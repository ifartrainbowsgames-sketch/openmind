// Artifact-first orchestration: planner → workers → judge → done. No agent chat theater.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import {
  liveBrain,
  runEmployee,
  simulatedBrain,
  type AgentBrain,
  type Employee,
  type LiveConnectionConfig,
  takeTokenUsage,
  type RunResult,
  type TokenUsage,
  type TraceLine,
} from './agent'
import type { CrewArtifact, CrewMemberResult, CrewRun } from './crew'
import {
  getActiveSandbox,
  setActiveCrewToolKeys,
  setActiveSandbox,
  setActiveWorkspace,
  type CrewToolKeys,
} from './crew-tools'
import { judgeTask } from './task-judge'
import { planProjectSmart, type PlannerBrain } from './task-planner-llm'
import { saveProject } from './project-store'
import {
  DEFAULT_BUDGET,
  DEFAULT_LIMITS,
  logEvent,
  projectBreach,
  readyTasks,
  recordDecision,
  recordEvidence,
  recordSpend,
  shouldSynthesizeNow,
  snapshot,
  type ArtifactRecord,
  type BudgetSpend,
  type ProjectBudget,
  type ProjectSnapshot,
  type ProjectState,
  type TaskRecord,
  type WorkerKind,
} from './task-ledger'
import { blockedMessage, isStrict } from './execution-mode'
import { withCrewTools, withGithubWorkspaceTools } from './crew'
import type { SkillId } from './skills'
import type { WorkspaceSpace } from './workspace'

export type { ProjectSnapshot }

export interface RunTaskGraphOptions {
  onTrace?: (line: TraceLine) => void
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>
  toolKeys?: CrewToolKeys
  workspace?: WorkspaceSpace
  skill?: SkillId
  /**
   * Provider for the task planner. Deliberately separate from the worker brain:
   * one model designing the graph, running every task in it, and judging the
   * result produces correlated failures — it approves its own plan.
   */
  planner?: PlannerBrain | null
  budget?: ProjectBudget
  /** Persist the ledger as it progresses. Off by default — callers opt in. */
  persist?: boolean
}

const WORKER_TOOLS: Record<WorkerKind, string[]> = {
  planner: [],
  research: ['web_search', 'browse_url', 'search_docs', 'summarize', 'memory_search'],
  browser: ['web_act', 'browse_url', 'web_search'],
  code: [
    'git_clone', 'workspace_ls', 'workspace_read_file', 'workspace_write_file', 'workspace_run',
    'run_checks', 'run_code', 'github_write_file', 'github_create_branch', 'calculator',
  ],
  analyst: ['summarize', 'calculator', 'memory_search'],
  writer: ['summarize', 'business_plan', 'web_search'],
  reviewer: [],
  tester: ['run_checks', 'workspace_run', 'workspace_read_file', 'browse_url', 'web_act'],
}

/**
 * Sandbox work is a sequence, not a single call: clone, install, edit, test,
 * read the failure, fix. Four steps cannot express that, so workers with a
 * machine get a wider plan than workers doing one lookup.
 */
const WORKSPACE_WORKERS: WorkerKind[] = ['code', 'tester']
const WORKSPACE_MAX_STEPS = 10

const WORKER_PROMPTS: Record<WorkerKind, string> = {
  planner: 'Break goals into tasks with concrete artifact outputs.',
  research: 'Gather evidence. Output JSON artifacts with sources array. No opinions without citations.',
  browser: 'Complete web actions. Record URLs visited and extracted data as JSON artifacts.',
  code: 'Write working code or files, then prove they work with run_checks. Output real file contents, never descriptions of files.',
  analyst: 'Synthesize inputs into a structured markdown report with sections and citations.',
  writer: 'Produce polished markdown deliverables. No meta-commentary about other agents.',
  reviewer: 'Validate artifacts against acceptance criteria. Return structured pass/fail only.',
  tester: "Run run_checks and report what the project's own tooling returned. Output test_results.json with passed, problems, exit codes — never a guess.",
}

function workerEmployee(kind: WorkerKind): Employee {
  return {
    id: `worker-${kind}`,
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    role: `${kind} worker`,
    prompt: WORKER_PROMPTS[kind],
    tools: WORKER_TOOLS[kind],
    accent: '#2f6594',
    maxSteps: WORKSPACE_WORKERS.includes(kind) ? WORKSPACE_MAX_STEPS : undefined,
  }
}

function artifactKind(path: string): ArtifactRecord['kind'] {
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.csv')) return 'csv'
  return 'markdown'
}

