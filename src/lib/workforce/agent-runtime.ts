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
import type { Workspace } from './runtime'
import type { WorkerSession } from './sessions'

/** A runtime's session. Alias rather than a new type — sessions.ts already models this. */
export type AgentSession = WorkerSession

export interface CapabilitySet {
  /** Can resume a prior session by id. */
  resumable: boolean
  /** Edits files in a workspace itself. */
  writesFiles: boolean
  /** Runs commands in a workspace. */
  runsCommands: boolean
  /** Can produce a restorable checkpoint. */
  checkpointable: boolean
}

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

export interface AgentRuntime {
  readonly id: string

  capabilities(): Promise<CapabilitySet>

  createSession(input: CreateSessionInput): Promise<AgentSession>

  resumeSession(sessionId: string): Promise<AgentSession | null>

  /**
   * Run one task. The stream is the only channel out, so the terminal
   * `task_finished` event carries both the outcome and the runtime's result.
   */
  runTask(session: AgentSession, task: TaskRecord): AsyncIterable<OpenMindEvent>

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
