/**
 * One capability vocabulary, for tasks, workers and runtimes.
 *
 * There used to be two, and they did not connect. `WorkerCapability` had
 * eleven semantic values describing what a *worker* brings; `CapabilitySet`
 * had four booleans describing what a *runtime* can do. Nothing translated
 * between them, `capabilities.ts` contained zero references to any runtime
 * type, and so the chain the scheduler needs —
 *
 *     task requirements → capabilities → eligible runtimes → chosen runtime
 *
 * broke in the middle: there was no way to express "this runtime can write
 * files" in the language the planner already used. Routing could rank workers
 * and then hand the winner to a runtime that could not run it.
 *
 * So capabilities are now fine-grained and shared. `filesystem.read` and
 * `filesystem.write` are separate because a read-only runtime is a real thing
 * and "filesystem" cannot say so.
 *
 * Runtime *mechanics* — resumable, checkpointable — live in `traits`, not in
 * the skill vocabulary. Mixing "can write files" with "can checkpoint itself"
 * is what made the first attempt unusable for routing: one is a question about
 * the work, the other is a question about the plumbing.
 */

import type { WorkerKind } from '../task-ledger'

export type WorkerCapability =
  | 'web.search'
  | 'browser.navigate'
  | 'browser.extract'
  | 'browser.act'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'terminal.exec'
  | 'git.read'
  | 'git.write'
  | 'code.write'
  | 'testing.run'
  | 'data.analyze'
  | 'writing.compose'
  | 'document.create'
  | 'mcp.call'

export const ALL_CAPABILITIES: readonly WorkerCapability[] = [
  'web.search', 'browser.navigate', 'browser.extract', 'browser.act',
  'filesystem.read', 'filesystem.write', 'terminal.exec',
  'git.read', 'git.write', 'code.write', 'testing.run',
  'data.analyze', 'writing.compose', 'document.create', 'mcp.call',
]

/**
 * The coarse names this vocabulary replaced.
 *
 * Kept because they are not only in code: they are in the delegation prompt a
 * model was shown, and in any ledger already on disk. A request naming
 * `filesystem` must keep working rather than being silently refused as an
 * unknown capability — which would look exactly like a worker asking for
 * something that does not exist.
 */
export const LEGACY_CAPABILITY: Readonly<Record<string, readonly WorkerCapability[]>> = {
  web_search: ['web.search'],
  browser: ['browser.navigate', 'browser.extract', 'browser.act'],
  coding: ['code.write'],
  filesystem: ['filesystem.read', 'filesystem.write'],
  terminal: ['terminal.exec'],
  git: ['git.read', 'git.write'],
  data_analysis: ['data.analyze'],
  writing: ['writing.compose'],
  testing: ['testing.run'],
  mcp: ['mcp.call'],
  document_creation: ['document.create'],
}

export function isWorkerCapability(value: unknown): value is WorkerCapability {
  return typeof value === 'string' && (ALL_CAPABILITIES as readonly string[]).includes(value)
}

/**
 * Read a capability from untrusted input — a model's delegation request, or a
 * persisted ledger. Legacy names resolve to the narrowest thing they clearly
 * meant, so a coarse request grants coarse routing rather than nothing.
 */
export function toCapability(value: unknown): WorkerCapability | undefined {
  if (isWorkerCapability(value)) return value
  if (typeof value !== 'string') return undefined
  return LEGACY_CAPABILITY[value]?.[0]
}

/** Expand untrusted input to everything it implied. */
export function expandCapability(value: unknown): readonly WorkerCapability[] {
  if (isWorkerCapability(value)) return [value]
  if (typeof value !== 'string') return []
  return LEGACY_CAPABILITY[value] ?? []
}

/**
 * What each built-in worker kind brings. Derived from the tools those workers
 * are actually given in `WORKER_TOOLS`, not aspirational — a capability listed
 * here that the worker has no tool for would make the scheduler confident and
 * wrong.
 */
export const WORKER_CAPABILITIES: Readonly<Record<WorkerKind, readonly WorkerCapability[]>> = {
  planner: ['writing.compose'],
  research: ['web.search', 'browser.navigate', 'browser.extract', 'mcp.call', 'writing.compose'],
  browser: ['browser.navigate', 'browser.extract', 'browser.act', 'web.search', 'document.create'],
  code: [
    'code.write', 'filesystem.read', 'filesystem.write', 'terminal.exec',
    'git.read', 'git.write', 'testing.run',
  ],
  analyst: ['data.analyze', 'writing.compose'],
  writer: ['writing.compose', 'document.create'],
  reviewer: ['writing.compose', 'data.analyze'],
  tester: ['testing.run', 'terminal.exec', 'filesystem.read', 'code.write'],
}

/**
 * What each task type needs. `required` gates eligibility; `preferred` only
 * breaks ties, so a task is never left unassignable because no worker happened
 * to have a nice-to-have.
 *
 * `required` is also what a *runtime* must be able to do — it is the same
 * vocabulary, which is the entire point of this file.
 */
