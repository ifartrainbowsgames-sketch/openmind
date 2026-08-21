/**
 * The kernel contract for executing a task.
 *
 * This replaces `CodingAgentAdapter`. That interface was too small to be the
 * thing `task-runner` calls, and its smallness is why the whole layer stayed
 * orphaned: adapters, sessions, workspaces and checkpoints were four files that
 * only made sense together, so nothing could adopt one without adopting all
 * four. `AgentRuntime` owns exactly the pieces that are genuinely coupled —
 * session identity, workspace ownership, resumption, cancellation — and nothing
 * else.
 *
 * Deliberately excluded: memory and browser. Those are capabilities a runtime
 * may consume or expose, not obligations every implementation must satisfy.
 * Folding them in here is how this becomes a god object.
 *
 * The rule this contract exists to enforce: **exactly one execution path**.
 * `runEmployee` is an implementation detail of `BuiltinAgentRuntime`, not a
 * kernel API. See runtime-boundary.test.ts, which fails CI if anything outside
 * the builtin runtime imports it.
 */

import type { TaskRecord, WorkerKind } from '../task-ledger'
import type { OpenMindEvent } from './events'
import type { RuntimeCapabilities } from './capabilities'
import type { MemoryContext } from './memory-service'
import type { Workspace } from './runtime'
import type { WorkspaceRecovery } from './workspaces'
import type { WorkerSession } from './sessions'

/**
 * A session as a runtime uses it: the persisted record, plus the machine it
 * resolves to and how that resolution went.
 *
 * `WorkerSession` stores a `workspaceId`; resolving it costs a repository read
 * and can fail. Doing that once, at createSession, and handing the result down
 * keeps every later step from re-deriving it — and makes the recovery outcome
 * something a caller has to look at rather than something it can forget to ask
 * about.
 */
export interface AgentSession extends WorkerSession {
  /** Resolved from `workspaceId`. Absent when the session has no machine yet. */
  workspace?: Workspace
  /**
   * How the machine was obtained. `lost` and `needs_user` mean the session
   * resumed but its workspace did not — a task must not run as though it had.
   */
  recovery?: WorkspaceRecovery
}

/**
 * What a runtime can do, in the same vocabulary tasks and workers use.
 *
 * This was four booleans — resumable, writesFiles, runsCommands,
 * checkpointable — which described the plumbing and could not answer the only
 * question routing asks: can this runtime do the work this task needs? See
 * capabilities.ts for why skills and traits are separated.
 */
export type { RuntimeCapabilities } from './capabilities'

export interface SessionCheckpoint {
  sessionId: string
  at: number
  /** Opaque to the orchestrator — only the runtime that wrote it can restore it. */
  state: unknown
  /** False when the runtime cannot checkpoint; callers must not treat it as saved. */
  captured: boolean
}

export interface WorkspaceState {
  workspace?: Workspace
  /** Paths changed since the session opened, when the runtime can tell. */
  changedFiles: string[]
  /** True when the runtime could actually inspect; false means "unknown", not "clean". */
  inspected: boolean
}

export interface CreateSessionInput {
  projectId: string
  worker: WorkerKind
  workspace?: Workspace
}

/**
 * What the kernel hands a runtime alongside the task.
 *
 * `TaskRecord` describes the work; this describes what the project already
 * knows. It is a parameter rather than something the runtime looks up because
 * of the failure it prevents: the builtin runtime composed its own prompt from
 * the ledger, so canonical memory reached OpenMind's worker and nothing else.
 * A Claude Code or Codex runtime would have started every task knowing
 * nothing, and would have looked like it was working.
 *
 * A runtime may render this however its provider expects. It may not skip it.
 */
export interface TaskContext {
  memory: MemoryContext
}

/** For callers with no project memory — tests, and one-off runs. */
export function emptyTaskContext(): TaskContext {
  return { memory: { text: '', entries: [], priorFailures: [] } }
}

export interface AgentRuntime {
  readonly id: string

  capabilities(): Promise<RuntimeCapabilities>

  createSession(input: CreateSessionInput): Promise<AgentSession>

  resumeSession(sessionId: string): Promise<AgentSession | null>

  /**
   * Run one task. The stream is the only channel out, so the terminal
   * `task_finished` event carries both the outcome and the runtime's result.
   *
   * `context` is required so that canonical memory cannot reach one runtime
   * and not another — that is the whole point of memory being a kernel service
   * rather than a tool the builtin worker happens to have.
   */
  runTask(
    session: AgentSession,
    task: TaskRecord,
    context: TaskContext,
  ): AsyncIterable<OpenMindEvent>

  checkpoint(sessionId: string): Promise<SessionCheckpoint>

  inspectWorkspace(sessionId: string): Promise<WorkspaceState>

  cancel(sessionId: string): Promise<void>

  close(sessionId: string): Promise<void>
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, AgentRuntime>()
let defaultId: string | undefined

export function registerRuntime(runtime: AgentRuntime, asDefault = false): void {
  registry.set(runtime.id, runtime)
  if (asDefault || !defaultId) defaultId = runtime.id
}

export function getRuntime(id: string): AgentRuntime | undefined {
  return registry.get(id)
}

export function listRuntimes(): AgentRuntime[] {
  return [...registry.values()]
}

/**
 * The runtime a task runs on.
 *
 * Throws when none is registered rather than falling back to a direct
 * `runEmployee` call. A silent fallback is precisely how two execution systems
 * grow back: the orchestrator would keep working while the runtime path rotted
 * unnoticed.
 */
export function runtimeFor(preferredId?: string): AgentRuntime {
  const chosen = preferredId ?? defaultId
  const runtime = chosen ? registry.get(chosen) : undefined
  if (!runtime) {
    throw new Error(
      'No AgentRuntime registered. Task execution must go through a runtime — ' +
      'call registerBuiltinRuntime() during startup.',
    )
  }
  return runtime
}

/** Test seam. Production never clears the registry. */
export function _resetRuntimes(): void {
  registry.clear()
  defaultId = undefined
}
