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

import type { RuntimeCapabilities } from './capabilities'
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

/**
 * What an agent may ask canonical memory.
 *
 * Read-only on purpose. Writing is the kernel's job: a worker that decides
 * what the project remembers is a worker whose successor remembers something
 * different.
 */
export interface MemoryReader {
  search(query: string, limit?: number): Promise<string[]>
}

/** Where a running task reports progress. One stream, not a second callback. */
export interface EventSink {
  emit(e: OpenMindEvent): void
}

/**
 * What every tool call gets, machine or not.
 *
 * Split from ExecutionContext because "having a sandbox" should not be a
 * prerequisite for running a web search. Deep research needs permissions, a
 * place to report progress and a way to be cancelled; it does not need a
 * workspace, and forcing one on it would mean provisioning a machine to read a
 * web page.
 */
export interface ToolContext {
  readonly permissions: PermissionContext
  readonly eventSink: EventSink
  /**
   * Read access to canonical memory.
   *
   * The kernel has already put the relevant part in the prompt — this is for
   * the agent that wants to look further, which is the whole remaining job of
   * `memory_search`.
   */
  readonly memory?: MemoryReader
  /** Aborted when the run is cancelled, so in-flight tool calls stop. */
  readonly abortSignal?: AbortSignal
}

/**
 * A ToolContext that also has a machine.
 *
 * Required by the tools that touch one — filesystem, terminal, git, run_code.
 * A tool that needs a workspace and receives only a ToolContext is refused
 * rather than silently given a fresh sandbox, because a fresh sandbox runs
 * fine and holds none of the work.
 */
export interface ExecutionContext extends ToolContext {
  readonly session: WorkerSession
  /** The typed edge to this session's machine, bound to this context. */
  readonly runtime: Runtime
  /** The machine and directory this session owns. */
  readonly workspace: Workspace
  readonly capabilities: RuntimeCapabilities
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
  capabilities: RuntimeCapabilities
  permissions: PermissionContext
  eventSink: EventSink
  memory?: MemoryReader
  abortSignal?: AbortSignal
  /**
   * Called when a tool creates a machine and the context adopts it.
   *
   * Without this the adoption lives only in a closure, so it survives the run
   * and nothing else. A caller that needs it to outlive the context — a
   * conversation that should keep its sandbox between turns — would have to
   * remember to read it back afterwards, which is the "remember to" pattern
   * this whole file exists to remove.
   */
  onAdopt?: (workspace: Workspace) => void
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
    memory: input.memory,
    abortSignal: input.abortSignal,
    adoptSandbox(sandboxId: string) {
      const id = sandboxId.trim()
      if (!id || id === workspace.sandboxId) return
      workspace = { ...workspace, sandboxId: id }
      input.onAdopt?.(workspace)
    },
  }

  return ctx
}

/**
 * Does this context carry a machine?
 *
 * The one place the narrowing happens. Everything below the tool transport
 * asks this rather than reaching for a module global, which is what made the
 * machine implicit in the first place.
 */
export function hasWorkspace(context?: ToolContext): context is ExecutionContext {
  return Boolean(context && 'workspace' in context && 'runtime' in context)
}

/** A tool context with no machine. For web-only work — search, browse, memory. */
export function toolContext(input: {
  permissions: PermissionContext
  eventSink?: EventSink
  memory?: MemoryReader
  abortSignal?: AbortSignal
}): ToolContext {
  return {
    permissions: input.permissions,
    eventSink: input.eventSink ?? NULL_SINK,
    memory: input.memory,
    abortSignal: input.abortSignal,
  }
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
  ctx: ToolContext | undefined,
  kind: OpenMindEventKind,
  text: string,
  rest: Partial<OpenMindEvent> = {},
): void {
  if (!ctx) return
  const sessionId = hasWorkspace(ctx) ? ctx.session.id : undefined
  ctx.eventSink.emit(event(kind, text, { sessionId, ...rest }))
}
