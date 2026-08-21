/**
 * Persistent worker sessions.
 *
 * A coding worker would otherwise rediscover the repository on every task:
 * clone, look around, work out the conventions, then do the actual job. That
 * cost is paid per task, and it is paid in model tokens.
 *
 * A session is the durable half of a worker — its scope, its workspace, its
 * provider session id, when it was last active. Tasks come and go against it.
 * This is the piece external coding agents need most, because Claude Code and
 * Codex both have their own resumable session ids, and throwing those away on
 * every task is what makes an adapter feel stateless and expensive.
 *
 * ## Why the workspace is an id
 *
 * A session says *who was working*; a `WorkspaceRecord` says *where*, with a
 * status and a last-verified time. Embedding the machine in the session made
 * "the sandbox id we remember" and "a machine that still exists" the same
 * field, which they are not — see workspaces.ts.
 *
 * The functions here stay pure. Durability is a repository the caller injects,
 * so a per-run runtime can hold no state and still see the same sessions as
 * every other run in the process, and as the process before it.
 */

import { scopeKey, type SessionScope } from './session-repository'
import type { WorkerKind } from '../task-ledger'

export type SessionStatus = 'idle' | 'running' | 'waiting' | 'blocked' | 'failed' | 'closed'

export interface WorkerSession {
  id: string
  scope: SessionScope
  /** Which adapter owns this session — 'builtin', 'claude-code', 'codex'… */
  provider: string
  /** The provider's own resumable id, when it has one. Internal metadata. */
  providerSessionId?: string
  /** The machine this session works on. Resolved through WorkspaceRepository. */
  workspaceId?: string
  status: SessionStatus
  /** Tasks this session has served, most recent last. */
  taskIds: string[]
  startedAt: number
  lastActivityAt: number
}

/** Sessions idle longer than this are considered stale and not resumed. */
export const SESSION_IDLE_MS = 15 * 60 * 1000

export function sessionProjectId(session: WorkerSession): string {
  return session.scope.kind === 'project'
    ? session.scope.projectId
    : `conversation:${session.scope.conversationId}`
}

export function sessionWorker(session: WorkerSession): WorkerKind | undefined {
  return session.scope.kind === 'project' ? session.scope.worker : undefined
}

export function newSession(
  scope: SessionScope,
  provider: string,
  now = Date.now(),
): WorkerSession {
  return {
    id: scopeKey(scope, provider),
    scope,
    provider,
    status: 'running',
    taskIds: [],
    startedAt: now,
    lastActivityAt: now,
  }
}

/**
 * A session is resumable when it is neither closed nor failed and has been
 * touched recently. Failed sessions are deliberately not resumed: whatever
 * broke the workspace is still there, and resuming into it turns one bad task
 * into a bad session.
 */
export function isResumable(session: WorkerSession, now = Date.now()): boolean {
  if (session.status === 'closed' || session.status === 'failed') return false
  return now - session.lastActivityAt < SESSION_IDLE_MS
}

export type SessionPatch =
  Partial<Pick<WorkerSession, 'status' | 'providerSessionId' | 'workspaceId'>>
  & { taskId?: string }

export function touch(
  session: WorkerSession,
  patch: SessionPatch = {},
  now = Date.now(),
): WorkerSession {
  const { taskId, ...rest } = patch
  return {
    ...session,
    ...rest,
    taskIds: taskId && !session.taskIds.includes(taskId)
      ? [...session.taskIds, taskId]
      : session.taskIds,
    lastActivityAt: now,
  }
}

export function closed(session: WorkerSession, now = Date.now()): WorkerSession {
  return { ...session, status: 'closed', lastActivityAt: now }
}

export function isStale(session: WorkerSession, now = Date.now()): boolean {
  return session.status !== 'closed' && now - session.lastActivityAt >= SESSION_IDLE_MS
}
