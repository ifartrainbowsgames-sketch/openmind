/**
 * What a worker can actually do.
 *
 * Assignment used to be identity, not matching: `planProject` set
 * `worker: type`, so a task typed 'research' went to the research worker by
 * definition. That works only while the eight built-in kinds are the only
 * workers. A custom employee with a browser and a citation habit could never
 * be picked for a research task, because picking was not a decision.
 *
 * Capabilities make it a decision. A task declares what it needs; a worker
 * declares what it has; the scheduler scores the match. Job titles stay for
 * the UI, where humans read them, and stop being the routing key.
 */

import type { WorkerKind } from '../task-ledger'

export type WorkerCapability =
  | 'web_search'
  | 'browser'
  | 'coding'
  | 'filesystem'
  | 'terminal'
  | 'git'
  | 'data_analysis'
  | 'writing'
  | 'testing'
  | 'mcp'
  | 'document_creation'

export const ALL_CAPABILITIES: readonly WorkerCapability[] = [
  'web_search', 'browser', 'coding', 'filesystem', 'terminal',
  'git', 'data_analysis', 'writing', 'testing', 'mcp', 'document_creation',
]

export function isWorkerCapability(value: unknown): value is WorkerCapability {
  return typeof value === 'string' && (ALL_CAPABILITIES as readonly string[]).includes(value)
}

/**
 * What each built-in worker kind brings. Derived from the tools those workers
 * are actually given in `WORKER_TOOLS`, not aspirational — a capability listed
 * here that the worker has no tool for would make the scheduler confident and
 * wrong.
 */
export const WORKER_CAPABILITIES: Readonly<Record<WorkerKind, readonly WorkerCapability[]>> = {
  planner: ['writing'],
  research: ['web_search', 'browser', 'mcp', 'writing'],
  browser: ['browser', 'web_search', 'document_creation'],
  code: ['coding', 'filesystem', 'terminal', 'git', 'testing'],
  analyst: ['data_analysis', 'writing'],
  writer: ['writing', 'document_creation'],
  reviewer: ['writing', 'data_analysis'],
  tester: ['testing', 'terminal', 'filesystem', 'coding'],
}

/**
 * What each task type needs. `required` gates eligibility; `preferred` only
 * breaks ties, so a task is never left unassignable because no worker happened
 * to have a nice-to-have.
 */
export const TASK_REQUIREMENTS: Readonly<
  Record<WorkerKind, { required: readonly WorkerCapability[]; preferred: readonly WorkerCapability[] }>
> = {
  planner: { required: [], preferred: ['writing'] },
  research: { required: ['web_search'], preferred: ['browser', 'writing', 'mcp'] },
  browser: { required: ['browser'], preferred: ['document_creation'] },
  code: { required: ['coding'], preferred: ['filesystem', 'terminal', 'git', 'testing'] },
  analyst: { required: ['data_analysis'], preferred: ['writing'] },
  writer: { required: ['writing'], preferred: ['document_creation'] },
  reviewer: { required: [], preferred: ['writing', 'data_analysis'] },
  tester: { required: ['testing'], preferred: ['terminal', 'coding'] },
}

export interface CapabilityHolder {
  id: string
  /** Human-readable, for the UI only. Never used for routing. */
  role?: string
  capabilities: readonly WorkerCapability[]
  /** Built-in kind, when this holder is one of the eight. */
  kind?: WorkerKind
}

export interface MatchResult {
  holder: CapabilityHolder
  score: number
  missing: WorkerCapability[]
}

export function hasAll(
  holder: CapabilityHolder,
  needed: readonly WorkerCapability[],
): boolean {
  return needed.every((c) => holder.capabilities.includes(c))
}

export function missingFor(
  holder: CapabilityHolder,
  needed: readonly WorkerCapability[],
): WorkerCapability[] {
  return needed.filter((c) => !holder.capabilities.includes(c))
}

/**
 * Rank eligible workers for a task type. Eligibility is all-or-nothing on
 * `required`; ranking is by preferred-capability coverage, then by fewest
 * surplus capabilities.
 *
 * The surplus tiebreak matters: given a specialist and a generalist that both
 * qualify, the specialist wins. A generalist picked for everything is how a
 * multi-agent system collapses back into one agent doing all the work.
 */
export function rankForTask(
  taskType: WorkerKind,
  holders: readonly CapabilityHolder[],
): MatchResult[] {
  const spec = TASK_REQUIREMENTS[taskType]
  return holders
    .filter((h) => hasAll(h, spec.required))
    .map((holder) => {
      const covered = spec.preferred.filter((c) => holder.capabilities.includes(c)).length
      const surplus = holder.capabilities.filter(
        (c) => !spec.required.includes(c) && !spec.preferred.includes(c),
      ).length
      // Preferred coverage dominates; surplus only separates equals.
      return { holder, score: covered * 10 - surplus, missing: [] as WorkerCapability[] }
    })
    .sort((a, b) => b.score - a.score || a.holder.id.localeCompare(b.holder.id))
}

/**
 * The single best worker, or why none fits. Returning the shortfall rather
 * than `undefined` lets the caller emit a real blocker — "no worker has
 * browser" — instead of a task that silently never runs.
 */
export function assignWorker(
  taskType: WorkerKind,
  holders: readonly CapabilityHolder[],
): { holder: CapabilityHolder } | { holder: null; missing: WorkerCapability[] } {
  const ranked = rankForTask(taskType, holders)
  if (ranked[0]) return { holder: ranked[0].holder }

  // Nobody qualified: report the capabilities the whole pool lacks.
  const required = TASK_REQUIREMENTS[taskType].required
  const pooled = new Set(holders.flatMap((h) => h.capabilities))
  return { holder: null, missing: required.filter((c) => !pooled.has(c)) }
}

/** The eight built-ins as capability holders, for a default pool. */
export function builtInHolders(): CapabilityHolder[] {
  return (Object.keys(WORKER_CAPABILITIES) as WorkerKind[]).map((kind) => ({
    id: kind,
    kind,
    role: kind,
    capabilities: WORKER_CAPABILITIES[kind],
  }))
}

/**
 * Best-effort capabilities for a custom employee, inferred from the tool ids
 * it was given. Inference is deliberately conservative — a tool we do not
 * recognise grants nothing, so an unknown employee is under-qualified rather
 * than wrongly trusted with a task it cannot do.
 */
const TOOL_CAPABILITY: Readonly<Record<string, WorkerCapability>> = {
  web_search: 'web_search',
  browse_url: 'browser',
  web_act: 'browser',
  run_code: 'coding',
  workspace_run: 'terminal',
  workspace_read_file: 'filesystem',
  workspace_write_file: 'filesystem',
  workspace_ls: 'filesystem',
  git_clone: 'git',
  run_checks: 'testing',
}

export function capabilitiesFromTools(tools: readonly string[]): WorkerCapability[] {
  const out = new Set<WorkerCapability>()
  for (const tool of tools) {
    const direct = TOOL_CAPABILITY[tool]
    if (direct) out.add(direct)
    // Every MCP-backed tool grants 'mcp'; the prefix is how they are named.
    if (tool.startsWith('mcp_')) out.add('mcp')
  }
  return [...out]
}
