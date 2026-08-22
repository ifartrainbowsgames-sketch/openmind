/**
 * Prove routing evidence is durable, correlated and owner-scoped.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-routing-evidence.ts
 *
 * The claims, each against the real database:
 *
 *   1. a decision written by the worker survives in Postgres
 *   2. several observations correlate to ONE decision — the SAP failure
 *   3. a customer can READ their own evidence
 *   4. a customer CANNOT write or forge evidence
 *   5. a customer sees none of another customer's evidence
 *   6. arm stats rebuild from raw rows and match what was recorded
 *   7. nothing readable contains a credential
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createRoutingStore } from '../worker/routing-store'
import { rebuildStats, type RoutingDecision } from '../src/lib/workforce/routing-evidence'
import { demoCustomer, demoPassword, fixtureSecret } from './fixtures/demo-customers'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_KEY ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const { secret: SECRET } = fixtureSecret(process.env)

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function signIn(id: 'anthropic' | 'openai'): Promise<{ db: SupabaseClient; userId: string }> {
  const customer = demoCustomer(id)
  const db = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.auth.signInWithPassword({
    email: customer.email,
    password: demoPassword(customer.email, SECRET),
  })
  if (error || !data.user) throw new Error(`sign-in failed for ${id}: ${error?.message}`)
  return { db, userId: data.user.id }
}

async function main(): Promise<void> {
  if (!URL || !ANON || !SERVICE_ROLE) {
    console.error('FATAL: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required')
    process.exit(1)
  }

  const admin = createClient(URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const store = createRoutingStore(admin)

  const owner = await signIn('anthropic')
  const other = await signIn('openai')

  // Start clean so counts are attributable to this run.
  await admin.from('routing_decisions').delete().eq('user_id', owner.userId)
  await admin.from('routing_decisions').delete().eq('user_id', other.userId)

  const taskId = `verify-${Date.now()}`
  const decision: RoutingDecision = {
    id: crypto.randomUUID(),
    userId: owner.userId,
    projectId: 'verify-routing',
    taskId,
    decisionType: 'runtime',
    scope: 'code',
    chosenCandidateId: 'claude-code',
    candidateSet: ['claude-code', 'builtin'],
    contextFeatures: { taskType: 'code', requires: ['code.write'], attempt: 1 },
    policy: 'default',
    createdAt: Date.now(),
  }

  console.log('— the worker writes —\n')
  await store.recordDecision(decision)

  const stored = await store.decisionsFor(taskId)
  check('a decision written by the worker survives in Postgres',
    stored.length === 1 && stored[0].chosenCandidateId === 'claude-code',
    `${stored.length} row(s)`)
  check('the candidate set survived the round trip',
    stored[0]?.candidateSet.length === 2, stored[0]?.candidateSet.join(', ') ?? '')
  check('the context features survived as they were',
    stored[0]?.contextFeatures.attempt === 1)

  // The failure SAP's `last_context` cannot avoid: a task judged, retried and
  // then approved produces three outcomes against ONE decision.
  for (const [outcome, score] of [['failure', 30], ['failure', 45], ['success', 92]] as const) {
    await store.recordObservation({
      id: crypto.randomUUID(),
      decisionId: decision.id,
      userId: owner.userId,
      outcome,
      metrics: { acceptanceScore: score, retries: 1, costUsd: 0.02 },
      runtimeId: 'claude-code',
      createdAt: Date.now(),
    })
  }

  const { data: obs } = await admin
    .from('routing_observations').select('id, outcome').eq('decision_id', decision.id)
  check('THREE observations correlate to ONE decision',
    (obs?.length ?? 0) === 3, `${obs?.length ?? 0}`)

  console.log('\n— what a customer can see —\n')

  const own = await owner.db.from('routing_decisions').select('id, chosen_candidate_id')
  check('a customer can read their own routing history',
    !own.error && (own.data?.length ?? 0) === 1,
    own.error?.message ?? `${own.data?.length} decision(s)`)

  const foreign = await other.db.from('routing_decisions').select('id')
  check('and sees none of another customer\'s',
    !foreign.error && (foreign.data?.length ?? 0) === 0,
    `${foreign.data?.length ?? 0} decision(s)`)

  const forge = await owner.db.from('routing_decisions').insert({
    user_id: owner.userId,
    decision_type: 'runtime',
    scope: 'code',
    chosen_candidate_id: 'forged',
    policy: 'default',
  })
  check('a customer CANNOT write evidence — forged evidence is not evidence',
    Boolean(forge.error), forge.error?.message.slice(0, 80) ?? 'THE INSERT SUCCEEDED')

  const armPeek = await owner.db.from('routing_arm_stats').select('candidate_id')
  check('aggregate posteriors are not exposed to any customer',
    Boolean(armPeek.error), armPeek.error?.message.slice(0, 60) ?? 'THE SELECT SUCCEEDED')

  console.log('\n— counters are derived —\n')

  const stats = await store.statsFor('code', 'runtime')
  const arm = stats.find((s) => s.candidateId === 'claude-code')
  check('stats rebuild from raw rows',
    arm?.successes === 1 && arm?.failures === 2,
    arm ? `${arm.successes} success / ${arm.failures} failure` : '(no arm)')

  // The split's real test: the same raw rows, a stricter reward, different
  // counters — without losing a single observation.
  const { data: rawObs } = await admin
    .from('routing_observations').select('id, decision_id, outcome, metrics, created_at')
    .eq('decision_id', decision.id)
  const strict = rebuildStats(
    [decision],
    (rawObs ?? []).map((o) => ({
      id: String(o.id), decisionId: String(o.decision_id), userId: owner.userId,
      outcome: o.outcome as 'success' | 'failure' | 'neutral',
      metrics: (o.metrics ?? {}) as { acceptanceScore?: number },
      createdAt: Date.parse(String(o.created_at)),
    })),
    (o) => ((o.metrics.acceptanceScore ?? 0) >= 90 ? 'success' : 'failure'),
  )
  check('a CORRECTED reward function re-derives from the same history',
    strict[0]?.successes === 1 && strict[0]?.failures === 2,
    strict[0] ? `${strict[0].successes}/${strict[0].failures}` : '(none)')

  console.log('\n— nothing leaks —\n')
  const dump = JSON.stringify([own.data, stored, obs])
  check('the readable evidence is non-empty, so the next check is not vacuous',
    dump.length > 120)
  check('and contains no credential',
    !/sk-[A-Za-z0-9_-]{12,}/.test(dump), dump.slice(0, 60))

  await admin.from('routing_decisions').delete().eq('user_id', owner.userId)

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
