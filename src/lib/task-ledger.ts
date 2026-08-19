/** Shared blackboard — agents produce artifacts, not meetings. */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'needs_user'
export type WorkerKind = 'planner' | 'research' | 'browser' | 'code' | 'analyst' | 'writer' | 'reviewer' | 'tester'

export interface TaskLimits {
  maxSteps: number
  maxRetries: number
  maxDelegations: number
  maxCostUsd: number
}

export const DEFAULT_LIMITS: TaskLimits = {
  maxSteps: 15,
  maxRetries: 3,
  maxDelegations: 2,
  maxCostUsd: 0.5,
}

export interface AcceptanceCriteria {
  /** Minimum artifact body length (chars) */
  minBodyLength?: number
  /** Required substring in artifact body */
  mustInclude?: string[]
  /** For JSON artifacts — minimum array length at dot-path e.g. "competitors" */
  minArrayLength?: Record<string, number>
  /** Minimum source count mentioned in metadata */
  minSources?: number
}

export interface ArtifactContract {
  id: string
  path: string
  kind: 'markdown' | 'html' | 'json' | 'csv'
  title: string
  required: boolean
  acceptance?: AcceptanceCriteria
}

export interface ArtifactRecord {
  id: string
  path: string
  kind: ArtifactContract['kind']
  title: string
  body: string
  taskId: string
  worker: WorkerKind
  sources?: number
  confidence?: number
  createdAt: number
}

export interface TaskRecord {
  id: string
  type: WorkerKind
  goal: string
  inputs: Record<string, string>
  outputs: string[]
  acceptance?: AcceptanceCriteria
  dependsOn: string[]
  status: TaskStatus
  worker: WorkerKind
  limits: TaskLimits
  retries: number
  stepsUsed: number
  costUsd: number
  artifactIds: string[]
  blocker?: string
  verdict?: JudgeVerdict
}

export interface JudgeVerdict {
  passed: boolean
  score: number
  problems: string[]
  requiredFixes: string[]
}

/** Structured agent actions — no chatWithAgent(). */
export type AgentAction =
  | { type: 'create_task'; task: Omit<TaskRecord, 'status' | 'retries' | 'stepsUsed' | 'costUsd' | 'artifactIds'> }
  | { type: 'read_artifact'; path: string }
  | { type: 'write_artifact'; artifact: Omit<ArtifactRecord, 'id' | 'createdAt'> }
  | { type: 'request_review'; taskId: string; artifactPath: string; criteria: string[] }
  | { type: 'request_tool'; taskId: string; tool: string; input: string }
  | { type: 'report_blocker'; taskId: string; reason: string }
  | { type: 'complete_task'; taskId: string; artifactPaths: string[]; sources?: number; confidence?: number }

export interface LedgerEvent {
  id: string
  ts: number
  taskId?: string
  worker?: WorkerKind
  action: AgentAction['type']
  detail: string
}

export interface ProjectState {
  id: string
  goal: string
  requirements: string[]
  tasks: TaskRecord[]
  artifacts: ArtifactRecord[]
  evidence: string[]
  decisions: string[]
  blockers: string[]
  events: LedgerEvent[]
  limits: TaskLimits
  finalOutput?: string
  startedAt: number
  finishedAt?: number
}

export interface ProjectSnapshot {
  id: string
  goal: string
  tasks: Array<Pick<TaskRecord, 'id' | 'goal' | 'status' | 'worker' | 'outputs' | 'artifactIds' | 'blocker'>>
  artifacts: Array<Pick<ArtifactRecord, 'id' | 'path' | 'kind' | 'title' | 'taskId' | 'sources' | 'confidence'>>
  blockers: string[]
  finished: boolean
}

export function makeProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `proj-${crypto.randomUUID()}`
  }
  return `proj-${Date.now()}`
}

export function makeTaskId(n: number): string {
  return `TASK-${String(n).padStart(3, '0')}`
}

export function createProject(goal: string, limits: TaskLimits = DEFAULT_LIMITS): ProjectState {
  return {
    id: makeProjectId(),
    goal,
    requirements: [],
    tasks: [],
    artifacts: [],
    evidence: [],
    decisions: [],
    blockers: [],
    events: [],
    limits,
    startedAt: Date.now(),
  }
}

export function logEvent(project: ProjectState, event: Omit<LedgerEvent, 'id' | 'ts'>): ProjectState {
  const entry: LedgerEvent = {
    id: `evt-${project.events.length + 1}`,
    ts: Date.now(),
    ...event,
  }
  return { ...project, events: [...project.events, entry] }
}

export function readyTasks(project: ProjectState): TaskRecord[] {
  const done = new Set(project.tasks.filter((t) => t.status === 'completed').map((t) => t.id))
  return project.tasks.filter(
    (t) =>
      t.status === 'pending' &&
      t.dependsOn.every((dep) => done.has(dep)),
  )
}

export function artifactByPath(project: ProjectState, path: string): ArtifactRecord | undefined {
  return project.artifacts.find((a) => a.path === path)
}

export function snapshot(project: ProjectState): ProjectSnapshot {
  return {
    id: project.id,
    goal: project.goal,
    tasks: project.tasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      status: t.status,
      worker: t.worker,
      outputs: t.outputs,
      artifactIds: t.artifactIds,
      blocker: t.blocker,
    })),
    artifacts: project.artifacts.map((a) => ({
      id: a.id,
      path: a.path,
      kind: a.kind,
      title: a.title,
      taskId: a.taskId,
      sources: a.sources,
      confidence: a.confidence,
    })),
    blockers: project.blockers,
    finished: !!project.finishedAt,
  }
}

export function isSimpleChat(message: string): boolean {
  const user = message.trim()
  if (user.length < 120 && /^(hi|hello|hey|yo|thanks|thank you|ok|okay)\b[!.?\s]*$/i.test(user)) return true
  if (user.length < 40 && !/\b(build|research|create|analyze|compare|deploy|write|code|find|list)\b/i.test(user)) return true
  return false
}
