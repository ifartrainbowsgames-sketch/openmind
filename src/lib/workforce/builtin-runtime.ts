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
import { makeWorkspace } from './runtime'
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
      return opened.session
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
      // `inspected: false` means "unknown", not "clean" — the builtin runtime
      // does not diff the workspace.
      return { workspace: session?.workspace, changedFiles: [], inspected: false }
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
