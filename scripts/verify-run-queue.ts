/**
 * Live check of the run-queue lifecycle, against the real database.
 *
 * Two behaviours here are the kind that typecheck perfectly and still do the
 * wrong thing, because they live in SQL and in a `.eq()` filter:
 *
 *   §4.1 a run that keeps killing the worker must stop being reclaimed
 *   §4.2 a terminal write must not overwrite a cancellation
 *
 * Uses the service role, so it bypasses RLS exactly as the worker does. Every
 * row it creates is namespaced and deleted at the end, including on failure.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-run-queue.ts
 */

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!URL || !KEY) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// Fixed ids so a crashed run leaves nothing behind that a rerun cannot clean.
const POISON = '11111111-1111-1111-1111-111111111111'
const HEALTHY = '22222222-2222-2222-2222-222222222222'
const RECOVERABLE = '33333333-3333-3333-3333-333333333333'
const CANCELLED = '44444444-4444-4444-4444-444444444444'
const ALL = [POISON, HEALTHY, RECOVERABLE, CANCELLED]

const LONG_AGO = '2020-01-01T00:00:00Z'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function cleanup(): Promise<void> {
  await db.from('agent_runs').delete().in('id', ALL)
}

async function statusOf(id: string): Promise<{ status: string; attempts: number; error: string | null }> {
  const { data } = await db.from('agent_runs').select('status, attempts, error').eq('id', id).maybeSingle()
  return (data as { status: string; attempts: number; error: string | null }) ?? { status: 'missing', attempts: -1, error: null }
}

async function main(): Promise<void> {
  // agent_runs.user_id is a FK to auth.users, which PostgREST does not expose.
  // The service role can list users through the admin API.
  const { data: listed, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1 })
  const userId = listed?.users?.[0]?.id
  if (!userId) {
    console.error('No auth user to attach test rows to.', listErr?.message ?? '')
    process.exit(1)
  }

  await cleanup()

  await db.from('agent_runs').insert([
    // At the cap and stale: must be retired, never handed to a worker again.
    { id: POISON, user_id: userId, goal: 'POISON', status: 'running', attempts: 3, claimed_at: LONG_AGO, claimed_by: 'dead' },
    // Under the cap and stale: a worker died mid-run, this should recover.
    { id: RECOVERABLE, user_id: userId, goal: 'RECOVERABLE', status: 'running', attempts: 1, claimed_at: LONG_AGO, claimed_by: 'dead' },
    // Cancelled: stands in for a user who pressed stop.
    { id: CANCELLED, user_id: userId, goal: 'CANCELLED', status: 'cancelled', attempts: 1, claimed_at: LONG_AGO, claimed_by: 'dead' },
    { id: HEALTHY, user_id: userId, goal: 'HEALTHY', status: 'queued', attempts: 0 },
  ])

  console.log('— §4.1 attempt cap —')
  const claimedIds: string[] = []
  for (let i = 0; i < 4; i++) {
    const { data, error } = await db.rpc('claim_agent_run', { worker_id: `verify-${i}` })
    if (error) { check('claim_agent_run is callable by the service role', false, error.message); break }
    const row = (data as { id: string }[] | null)?.[0]
    if (row) claimedIds.push(row.id)
  }
  check('claim_agent_run is callable by the service role', failures === 0)

  const poison = await statusOf(POISON)
  check('the poison run is retired as failed', poison.status === 'failed', `status=${poison.status}`)
  check('its error says why', Boolean(poison.error?.match(/abandoned after/i)), poison.error ?? '(none)')
  check('it was never handed to a worker', !claimedIds.includes(POISON), claimedIds.join(', ') || '(nothing claimed)')

  const recoverable = await statusOf(RECOVERABLE)
  check('a stale run under the cap is reclaimed', claimedIds.includes(RECOVERABLE), `attempts=${recoverable.attempts}`)
  check('reclaiming increments attempts', recoverable.attempts === 2, `attempts=${recoverable.attempts}`)
  check('a queued run is claimed', claimedIds.includes(HEALTHY))

  console.log('\n— §4.2 a cancelled run cannot be resurrected —')
  const stillCancelled = await statusOf(CANCELLED)
  check('a cancelled run is never claimed', !claimedIds.includes(CANCELLED), `status=${stillCancelled.status}`)

  // Exactly what the worker does on completion, including the guard.
  const { data: guarded } = await db
    .from('agent_runs')
    .update({ status: 'completed', answer: 'should not land' })
    .eq('id', CANCELLED)
    .eq('status', 'running')
    .select()
  check('the guarded terminal write touches no rows', (guarded?.length ?? 0) === 0, `${guarded?.length ?? 0} row(s)`)
  const after = await statusOf(CANCELLED)
  check('the row is still cancelled', after.status === 'cancelled', `status=${after.status}`)

  // And prove the guard is what stopped it, not something else.
  const { data: unguarded } = await db
    .from('agent_runs')
    .update({ status: 'completed' })
    .eq('id', CANCELLED)
    .select()
  check('without the guard it WOULD have been overwritten', (unguarded?.length ?? 0) === 1,
    `${unguarded?.length ?? 0} row(s) — this is the bug the guard prevents`)

  await cleanup()
  const gone = await statusOf(POISON)
  check('test rows cleaned up', gone.status === 'missing')

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch(async (error) => {
  console.error('THREW', error)
  await cleanup()
  process.exit(1)
})
