/**
 * OpenMind's own worker, behind the kernel contract.
 *
 * This is the ONLY module allowed to import `runEmployee`. That is enforced by
 * runtime-boundary.test.ts, not by convention — the whole point of the
 * consolidation is that there is one execution path, and an import from
 * anywhere else silently recreates the second one.
 *
 * The wrapping is deliberately thin. `runEmployee` already plans, acts,
 * evaluates and replans; this adds session identity, workspace ownership and an
 * event stream around it, and changes none of its behaviour.
 */

import { runEmployee, type AgentBrain, type Employee, type LiveConnectionConfig, type RunResult } from '../agent'
import type { TaskRecord } from '../task-ledger'
import {
  type AgentRuntime, type AgentSession,
  type CreateSessionInput, type SessionCheckpoint, type TaskContext,
  type WorkspaceState,
} from './agent-runtime'
import {
  ALL_CAPABILITIES, runtimeCapabilities, type RuntimeCapabilities,
} from './capabilities'
import { event, type OpenMindEvent, type RunOutcome } from './events'
import { setActiveSandbox } from '../crew-tools'
import {
  NULL_SINK, createExecutionContext,
  type ExecutionContext, type MemoryReader, type PermissionContext,
} from './execution-context'
import { makeWorkspace, type Workspace } from './runtime'
import { sandboxRuntime } from './sandbox-runtime'
import { ensureWorktree } from './worktrees'
import {
  closed, isResumable, newSession, touch, type WorkerSession,
} from './sessions'
import {
  repositories, scopeProjectId,
  type Repositories, type SessionScope,
} from './session-repository'
import {
  makeWorkspaceRecord, recoverWorkspace, toWorkspace, withWorkspace,
  type WorkspaceRecovery,
} from './workspaces'

export const BUILTIN_CAPABILITIES: RuntimeCapabilities = runtimeCapabilities(
  // Every skill, because this runtime executes arbitrary employees with
  // arbitrary tools. A capability is not a credential: a missing Slack
  // connection is reported as a blocked tool call, not as a runtime that
  // cannot post to Slack. Conflating the two would make a key outage look like
  // an architectural limit.
  ALL_CAPABILITIES,
  {
    // Sessions resume within a project, but there is no provider-side session
    // to restore and no checkpoint format — state is whatever the sandbox and
    // the ledger still hold. Claiming otherwise would make the orchestrator
    // trust a restore that cannot happen.
    resumable: true,
    checkpointable: false,
    inspectable: true,
    persistentWorkspace: true,
  },
)

/** Workers that get their own branch, so two coders never share a directory. */
const ISOLATED_WORKERS: readonly string[] = ['code', 'tester']

export interface BuiltinRuntimeDeps {
  /** The model. Supplied per run by the orchestrator. */
  brain: AgentBrain
  /** Builds the employee for a task — routing stays outside the runtime. */
  employeeFor: (task: TaskRecord) => Employee
  /**
   * Full prompt: rules, SOP, canonical memory, revision block.
   *
   * Takes the TaskContext so the memory the kernel built is what reaches the
   * prompt — the runtime does not get to compose a different one.
   */
  promptFor: (task: TaskRecord, context: TaskContext) => string
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>
  /** What this run may do. Defaults to no platform credentials, no guard. */
  permissions?: PermissionContext
  /**
   * Read access to canonical memory, for the agent that wants to look past
   * the context the kernel already gave it. The kernel service does the
   * writing; a runtime never does.
   */
  memory?: MemoryReader
  /**
   * Where sessions and workspaces live between runs.
   *
   * Injected rather than held, because the runtime itself is per-run: it
   * carries the brain and the composed prompt, so a shared instance would be
   * shared mutable state two concurrent runs corrupt. The runtime stays
   * isolated; the store is what they have in common.
   */
  repositories?: Repositories
}

