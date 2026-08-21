/**
 * Controlled delegation.
 *
 * A worker that hits something outside its capabilities has, until now, had
 * two options: fake it, or fail. Neither is right when another worker could
 * do it. Delegation adds a third — but as a *structured request the
 * orchestrator adjudicates*, never as a worker summoning another worker.
 *
 * The distinction is the whole point. Free spawning is how multi-agent systems
 * produce a hundred agents discussing one task. Every request here is bounded
 * by depth, by sibling count, by project-wide total, and must name concrete
 * expected outputs — a delegation that cannot say what artifact it will
 * produce is a conversation, and gets refused.
 */

import type { TaskRecord, WorkerKind } from '../task-ledger'
import type { WorkerCapability } from './capabilities'

export interface ArtifactExpectation {
  path: string
  kind: 'markdown' | 'html' | 'json' | 'csv'
}

export interface SpawnRequest {
  parentTaskId: string
  capability: WorkerCapability
  goal: string
  /** Artifact paths the child may read. Must already exist in the project. */
  inputArtifacts: string[]
  /** What the child must produce. An empty list is refused. */
  expectedOutputs: ArtifactExpectation[]
}

export interface DelegationLimits {
  /** Children one task may spawn directly. */
  maxChildren: number
  /** How deep the chain may go. Depth 0 is a planner-created task. */
  maxDepth: number
  /** Delegated tasks allowed across the whole project. */
  maxPerProject: number
}

export const DEFAULT_DELEGATION_LIMITS: DelegationLimits = {
  maxChildren: 3,
  maxDepth: 2,
  maxPerProject: 8,
}

/** Bookkeeping the orchestrator keeps alongside the project. */
export interface DelegationState {
  /** Task id → depth. Absent means depth 0. */
  depth: Record<string, number>
  /** Parent task id → number of children spawned. */
  children: Record<string, number>
  /** Total delegated tasks created in this project. */
  total: number
}

export function emptyDelegationState(): DelegationState {
  return { depth: {}, children: {}, total: 0 }
}

export function depthOf(state: DelegationState, taskId: string): number {
  return state.depth[taskId] ?? 0
}

export type DelegationRefusal =
  | 'unknown_parent'
  | 'depth_exceeded'
  | 'sibling_limit'
  | 'project_limit'
  | 'no_expected_outputs'
  | 'empty_goal'
  | 'unknown_input_artifact'
  | 'duplicate_output'

export interface DelegationDecision {
  allowed: boolean
  reason?: DelegationRefusal
  /** Human-readable, safe to surface as a task blocker. */
  detail?: string
  /** Depth the child would run at, when allowed. */
  childDepth?: number
}

/**
 * Adjudicate one spawn request against the project and the limits.
 *
 * Pure and synchronous on purpose: the decision to create another agent is
 * exactly the kind of thing that should be testable without a model in the
 * loop.
 */
export function evaluateSpawn(
  request: SpawnRequest,
  ctx: {
    tasks: readonly Pick<TaskRecord, 'id'>[]
    artifactPaths: readonly string[]
    state: DelegationState
    limits?: DelegationLimits
  },
): DelegationDecision {
  const limits = ctx.limits ?? DEFAULT_DELEGATION_LIMITS

  const parent = ctx.tasks.find((t) => t.id === request.parentTaskId)
  if (!parent) {
    return { allowed: false, reason: 'unknown_parent', detail: `no task ${request.parentTaskId}` }
  }

  if (!request.goal.trim()) {
    return { allowed: false, reason: 'empty_goal', detail: 'a delegated task needs a goal' }
  }

  // A request with no named output is a request to chat. Refuse it.
  if (!request.expectedOutputs.length) {
    return {
      allowed: false,
      reason: 'no_expected_outputs',
      detail: 'delegation must name at least one artifact it will produce',
    }
  }

  const duplicate = request.expectedOutputs.find((o) => ctx.artifactPaths.includes(o.path))
  if (duplicate) {
    return {
      allowed: false,
      reason: 'duplicate_output',
      detail: `${duplicate.path} already exists — read it instead of regenerating it`,
    }
  }

  const unknownInput = request.inputArtifacts.find((p) => !ctx.artifactPaths.includes(p))
  if (unknownInput) {
    return {
      allowed: false,
      reason: 'unknown_input_artifact',
      detail: `no artifact at ${unknownInput}`,
    }
  }

  const childDepth = depthOf(ctx.state, request.parentTaskId) + 1
  if (childDepth > limits.maxDepth) {
    return {
      allowed: false,
      reason: 'depth_exceeded',
      detail: `delegation depth ${childDepth} exceeds ${limits.maxDepth}`,
    }
  }

  const siblings = ctx.state.children[request.parentTaskId] ?? 0
  if (siblings >= limits.maxChildren) {
    return {
      allowed: false,
      reason: 'sibling_limit',
      detail: `task ${request.parentTaskId} already spawned ${siblings}`,
    }
  }

  if (ctx.state.total >= limits.maxPerProject) {
    return {
      allowed: false,
      reason: 'project_limit',
      detail: `project reached ${limits.maxPerProject} delegated tasks`,
    }
  }

  return { allowed: true, childDepth }
}