export const TASK_REQUIREMENTS: Readonly<
  Record<WorkerKind, { required: readonly WorkerCapability[]; preferred: readonly WorkerCapability[] }>
> = {
  planner: { required: [], preferred: ['writing.compose'] },
  research: {
    required: ['web.search'],
    preferred: ['browser.navigate', 'browser.extract', 'writing.compose', 'mcp.call'],
  },
  browser: { required: ['browser.navigate'], preferred: ['browser.extract', 'document.create'] },
  code: {
    required: ['code.write', 'filesystem.write'],
    preferred: ['filesystem.read', 'terminal.exec', 'git.write', 'testing.run'],
  },
  analyst: { required: ['data.analyze'], preferred: ['writing.compose'] },
  writer: { required: ['writing.compose'], preferred: ['document.create'] },
  reviewer: { required: [], preferred: ['writing.compose', 'data.analyze'] },
  tester: { required: ['testing.run'], preferred: ['terminal.exec', 'code.write', 'filesystem.read'] },
}

// ── Runtimes ────────────────────────────────────────────────────────────────

/**
 * How a runtime behaves, as opposed to what work it can do.
 *
 * These are never routing keys. A task needs `filesystem.write`; it does not
 * need `checkpointable`. Keeping them out of `skills` is what lets the same
 * vocabulary describe a worker and a machine without either becoming nonsense.
 */
export interface RuntimeTraits {
  /** Can resume a prior session by id. */
  resumable: boolean
  /** Can produce a restorable checkpoint. */
  checkpointable: boolean
  /** Can report what changed in a workspace. */
  inspectable: boolean
  /** A workspace survives between tasks on one session. */
  persistentWorkspace: boolean
}

export interface RuntimeCapabilities {
  /** The routing vocabulary — the same one tasks and workers use. */
  skills: ReadonlySet<WorkerCapability>
  traits: RuntimeTraits
}

export function runtimeCapabilities(
  skills: readonly WorkerCapability[],
  traits: RuntimeTraits,
): RuntimeCapabilities {
  return { skills: new Set(skills), traits }
}

/**
 * The required capabilities a runtime cannot provide for this task type.
 *
 * Empty means eligible. This is the check that was missing entirely:
 * `assignWorker` ran once at plan time and nothing consulted capabilities at
 * dispatch, so a task could be handed to a runtime that had no chance of
 * completing it and would fail in whatever way that runtime fails.
 */
export function runtimeShortfall(
  taskType: WorkerKind,
  capabilities: RuntimeCapabilities,
): WorkerCapability[] {
  return TASK_REQUIREMENTS[taskType].required.filter((c) => !capabilities.skills.has(c))
}

export function runtimeCan(
  capabilities: RuntimeCapabilities,
  needed: readonly WorkerCapability[],
): boolean {
  return needed.every((c) => capabilities.skills.has(c))
}

/** Runtimes that could run this task type, best-covered first. */
export function eligibleRuntimes<T extends { id: string; capabilities: RuntimeCapabilities }>(
  taskType: WorkerKind,
  runtimes: readonly T[],
): T[] {
  const spec = TASK_REQUIREMENTS[taskType]
  return runtimes
    .filter((r) => runtimeShortfall(taskType, r.capabilities).length === 0)
    .sort((a, b) => {
      const cover = (r: T) => spec.preferred.filter((c) => r.capabilities.skills.has(c)).length
      return cover(b) - cover(a) || a.id.localeCompare(b.id)
    })
}

// ── Workers ─────────────────────────────────────────────────────────────────

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
 * browser.navigate" — instead of a task that silently never runs.
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
const TOOL_CAPABILITY: Readonly<Record<string, readonly WorkerCapability[]>> = {
  web_search: ['web.search'],
  browse_url: ['browser.navigate', 'browser.extract'],
  web_act: ['browser.navigate', 'browser.act'],
  run_code: ['code.write'],
  workspace_run: ['terminal.exec'],
  workspace_read_file: ['filesystem.read'],
  workspace_write_file: ['filesystem.write'],
  workspace_ls: ['filesystem.read'],
  git_clone: ['git.read'],
  github_write_file: ['git.write'],
  github_create_branch: ['git.write'],
  github_open_pr: ['git.write'],
  run_checks: ['testing.run'],
  business_plan: ['document.create'],
  summarize: ['writing.compose'],
}

export function capabilitiesFromTools(tools: readonly string[]): WorkerCapability[] {
  const out = new Set<WorkerCapability>()
  for (const tool of tools) {
    for (const capability of TOOL_CAPABILITY[tool] ?? []) out.add(capability)
    // Every MCP-backed tool grants 'mcp.call'; the prefix is how they are named.
    if (tool.startsWith('mcp_')) out.add('mcp.call')
  }
  return [...out]
}
