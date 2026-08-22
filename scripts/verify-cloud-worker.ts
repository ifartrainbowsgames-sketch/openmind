/**
 * Prove the DEPLOYED worker really executes a customer's run.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-cloud-worker.ts
 *   npx tsx scripts/verify-cloud-worker.ts --user <uuid>
 *
 * This writes real rows to production `agent_runs` and waits for the Railway
 * worker to claim them. Nothing here executes the graph locally — that is the
 * whole point. A local run proves the code works; only a claimed row proves the
 * deployment does.
 *
 * ── Why the canary is a transformation, not a token ─────────────────────────
 *
 * The obvious canary is "ask for CLOUD-RUNTIME-CANARY-8274, check the answer
 * contains it". That test cannot fail. `simulatedBrain.respond` ends with
 * `You asked: "${input}"` — it echoes the goal verbatim, so the token comes
 * back whether or not a model was ever called, and the check passes against
 * the very thing it exists to rule out.
 *
 * So the canary asks for the token with its digits REVERSED. An echo returns
 * 8274; only something that read the instruction and acted on it returns 4728.
 * Phase 1 proves that discrimination locally, against the real simulator,
 * before any production row is written — because a canary nobody has watched
 * fail is not evidence.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { simulatedBrain } from '../src/lib/agent'
import type { Employee } from '../src/lib/agent/types'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** How long to wait for a worker to claim and finish. */
const TIMEOUT_MS = Number(process.env.CANARY_TIMEOUT_MS ?? 480_000)
const POLL_MS = 3000

const TOKEN = 'CLOUD-RUNTIME-CANARY-8274'
const EXPECTED = 'CLOUD-RUNTIME-CANARY-4728'
const GOAL =
  `Reply with the token ${TOKEN}, except write its four digits in reverse order. `
  + 'Output only that one token. Do not explain, do not use any tool.'

/** From simulatedBrain.respond in src/lib/agent/brains.ts. */
const SIMULATOR_FINGERPRINT = "in live mode I'd"

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

interface RunRow {
  id: string
  status: string
  answer: string | null
  error: string | null
  claimed_by: string | null
  claimed_at: string | null
  trace_id: string | null
  project_id: string | null
}

function must(name: string, value: string): string {
  if (!value) {
    console.error(`FATAL: ${name} is not set. Run:  set -a; . ./.env; set +a`)
    process.exit(1)
  }
  return value
}