/** Parse ```lang optional/path\nbody``` fences from worker output. */
export function parseWorkerArtifacts(task: TaskRecord, answer: string, worker: WorkerKind): ArtifactRecord[] {
  const found: ArtifactRecord[] = []
  const fence = /```(?:json|markdown|md|html|csv)?\s*([^\n`]*)\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fence.exec(answer))) {
    const hint = m[1].trim()
    const body = m[2].trim()
    if (!body) continue
    const path = hint.includes('/') ? hint : task.outputs.find((p) => p.includes(hint)) ?? task.outputs[0]
    if (!path) continue
    found.push({
      id: `art-${task.id}-${found.length + 1}`,
      path,
      kind: artifactKind(path),
      title: path.split('/').pop() ?? path,
      body,
      taskId: task.id,
      worker,
      sources: countSources(body),
      confidence: 0.75,
      createdAt: Date.now(),
    })
  }

  for (const path of task.outputs) {
    if (found.some((a) => a.path === path)) continue
    if (path.endsWith('.json') && answer.includes('{')) {
      const json = extractJsonBlob(answer)
      if (json) {
        found.push(makeArtifact(task, path, json, worker))
      }
    } else if (answer.trim().length > 40) {
      found.push(makeArtifact(task, path, answer.trim().slice(0, 8000), worker))
    }
  }
  return found
}

function makeArtifact(task: TaskRecord, path: string, body: string, worker: WorkerKind): ArtifactRecord {
  return {
    id: `art-${task.id}-${path.replace(/\W/g, '-')}`,
    path,
    kind: artifactKind(path),
    title: path.split('/').pop() ?? path,
    body,
    taskId: task.id,
    worker,
    sources: countSources(body),
    confidence: 0.7,
    createdAt: Date.now(),
  }
}

function extractJsonBlob(text: string): string | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  const slice = text.slice(start, end + 1)
  try {
    JSON.parse(slice)
    return slice
  } catch {
    return undefined
  }
}

