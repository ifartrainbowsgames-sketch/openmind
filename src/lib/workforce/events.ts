/**
 * One canonical event stream.
 *
 * Progress currently exists in four incompatible shapes — LangGraph `TraceLine`,
 * ledger `LedgerEvent`, adapter events, and queued-run row updates — so the UI,
 * the trace, and anything that might later replay a run each read a different
 * partial view. This is the single shape everything converges on.
 *
 * Deliberately narrow for now. It covers what a running task actually emits;
 * memory, evolution and approval events join later, when there is something
 * emitting them. An event union that describes features nobody produces is
 * documentation, not a contract.
 */

import type { TaskRecord, WorkerKind } from '../task-ledger'

export type OpenMindEventKind =
  | 'task_started'
  | 'task_finished'
  | 'agent_thinking'
  | 'tool_started'
  | 'tool_completed'
  | 'artifact_created'
  | 'session_opened'
  | 'session_resumed'
  | 'blocked'

/** How a task run ended. Terminal, always — never "still working". */
export type RunOutcome = 'completed' | 'failed' | 'blocked' | 'needs_user' | 'cancelled'

export const TERMINAL_OUTCOMES: readonly RunOutcome[] = [
  'completed', 'failed', 'blocked', 'needs_user', 'cancelled',
]

export function isTerminalOutcome(value: string): value is RunOutcome {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(value)
}

export interface OpenMindEvent {
  kind: OpenMindEventKind
  /** Short and human-readable. This is what reaches the trace. */
  text: string
  at: number
  projectId?: string
  taskId?: string
  worker?: WorkerKind
  sessionId?: string
  /** Set on tool events. */
  tool?: string
  /** Set on artifact_created. */
  artifactPath?: string
  /** Set on task_finished. */
  outcome?: RunOutcome
  /**
   * The runtime's own result payload, carried on `task_finished`.
   *
   * The event stream is the only channel a runtime has, so the thing the
   * orchestrator needs back — the answer, the tool calls, the trace — rides on
   * the terminal event rather than a second return value. Typed as unknown
   * here so this module does not depend on the employee runtime.
   */
  result?: unknown
}

export function event(kind: OpenMindEventKind, text: string, rest: Partial<OpenMindEvent> = {}): OpenMindEvent {
  return { kind, text, at: Date.now(), ...rest }
}

/** Context every event from one task run should carry. */
export interface EventContext {
  projectId: string
  taskId: string
  worker: WorkerKind
  sessionId?: string
}

export function contextFor(projectId: string, task: TaskRecord, sessionId?: string): EventContext {
  return { projectId, taskId: task.id, worker: task.worker, sessionId }
}

/** Stamp a bare event with its run context, without overwriting what it set. */
export function withContext(e: OpenMindEvent, ctx: EventContext): OpenMindEvent {
  return {
    ...e,
    projectId: e.projectId ?? ctx.projectId,
    taskId: e.taskId ?? ctx.taskId,
    worker: e.worker ?? ctx.worker,
    sessionId: e.sessionId ?? ctx.sessionId,
  }
}