/** Record an allowed spawn. Call only after `evaluateSpawn` allowed it. */
export function recordSpawn(
  state: DelegationState,
  parentTaskId: string,
  childTaskId: string,
  childDepth: number,
): DelegationState {
  return {
    depth: { ...state.depth, [childTaskId]: childDepth },
    children: { ...state.children, [parentTaskId]: (state.children[parentTaskId] ?? 0) + 1 },
    total: state.total + 1,
  }
}

/**
 * The worker kind that should serve a capability. Delegation names a
 * capability, not a worker, so the requester never picks its own helper.
 */
export const CAPABILITY_WORKER: Readonly<Record<WorkerCapability, WorkerKind>> = {
  'web.search': 'research',
  'browser.navigate': 'browser',
  'browser.extract': 'browser',
  'browser.act': 'browser',
  'filesystem.read': 'code',
  'filesystem.write': 'code',
  'terminal.exec': 'code',
  'git.read': 'code',
  'git.write': 'code',
  'code.write': 'code',
  'testing.run': 'tester',
  'data.analyze': 'analyst',
  'writing.compose': 'writer',
  'document.create': 'writer',
  'mcp.call': 'research',
}

/**
 * Parse delegation requests out of a worker's answer.
 *
 * Fenced and explicit rather than inferred from prose: "I need someone to
 * analyse this" is a sentence, and treating sentences as spawn requests is how
 * a system ends up creating agents because a model was thinking out loud. A
 * malformed block is dropped silently — the worker simply gets no help, which
 * is the safe direction.
 */
export function parseSpawnRequests(answer: string, parentTaskId: string): SpawnRequest[] {
  const out: SpawnRequest[] = []
  const fence = /```delegate\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fence.exec(answer))) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const req = coerceSpawnRequest(parsed, parentTaskId)
    if (req) out.push(req)
  }
  return out
}

function coerceSpawnRequest(value: unknown, parentTaskId: string): SpawnRequest | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.capability !== 'string' || typeof v.goal !== 'string') return null

  const outputs = Array.isArray(v.expectedOutputs) ? v.expectedOutputs : []
  const expectedOutputs: ArtifactExpectation[] = []
  for (const raw of outputs) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (typeof o.path !== 'string' || !o.path.trim()) continue
    const kind = typeof o.kind === 'string' ? o.kind : pathKind(o.path)
    if (kind !== 'markdown' && kind !== 'html' && kind !== 'json' && kind !== 'csv') continue
    expectedOutputs.push({ path: o.path.trim(), kind })
  }

  const inputArtifacts = Array.isArray(v.inputArtifacts)
    ? v.inputArtifacts.filter((p): p is string => typeof p === 'string')
    : []

  return {
    parentTaskId,
    capability: v.capability as SpawnRequest['capability'],
    goal: v.goal,
    inputArtifacts,
    expectedOutputs,
  }
}

function pathKind(path: string): ArtifactExpectation['kind'] {
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.csv')) return 'csv'
  if (path.endsWith('.html')) return 'html'
  return 'markdown'
}

/** The instruction block workers are given, so the format is documented once. */
export const DELEGATION_PROMPT = `DELEGATION
If this task needs a capability you do not have, you may request ONE helper by
emitting a fenced block. You cannot talk to other workers; you can only ask for
a task to be created, and the orchestrator decides.

\`\`\`delegate
{"capability":"data.analyze","goal":"what the helper must achieve","inputArtifacts":["research/pricing.json"],"expectedOutputs":[{"path":"analysis/clusters.json","kind":"json"}]}
\`\`\`

A request with no expectedOutputs is refused. Ask only when the work genuinely
needs a capability you lack — otherwise do it yourself.`
