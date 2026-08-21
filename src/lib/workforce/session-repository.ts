/**
 * Durable sessions and workspaces, as an injected service.
 *
 * The tempting fix for "a restart loses every session" is to make the runtime
 * a singleton so its `SessionStore` survives. That trades one problem for a
 * worse one: the builtin runtime holds per-run dependencies — the brain, the
 * composed prompt — so a shared instance is shared mutable state that two
 * concurrent runs corrupt. The runtime stays per-run. The *store* becomes a
 * service they all see.
 *
 * That fixes both failures at once:
 *
 *   process restart          — sessions outlive the process
 *   concurrent runs A and B  — they stop having private, divergent stores
 *
 * Local-first, like `project-store` and `memory`: every write lands in the
 * process map immediately and mirrors to Postgres when a user is signed in. A
 * cloud failure degrades to local rather than to silence. What it must never
 * do is degrade to a *different answer* — a cold read that misses the cloud
 * returns null, which is "I do not know", not "there is no session".
 */

import type { WorkerKind } from '../task-ledger'
import type { WorkerSession } from './sessions'
import type { WorkspaceRecord } from './workspaces'

/**
 * Who a session belongs to.
 *
 * Conversations and tasks have different ownership keys and identical
 * lifecycles. Giving chat its own session implementation is what produced the
 * bug where a chat turn inherited a coding task's sandbox.
 */
export type SessionScope =
  | { kind: 'project'; projectId: string; worker: WorkerKind }
  | { kind: 'conversation'; conversationId: string }

export function scopeKey(scope: SessionScope, provider: string): string {
  return scope.kind === 'project'
    ? `${scope.projectId}:${scope.worker}:${provider}`
    : `conversation:${scope.conversationId}:${provider}`
}

/** The id a workspace is filed under. Conversations own one; projects own one. */
export function scopeProjectId(scope: SessionScope): string {
  return scope.kind === 'project' ? scope.projectId : `conversation:${scope.conversationId}`
}

export interface SessionRepository {
  get(id: string): Promise<WorkerSession | null>
  find(scope: SessionScope, provider: string): Promise<WorkerSession | null>
  save(session: WorkerSession): Promise<void>
  delete(id: string): Promise<void>
}

export interface WorkspaceRepository {
  get(id: string): Promise<WorkspaceRecord | null>
  forProject(projectId: string): Promise<WorkspaceRecord[]>
  save(record: WorkspaceRecord): Promise<void>
  delete(id: string): Promise<void>
}

export interface Repositories {
  sessions: SessionRepository
  workspaces: WorkspaceRepository
}

// ── In-process ──────────────────────────────────────────────────────────────

const sessionMap = new Map<string, WorkerSession>()
const workspaceMap = new Map<string, WorkspaceRecord>()

export function memorySessionRepository(): SessionRepository {
  return {
    async get(id) {
      return sessionMap.get(id) ?? null
    },
    async find(scope, provider) {
      return sessionMap.get(scopeKey(scope, provider)) ?? null
    },
    async save(session) {
      sessionMap.set(session.id, session)
    },
    async delete(id) {
      sessionMap.delete(id)
    },
  }
}

export function memoryWorkspaceRepository(): WorkspaceRepository {
  return {
    async get(id) {
      return workspaceMap.get(id) ?? null
    },
    async forProject(projectId) {
      return [...workspaceMap.values()].filter((w) => w.projectId === projectId)
    },
    async save(record) {
      workspaceMap.set(record.id, record)
    },
    async delete(id) {
      workspaceMap.delete(id)
    },
  }
}

/** Test seam, and the reset a fresh process gets for free. */
export function _resetRepositories(): void {
  sessionMap.clear()
  workspaceMap.clear()
}

// ── Postgres-backed ─────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  scope: unknown
  provider: string
  provider_session_id: string | null
  workspace_id: string | null
  status: string
  task_ids: unknown
  started_at: string
  last_activity_at: string
}

interface WorkspaceRow {
  id: string
  runtime: string
  external_id: string | null
  project_id: string
  kind: string
  path: string
  branch: string | null
  repo_url: string | null
  status: string
  created_at: string
  last_verified_at: string | null
}

function toSession(row: SessionRow): WorkerSession {
  return {
    id: row.id,
    scope: row.scope as SessionScope,
    provider: row.provider,
    providerSessionId: row.provider_session_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    status: row.status as WorkerSession['status'],
    taskIds: Array.isArray(row.task_ids) ? (row.task_ids as string[]) : [],
    startedAt: Date.parse(row.started_at) || Date.now(),
    lastActivityAt: Date.parse(row.last_activity_at) || Date.now(),
  }
}

function toRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    runtime: row.runtime,
    externalId: row.external_id ?? undefined,
    projectId: row.project_id,
    kind: row.kind as WorkspaceRecord['kind'],
    path: row.path,
    branch: row.branch ?? undefined,
    repoUrl: row.repo_url ?? undefined,
    status: row.status as WorkspaceRecord['status'],
    createdAt: Date.parse(row.created_at) || Date.now(),
    lastVerifiedAt: row.last_verified_at ? Date.parse(row.last_verified_at) : undefined,
  }
}

/**
 * The signed-in user, or null.
 *
 * Sessions are per-account: a session id is derived from a project and a
 * worker, so two accounts working on projects with the same id must not see
 * each other's machines.
 */
async function owner(): Promise<string | null> {
  if (typeof window === 'undefined' && typeof globalThis.localStorage === 'undefined') {
    // Worker/CLI process. It authenticates as the service role and passes the
    // owner explicitly; there is no browser session to read.
    return null
  }
  try {
    const { getSession } = await import('../auth')
    const { isSupabaseConfigured } = await import('../supabase')
    const session = await getSession()
    if (!session?.user.id || session.demo || !isSupabaseConfigured) return null
    return session.user.id
  } catch {
    return null
  }
}

/**
 * Sessions and workspaces in Postgres, mirrored through the process maps.
 *
 * `provider_session_id` is runtime metadata, not a credential — but it is
 * internal, and nothing here hands it to a browser that did not already own
 * the session.
 */
export function durableRepositories(): Repositories {
  const memSessions = memorySessionRepository()
  const memWorkspaces = memoryWorkspaceRepository()

  return {
    sessions: {
      async get(id) {
        const local = await memSessions.get(id)
        if (local) return local
        const userId = await owner()
        if (!userId) return null
        const { supabase } = await import('../supabase')
        const { data, error } = await supabase
          .from('agent_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
        if (error || !data) return null
        const session = toSession(data as SessionRow)
        await memSessions.save(session)
        return session
      },

      async find(scope, provider) {
        return this.get(scopeKey(scope, provider))
      },

      async save(session) {
        await memSessions.save(session)
        const userId = await owner()
        if (!userId) return
        const { supabase } = await import('../supabase')
        await supabase.from('agent_sessions').upsert({
          id: session.id,
          user_id: userId,
          scope: session.scope,
          provider: session.provider,
          provider_session_id: session.providerSessionId ?? null,
          workspace_id: session.workspaceId ?? null,
          status: session.status,
          task_ids: session.taskIds,
          started_at: new Date(session.startedAt).toISOString(),
          last_activity_at: new Date(session.lastActivityAt).toISOString(),
        })
      },

      async delete(id) {
        await memSessions.delete(id)
        const userId = await owner()
        if (!userId) return
        const { supabase } = await import('../supabase')
        await supabase.from('agent_sessions').delete().eq('id', id).eq('user_id', userId)
      },
    },

    workspaces: {
      async get(id) {
        const local = await memWorkspaces.get(id)
        if (local) return local
        const userId = await owner()
        if (!userId) return null
        const { supabase } = await import('../supabase')
        const { data, error } = await supabase
          .from('agent_workspaces').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
        if (error || !data) return null
        const record = toRecord(data as WorkspaceRow)
        await memWorkspaces.save(record)
        return record
      },

      async forProject(projectId) {
        const local = await memWorkspaces.forProject(projectId)
        if (local.length) return local
        const userId = await owner()
        if (!userId) return []
        const { supabase } = await import('../supabase')
        const { data, error } = await supabase
          .from('agent_workspaces').select('*').eq('project_id', projectId).eq('user_id', userId)
        if (error || !data) return []
        const records = (data as WorkspaceRow[]).map(toRecord)
        for (const record of records) await memWorkspaces.save(record)
        return records
      },

      async save(record) {
        await memWorkspaces.save(record)
        const userId = await owner()
        if (!userId) return
        const { supabase } = await import('../supabase')
        await supabase.from('agent_workspaces').upsert({
          id: record.id,
          user_id: userId,
          runtime: record.runtime,
          external_id: record.externalId ?? null,
          project_id: record.projectId,
          kind: record.kind,
          path: record.path,
          branch: record.branch ?? null,
          repo_url: record.repoUrl ?? null,
          status: record.status,
          created_at: new Date(record.createdAt).toISOString(),
          last_verified_at: record.lastVerifiedAt ? new Date(record.lastVerifiedAt).toISOString() : null,
        })
      },

      async delete(id) {
        await memWorkspaces.delete(id)
        const userId = await owner()
        if (!userId) return
        const { supabase } = await import('../supabase')
        await supabase.from('agent_workspaces').delete().eq('id', id).eq('user_id', userId)
      },
    },
  }
}

let shared: Repositories | undefined

/** The repositories every runtime instance in this process shares. */
export function repositories(): Repositories {
  return (shared ??= durableRepositories())
}

/** Swap the shared repositories. Tests and the worker process use this. */
export function setRepositories(next: Repositories | undefined): void {
  shared = next
}
