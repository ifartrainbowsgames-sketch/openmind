/**
 * A workspace identity for surfaces that have no task.
 *
 * The chat turn, the crew, and the Studio's single-employee run are production
 * surfaces — a user action runs a real employee with real tools — but they are
 * not task-graph runs, so they have no project and no ledger. They were
 * therefore left on the module-level sandbox binding.
 *
 * That is a leak, not merely untidy. None of them ever *sets* the binding, so
 * they inherit whatever the last task run left there. A chat turn following a
 * coding task would run `run_code` inside that task's sandbox — reading its
 * files, and writing into a machine the task still believes it owns. Nothing
 * errors. The only symptom is a chat answer that knows things it should not.
 *
 * The fix is not a second session system. It is the *same* one with a different
 * ownership key:
 *
 *   task session          { kind: 'project', projectId, worker }
 *   conversation session  { kind: 'conversation', conversationId }
 *
 * Same repository, same resumption rules, same workspace records, same
 * recovery. A conversation deliberately gets no ledger, no memory recording
 * and no judge — those belong to tasks.
 *
 * Synchronous by necessity: `runEmployee` callers build this inline. So it
 * reads the process-local cache and writes through to durable storage in the
 * background. A conversation losing its machine on a cold start costs one new
 * sandbox; blocking a chat turn on a round trip costs every chat turn.
 */

import { BUILTIN_CAPABILITIES } from './builtin-runtime'
import {
  NULL_SINK, createExecutionContext,
  type EventSink, type ExecutionContext, type MemoryReader, type PermissionContext,
} from './execution-context'
import { newSession, touch, type WorkerSession } from './sessions'
import {
  repositories, scopeKey, scopeProjectId, type SessionScope,
} from './session-repository'
import { sandboxRuntime } from './sandbox-runtime'
import { makeWorkspaceRecord, toWorkspace, withWorkspace, type WorkspaceRecord } from './workspaces'
import type { Workspace } from './runtime'

/** Process-local view, so building a context does not await. */
const live = new Map<string, { session: WorkerSession; record: WorkspaceRecord }>()

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
  const scope: SessionScope = { kind: 'conversation', conversationId: input.conversationId || 'anon' }
  const id = scopeKey(scope, 'builtin')

  let entry = live.get(id)
  if (!entry) {
    const record = makeWorkspaceRecord({ projectId: scopeProjectId(scope), kind: 'conversation' })
    const session = touch(newSession(scope, 'builtin'), { workspaceId: record.id })
    entry = { session, record }
    live.set(id, entry)
    void persist(entry)
  }

  const held = entry

  return createExecutionContext({
    session: held.session,
    runtime: (self) => sandboxRuntime(self),
    workspace: toWorkspace(held.record),
    capabilities: BUILTIN_CAPABILITIES,
    permissions: input.permissions,
    eventSink: input.eventSink ?? NULL_SINK,
    memory: input.memory,
    abortSignal: input.abortSignal,
    // Written back so the machine a tool created in this turn is the machine
    // the next turn uses — and so it outlives the process.
    onAdopt: (workspace: Workspace) => {
      held.record = { ...withWorkspace(held.record, workspace), status: 'active', lastVerifiedAt: Date.now() }
      live.set(id, held)
      void persist(held)
    },
  })
}

/**
 * Durable write, deliberately not awaited.
 *
 * A failure here costs a conversation its remembered machine on the next cold
 * start — one new sandbox. Awaiting it would cost a round trip on every chat
 * turn, and a chat turn that stalls on a database write is a worse product
 * than one that occasionally forgets which sandbox it had.
 */
async function persist(entry: { session: WorkerSession; record: WorkspaceRecord }): Promise<void> {
  try {
    const repos = repositories()
    await repos.workspaces.save(entry.record)
    await repos.sessions.save(entry.session)
  } catch {
    /* local-first: the process map is still correct */
  }
}

/**
 * Adopt a durable conversation session, when a caller can afford to wait.
 *
 * Used at boot so a returning user keeps the machine their last conversation
 * left behind, rather than starting a new one because the process is new.
 */
export async function warmConversation(conversationId: string): Promise<void> {
  const scope: SessionScope = { kind: 'conversation', conversationId: conversationId || 'anon' }
  const id = scopeKey(scope, 'builtin')
  if (live.has(id)) return
  try {
    const repos = repositories()
    const session = await repos.sessions.find(scope, 'builtin')
    const record = session?.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
    if (session && record) live.set(id, { session, record })
  } catch {
    /* nothing stored yet, or no account — a fresh conversation is correct */
  }
}

/** Test seam. Production never clears conversation sessions. */
export function _resetConversations(): void {
  live.clear()
}
