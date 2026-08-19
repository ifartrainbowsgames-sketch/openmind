// Artifact-first orchestration: planner → workers → judge → done. No agent chat theater.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import {
  liveBrain,
  runEmployee,
  simulatedBrain,
  type AgentBrain,
  type Employee,
  type LiveConnectionConfig,
  type TraceLine,
} from './agent'
import type { CrewArtifact, CrewMemberResult, CrewRun } from './crew'
import { setActiveCrewToolKeys, setActiveWorkspace, type CrewToolKeys } from './crew-tools'
import { judgeTask } from './task-judge'
import { planProject } from './task-planner'
import {
  logEvent,
  readyTasks,
  snapshot,
  type ArtifactRecord,
  type ProjectSnapshot,
  type ProjectState,
  type TaskRecord,
  type WorkerKind,
} from './task-ledger'
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
}

const WORKER_TOOLS: Record<WorkerKind, string[]> = {
  planner: [],
  research: ['web_search', 'browse_url', 'search_docs', 'summarize', 'memory_search'],
  browser: ['web_act', 'browse_url', 'web_search'],
  code: ['run_code', 'code_review', 'github_write_file', 'github_create_branch', 'calculator'],
  analyst: ['summarize', 'calculator', 'memory_search'],
  writer: ['summarize', 'business_plan', 'web_search'],
  reviewer: [],
  tester: ['browse_url', 'web_act', 'code_review'],
}

const WORKER_PROMPTS: Record<WorkerKind, string> = {
  planner: 'Break goals into tasks with concrete artifact outputs.',
  research: 'Gather evidence. Output JSON artifacts with sources array. No opinions without citations.',
  browser: 'Complete web actions. Record URLs visited and extracted data as JSON artifacts.',
  code: 'Write working code or files. Output real file contents, not descriptions of files.',
  analyst: 'Synthesize inputs into a structured markdown report with sections and citations.',
  writer: 'Produce polished markdown deliverables. No meta-commentary about other agents.',
  reviewer: 'Validate artifacts against acceptance criteria. Return structured pass/fail only.',
  tester: 'Run validation checks. Output test_results.json with passed, problems, screenshots list.',
}

function workerEmployee(kind: WorkerKind): Employee {
  return {
    id: `worker-${kind}`,
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    role: `${kind} worker`,
    prompt: WORKER_PROMPTS[kind],
    tools: WORKER_TOOLS[kind],
    accent: '#2f6594',
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

function countSources(body: string): number {
  const urls = body.match(/https?:\/\/[^\s)\]"']+/g) ?? []
  return new Set(urls).size
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
    (inputs ? `\nREAD THESE INPUTS:\n${inputs}\n` : '')
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

    let employee = withGithubWorkspaceTools(withCrewTools(workerEmployee(task.worker)), options.workspace)
    const prompt = buildWorkerPrompt(next, task)
    next = logEvent(next, { action: 'request_tool', taskId: task.id, worker: task.worker, detail: task.goal })

    const result = await runEmployee(
      brain,
      employee,
      prompt,
      (line) => options.onTrace?.({ ...line, text: `${task.worker}: ${line.text}` }),
      options.configs,
    )

    members.push({ employeeId: employee.id, name: employee.name, role: employee.role, result })
    trace.push({ node: 'act', text: `${task.id} ${task.worker} — ${result.toolCalls.length} tools` })

    const artifacts = parseWorkerArtifacts(task, result.answer, task.worker)
    next = {
      ...next,
      artifacts: [...next.artifacts.filter((a) => !artifacts.some((n) => n.path === a.path)), ...artifacts],
    }
    next = updateTask(next, task.id, {
      status: 'running',
      stepsUsed: task.stepsUsed + result.toolCalls.length + 1,
      artifactIds: artifacts.map((a) => a.id),
    })
  }

  return { project: next, members, trace }
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

function allTerminal(project: ProjectState): boolean {
  return project.tasks.every((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'blocked')
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

  const { project: initial } = planProject(rawTask)
  let project = initial
  let allMembers: CrewMemberResult[] = []
  let allTrace: TraceLine[] = [{ node: 'plan', text: `Task graph — ${project.tasks.length} tasks` }]

  const executeNode = async (state: TRS): Promise<Partial<TRS>> => {
    const { project: p, members, trace } = await executeBatch(brain, state.project, options)
    return { project: p, members, trace }
  }

  const judgeNode = async (state: TRS): Promise<Partial<TRS>> => {
    const p = judgeBatch(state.project)
    return {
      project: p,
      trace: [{ node: 'plan', text: `Judge — ${p.tasks.filter((t) => t.status === 'completed').length}/${p.tasks.length} done` }],
    }
  }

  const finishNode = async (state: TRS): Promise<Partial<TRS>> => {
    const finished = { ...state.project, finishedAt: Date.now() }
    return {
      project: finished,
      answer: synthesizeAnswer(finished),
      trace: [{ node: 'respond', text: 'Artifacts assembled' }],
    }
  }

  const routeAfterJudge = (state: TRS): 'execute' | 'finish' => {
    if (allTerminal(state.project)) return 'finish'
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