/** Wait for a queued row to reach a terminal status. */
async function settle(db: SupabaseClient, id: string): Promise<RunRow> {
  const deadline = Date.now() + TIMEOUT_MS
  let claimedLogged = false
  let last = ''

  while (Date.now() < deadline) {
    const { data } = await db
      .from('agent_runs')
      .select('id, status, answer, error, claimed_by, claimed_at, trace_id, project_id')
      .eq('id', id)
      .maybeSingle()
    const row = data as RunRow | null

    if (row) {
      if (row.claimed_by && !claimedLogged) {
        claimedLogged = true
        console.log(`      claimed by ${row.claimed_by}`)
      }
      if (row.status !== last) {
        console.log(`      status: ${row.status}  (${Math.round((Date.now() - deadline + TIMEOUT_MS) / 1000)}s)`)
        last = row.status
      }
      if (['completed', 'failed', 'needs_user', 'cancelled'].includes(row.status)) return row
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }

  const { data } = await db.from('agent_runs').select('*').eq('id', id).maybeSingle()
  return (data ?? { id, status: 'TIMEOUT', answer: null, error: null,
    claimed_by: null, claimed_at: null, trace_id: null, project_id: null }) as RunRow
}

async function enqueue(db: SupabaseClient, userId: string, goal: string): Promise<string> {
  const { data, error } = await db
    .from('agent_runs')
    .insert({ user_id: userId, goal, status: 'queued', options: { strictMode: true } })
    .select('id')
    .single()
  if (error) throw new Error(`could not queue: ${error.message}`)
  return (data as { id: string }).id
}

async function main(): Promise<void> {
  // ── Phase 1 — the canary can fail ─────────────────────────────────────────
  //
  // Run the real simulator against the real goal. If it passes the canary, the
  // canary is worthless and this script stops rather than reporting a green
  // production result it did not earn.
  console.log('— phase 1: the canary discriminates —\n')

  const employee: Employee = {
    id: 'canary', name: 'Canary', role: 'Probe',
    prompt: 'Answer exactly as asked.', tools: [], accent: '#000',
  }
  const simulated = await simulatedBrain().respond(GOAL, [], employee)

  check('the simulator echoes the goal, as expected', simulated.includes(TOKEN))
  check('THE SIMULATOR CANNOT PASS THE CANARY', !simulated.includes(EXPECTED),
    simulated.includes(EXPECTED) ? 'canary is vacuous — STOP' : `it returns ${TOKEN}, not ${EXPECTED}`)
  check('the simulator has a recognisable fingerprint', simulated.includes(SIMULATOR_FINGERPRINT))

  if (failures) {
    console.error('\nThe canary cannot distinguish a real model from the simulator.')
    console.error('Fix the canary before trusting any production result.')
    process.exit(1)
  }

  // ── Phase 2 — production ──────────────────────────────────────────────────
  const db = createClient(must('SUPABASE_URL', URL), must('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const flagged = process.argv.indexOf('--user')
  let userId = flagged >= 0 ? process.argv[flagged + 1] : ''

  if (!userId) {
    const { data } = await db.from('provider_keys').select('user_id, role').in('role', ['worker', 'anthropic'])
    userId = ((data ?? [])[0] as { user_id: string } | undefined)?.user_id ?? ''
    if (!userId) {
      console.error('\nFATAL: no customer has a stored provider key.')
      console.error('       Sign in to /app and add one under Settings → AI Providers,')
      console.error('       then re-run with --user <uuid>.')
      process.exit(1)
    }
    console.log(`\n(no --user given; using ${userId.slice(0, 8)}… from provider_keys)`)
  }

  console.log('\n— phase 2: a real run, executed by the deployed worker —\n')
  const canaryId = await enqueue(db, userId, GOAL)
  console.log(`      queued ${canaryId}`)
  const run = await settle(db, canaryId)

  check('the worker CLAIMED the run', Boolean(run.claimed_by), run.claimed_by ?? 'never claimed')
  check('it is not this machine', run.claimed_by !== `worker-${process.pid}`)
  check('the run reached a terminal status', run.status !== 'TIMEOUT', run.status)
  check('the run COMPLETED', run.status === 'completed',
    run.status === 'completed' ? '' : `${run.status}: ${run.error ?? '(no error)'}`)

  const answer = run.answer ?? ''
  check('THE CANARY CAME BACK', answer.includes(EXPECTED),
    answer.includes(EXPECTED) ? EXPECTED : `absent — answer began "${answer.slice(0, 120)}"`)
  check('the simulator was NOT used', !answer.includes(SIMULATOR_FINGERPRINT))
  check('the answer is not a bare echo of the goal',
    answer.includes(EXPECTED) && !(answer.includes(TOKEN) && !answer.includes(EXPECTED)))
  check('a trace was recorded', Boolean(run.trace_id), run.trace_id ?? '(none)')
  check('a project snapshot was written', Boolean(run.project_id), run.project_id ?? '(none)')

  // ── Phase 3 — a customer with no key blocks, truthfully ───────────────────
  //
  // The failure this rules out is the worst one available: a customer who
  // connected nothing gets a fluent, simulated answer and believes it.
  console.log('\n— phase 3: no provider key blocks, and does not simulate —\n')

  const { data: keyed } = await db.from('provider_keys').select('user_id')
  const withKeys = new Set((keyed ?? []).map((r) => (r as { user_id: string }).user_id))
  const { data: users } = await db.auth.admin.listUsers()
  const bare = (users?.users ?? []).find((u) => !withKeys.has(u.id))

  if (!bare) {
    console.log('SKIP  every account has a stored key — no bare account to test with')
  } else {
    const bareId = await enqueue(db, bare.id, GOAL)
    console.log(`      queued ${bareId} for ${bare.id.slice(0, 8)}… (no keys)`)
    const blocked = await settle(db, bareId)

    check('it BLOCKED rather than answering', blocked.status === 'needs_user', blocked.status)
    check('it did not silently complete', blocked.status !== 'completed')
    check('the reason names the fix', (blocked.error ?? '').toLowerCase().includes('provider key'),
      blocked.error ?? '(no error)')
    check('nothing was simulated', !(blocked.answer ?? '').includes(SIMULATOR_FINGERPRINT))
    check('the canary did NOT come back', !(blocked.answer ?? '').includes(EXPECTED))
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
