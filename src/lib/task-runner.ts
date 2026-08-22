// Artifact-first orchestration: planner → workers → judge → done. No agent chat theater.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import {
  liveBrain,
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
  setActiveCrewToolKeys,
  setPlatformKeysAllowed,
  setActiveWorkspace,
  type CrewToolKeys,
} from './crew-tools'
import { judgeTask } from './task-judge'
import {
  CAPABILITY_WORKER, DELEGATION_PROMPT, emptyDelegationState, evaluateSpawn,
  parseSpawnRequests, recordSpawn,
} from './workforce/delegation'
import {
  runtimeShortfall, toCapability, type RuntimeCapabilities,
} from './workforce/capabilities'
import { runtimeFor, type AgentRuntime, type TaskContext } from './workforce/agent-runtime'
import { createBuiltinRuntime } from './workforce/builtin-runtime'
import type { OpenMindEvent, RunOutcome } from './workforce/events'
import { makeWorkspace } from './workforce/runtime'
import { renderConstitution, withProjectRules } from './workforce/constitution'
import { mergeAcceptance, renderSop, sopFor } from './workforce/sop'
import { renderMemory } from './workforce/memory-layers'
import {
  accountUserLayer, createMemoryService, initialBook, type MemoryService,
} from './workforce/memory-service'
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
  type JudgeVerdict,
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
  /**
   * Let this run draw on the deployment's own tool credentials. Only true for
   * platform-billed runs — a customer funding their own model must not have
   * their search and sandbox calls billed to us.
   */
  platformKeys?: boolean
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
  /**
   * Asked before each task starts. Returning true stops the run.
   *
   * Checked between tasks rather than mid-task: a task is the smallest unit
   * that produces a coherent artifact, and abandoning one halfway leaves the
   * ledger describing work that was never finished. The worker uses this to
   * honour a cancellation the user made after the run was claimed.
   */
  shouldStop?: () => boolean | Promise<boolean>
  /** Which AgentRuntime executes tasks. Defaults to the registered default. */
  runtimeId?: string
  /** Canonical runtime events, for the UI and any future replay/event store. */
  onEvent?: (event: OpenMindEvent) => void
}

