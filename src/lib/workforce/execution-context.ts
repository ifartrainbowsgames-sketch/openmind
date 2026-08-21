/**
 * Where a task executes, as a value instead of module state.
 *
 * The problem this replaces: the runtime bound a module global
 * (`setActiveSandbox`) before the agent's tools ran, and every workspace tool
 * read it back. That works exactly as long as the runtime remembers to bind —
 * and the failure when it forgets is the worst kind available here, because
 * nothing errors. The coder edits one live machine while `inspectWorkspace()`
 * reads another. Two real sandboxes, both working, wrong answers.
 *
 * An ExecutionContext makes the machine an argument. A tool that receives one
 * cannot resolve a different sandbox than the session owns, because there is
 * no second place to look.
 *
 * The module state in `crew-tools` stays as the fallback for surfaces that
 * genuinely have no session — the chat crew, deep research — and is documented
 * there as exactly that. It is no longer how the task graph works.
 *
 * `workspace` is a getter rather than a field because of adoption: the first
 * workspace tool in a run may *create* the sandbox, and the id comes back from
 * the tool call. `adoptSandbox` is the one mutation, and it only ever narrows
 * "no machine yet" into "this machine".
 */

import type { CapabilitySet } from './agent-runtime'
import { event, type OpenMindEvent, type OpenMindEventKind } from './events'
import type { Runtime, Workspace } from './runtime'
import type { WorkerSession } from './sessions'

/**
 * What this run is allowed to do. Separate from capabilities: capabilities say
 * what the runtime *can* do, permissions say what this particular run *may*.
 */
export interface PermissionContext {
  /**
   * May draw on the deployment's own tool credentials. Only true for
   * platform-billed runs — a customer funding their own model must not have
   * their search and sandbox calls billed to us.
   */
  platformKeys: boolean
  /** Asked before a risky tool runs. Returning false declines it. */
  confirm?: (tool: string, summary: string) => Promise<boolean>
}

/** Where a running task reports progress. One stream, not a second callback. */
export interface EventSink {
  emit(e: OpenMindEvent): void
}

export interface ExecutionContext {
  readonly session: WorkerSession
  /** The typed edge to this session's machine, bound to this context. */
  readonly runtime: Runtime
  /** The machine and directory this session owns. */
  readonly workspace: Workspace
  readonly capabilities: CapabilitySet
  readonly permissions: PermissionContext
  readonly eventSink: EventSink
  /** Aborted when the run is cancelled, so in-flight tool calls stop. */
  readonly abortSignal?: AbortSignal
  /**
   * Take ownership of a sandbox a tool created. Ignored when it names the
   * machine already held — the session follows the machine, it does not
   * accumulate machines.
   */
  adoptSandbox(sandboxId: string): void
}

export interface ExecutionContextInput {
  session: WorkerSession
  /**
   * Built from the context that will own it, and only when something asks.
   *
   * The runtime resolves its machine *through* this context, so it cannot be
   * constructed before the context exists — and a run that never touches a
   * filesystem should not build one at all.
   */
  runtime: (ctx: ExecutionContext) => Runtime
  workspace: Workspace
  capabilities: CapabilitySet
  permissions: PermissionContext
  eventSink: EventSink
  abortSignal?: AbortSignal
}

export function createExecutionContext(input: ExecutionContextInput): ExecutionContext {
  let workspace = input.workspace
  let runtime: Runtime | undefined

  const ctx: ExecutionContext = {
    session: input.session,
    get runtime() {
      return (runtime ??= input.runtime(ctx))
    },
    get workspace() {
      return workspace
    },
    capabilities: input.capabilities,
    permissions: input.permissions,
    eventSink: input.eventSink,
    abortSignal: input.abortSignal,
    adoptSandbox(sandboxId: string) {
      const id = sandboxId.trim()
      if (!id || id === workspace.sandboxId) return
      workspace = { ...workspace, sandboxId: id }
    },
  }

  return ctx
}

/** A sink that drops everything. For callers with no stream to feed. */
export const NULL_SINK: EventSink = { emit: () => {} }

/**
 * Emit through a context, stamped with its session.
 *
 * Exported so the employee graph can report tool progress without importing
 * the event module directly — the worker emits into the kernel's stream, it
 * does not own the vocabulary.
 */
export function emit(
  ctx: ExecutionContext | undefined,
  kind: OpenMindEventKind,
  text: string,
  rest: Partial<OpenMindEvent> = {},
): void {
  if (!ctx) return
  ctx.eventSink.emit(event(kind, text, { sessionId: ctx.session.id, ...rest }))
}
