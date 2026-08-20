/**
 * The built-in coding agent, as an adapter.
 *
 * OpenMind's own worker loop already does what the adapter interface
 * describes — plan, act, observe, produce artifacts. Wrapping it makes it the
 * first registered adapter rather than a special case the orchestrator knows
 * about directly, which is what proves the interface fits something real
 * before an external agent is plugged into it.
 *
 * It is also the honest fallback: when no Claude Code or Codex session is
 * reachable, there is still an agent that works, and the caller does not have
 * to special-case its absence.
 */

import { runEmployee, type AgentBrain, type Employee } from '../agent'
import type { TaskRecord } from '../task-ledger'
import {
  registerAdapter,
  type AdapterCapabilities, type AgentRuntimeEvent, type CodingAgentAdapter,
} from './adapters'
import type { Workspace } from './runtime'
import {
  emptySessionStore, openSession, recordActivity, closeSession,
  type SessionStore, type WorkerSession,
} from './sessions'

const CAPABILITIES: AdapterCapabilities = {
  // Sessions resume within a project; there is no provider-side session to
  // restore, so state is whatever the sandbox and ledger still hold.
  resumable: true,
  writesFiles: true,
  runsCommands: true,
}

export interface BuiltinAdapterDeps {
  brain: AgentBrain
  /** Builds the employee for a task. Injected so the adapter owns no routing. */
  employeeFor: (task: TaskRecord) => Employee
  /** Prompt for a task, including rules, SOP and shared context. */
  promptFor: (task: TaskRecord) => string
}

export function createBuiltinAdapter(deps: BuiltinAdapterDeps): CodingAgentAdapter {
  let store: SessionStore = emptySessionStore()

  return {
    id: 'builtin',
    name: 'OpenMind worker',
    capabilities: CAPABILITIES,

    async available() {
      return true
    },

    async start(workspace: Workspace, projectId: string): Promise<WorkerSession> {
      const opened = openSession(store, {
        projectId,
        worker: 'code',
        provider: 'builtin',
        workspace,
      })
      store = opened.store
      return opened.session
    },

    async *runTask(session: WorkerSession, task: TaskRecord): AsyncIterable<AgentRuntimeEvent> {
      const now = () => Date.now()
      store = recordActivity(store, session.id, { status: 'running', taskId: task.id })
      yield { kind: 'thinking', text: `${task.id}: ${task.goal}`, at: now() }

      try {
        const result = await runEmployee(deps.brain, deps.employeeFor(task), deps.promptFor(task))

        for (const call of result.toolCalls) {
          yield { kind: 'tool_started', text: call.tool, tool: call.tool, at: now() }
          yield {
            kind: call.error ? 'error' : 'tool_completed',
            text: call.error?.message ?? call.output.slice(0, 200),
            tool: call.tool,
            at: now(),
          }
        }

        // A run whose every tool call was blocked did not fail at its job — a
        // capability was missing, and that is the user's decision to make.
        const blocked = result.toolCalls.length > 0
          && result.toolCalls.every((c) => c.error?.kind === 'blocked')

        store = recordActivity(store, session.id, { status: blocked ? 'blocked' : 'idle' })
        yield {
          kind: 'finished',
          text: blocked ? 'capability unavailable' : 'task run complete',
          outcome: blocked ? 'needs_user' : 'completed',
          at: now(),
        }
      } catch (err) {
        store = recordActivity(store, session.id, { status: 'failed' })
        yield {
          kind: 'finished',
          text: err instanceof Error ? err.message : String(err),
          outcome: 'failed',
          at: now(),
        }
      }
    },

    async cancel(sessionId: string) {
      store = closeSession(store, sessionId)
    },

    async resume(sessionId: string) {
      return store.sessions[sessionId] ?? null
    },
  }
}

/** Register the built-in adapter. Idempotent — safe to call at module load. */
export function registerBuiltinAdapter(deps: BuiltinAdapterDeps): CodingAgentAdapter {
  const adapter = createBuiltinAdapter(deps)
  registerAdapter(adapter)
  return adapter
}
