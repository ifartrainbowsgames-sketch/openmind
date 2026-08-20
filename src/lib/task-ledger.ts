/** Shared blackboard — agents produce artifacts, not meetings. */

import type { DelegationState } from './workforce/delegation'

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

/**
 * What a whole project is allowed to consume. Without this the planner has no
 * reason to prefer one worker over four — headcount is free, so it hires.
 */
export interface ProjectBudget {
  maxCostUsd: number
  maxTokens: number
  maxToolCalls: number
  maxAgentRuns: number
  deadlineMs: number
}

export const DEFAULT_BUDGET: ProjectBudget = {
  maxCostUsd: 2,
  maxTokens: 150_000,
  maxToolCalls: 50,
  maxAgentRuns: 12,
  deadlineMs: 300_000,
}

export interface BudgetSpend {
  costUsd: number
  tokens: number
  toolCalls: number
  agentRuns: number
}

export const ZERO_SPEND: BudgetSpend = { costUsd: 0, tokens: 0, toolCalls: 0, agentRuns: 0 }

export type BudgetDimension = keyof BudgetSpend | 'deadline'

export interface BudgetBreach {
  dimension: BudgetDimension
  used: number
  limit: number
}

/** Fraction of the tightest budget dimension consumed so far (0–1+). */
export function budgetPressure(spend: BudgetSpend, budget: ProjectBudget, elapsedMs: number): number {
  return Math.max(
    spend.costUsd / budget.maxCostUsd,
    spend.tokens / budget.maxTokens,
    spend.toolCalls / budget.maxToolCalls,
    spend.agentRuns / budget.maxAgentRuns,
    elapsedMs / budget.deadlineMs,
  )
}

/** The first exhausted dimension, or undefined while there is room left. */
export function budgetBreach(
  spend: BudgetSpend,
  budget: ProjectBudget,
  elapsedMs: number,
): BudgetBreach | undefined {
  if (spend.costUsd >= budget.maxCostUsd) return { dimension: 'costUsd', used: spend.costUsd, limit: budget.maxCostUsd }
  if (spend.tokens >= budget.maxTokens) return { dimension: 'tokens', used: spend.tokens, limit: budget.maxTokens }
  if (spend.toolCalls >= budget.maxToolCalls) return { dimension: 'toolCalls', used: spend.toolCalls, limit: budget.maxToolCalls }
  if (spend.agentRuns >= budget.maxAgentRuns) return { dimension: 'agentRuns', used: spend.agentRuns, limit: budget.maxAgentRuns }
  if (elapsedMs >= budget.deadlineMs) return { dimension: 'deadline', used: elapsedMs, limit: budget.deadlineMs }
  return undefined
}

/**
 * Past this much of the budget, stop starting new work and synthesize what
 * exists. Spending the last 20% on a fresh task usually buys a half-finished
 * one instead of a finished report.
 */
export const SYNTHESIZE_AT_PRESSURE = 0.8

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
  /** What kind of work this is. Set by the planner from the goal. */
  type: WorkerKind
  goal: string
  inputs: Record<string, string>
  outputs: string[]
  acceptance?: AcceptanceCriteria
  dependsOn: string[]
  status: TaskStatus
  /**
   * The worker kind that will run it. Chosen by capability matching, not
   * copied from `type` — those were identical while the eight built-ins were
   * the only workers, and separating them is what lets a custom employee be
   * assigned work it is actually equipped for.
   */
  worker: WorkerKind
  /** A specific employee id, when one was matched rather than a built-in kind. */
  assignedTo?: string
  /** Set on tasks created by delegation, naming the task that asked. */
  parentTaskId?: string
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
  // A worker asking for a capability it does not have. The orchestrator
  // adjudicates; the worker never creates another worker itself.
  | { type: 'request_subtask'; taskId: string; capability: string; goal: string; outputs: string[] }

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
  budget: ProjectBudget
  spend: BudgetSpend
  /** Sandbox shared by every workspace tool in this project, once one exists. */
  sandboxId?: string
  /** Depth/sibling/total counters that bound delegation. */
  delegation?: DelegationState
  /**
   * Owner-authored rules, one per line. Prepended to every worker prompt above
   * the role description — see workforce/constitution.ts.
   */
  rules?: string
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
  /** Real artifact handoffs — the network graph animates these and nothing else. */
  handoffs: LedgerHandoff[]
  spend: BudgetSpend
  budget: ProjectBudget
  /** Set when the run stopped because a budget dimension ran out. */
  budgetBreach?: BudgetBreach
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

export function createProject(
  goal: string,
  limits: TaskLimits = DEFAULT_LIMITS,
  budget: ProjectBudget = DEFAULT_BUDGET,
): ProjectState {
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
    budget,
    spend: { ...ZERO_SPEND },
    startedAt: Date.now(),
  }
}

/** Add consumption to the running total. Costs are estimates — labelled as such. */
export function recordSpend(project: ProjectState, delta: Partial<BudgetSpend>): ProjectState {
  return {
    ...project,
    spend: {
      costUsd: project.spend.costUsd + (delta.costUsd ?? 0),
      tokens: project.spend.tokens + (delta.tokens ?? 0),
      toolCalls: project.spend.toolCalls + (delta.toolCalls ?? 0),
      agentRuns: project.spend.agentRuns + (delta.agentRuns ?? 0),
    },
  }
}

