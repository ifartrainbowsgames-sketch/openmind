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
  type AgentRuntime, type AgentSession, type CapabilitySet,
  type CreateSessionInput, type SessionCheckpoint, type WorkspaceState,
} from './agent-runtime'
import { event, type OpenMindEvent, type RunOutcome } from './events'
import { getActiveSandbox, setActiveSandbox } from '../crew-tools'
import { makeWorkspace, type Workspace } from './runtime'
import { sandboxRuntime } from './sandbox-runtime'
import { ensureWorktree } from './worktrees'
import {
  closeSession, emptySessionStore, openSession, recordActivity,
  type SessionStore,
} from './sessions'

const CAPABILITIES: CapabilitySet = {
  // Sessions resume within a project, but there is no provider-side session to
  // restore and no checkpoint format — state is whatever the sandbox and the
  // ledger still hold. Claiming otherwise would make the orchestrator trust a
  // restore that cannot happen.
  resumable: true,
  writesFiles: true,
  runsCommands: true,
  checkpointable: false,
}

/** Workers that get their own branch, so two coders never share a directory. */
const ISOLATED_WORKERS: readonly string[] = ['code', 'tester']

export interface BuiltinRuntimeDeps {
  /** The model. Supplied per run by the orchestrator. */
  brain: AgentBrain
  /** Builds the employee for a task — routing stays outside the runtime. */
  employeeFor: (task: TaskRecord) => Employee
  /** Full prompt: rules, SOP, shared context, revision block. */
  promptFor: (task: TaskRecord) => string
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>
}

export function createBuiltinRuntime(deps: BuiltinRuntimeDeps): AgentRuntime {
  let store: SessionStore = emptySessionStore()
  const cancelled = new Set<string>()

  return {
    id: 'builtin',

    async capabilities() {
      return CAPABILITIES
    },

    async createSession(input: CreateSessionInput): Promise<AgentSession> {
      const opened = openSession(store, {
        projectId: input.projectId,
        worker: input.worker,
        provider: 'builtin',
        workspace: input.workspace ?? makeWorkspace(input.projectId),
      })
      store = opened.store
      let session = opened.session

      // A coding worker gets its own worktree so parallel coders cannot edit
      // the same directory. Best-effort by design: a project with no repo (or
      // no sandbox yet) simply keeps the shared workspace rather than failing
      // to start — isolation is an improvement on the default, not a
      // precondition for running at all.
      if (
        !opened.resumed
        && ISOLATED_WORKERS.includes(input.worker)
        && session.workspace?.sandboxId
        && !session.workspace.worktree
      ) {
        setActiveSandbox(session.workspace.sandboxId)
        try {
          const { workspace } = await ensureWorktree(sandboxRuntime(), input.projectId, input.worker)
          const isolated: Workspace = { ...workspace, sandboxId: session.workspace.sandboxId }
          store = recordActivity(store, session.id, { workspace: isolated })
          session = { ...session, workspace: isolated }
        } catch {
          // No repo to branch from. The shared workspace is still correct.
        }
      }
      return session
    },

    async resumeSession(sessionId: string): Promise<AgentSession | null> {
      return store.sessions[sessionId] ?? null
    },

    async *runTask(session: AgentSession, task: TaskRecord): AsyncIterable<OpenMindEvent> {
      const ctx = { sessionId: session.id, taskId: task.id, worker: task.worker }
      store = recordActivity(store, session.id, { status: 'running', taskId: task.id })

      if (cancelled.has(session.id)) {
        yield event('task_finished', 'cancelled before start', { ...ctx, outcome: 'cancelled' })
        return
      }

      yield event('task_started', task.goal, ctx)

      // ONE workspace identity. The agent's own tools resolve their sandbox
      // from this same value, so the machine the coder edits is the machine
      // inspectWorkspace() reads. Without this the two drift apart silently and
      // everything still looks live.
      setActiveSandbox(session.workspace?.sandboxId)

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

      let done = false
      let failure: unknown
      let result: RunResult | undefined

      const running = runEmployee(
        deps.brain,
        deps.employeeFor(task),
        deps.promptFor(task),
        (line) => push(event('agent_thinking', line.text, ctx)),
        deps.configs,
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

      try {
        if (failure) throw failure
        if (!result) throw new Error('employee runtime returned no result')
      } catch (error) {
        store = recordActivity(store, session.id, { status: 'failed' })
        yield event('task_finished', error instanceof Error ? error.message : String(error), {
          ...ctx, outcome: 'failed',
        })
        return
      }

      // The tools may have created or replaced the sandbox; adopt whatever they
      // ended on so the session and the machine stay the same thing.
      const sandboxAfter = getActiveSandbox()
      if (sandboxAfter && sandboxAfter !== session.workspace?.sandboxId) {
        const workspace: Workspace = {
          ...(session.workspace ?? makeWorkspace(session.projectId)),
          sandboxId: sandboxAfter,
        }
        store = recordActivity(store, session.id, { workspace })
        yield event('session_opened', `workspace on sandbox ${sandboxAfter}`, {
          ...ctx, sessionId: session.id,
        })
      }

      for (const call of result.toolCalls) {
        yield event('tool_started', call.tool, { ...ctx, tool: call.tool })
        yield event(
          call.error ? 'blocked' : 'tool_completed',
          call.error?.message ?? call.output.slice(0, 200),
          { ...ctx, tool: call.tool },
        )
      }

      // Every tool call blocked means a missing capability, not a failed
      // attempt. That distinction is the difference between asking the user for
      // a connection and burning a retry.
      const blocked = result.toolCalls.length > 0
        && result.toolCalls.every((c) => c.error?.kind === 'blocked')
      const outcome: RunOutcome = cancelled.has(session.id)
        ? 'cancelled'
        : blocked ? 'needs_user' : 'completed'

      store = recordActivity(store, session.id, { status: outcome === 'completed' ? 'idle' : 'blocked' })
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
      const session = store.sessions[sessionId]
      const workspace = session?.workspace
      if (!workspace?.sandboxId) {
        // No machine yet. `inspected: false` means "unknown", never "clean" —
        // a caller must not read an empty list as a clean tree.
        return { workspace, changedFiles: [], inspected: false }
      }
      // Read the same sandbox the session owns, not a fresh one.
      setActiveSandbox(workspace.sandboxId)
      try {
        const changed = await sandboxRuntime().exec(
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
      store = recordActivity(store, sessionId, { status: 'blocked' })
    },

    async close(sessionId: string): Promise<void> {
      cancelled.delete(sessionId)
      store = closeSession(store, sessionId)
    },
  }
}
