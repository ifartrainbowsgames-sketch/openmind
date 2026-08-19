// Queue a run on the worker and watch it, instead of executing in the tab.
//
// A foreground run dies when the tab closes. A queued run is a row the worker
// claims; the browser is then just a viewer, and closing it costs nothing.
// Only non-secret options travel with the row — the worker reads the provider
// key from the vault, so nothing sensitive lands in `agent_runs`.

import type { ProjectSnapshot } from './task-ledger'
import type { WorkspaceSpace } from './workspace'
import type { SkillId } from './skills'

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'needs_user'
  | 'cancelled'

export interface QueuedRun {
  id: string
  goal: string
  status: RunStatus
  snapshot?: ProjectSnapshot
  answer?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

/** Non-secret run configuration. Never put an API key in here. */
export interface RunOptions {
  workspace?: WorkspaceSpace
  skill?: SkillId
  strictMode?: boolean
  toolKeys?: Record<string, string | undefined>
}

export const TERMINAL_STATUSES: RunStatus[] = [
  'completed', 'failed', 'blocked', 'needs_user', 'cancelled',
]

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

function toRun(row: Record<string, unknown>): QueuedRun {
  return {
    id: String(row.id),
    goal: String(row.goal ?? ''),
    status: row.status as RunStatus,
    snapshot: (row.snapshot as ProjectSnapshot) ?? undefined,
    answer: (row.answer as string | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
    createdAt: row.created_at ? Date.parse(String(row.created_at)) : Date.now(),
    finishedAt: row.finished_at ? Date.parse(String(row.finished_at)) : undefined,
  }
}

/**
 * Hand a goal to the worker. Returns the row id — the caller subscribes to it
 * rather than awaiting, because the point is that the tab need not stay open.
 */
export async function enqueueRun(goal: string, options: RunOptions = {}): Promise<QueuedRun> {
  const { supabase } = await import('./supabase')
  const { getSession } = await import('./auth')
  const session = await getSession()
  if (!session?.user.id || session.demo) {
    throw new Error('Background runs need a signed-in account — they outlive the browser tab.')
  }

  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      user_id: session.user.id,
      goal,
      status: 'queued',
      options: sanitizeOptions(options),
    })
    .select()
    .single()

  if (error) throw new Error(`could not queue the run: ${error.message}`)
  return toRun(data as Record<string, unknown>)
}

/**
 * Strip anything secret before it reaches the row. `toolKeys` in particular is
 * a bag the caller fills from local settings — the server-held vault is the
 * only place keys belong now.
 */
export function sanitizeOptions(options: RunOptions): Record<string, unknown> {
  return {
    workspace: options.workspace,
    skill: options.skill,
    strictMode: options.strictMode === true,
  }
}

/**
 * Watch one run. Calls back on every change and resolves the unsubscribe.
 * Falls back to polling when Realtime is unavailable, so a blocked WebSocket
 * degrades to slower updates instead of a run that appears frozen.
 */
export async function watchRun(
  runId: string,
  onChange: (run: QueuedRun) => void,
): Promise<() => void> {
  const { supabase } = await import('./supabase')
  let stopped = false

  const emit = (row: Record<string, unknown>) => {
    if (!stopped) onChange(toRun(row))
  }

  const { data } = await supabase.from('agent_runs').select('*').eq('id', runId).single()
  if (data) emit(data as Record<string, unknown>)

  const channel = supabase
    .channel(`agent_runs:${runId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'agent_runs', filter: `id=eq.${runId}` },
      (payload) => emit(payload.new as Record<string, unknown>),
    )
    .subscribe()

  // Realtime can be disabled or blocked by a proxy; poll slowly regardless so
  // the UI still converges. Cheap: one row by primary key.
  const poll = setInterval(async () => {
    if (stopped) return
    const { data: row } = await supabase.from('agent_runs').select('*').eq('id', runId).single()
    if (row) {
      emit(row as Record<string, unknown>)
      if (isTerminal((row as { status: RunStatus }).status)) clearInterval(poll)
    }
  }, 5000)

  return () => {
    stopped = true
    clearInterval(poll)
    void supabase.removeChannel(channel)
  }
}

export async function listRuns(limit = 20): Promise<QueuedRun[]> {
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data ?? []).map((r) => toRun(r as Record<string, unknown>))
}

/** Cancel is the only status change a client is allowed to make. */
export async function cancelRun(runId: string): Promise<void> {
  const { supabase } = await import('./supabase')
  await supabase.from('agent_runs').update({ status: 'cancelled' }).eq('id', runId)
}
