/**
 * A workspace identity for surfaces that have no task.
 *
 * The chat turn, the crew, and the Studio's single-employee run are production
 * surfaces — a user action runs a real employee with real tools — but they are
 * not task-graph runs, so they have no project, no ledger and no session. They
 * were therefore left on the module-level sandbox binding.
 *
 * That is a leak, not merely untidy. None of them ever *sets* the binding, so
 * they inherit whatever the last task run left there. A chat turn following a
 * coding task would run `run_code` inside that task's sandbox — reading its
 * files, and writing into a machine the task still believes it owns. Nothing
 * errors. The only symptom is a chat answer that knows things it should not.
 *
 * So a conversation gets its own identity: one workspace per conversation,
 * held across turns, and never the task graph's. Same `sessions.ts` machinery,
 * so the same rules about resumption and staleness apply.
 *
 * What this deliberately does NOT do is give a conversation a ledger, memory
 * recording, or a judge. Those belong to tasks. This is the smallest thing
 * that makes "which machine am I on" answerable.
 */

import { BUILTIN_CAPABILITIES } from './builtin-runtime'
import {
  NULL_SINK, createExecutionContext,
  type EventSink, type ExecutionContext, type MemoryReader, type PermissionContext,
} from './execution-context'
import { makeWorkspace, type Workspace } from './runtime'
import { sandboxRuntime } from './sandbox-runtime'
import { emptySessionStore, openSession, recordActivity, type SessionStore } from './sessions'

let store: SessionStore = emptySessionStore()

export interface ConversationContextInput {
  /**
   * Stable per conversation. The account id is the right granularity for the
   * chat surface: one machine per person, not one per message.
   */
  conversationId: string
  permissions: PermissionContext
  eventSink?: EventSink
  memory?: MemoryReader
  abortSignal?: AbortSignal
}

export function conversationContext(input: ConversationContextInput): ExecutionContext {
  const projectId = `conversation:${input.conversationId || 'anon'}`
  const opened = openSession(store, {
    projectId,
    // Conversations are not typed work. 'research' is the least-privileged
    // built-in kind that still reads as a general assistant; nothing routes on
    // it, because nothing routes conversations.
    worker: 'research',
    provider: 'conversation',
    workspace: makeWorkspace(projectId),
  })
  store = opened.store
  const session = opened.session

  return createExecutionContext({
    session,
    runtime: (self) => sandboxRuntime(self),
    workspace: session.workspace ?? makeWorkspace(projectId),
    capabilities: BUILTIN_CAPABILITIES,
    permissions: input.permissions,
    eventSink: input.eventSink ?? NULL_SINK,
    memory: input.memory,
    abortSignal: input.abortSignal,
    // Written back to the store, so the machine a tool created in this turn is
    // the machine the next turn uses.
    onAdopt: (workspace: Workspace) => {
      store = recordActivity(store, session.id, { workspace })
    },
  })
}

/** Test seam. Production never clears conversation sessions. */
export function _resetConversations(): void {
  store = emptySessionStore()
}