export function projectBreach(project: ProjectState, now = Date.now()): BudgetBreach | undefined {
  return budgetBreach(project.spend, project.budget, now - project.startedAt)
}

export function projectPressure(project: ProjectState, now = Date.now()): number {
  return budgetPressure(project.spend, project.budget, now - project.startedAt)
}

/** Budget is spent enough that starting new work costs more than it returns. */
export function shouldSynthesizeNow(project: ProjectState, now = Date.now()): boolean {
  return projectPressure(project, now) >= SYNTHESIZE_AT_PRESSURE
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

/** Dedupes — the same URL cited by three tasks is one piece of evidence. */
export function recordEvidence(project: ProjectState, items: string[]): ProjectState {
  if (!items.length) return project
  const seen = new Set(project.evidence)
  const added = items.filter((e) => e.trim() && !seen.has(e))
  if (!added.length) return project
  return { ...project, evidence: [...project.evidence, ...added] }
}

/** A judged outcome worth carrying forward, so the next worker need not re-derive it. */
export function recordDecision(project: ProjectState, decision: string): ProjectState {
  const text = decision.trim()
  if (!text || project.decisions.includes(text)) return project
  return { ...project, decisions: [...project.decisions, text] }
}

/**
 * Apply a structured agent action to the ledger. This is the write path the
 * AgentAction union always described — previously the type existed but nothing
 * dispatched on it, so workers could only ever append artifacts.
 */
export function applyAction(project: ProjectState, action: AgentAction, worker?: WorkerKind): ProjectState {
  switch (action.type) {
    case 'create_task': {
      const task: TaskRecord = {
        ...action.task,
        status: 'pending',
        retries: 0,
        stepsUsed: 0,
        costUsd: 0,
        artifactIds: [],
      }
      if (project.tasks.some((t) => t.id === task.id)) return project
      return logEvent({ ...project, tasks: [...project.tasks, task] }, {
        action: 'create_task',
        worker,
        taskId: task.id,
        detail: `${task.worker}: ${task.goal}`,
      })
    }
    case 'write_artifact': {
      const artifact: ArtifactRecord = {
        ...action.artifact,
        id: `art-${action.artifact.taskId}-${project.artifacts.length + 1}`,
        createdAt: Date.now(),
      }
      const kept = project.artifacts.filter((a) => a.path !== artifact.path)
      return logEvent({ ...project, artifacts: [...kept, artifact] }, {
        action: 'write_artifact',
        worker: worker ?? artifact.worker,
        taskId: artifact.taskId,
        detail: artifact.path,
      })
    }
    case 'report_blocker': {
      const withBlocker = {
        ...project,
        blockers: [...project.blockers, `${action.taskId}: ${action.reason}`],
        tasks: project.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: 'blocked' as TaskStatus, blocker: action.reason } : t,
        ),
      }
      return logEvent(withBlocker, {
        action: 'report_blocker',
        worker,
        taskId: action.taskId,
        detail: action.reason,
      })
    }
    case 'complete_task': {
      const completed = {
        ...project,
        tasks: project.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: 'completed' as TaskStatus } : t,
        ),
      }
      return logEvent(completed, {
        action: 'complete_task',
        worker,
        taskId: action.taskId,
        detail: action.artifactPaths.join(', '),
      })
    }
    case 'request_subtask':
      // Logged only. Creating the child is the orchestrator's call, made in
      // task-runner against the delegation limits — recording the ask here
      // would let a worker spawn by writing to the ledger.
      return logEvent(project, {
        action: action.type,
        taskId: action.taskId,
        worker,
        detail: `${action.capability}: ${action.goal}`,
      })
    case 'read_artifact':
    case 'request_review':
    case 'request_tool':
      return logEvent(project, {
        action: action.type,
        worker,
        detail: 'path' in action ? action.path : action.taskId,
      })
  }
}

/**
 * Real artifact handoffs, derived from the DAG: task B depends on task A, and
 * A produced an artifact, so something genuinely moved from A's worker to B's.
 * This is the only legitimate source for the network animation — anything else
 * is decoration pretending to be telemetry.
 */
export interface LedgerHandoff {
  from: WorkerKind
  to: WorkerKind
  fromTaskId: string
  toTaskId: string
  label: string
  at: number
}

export function handoffs(project: ProjectState): LedgerHandoff[] {
  const byId = new Map(project.tasks.map((t) => [t.id, t]))
  const out: LedgerHandoff[] = []
  for (const task of project.tasks) {
    for (const depId of task.dependsOn) {
      const dep = byId.get(depId)
      if (!dep) continue
      for (const artifact of project.artifacts.filter((a) => a.taskId === depId)) {
        out.push({
          from: dep.worker,
          to: task.worker,
          fromTaskId: dep.id,
          toTaskId: task.id,
          label: artifact.path,
          at: artifact.createdAt,
        })
      }
    }
  }
  return out
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
    handoffs: handoffs(project),
    spend: project.spend,
    budget: project.budget,
    budgetBreach: projectBreach(project),
  }
}

export function isSimpleChat(message: string): boolean {
  const user = message.trim()
  if (user.length < 120 && /^(hi|hello|hey|yo|thanks|thank you|ok|okay)\b[!.?\s]*$/i.test(user)) return true
  if (user.length < 40 && !/\b(build|research|create|analyze|compare|deploy|write|code|find|list)\b/i.test(user)) return true
  return false
}