function extractUrls(body: string): string[] {
  return [...new Set(body.match(/https?:\/\/[^\s)\]"']+/g) ?? [])]
}

function countSources(body: string): number {
  return extractUrls(body).length
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Rough blended rate per 1K tokens. An estimate, and treated as one. */
const USD_PER_1K_TOKENS = 0.004
const CHARS_PER_TOKEN = 4

/**
 * Charge a worker run against the project budget. Prefers the token count the
 * provider actually billed; falls back to characters/4 only when the provider
 * reported no usage (keyless simulation, or an API that omits the block).
 * `measured` says which happened, so the number is never passed off as exact
 * when it was guessed.
 */
export function estimateRunSpend(
  prompt: string,
  result: RunResult,
  usage?: TokenUsage,
): BudgetSpend & { measured: boolean } {
  if (usage?.measured && usage.totalTokens > 0) {
    return {
      tokens: usage.totalTokens,
      costUsd: (usage.totalTokens / 1000) * USD_PER_1K_TOKENS,
      toolCalls: result.toolCalls.length,
      agentRuns: 1,
      measured: true,
    }
  }
  const chars =
    prompt.length +
    result.answer.length +
    result.toolCalls.reduce((sum, c) => sum + c.input.length + c.output.length, 0)
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN)
  return {
    tokens,
    costUsd: (tokens / 1000) * USD_PER_1K_TOKENS,
    toolCalls: result.toolCalls.length,
    agentRuns: 1,
    measured: false,
  }
}

function buildWorkerPrompt(project: ProjectState, task: TaskRecord): string {
  const inputs = task.dependsOn
    .flatMap((id) => project.artifacts.filter((a) => a.taskId === id))
    .map((a) => `INPUT ${a.path}:\n${a.body.slice(0, 4000)}`)
    .join('\n\n')
  return (
    `PROJECT GOAL: ${project.goal}\n\n` +
    `YOUR TASK ${task.id}: ${task.goal}\n\n` +
    `REQUIRED ARTIFACTS (write each as a fenced code block with path on first line):\n` +
    task.outputs.map((p) => `- ${p}`).join('\n') +
    `\n\nRULES: Produce files only. Do not chat with other agents. Do not say "I think" without evidence.\n` +
    (inputs ? `\nREAD THESE INPUTS:\n${inputs}\n` : '') +
    buildSharedContext(project) +
    buildRevisionBlock(project, task)
  )
}

/**
 * What the project already established. Without this every worker re-derives
 * the same facts from scratch, which is why the same questions kept coming
 * back around — the ledger held them, but nothing put them in the prompt.
 */
export function buildSharedContext(project: ProjectState): string {
  const decisions = project.decisions.slice(-6)
  const evidence = project.evidence.slice(-12)
  if (!decisions.length && !evidence.length) return ''
  return (
    '\nALREADY ESTABLISHED — do not re-derive:\n' +
    (decisions.length ? `Decisions:\n${decisions.map((d) => `- ${d}`).join('\n')}\n` : '') +
    (evidence.length ? `Sources already found:\n${evidence.map((e) => `- ${e}`).join('\n')}\n` : '')
  )
}

/**
 * Judge feedback for a rejected attempt. Without this a retry re-runs the
 * identical prompt — three throws of the same dice instead of an iteration.
 */
export function buildRevisionBlock(project: ProjectState, task: TaskRecord): string {
  const verdict = task.verdict
  if (!task.retries || !verdict || verdict.passed) return ''

  const rejected = project.artifacts
    .filter((a) => a.taskId === task.id)
    .map((a) => `REJECTED ${a.path}:\n${a.body.slice(0, 2000)}`)
    .join('\n\n')

  return (
    `\nATTEMPT ${task.retries + 1} of ${task.limits.maxRetries} — your previous attempt was REJECTED.\n\n` +
    `WHY IT FAILED:\n${verdict.problems.map((x) => `- ${x}`).join('\n')}\n\n` +
    `YOU MUST FIX ALL OF THESE:\n${verdict.requiredFixes.map((x) => `- ${x}`).join('\n')}\n\n` +
    (rejected ? `${rejected}\n\n` : '') +
    `Do not resubmit the same content. Address every required fix above.\n`
  )
}

function toCrewArtifacts(project: ProjectState): CrewArtifact[] {
  return project.artifacts.map((a) => ({
    id: a.id,
    kind: a.kind === 'json' || a.kind === 'csv' ? 'markdown' : a.kind,
    title: a.path,
    body: a.kind === 'json' ? '```json\n' + a.body + '\n```' : a.body,
  }))
}

function synthesizeAnswer(project: ProjectState): string {
  const lines = [`**${project.goal}**`, '']
  for (const task of project.tasks) {
    const icon = task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '○'
    lines.push(`${icon} ${task.id} (${task.worker}): ${task.goal}`)
  }
  lines.push('', '**Artifacts**', '')
  for (const a of project.artifacts) {
    lines.push(`- \`${a.path}\`${a.sources ? ` — ${a.sources} sources` : ''}`)
  }
  const report = project.artifacts.find((a) => a.path.includes('report') || a.path.includes('answer'))
  if (report) {
    lines.push('', report.body.slice(0, 6000))
  }
  return lines.join('\n')
}

const TaskRunState = Annotation.Root({
  rawTask: Annotation<string>(),
  project: Annotation<ProjectState>(),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  members: Annotation<CrewMemberResult[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  trace: Annotation<TraceLine[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})

type TRS = typeof TaskRunState.State

async function executeBatch(
  brain: AgentBrain,
  project: ProjectState,
  options: RunTaskGraphOptions,
): Promise<{ project: ProjectState; members: CrewMemberResult[]; trace: TraceLine[] }> {
  const batch = readyTasks(project)
  if (!batch.length) return { project, members: [], trace: [] }

  let next = project
  const members: CrewMemberResult[] = []
  const trace: TraceLine[] = []

  for (const task of batch) {
    if (task.stepsUsed >= task.limits.maxSteps) {
      next = updateTask(next, task.id, { status: 'blocked', blocker: 'Max steps exceeded' })
      continue
    }

    // Budget is checked per task, not per batch — a run that exhausts itself
    // mid-batch must not start the next worker on credit.
    const breach = projectBreach(next)
    if (breach) {
      next = updateTask(next, task.id, {
        status: 'blocked',
        blocker: `Budget exhausted: ${breach.dimension} ${round2(breach.used)}/${breach.limit}`,
      })
      next = logEvent(next, {
        action: 'report_blocker',
        taskId: task.id,
        worker: task.worker,
        detail: blockedMessage('budget_exhausted', task.worker, `${breach.dimension} ${round2(breach.used)}/${breach.limit}`),
      })
      continue
    }

    let employee = withGithubWorkspaceTools(withCrewTools(workerEmployee(task.worker)), options.workspace)
    const prompt = buildWorkerPrompt(next, task)
    next = logEvent(next, { action: 'request_tool', taskId: task.id, worker: task.worker, detail: task.goal })

    // The prompt has captured the rejected bodies; drop them so the judge only
    // ever sees what this attempt produced. Otherwise a retry that emits
    // nothing parseable gets re-judged on its own rejected work.
    if (task.retries > 0) next = clearTaskArtifacts(next, task.id)

    // Hand this run the project's sandbox, then take back whatever it ended
    // with — the function may have created or replaced one.
    setActiveSandbox(next.sandboxId)
    takeTokenUsage() // start a clean accounting window for this worker
    const result = await runEmployee(
      brain,
      employee,
      prompt,
      (line) => options.onTrace?.({ ...line, text: `${task.worker}: ${line.text}` }),
      options.configs,
    )
    const sandboxAfter = getActiveSandbox()
    if (sandboxAfter && sandboxAfter !== next.sandboxId) {
      next = { ...next, sandboxId: sandboxAfter }
    }

    members.push({ employeeId: employee.id, name: employee.name, role: employee.role, result })
    trace.push({ node: 'act', text: `${task.id} ${task.worker} — ${result.toolCalls.length} tools` })

    const spent = estimateRunSpend(prompt, result, takeTokenUsage())
    next = recordSpend(next, spent)
    if (!spent.measured) {
      trace.push({ node: 'act', text: `${task.id} spend estimated (provider reported no usage)` })
    }

    // A worker that came back only with blocked tool calls did not fail at its
    // job — the capability was missing. That is the user's decision to make.
    const blockedCalls = result.toolCalls.filter((c) => c.error?.kind === 'blocked')
    if (result.toolCalls.length > 0 && blockedCalls.length === result.toolCalls.length) {
      const reason = blockedCalls[0].error?.message ?? 'required capability unavailable'
      next = updateTask(next, task.id, { status: 'needs_user', blocker: reason, costUsd: task.costUsd + spent.costUsd })
      next = { ...next, blockers: [...next.blockers, `${task.id}: ${reason}`] }
      next = logEvent(next, { action: 'report_blocker', taskId: task.id, worker: task.worker, detail: reason })
      continue
    }

    const artifacts = parseWorkerArtifacts(task, result.answer, task.worker)
    next = {
      ...next,
      artifacts: [...next.artifacts.filter((a) => !artifacts.some((n) => n.path === a.path)), ...artifacts],
    }
    // Evidence is the URL set behind the artifacts — carried on the project so
    // a later worker cites what an earlier one found instead of re-searching.
    next = recordEvidence(next, artifacts.flatMap((a) => extractUrls(a.body)))
    next = updateTask(next, task.id, {
      status: 'running',
      stepsUsed: task.stepsUsed + result.toolCalls.length + 1,
      costUsd: task.costUsd + spent.costUsd,
      artifactIds: artifacts.map((a) => a.id),
    })
  }

  return { project: next, members, trace }
}

/**
 * Checkpoint the ledger. A persistence failure must not lose the run in
 * progress, so demo mode swallows it; strict mode lets it surface, because a
 * project that silently exists only in RAM is a project you will lose.
 */
async function persistQuietly(project: ProjectState, options: RunTaskGraphOptions): Promise<void> {
  if (!options.persist) return
  try {
    await saveProject(project)
  } catch (err) {
    if (isStrict()) throw err
  }
}

/** Drop every artifact a task produced — used to clear a rejected attempt. */
export function clearTaskArtifacts(project: ProjectState, taskId: string): ProjectState {
  return { ...project, artifacts: project.artifacts.filter((a) => a.taskId !== taskId) }
}

function updateTask(project: ProjectState, taskId: string, patch: Partial<TaskRecord>): ProjectState {
  return {
    ...project,
    tasks: project.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
  }
}

function judgeBatch(project: ProjectState): ProjectState {
  let next = project
  for (const task of next.tasks.filter((t) => t.status === 'running')) {
    const taskArtifacts = next.artifacts.filter((a) => a.taskId === task.id)
    const verdict = judgeTask(task, taskArtifacts)
    if (verdict.passed) {
      next = updateTask(next, task.id, { status: 'completed', verdict })
      next = recordDecision(next, `${task.id} accepted (${verdict.score}/100): ${task.goal} → ${task.outputs.join(', ')}`)
      next = logEvent(next, {
        action: 'complete_task',
        taskId: task.id,
        worker: task.worker,
        detail: `PASS score=${verdict.score} artifacts=${task.outputs.join(', ')}`,
      })
    } else if (task.retries + 1 >= task.limits.maxRetries) {
      next = updateTask(next, task.id, {
        status: 'failed',
        verdict,
        blocker: verdict.problems.join('; '),
      })
      next = {
        ...next,
        blockers: [...next.blockers, `${task.id}: ${verdict.problems[0] ?? 'failed'}`],
      }
      next = logEvent(next, {
        action: 'report_blocker',
        taskId: task.id,
        worker: task.worker,
        detail: verdict.problems.join('; '),
      })
    } else {
      next = updateTask(next, task.id, {
        status: 'pending',
        retries: task.retries + 1,
        verdict,
      })
      next = logEvent(next, {
        action: 'request_review',
        taskId: task.id,
        worker: task.worker,
        detail: `FAIL retry ${task.retries + 1}: ${verdict.requiredFixes[0] ?? 'fix artifacts'}`,
      })
    }
  }
  return next
}

const TERMINAL: TaskRecord['status'][] = ['completed', 'failed', 'blocked', 'needs_user']

function allTerminal(project: ProjectState): boolean {
  return project.tasks.every((t) => TERMINAL.includes(t.status))
}

function hasPendingWork(project: ProjectState): boolean {
  return readyTasks(project).length > 0 || project.tasks.some((t) => t.status === 'running')
}

export async function runTaskGraph(
  rawTask: string,
  brain: AgentBrain,
  options: RunTaskGraphOptions = {},
): Promise<CrewRun & { project: ProjectSnapshot }> {
  setActiveCrewToolKeys(options.toolKeys ?? {})
  setActiveWorkspace(options.workspace)

  const { project: initial } = await planProjectSmart(
    rawTask,
    options.planner,
    DEFAULT_LIMITS,
    options.budget ?? DEFAULT_BUDGET,
  )
  let project = initial
  let allMembers: CrewMemberResult[] = []
  let allTrace: TraceLine[] = [{ node: 'plan', text: `Task graph — ${project.tasks.length} tasks` }]

  const executeNode = async (state: TRS): Promise<Partial<TRS>> => {
    const { project: p, members, trace } = await executeBatch(brain, state.project, options)
    return { project: p, members, trace }
  }

  const judgeNode = async (state: TRS): Promise<Partial<TRS>> => {
    const p = judgeBatch(state.project)
    await persistQuietly(p, options)
    return {
      project: p,
      trace: [{ node: 'plan', text: `Judge — ${p.tasks.filter((t) => t.status === 'completed').length}/${p.tasks.length} done` }],
    }
  }

  const finishNode = async (state: TRS): Promise<Partial<TRS>> => {
    const answer = synthesizeAnswer(state.project)
    const finished = { ...state.project, finishedAt: Date.now(), finalOutput: answer }
    await persistQuietly(finished, options)
    return {
      project: finished,
      answer,
      trace: [{ node: 'respond', text: 'Artifacts assembled' }],
    }
  }

  const routeAfterJudge = (state: TRS): 'execute' | 'finish' => {
    if (allTerminal(state.project)) return 'finish'
    // Past the synthesize threshold, assemble what exists rather than starting
    // work the remaining budget cannot finish.
    if (shouldSynthesizeNow(state.project)) return 'finish'
    if (hasPendingWork(state.project)) return 'execute'
    return 'finish'
  }

  const graph = new StateGraph(TaskRunState)
    .addNode('execute', executeNode)
    .addNode('judge', judgeNode)
    .addNode('finish', finishNode)
    .addEdge(START, 'execute')
    .addEdge('execute', 'judge')
    .addConditionalEdges('judge', routeAfterJudge, { execute: 'execute', finish: 'finish' })
    .addEdge('finish', END)

  const compiled = graph.compile()
  let final: TRS = { rawTask, project, answer: '', members: [], trace: [] }

  for await (const update of await compiled.stream({ rawTask, project, answer: '', members: [], trace: [] }, { streamMode: 'updates' })) {
    for (const partial of Object.values(update) as Partial<TRS>[]) {
      final = {
        ...final,
        ...partial,
        project: partial.project ?? final.project,
        members: partial.members ? final.members.concat(partial.members) : final.members,
        trace: partial.trace ? final.trace.concat(partial.trace) : final.trace,
      }
      if (partial.members) allMembers = allMembers.concat(partial.members)
      if (partial.trace) allTrace = allTrace.concat(partial.trace)
    }
  }

  setActiveCrewToolKeys({})
  const artifacts = toCrewArtifacts(final.project)
  return {
    answer: final.answer,
    members: allMembers,
    artifacts,
    trace: allTrace,
    employeeIds: [...new Set(allMembers.map((m) => m.employeeId))],
    project: snapshot(final.project),
  }
}

export { simulatedBrain, liveBrain }