/** The workspace a session runs in. One per project for now; worktrees later. */
function sessionWorkspace(project: ProjectState) {
  // Carry the project's machine in, so a resumed project keeps its sandbox
  // instead of silently starting a fresh one.
  return { ...makeWorkspace(project.id), sandboxId: project.sandboxId }
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

/**
 * Files the tools produced, as ledger records.
 *
 * `ToolCall.artifacts` existed and nothing read it, so a tool that wrote a
 * real file had it silently discarded and the ledger kept only whatever the
 * model said about it afterwards. That is the gap that made the browser
 * subsystem look wired when its output could never reach a judge.
 *
 * Confidence is higher than a parsed answer's because the provenance is
 * better: these bytes came from a tool, not from a model's account of one.
 */
export function toolArtifacts(task: TaskRecord, result: RunResult): ArtifactRecord[] {
  const out: ArtifactRecord[] = []
  for (const call of result.toolCalls) {
    if (call.error) continue
    for (const artifact of call.artifacts ?? []) {
      if (!artifact.path || !artifact.body.trim()) continue
      out.push({ ...makeArtifact(task, artifact.path, artifact.body, task.worker), confidence: 0.9 })
    }
  }
  return out
}

/** First list wins on a path collision. */
function mergeArtifacts(
  preferred: readonly ArtifactRecord[],
  fallback: readonly ArtifactRecord[],
): ArtifactRecord[] {
  const taken = new Set(preferred.map((a) => a.path))
  return [...preferred, ...fallback.filter((a) => !taken.has(a.path))]
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

function buildWorkerPrompt(project: ProjectState, task: TaskRecord, memoryText?: string): string {
  const inputs = task.dependsOn
    .flatMap((id) => project.artifacts.filter((a) => a.taskId === id))
    .map((a) => `INPUT ${a.path}:\n${a.body.slice(0, 4000)}`)
    .join('\n\n')
  const rules = renderConstitution(withProjectRules(project.rules))
  const sop = sopFor(task.worker)
  return (
    // Rules lead. What follows is a role description, and a role description
    // was never the thing keeping a worker honest.
    (rules ? `${rules}\n\n` : '') +
    `PROJECT GOAL: ${project.goal}\n\n` +
    `YOUR TASK ${task.id}: ${task.goal}\n\n` +
    `REQUIRED ARTIFACTS (write each as a fenced code block with path on first line):\n` +
    task.outputs.map((p) => `- ${p}`).join('\n') +
    `\n` +
    (inputs ? `\nREAD THESE INPUTS:\n${inputs}\n` : '') +
    (sop ? `
${renderSop(sop)}
` : '') +
    // Canonical memory. Supplied by the kernel service when a run is in
    // progress; the project-only view otherwise. Every worker on every runtime
    // receives this — it is not something a worker chooses to look up.
    (memoryText ? `\n${memoryText}\n` : buildSharedContext(project)) +
    // Only offered where it can be honoured. At max depth, or once the project
    // has spent its delegation budget, describing the option would invite a
    // request guaranteed to be refused — and a worker that asks and is denied
    // has burned a step for nothing.
    (canDelegate(project, task) ? `\n\n${DELEGATION_PROMPT}\n` : '') +
    buildRevisionBlock(project, task)
  )
}

/** Whether this task could still spawn a helper, given the limits so far. */
function canDelegate(project: ProjectState, task: TaskRecord): boolean {
  return evaluateSpawn(
    {
      parentTaskId: task.id,
      capability: 'data.analyze',
      goal: 'probe',
      inputArtifacts: [],
      expectedOutputs: [{ path: `__probe__/${task.id}.json`, kind: 'json' }],
    },
    {
      tasks: project.tasks,
      artifactPaths: project.artifacts.map((a) => a.path),
      state: project.delegation ?? emptyDelegationState(),
    },
  ).allowed
}

/**
 * What the project already established, rendered from canonical memory.
 *
 * This used to format `decisions` and `evidence` directly. It now renders the
 * memory book, seeded from those same two arrays for projects that predate it —
 * so there is one renderer rather than a prompt block and a memory layer
 * describing the same facts differently.
 *
 * The synchronous, project-only view. A run supplies the fuller one through
 * the memory service, which merges the account's user layer on top.
 */
export function buildSharedContext(project: ProjectState): string {
  const text = renderMemory(initialBook(project))
  return text ? `\n${text}\n` : ''
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


/**
 * Adjudicate a worker's delegation requests and create the tasks it earned.
 *
 * The worker asked; the orchestrator decides. A refusal is written back as a
 * ledger event rather than thrown away, so "I asked for help and was told no"
 * appears in the trace instead of looking like the worker did nothing.
 */
export function applyDelegation(
  project: ProjectState,
  task: TaskRecord,
  answer: string,
): { project: ProjectState; created: number } {
  const requests = parseSpawnRequests(answer, task.id)
  if (!requests.length) return { project, created: 0 }

  let next = project
  let state = next.delegation ?? emptyDelegationState()
  let created = 0

  for (const request of requests) {
    // Legacy coarse names resolve rather than being refused: they are in the
    // prompt a model was shown and in ledgers already on disk, and "unknown
    // capability" is the wrong thing to tell a worker that asked correctly.
    const capability = toCapability(request.capability)
    if (!capability) {
      next = logEvent(next, {
        action: 'request_subtask', taskId: task.id, worker: task.worker,
        detail: `refused — unknown capability "${request.capability}"`,
      })
      continue
    }

    const decision = evaluateSpawn(request, {
      tasks: next.tasks,
      artifactPaths: next.artifacts.map((a) => a.path),
      state,
    })

    if (!decision.allowed) {
      next = logEvent(next, {
        action: 'request_subtask', taskId: task.id, worker: task.worker,
        detail: `refused (${decision.reason}) — ${decision.detail ?? ''}`.trim(),
      })
      continue
    }

    const worker = CAPABILITY_WORKER[capability]
    const childId = `${task.id}-d${(state.children[task.id] ?? 0) + 1}`
    const child: TaskRecord = {
      id: childId,
      type: worker,
      goal: request.goal,
      inputs: { from: task.id },
      outputs: request.expectedOutputs.map((o: { path: string }) => o.path),
      dependsOn: [],
      status: 'pending',
      worker,
      parentTaskId: task.id,
      limits: task.limits,
      retries: 0,
      stepsUsed: 0,
      costUsd: 0,
      artifactIds: [],
    }

    next = { ...next, tasks: [...next.tasks, child] }
    state = recordSpawn(state, task.id, childId, decision.childDepth ?? 1)
    created++
    next = logEvent(next, {
      action: 'request_subtask', taskId: task.id, worker: task.worker,
      detail: `spawned ${childId} (${worker}) → ${child.outputs.join(', ')}`,
    })
  }

  return { project: { ...next, delegation: state }, created }
}

/** The kernel's memory service for one run. */
interface MemoryPass {
  service: MemoryService
}

/**
 * Refuse a task the chosen runtime cannot do, before spending anything on it.
 *
 * This is the half of capability routing that did not exist. `assignWorker`
 * ran once, at plan time, matching a task type to a worker kind; nothing
 * consulted capabilities at dispatch. So a task could be handed to a runtime
 * with no chance of completing it, and the failure would arrive as whatever
 * that runtime does when asked for something it cannot do — a timeout, an
 * empty answer, a judge rejection — rather than as "this runtime cannot write
 * files".
 */
function capabilityBlocker(
  task: TaskRecord,
  capabilities: RuntimeCapabilities | undefined,
  runtimeId: string,
): string | undefined {
  if (!capabilities) return undefined
  const missing = runtimeShortfall(task.worker, capabilities)
  if (!missing.length) return undefined
  return `runtime "${runtimeId}" cannot ${missing.join(', ')}`
}

async function executeBatch(
  project: ProjectState,
  options: RunTaskGraphOptions,
  runtime: AgentRuntime,
  memory: MemoryPass,
  capabilities: RuntimeCapabilities | undefined,
  /** Set when the runtime itself cannot run — every task blocks on it. */
  unavailable: string | undefined,
): Promise<{ project: ProjectState; members: CrewMemberResult[]; trace: TraceLine[] }> {
  const batch = readyTasks(project)
  if (!batch.length) return { project, members: [], trace: [] }

  let next = project
  const members: CrewMemberResult[] = []
  const trace: TraceLine[] = []

  for (const task of batch) {
    // Cancellation is checked here, before any spend. A run the user stopped
    // must not start another worker.
    if (options.shouldStop && (await options.shouldStop())) {
      next = updateTask(next, task.id, { status: 'blocked', blocker: 'Run cancelled' })
      next = logEvent(next, {
        action: 'report_blocker',
        taskId: task.id,
        worker: task.worker,
        detail: 'cancelled by the user',
      })
      continue
    }

    // Availability first, then capability: both are cheaper than the budget
    // check and both are harder noes. A runtime that cannot run, or cannot do
    // the work, will not manage either more cheaply later.
    const unable = unavailable ?? capabilityBlocker(task, capabilities, runtime.id)
    if (unable) {
      next = updateTask(next, task.id, { status: 'needs_user', blocker: unable })
      next = { ...next, blockers: [...next.blockers, `${task.id}: ${unable}`] }
      next = logEvent(next, {
        action: 'report_blocker', taskId: task.id, worker: task.worker,
        detail: blockedMessage('capability_unavailable', task.worker, unable),
      })
      continue
    }

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

    // Canonical memory, before execution, unconditionally. Not a tool the
    // worker may call — the whole point is that a Claude Code worker, a Codex
    // worker and the builtin worker all start from the same project facts. It
    // travels as an argument to runTask for exactly that reason.
    const taskContext: TaskContext = {
      memory: await memory.service.buildContext({
        book: next.memory ?? { entries: [] },
        projectId: next.id,
        task,
        worker: task.worker,
      }),
    }

    const employee = withGithubWorkspaceTools(withCrewTools(workerEmployee(task.worker)), options.workspace)
    const prompt = buildWorkerPrompt(next, task, taskContext.memory.text)
    next = logEvent(next, { action: 'request_tool', taskId: task.id, worker: task.worker, detail: task.goal })

    // The prompt has captured the rejected bodies; drop them so the judge only
    // ever sees what this attempt produced. Otherwise a retry that emits
    // nothing parseable gets re-judged on its own rejected work.
    if (task.retries > 0) next = clearTaskArtifacts(next, task.id)

    // Hand this run the project's sandbox, then take back whatever it ended
    // with — the function may have created or replaced one.
    // The sandbox belongs to the session, not to this loop. The runtime binds
    // it before the worker runs and adopts whatever it ends on — one workspace
    // identity per session. Setting it here too would give the agent's tools
    // one machine and inspectWorkspace() another.
    takeTokenUsage() // start a clean accounting window for this worker

    // Execution goes through the runtime, never through runEmployee directly.
    // One path: the runtime owns session identity and workspace ownership, and
    // the builtin implementation is what wraps the employee graph.
    const session = await runtime.createSession({
      projectId: next.id,
      worker: task.worker,
      workspace: sessionWorkspace(next),
    })

    // The session resumed but its machine did not. Running anyway would
    // provision an empty sandbox and report it as the same session — every
    // file the last task wrote silently gone, and the first thing this task
    // does is assume they are there. Blocking is the honest outcome.
    const recovery = session.recovery
    if (recovery && (recovery.kind === 'lost' || recovery.kind === 'needs_user')) {
      next = updateTask(next, task.id, { status: 'needs_user', blocker: recovery.reason })
      next = { ...next, blockers: [...next.blockers, `${task.id}: ${recovery.reason}`] }
      next = logEvent(next, {
        action: 'report_blocker', taskId: task.id, worker: task.worker,
        detail: blockedMessage('capability_unavailable', 'workspace', recovery.reason),
      })
      // The project's remembered sandbox is gone. Clearing it stops the next
      // run inheriting a pointer we have already proven dead.
      next = { ...next, sandboxId: undefined }
      next = await recordTaskMemory(next, memory, task, undefined, [])
      continue
    }

    let result: RunResult | undefined
    let outcome: RunOutcome | undefined
    let outcomeText = ''
    /** Approval requests the runtime surfaced, in the order they were asked. */
    const approvals: string[] = []
    for await (const ev of runtime.runTask(session, task, taskContext)) {
      // Runtime events reach the trace, so the UI observes the same stream the
      // orchestrator does rather than a parallel one.
      if (ev.kind === 'task_finished') {
        result = ev.result as RunResult | undefined
        outcome = ev.outcome
        outcomeText = ev.text
        if (ev.outcome && ev.outcome !== 'completed') {
          trace.push({ node: 'act', text: `${task.id} ${task.worker} — ${ev.outcome}: ${ev.text}` })
        }
      } else if (ev.kind === 'blocked') {
        approvals.push(ev.text)
        trace.push({ node: 'act', text: `${task.worker}: blocked — ${ev.text}` })
      } else if (ev.kind === 'agent_thinking') {
        // Same live trace the direct call used to produce, now sourced from the
        // runtime's stream instead of a second callback path.
        options.onTrace?.({ node: 'act', text: `${task.worker}: ${ev.text}` })
      }
      options.onEvent?.(ev)
    }

    if (!result) {
      // The runtime terminated without a result. Treat it as a failed task
      // rather than inventing an empty one, which would judge as an artifact-less
      // completion.
      next = updateTask(next, task.id, { status: 'failed', blocker: 'runtime returned no result' })
      next = logEvent(next, {
        action: 'report_blocker', taskId: task.id, worker: task.worker,
        detail: 'runtime returned no result',
      })
      next = await recordTaskMemory(next, memory, task, undefined, [])
      continue
    }

    // THE RUNTIME'S OUTCOME IS AUTHORITATIVE.
    //
    // It used to reach nothing but a trace line, so a runtime reporting
    // `needs_user` — Claude Code waiting on an approval it was refused — fell
    // straight through to artifact parsing and judging. The task would then
    // fail for having produced no artifacts, which is true and is not the
    // reason. "Awaiting your approval to run npm install" and "the worker
    // produced nothing" are different states and the user can only act on one.
    if (outcome && outcome !== 'completed') {
      const detail = approvals.length ? approvals.join('; ') : outcomeText
      const status: TaskRecord['status'] =
        outcome === 'needs_user' ? 'needs_user'
        : outcome === 'cancelled' ? 'blocked'
        : outcome === 'blocked' ? 'blocked'
        : 'failed'

      next = updateTask(next, task.id, { status, blocker: detail })
      if (status === 'needs_user' || status === 'blocked') {
        next = { ...next, blockers: [...next.blockers, `${task.id}: ${detail}`] }
      }
      next = logEvent(next, {
        action: 'report_blocker', taskId: task.id, worker: task.worker, detail,
      })
      next = await recordTaskMemory(next, memory, task, result, [])
      continue
    }

    // Mirror the session's machine onto the project so a reload can find it.
    const sessionSandbox = (await runtime.resumeSession(session.id))?.workspace?.sandboxId
    if (sessionSandbox && sessionSandbox !== next.sandboxId) {
      next = { ...next, sandboxId: sessionSandbox }
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
      // A blocked capability is a fact about the project, not about this
      // attempt. Recorded here because this path is terminal — it never
      // reaches the judge, and without this every later worker rediscovers
      // that the same connection is missing.
      next = await recordTaskMemory(next, memory, task, result, [])
      continue
    }

    // Delegation is adjudicated before artifacts, so a worker that both asked
    // for help and produced partial output still gets its helper queued.
    const delegated = applyDelegation(next, task, result.answer)
    next = delegated.project
    if (delegated.created) {
      trace.push({ node: 'act', text: `${task.id} delegated ${delegated.created} subtask(s)` })
    }

    // Files a tool produced directly, then files described in the answer.
    // Tool artifacts win on a path collision: a browser session that wrote
    // sources.json from the URLs it actually visited is evidence, and the
    // model's prose account of the same page is a description of evidence.
    const artifacts = mergeArtifacts(
      toolArtifacts(task, result),
      parseWorkerArtifacts(task, result.answer, task.worker),
    )
    next = {
      ...next,
      artifacts: [...next.artifacts.filter((a) => !artifacts.some((n) => n.path === a.path)), ...artifacts],
    }
    // Evidence is the URL set behind the artifacts — carried on the project so
    // a later worker cites what an earlier one found instead of re-searching.
    next = recordEvidence(next, artifacts.flatMap((a) => extractUrls(a.body)))
    // What this attempt produced. The verdict is added after the judge runs —
    // recordOutcome is idempotent, so each caller contributes what it knows.
    next = await recordTaskMemory(next, memory, task, result, artifacts)
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

/**
 * Record one task's outcome into canonical memory.
 *
 * Called from every path a task can terminate on: blocked before the judge,
 * no result at all, and after judging. `recordOutcome` deduplicates, so a task
 * that passes through two of them contributes what each knew without writing
 * the same fact twice.
 */
async function recordTaskMemory(
  project: ProjectState,
  memory: MemoryPass,
  task: TaskRecord,
  result: RunResult | undefined,
  artifacts: readonly ArtifactRecord[],
  verdict?: JudgeVerdict,
): Promise<ProjectState> {
  const book = await memory.service.recordOutcome({
    book: project.memory ?? { entries: [] },
    projectId: project.id,
    task,
    result,
    artifacts,
    verdict,
  })
  return { ...project, memory: book }
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

async function judgeBatch(project: ProjectState, memory: MemoryPass): Promise<ProjectState> {
  let next = project
  for (const task of next.tasks.filter((t) => t.status === 'running')) {
    const taskArtifacts = next.artifacts.filter((a) => a.taskId === task.id)
    // The SOP's criteria are part of the contract, not advice. Judging against
    // the merged set is what stops a procedure that says "cite your sources"
    // from being a suggestion the worker can decline.
    const contract: TaskRecord = {
      ...task,
      acceptance: mergeAcceptance(sopFor(task.worker), task.acceptance),
    }
    const verdict = judgeTask(contract, taskArtifacts)
    // The validator's decision is the part of the outcome worth carrying
    // forward — a pass supersedes the failures recorded for the same task, so
    // a fixed problem stops being recalled as an open one.
    next = await recordTaskMemory(next, memory, task, undefined, taskArtifacts, verdict)
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
  setPlatformKeysAllowed(options.platformKeys === true)
  setActiveWorkspace(options.workspace)

  const { project: initial } = await planProjectSmart(
    rawTask,
    options.planner,
    DEFAULT_LIMITS,
    options.budget ?? DEFAULT_BUDGET,
  )
  // Canonical memory for this run. Seeded from the ledger's decisions and
  // evidence so a project that predates the memory service does not look like
  // one that has established nothing.
  const memory: MemoryPass = {
    service: createMemoryService({ userLayer: accountUserLayer() }),
  }
  const project: ProjectState = { ...initial, memory: initialBook(initial) }
  let allMembers: CrewMemberResult[] = []
  let allTrace: TraceLine[] = [{ node: 'plan', text: `Task graph — ${project.tasks.length} tasks` }]

  /**
   * One runtime for the whole run.
   *
   * The builtin is constructed here rather than pulled from the registry
   * because its dependencies — the brain, the employee, the composed prompt —
   * are per-run values. A registered singleton holding them would be shared
   * mutable state that two concurrent runs would corrupt. External runtimes
   * (Claude Code, Codex, Wayland Core) have no such dependency and do come from
   * the registry, by id.
   *
   * Built once, not per task, so a worker's session survives across the tasks
   * it serves instead of being reopened each time.
   */
  const runtime: AgentRuntime = options.runtimeId
    ? runtimeFor(options.runtimeId)
    : createBuiltinRuntime({
        brain,
        employeeFor: (task) =>
          withGithubWorkspaceTools(withCrewTools(workerEmployee(task.worker)), options.workspace),
        promptFor: (task, context) => buildWorkerPrompt(currentProject, task, context.memory.text),
        configs: options.configs,
        // Carried on the context rather than read from module state by the
        // tool layer, so what a run may spend is a property of the run.
        permissions: { platformKeys: options.platformKeys === true },
        // The explicit half of memory: the kernel already put this project's
        // established facts in the prompt, and a worker that wants to look
        // further searches the same canonical book rather than its own.
        memory: {
          search: async (query, limit) => {
            const hits = await memory.service.search(
              currentProject.memory ?? { entries: [] },
              { text: query, limit },
            )
            return hits.map((e) => `(${e.layer}/${e.kind}) ${e.text}`)
          },
        },
      })

  // What this runtime can actually do, asked once. Tasks it cannot serve are
  // refused before they cost anything.
  const capabilities = await runtime.capabilities().catch(() => undefined)

  // And whether it can run at all. A selected runtime that is not installed
  // must BLOCK the work — quietly running it on the builtin runtime instead
  // would answer with a different agent and report success.
  const availability = runtime.available
    ? await runtime.available().catch((error: unknown) => ({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      }))
    : { ok: true }
  const unavailable = availability.ok
    ? undefined
    : `runtime "${runtime.id}" is unavailable: ${availability.reason ?? 'no reason given'}`

  // The prompt needs the ledger as it stands when the task runs, not as it was
  // when the runtime was built.
  let currentProject: ProjectState = project

  const executeNode = async (state: TRS): Promise<Partial<TRS>> => {
    currentProject = state.project
    const { project: p, members, trace } =
      await executeBatch(state.project, options, runtime, memory, capabilities, unavailable)
    return { project: p, members, trace }
  }

  const judgeNode = async (state: TRS): Promise<Partial<TRS>> => {
    const p = await judgeBatch(state.project, memory)
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
