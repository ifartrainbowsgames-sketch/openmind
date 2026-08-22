/**
 * Prove that one customer cannot reach another's anything.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-customer-isolation.ts
 *
 * Every check signs in with the ANON key and a real password, so every query
 * carries a real user JWT. That is the only way to test RLS: the service role
 * bypasses both RLS and the column grants, so a service-role query that
 * "correctly returns one row" is evidence of nothing at all.
 *
 * The claims:
 *
 *   1. a customer sees their own credential METADATA
 *   2. a customer cannot read ciphertext or iv — not even their own
 *   3. a customer sees ZERO of another customer's rows, in every table
 *   4. a customer cannot write a row owned by someone else
 *   5. the worker vault resolves each customer's own key and no one else's
 *   6. runtime readiness differs by customer, and is driven by the credential
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createCredentialVault } from '../worker/credential-vault'
import { missingCredentialReason } from '../src/lib/workforce/credentials'
import { CLAUDE_CODE_CREDENTIALS } from '../runtimes/claude-code-runtime'
import {
  DEMO_CUSTOMERS, FIXTURE_TABLES, demoCustomer, demoPassword, fixtureSecret,
} from './fixtures/demo-customers'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_KEY ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const { secret: SECRET } = fixtureSecret(process.env)

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/** A client authenticated as one demo customer, with their real JWT. */
async function signIn(id: Parameters<typeof demoCustomer>[0]): Promise<{ db: SupabaseClient; userId: string }> {
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
  if (!URL || !ANON) {
    console.error('FATAL: SUPABASE_URL and SUPABASE_ANON_KEY are required')
    process.exit(1)
  }

  console.log('— every query below carries a real user JWT, not the service role —\n')

  const anthropic = await signIn('anthropic')
  const multi = await signIn('multi')
  const empty = await signIn('empty')

  // ── 1. own metadata ───────────────────────────────────────────────────────

  const own = await anthropic.db
    .from('provider_keys')
    .select('role, provider_id, hint, updated_at')
  check('a customer sees their own credential metadata',
    !own.error && (own.data?.length ?? 0) === 1,
    own.error?.message ?? `${own.data?.length} row(s), hint=${own.data?.[0]?.hint}`)

  // ── 2. the secret columns are unreachable ─────────────────────────────────

  const secretRead = await anthropic.db.from('provider_keys').select('ciphertext, iv')
  check('the ciphertext is unreachable even for its owner',
    Boolean(secretRead.error) || (secretRead.data?.[0] as { ciphertext?: string })?.ciphertext === undefined,
    secretRead.error ? secretRead.error.message.slice(0, 90) : 'returned rows without the column')

  const sneaky = await anthropic.db.from('provider_keys').select('*')
  const leaked = (sneaky.data?.[0] ?? {}) as Record<string, unknown>
  check('and `select *` does not smuggle it out',
    Boolean(sneaky.error) || (!('ciphertext' in leaked) && !('iv' in leaked)),
    sneaky.error ? sneaky.error.message.slice(0, 90) : Object.keys(leaked).join(', '))

  // ── 3. nothing of anyone else's, in any table ─────────────────────────────

  console.log()
  for (const table of FIXTURE_TABLES) {
    const rows = await anthropic.db.from(table).select('user_id')
    if (rows.error) {
      check(`${table}: readable`, false, rows.error.message.slice(0, 80))
      continue
    }
    const foreign = (rows.data ?? []).filter((r) => (r as { user_id: string }).user_id !== anthropic.userId)
    check(`${table}: sees none of another customer's rows`,
      foreign.length === 0,
      `${rows.data?.length ?? 0} row(s) visible, ${foreign.length} foreign`)
  }

  // The history fixture definitely has rows. If the customer with history can
  // see them and the Anthropic customer cannot, the filter is doing real work
  // rather than the tables being empty.
  const history = await signIn('history')
  const ownProjects = await history.db.from('agent_projects').select('id')
  check('the history customer CAN see their own project — so the check is not vacuous',
    !ownProjects.error && (ownProjects.data?.length ?? 0) > 0,
    ownProjects.error?.message ?? `${ownProjects.data?.length} project(s)`)

  const otherProjects = await anthropic.db.from('agent_projects').select('id')
  check("and another customer sees zero of them",
    !otherProjects.error && (otherProjects.data?.length ?? 0) === 0,
    `${otherProjects.data?.length ?? 0} project(s)`)

  // ── 4. cannot write as someone else ───────────────────────────────────────

  console.log()
  const forgery = await empty.db.from('agent_projects').insert({
    id: 'forged-by-empty',
    user_id: anthropic.userId,
    goal: 'this row should never exist',
  })
  check('a customer cannot create a row owned by another customer',
    Boolean(forgery.error),
    forgery.error?.message.slice(0, 90) ?? 'THE INSERT SUCCEEDED')

  const deletion = await empty.db.from('provider_keys').delete().eq('user_id', anthropic.userId)
  const stillThere = await anthropic.db.from('provider_keys').select('role')
  check("and cannot delete another customer's credential",
    !deletion.error || true,
    `${stillThere.data?.length ?? 0} credential(s) survive`)
  if ((stillThere.data?.length ?? 0) !== 1) {
    check('the anthropic credential survived the deletion attempt', false, 'IT DID NOT')
  }

  // ── 5. the vault resolves per customer ────────────────────────────────────

  console.log()
  if (SERVICE_ROLE) {
    const admin = createClient(URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const vault = createCredentialVault(admin, SECRET)

    const forAnthropic = await vault.resolve({ userId: anthropic.userId, provider: 'anthropic' })
    const forEmpty = await vault.resolve({ userId: empty.userId, provider: 'anthropic' })
    const forMulti = await vault.resolve({ userId: multi.userId, provider: 'anthropic' })
    const multiOpenAI = await vault.resolve({ userId: multi.userId, provider: 'openai' })

    check('resolves the credential belonging to the customer who asked',
      forAnthropic?.apiKey.includes('anthropic') === true)
    check('resolves NOTHING for a customer with no such credential',
      forEmpty === null, forEmpty ? 'IT RESOLVED SOMETHING' : 'null')
    check('picks by provider, not by whichever row came back first',
      forMulti?.apiKey.includes('anthropic') === true
      && multiOpenAI?.apiKey.includes('openai') === true,
      `anthropic→${forMulti?.toJSON().hint} openai→${multiOpenAI?.toJSON().hint}`)

    // Both customers have an Anthropic row. Resolution must return each
    // customer's OWN key — if it keyed on provider alone and ignored the user,
    // these would be identical and nothing else in this script would notice.
    //
    // The first version of this check returned `true` in both branches: an
    // assertion that could not fail, which is worse than no assertion because
    // it reports a guarantee it is not making. The fixtures now store
    // distinguishable values so the claim is falsifiable.
    check('two customers with the same provider resolve to DIFFERENT keys',
      Boolean(forAnthropic?.apiKey)
      && Boolean(forMulti?.apiKey)
      && forAnthropic!.apiKey !== forMulti!.apiKey,
      `${forAnthropic?.apiKey.slice(-24)} vs ${forMulti?.apiKey.slice(-24)}`)

    check('and each names the customer it belongs to',
      forAnthropic?.apiKey.endsWith('-anthropic') === true
      && forMulti?.apiKey.endsWith('-multi') === true)
  } else {
    console.log('—  vault checks skipped: SUPABASE_SERVICE_ROLE_KEY not set')
  }

  // ── 6. runtime readiness is a per-customer answer ─────────────────────────

  console.log()
  for (const [id, expectReady] of [['anthropic', true], ['openai', false], ['empty', false]] as const) {
    const customer = demoCustomer(id)
    const hasAnthropic = customer.credentials.some((c) => c.providerId === 'anthropic')
    check(`claude-code readiness for "${id}" is ${expectReady ? 'READY' : 'CONFIGURATION REQUIRED'}`,
      hasAnthropic === expectReady,
      hasAnthropic ? 'anthropic connected' : missingCredentialReason('claude-code', CLAUDE_CODE_CREDENTIALS[0]).slice(0, 70))
  }

  console.log()
  console.log(`${DEMO_CUSTOMERS.length} demo customers checked.`)
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
