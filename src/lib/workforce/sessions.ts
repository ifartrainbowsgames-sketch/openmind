/**
 * Persistent worker sessions.
 *
 * A coding worker currently rediscovers the repository on every task: clone,
 * look around, work out the conventions, then do the actual job. That cost is
 * paid per task, and it is paid in model tokens.
 *
 * A session is the durable half of a worker — its workspace, its provider
 * session id, when it was last active. Tasks come and go against it. This is
 * the piece external coding agents need most, because Claude Code and Codex
 * both have their own resumable session ids, and throwing those away on every
 * task is what makes an adapter feel stateless and expensive.
 */

import type { WorkerKind } from '../task-ledger'
import type { Workspace } from './runtime'

export type SessionStatus = 'idle' | 'running' | 'waiting' | 'blocked' | 'failed' | 'closed'

export interface WorkerSession {
  id: string
  projectId: string
  worker: WorkerKind
  workspace?: Workspace
  /** Which adapter owns this session — 'builtin', 'claude-code', 'codex'… */
  provider: string
  /** The provider's own resumable id, when it has one. */
  providerSessionId?: string
  status: SessionStatus
  /** Tasks this session has served, most recent last. */
  taskIds: string[]
  startedAt: number
  lastActivityAt: number
}

/** Sessions idle longer than this are considered stale and not resumed. */
export const SESSION_IDLE_MS = 15 * 60 * 1000

export interface SessionStore {
  sessions: Record<string, WorkerSession>
}

export function emptySessionStore(): SessionStore {
  return { sessions: {} }
}

function sessionKey(projectId: string, worker: WorkerKind, provider: string): string {
  return `${projectId}:${worker}:${provider}`
}

export function openSession(
  store: SessionStore,
  input: { projectId: string; worker: WorkerKind; provider?: string; workspace?: Workspace },
  now = Date.now(),
): { store: SessionStore; session: WorkerSession; resumed: boolean } {
  const provider = input.provider ?? 'builtin'
  const key = sessionKey(input.projectId, input.worker, provider)
  const existing = store.sessions[key]

  if (existing && isResumable(existing, now)) {
    const session: WorkerSession = { ...existing, status: 'running', lastActivityAt: now }
    return { store: { sessions: { ...store.sessions, [key]: session } }, session, resumed: true }
  }

  const session: WorkerSession = {
    id: key,
    projectId: input.projectId,
    worker: input.worker,
    workspace: input.workspace ?? existing?.workspace,
    provider,
    status: 'running',
    taskIds: [],
    startedAt: now,
    lastActivityAt: now,
  }
  return { store: { sessions: { ...store.sessions, [key]: session } }, session, resumed: false }
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

export function recordActivity(
  store: SessionStore,
  sessionId: string,
  patch: Partial<Pick<WorkerSession, 'status' | 'providerSessionId' | 'workspace'>> & { taskId?: string },
  now = Date.now(),
): SessionStore {
  const existing = store.sessions[sessionId]
  if (!existing) return store
  const { taskId, ...rest } = patch
  const updated: WorkerSession = {
    ...existing,
    ...rest,
    taskIds: taskId && !existing.taskIds.includes(taskId)
      ? [...existing.taskIds, taskId]
      : existing.taskIds,
    lastActivityAt: now,
  }
  return { sessions: { ...store.sessions, [sessionId]: updated } }
}

export function closeSession(store: SessionStore, sessionId: string, now = Date.now()): SessionStore {
  const existing = store.sessions[sessionId]
  if (!existing) return store
  return {
    sessions: {
      ...store.sessions,
      [sessionId]: { ...existing, status: 'closed', lastActivityAt: now },
    },
  }
}

/** Sessions eligible for cleanup. Callers decide what closing costs. */
export function staleSessions(store: SessionStore, now = Date.now()): WorkerSession[] {
  return Object.values(store.sessions).filter(
    (s) => s.status !== 'closed' && now - s.lastActivityAt >= SESSION_IDLE_MS,
  )
}

export function sessionsFor(store: SessionStore, projectId: string): WorkerSession[] {
  return Object.values(store.sessions).filter((s) => s.projectId === projectId)
}