export function createBuiltinRuntime(deps: BuiltinRuntimeDeps): AgentRuntime {
  const repos = deps.repositories ?? repositories()
  const cancelled = new Set<string>()
  /** One per in-flight task, so cancel() stops work already in the network. */
  const aborts = new Map<string, AbortController>()
  const permissions: PermissionContext = deps.permissions ?? { platformKeys: false }

  /**
   * A context for work the runtime does *around* a task — provisioning a
   * worktree, inspecting a workspace. Same session, same machine, no event
   * stream to feed and nothing to cancel.
   */
  function contextFor(session: WorkerSession, workspace: Workspace): ExecutionContext {
    return createExecutionContext({
      session,
      runtime: (self) => sandboxRuntime(self),
      workspace,
      capabilities: BUILTIN_CAPABILITIES,
      permissions,
      eventSink: NULL_SINK,
    })
  }

  return {
    id: 'builtin',

    async capabilities() {
      return BUILTIN_CAPABILITIES
    },

    async createSession(input: CreateSessionInput): Promise<AgentSession> {
      const scope: SessionScope = { kind: 'project', projectId: input.projectId, worker: input.worker }
      const existing = await repos.sessions.find(scope, 'builtin')
      const resumed = Boolean(existing && isResumable(existing))
      let session = resumed && existing ? touch(existing, { status: 'running' }) : newSession(scope, 'builtin')

      // The machine, as a record rather than a string. `input.workspace` is the
      // caller's hint — the project's remembered sandbox — and it seeds a
      // record only when we do not already have one.
      let record = session.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
      record ??= makeWorkspaceRecord({
        projectId: scopeProjectId(scope),
        kind: 'shared',
        externalId: input.workspace?.sandboxId,
        path: input.workspace?.path,
      })

      // "Do we still have a machine?" is a question, asked, not assumed. A
      // pointer to a reclaimed sandbox reads exactly like a pointer to a live
      // one, and the difference only shows up when a task reads a file that is
      // no longer there.
      const recovery: WorkspaceRecovery = await recoverWorkspace({
        record,
        context: contextFor(session, toWorkspace(record)),
      })
      record = recovery.record
      await repos.workspaces.save(record)
      session = touch(session, { workspaceId: record.id })

      let workspace = 'workspace' in recovery ? recovery.workspace : toWorkspace(record)

      // A coding worker gets its own worktree so parallel coders cannot edit
      // the same directory. Best-effort by design: a project with no repo (or
      // no sandbox yet) simply keeps the shared workspace rather than failing
      // to start — isolation is an improvement on the default, not a
      // precondition for running at all.
      if (
        !resumed
        && recovery.kind === 'resumed'
        && ISOLATED_WORKERS.includes(input.worker)
        && workspace.sandboxId
        && !workspace.worktree
      ) {
        try {
          const provisioning = contextFor(session, workspace)
          const isolated = await ensureWorktree(provisioning.runtime, input.projectId, input.worker)
          workspace = { ...isolated.workspace, sandboxId: workspace.sandboxId }
          // A NEW record, not the project's shared one folded into a worktree.
          // Overwriting it would give the whole project the coder's branch and
          // directory, which is the opposite of isolation.
          record = withWorkspace(
            makeWorkspaceRecord({
              projectId: scopeProjectId(scope),
              kind: 'worktree',
              name: input.worker,
              externalId: workspace.sandboxId,
            }),
            workspace,
          )
          record = { ...record, status: 'active', lastVerifiedAt: Date.now() }
          await repos.workspaces.save(record)
          session = touch(session, { workspaceId: record.id })
        } catch {
          // No repo to branch from. The shared workspace is still correct.
        }
      }

      await repos.sessions.save(session)
      return { ...session, workspace, recovery }
    },

    async resumeSession(sessionId: string): Promise<AgentSession | null> {
      const session = await repos.sessions.get(sessionId)
      if (!session) return null
      const record = session.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
      return { ...session, workspace: record ? toWorkspace(record) : undefined }
    },

    async *runTask(
      session: AgentSession,
      task: TaskRecord,
      taskContext: TaskContext,
    ): AsyncIterable<OpenMindEvent> {
      const ctx = { sessionId: session.id, taskId: task.id, worker: task.worker }

      // Read from the repository, not from the caller's copy. The `session`
      // argument is a snapshot taken at createSession; a caller that runs two
      // tasks against it hands back the same stale object twice, and the
      // second write discards the first — which silently emptied the task
      // history a session had served. The store is the truth.
      const stored = (await repos.sessions.get(session.id)) ?? session
      let current: WorkerSession = touch(stored, { status: 'running', taskId: task.id })
      const record = async (patch: Parameters<typeof touch>[1]) => {
        current = touch(current, patch)
        await repos.sessions.save(current)
      }
      await repos.sessions.save(current)

      if (cancelled.has(session.id)) {
        yield event('task_finished', 'cancelled before start', { ...ctx, outcome: 'cancelled' })
        return
      }

      yield event('task_started', task.goal, ctx)

      // The employee graph reports progress through a callback while it runs,
      // but this is a generator — so trace lines land in a queue that the loop
      // below drains as they arrive. Collecting them and yielding at the end
      // would typecheck and still be a regression: the live trace is the only
      // sign a long task is moving.
      const pending: OpenMindEvent[] = []
      let wake: (() => void) | undefined
      const push = (e: OpenMindEvent) => {
        pending.push(e)
        wake?.()
      }

      // ONE workspace identity, as a value the tools receive rather than a
      // global they read. The machine the coder edits is the machine
      // inspectWorkspace() reads because there is nowhere else to look.
      const abort = new AbortController()
      aborts.set(session.id, abort)
      const context = createExecutionContext({
        session,
        runtime: (self) => sandboxRuntime(self),
        workspace: session.workspace ?? makeWorkspace(scopeProjectId(session.scope)),
        capabilities: BUILTIN_CAPABILITIES,
        permissions,
        eventSink: { emit: (e) => push({ ...ctx, ...e }) },
        memory: deps.memory,
        abortSignal: abort.signal,
      })

      // Still bound, for the tools that reach the sandbox without a context —
      // deep research and the chat crew share this transport. Both values come
      // from the session, so they cannot disagree at the start of a run, and
      // `adoptSandbox` keeps them together if a tool creates a machine.
      setActiveSandbox(context.workspace.sandboxId)

      let done = false
      let failure: unknown
      let result: RunResult | undefined

      const running = runEmployee(
        deps.brain,
        deps.employeeFor(task),
        deps.promptFor(task, taskContext),
        (line) => push(event('agent_thinking', line.text, ctx)),
        deps.configs,
        context,
      ).then(
        (r) => { result = r; done = true; wake?.() },
        (e) => { failure = e; done = true; wake?.() },
      )

      while (!done || pending.length) {
        if (!pending.length) {
          await new Promise<void>((resolve) => { wake = resolve })
          wake = undefined
          continue
        }
        yield pending.shift() as OpenMindEvent
      }
      await running

      aborts.delete(session.id)

      // The tools may have created a sandbox; the context adopted it as it
      // happened. Record it whether the run succeeded or failed — a failure is
      // not a reason to forget which machine holds the half-finished work.
      const sandboxAfter = context.workspace.sandboxId
      const adopted = Boolean(sandboxAfter) && sandboxAfter !== session.workspace?.sandboxId
      if (adopted && session.workspaceId) {
        const held = await repos.workspaces.get(session.workspaceId)
        if (held) {
          await repos.workspaces.save({
            ...withWorkspace(held, context.workspace),
            status: 'active',
            lastVerifiedAt: Date.now(),
          })
        }
      }

      try {
        if (failure) throw failure
        if (!result) throw new Error('employee runtime returned no result')
      } catch (error) {
        await record({ status: 'failed' })
        yield event('task_finished', error instanceof Error ? error.message : String(error), {
          ...ctx, outcome: 'failed',
        })
        return
      }

      if (adopted) {
        yield event('session_opened', `workspace on sandbox ${sandboxAfter}`, {
          ...ctx, sessionId: session.id,
        })
      }

      // Tool events are not replayed here. The actor emits them through the
      // context's sink as each call happens, which is both live and the only
      // place that knows a call started before it finished.

      // Every tool call blocked means a missing capability, not a failed
      // attempt. That distinction is the difference between asking the user for
      // a connection and burning a retry.
      const blocked = result.toolCalls.length > 0
        && result.toolCalls.every((c) => c.error?.kind === 'blocked')
      const outcome: RunOutcome = cancelled.has(session.id)
        ? 'cancelled'
        : blocked ? 'needs_user' : 'completed'

      await record({ status: outcome === 'completed' ? 'idle' : 'blocked' })
      yield event('task_finished', outcome === 'needs_user' ? 'capability unavailable' : 'task complete', {
        ...ctx,
        outcome,
        result,
      })
    },

    async checkpoint(sessionId: string): Promise<SessionCheckpoint> {
      // Honest negative: this runtime keeps no restorable state of its own.
      // Reporting captured:true with an empty payload would let a caller build
      // recovery on something that cannot recover.
      return { sessionId, at: Date.now(), state: null, captured: false }
    },

    async inspectWorkspace(sessionId: string): Promise<WorkspaceState> {
      const session = await repos.sessions.get(sessionId)
      const record = session?.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
      const workspace = record ? toWorkspace(record) : undefined
      if (!session || !workspace?.sandboxId) {
        // No machine yet. `inspected: false` means "unknown", never "clean" —
        // a caller must not read an empty list as a clean tree.
        return { workspace, changedFiles: [], inspected: false }
      }
      // Read the same sandbox the session owns, not a fresh one. The context
      // carries that identity, so there is no binding step to forget.
      try {
        const changed = await contextFor(session, workspace).runtime.exec(
          `cd '${workspace.path}' && git status --porcelain 2>/dev/null || true`,
        )
        if (!changed.ran) return { workspace, changedFiles: [], inspected: false }
        const files = changed.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^\S+\s+/, ''))
        return { workspace, changedFiles: files, inspected: true }
      } catch {
        return { workspace, changedFiles: [], inspected: false }
      }
    },

    async cancel(sessionId: string): Promise<void> {
      cancelled.add(sessionId)
      // Not just a flag for the next task: abort the tool calls this one has
      // in flight, or a cancelled run keeps a sandbox busy with an install
      // nobody is waiting for.
      aborts.get(sessionId)?.abort()
      const session = await repos.sessions.get(sessionId)
      if (session) await repos.sessions.save(touch(session, { status: 'blocked' }))
    },

    async close(sessionId: string): Promise<void> {
      cancelled.delete(sessionId)
      aborts.get(sessionId)?.abort()
      aborts.delete(sessionId)
      const session = await repos.sessions.get(sessionId)
      if (session) await repos.sessions.save(closed(session))
    },
  }
}
