/**
 * Create or refresh the demo customers.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/fixtures-demo-customers.ts            # create / refresh
 *   npx tsx scripts/fixtures-demo-customers.ts --teardown # remove them
 *
 * Idempotent: running it twice leaves the same seven accounts in the same
 * states. Credentials are sealed with the same AES-GCM path the vault function
 * uses, because a fixture encrypted differently from production would test a
 * decryption path nothing else takes.
 *
 * These accounts are created with `email_confirm: true` through the admin API,
 * so no mail is sent to anyone.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sealKey } from '../worker/crypto'
import {
  DEMO_CUSTOMERS, FIXTURE_TABLES, demoPassword, fixtureSecret, type DemoCustomer,
} from './fixtures/demo-customers'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const { secret: SECRET, productionCompatible } = fixtureSecret(process.env)

function must(name: string, value: string): string {
  if (!value) {
    console.error(`FATAL: ${name} is not set`)
    process.exit(1)
  }
  return value
}

const db: SupabaseClient = createClient(must('SUPABASE_URL', URL), must('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE), {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** The account for one fixture, created or found. */
async function ensureUser(customer: DemoCustomer): Promise<string> {
  const password = demoPassword(customer.email, SECRET)

  const { data: created, error } = await db.auth.admin.createUser({
    email: customer.email,
    password,
    email_confirm: true,
    user_metadata: { openmind_demo: customer.id },
  })
  if (created?.user?.id) return created.user.id

  // Already there. Reset the password so a rotated secret does not leave the
  // fixture unusable and silently untestable.
  if (error && !/already/i.test(error.message)) throw error

  const existing = await findUser(customer.email)
  if (!existing) throw new Error(`could not create or find ${customer.email}: ${error?.message}`)
  await db.auth.admin.updateUserById(existing, { password, email_confirm: true })
  return existing
}

async function findUser(email: string): Promise<string | null> {
  // listUsers is paged; these fixtures live on the first pages of a small
  // project, but the loop is bounded rather than assumed.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}

async function clearCustomer(userId: string): Promise<void> {
  for (const table of FIXTURE_TABLES) {
    const { error } = await db.from(table).delete().eq('user_id', userId)
    // A table that does not exist yet is not a failure of this script.
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.warn(`  warn: clearing ${table}: ${error.message}`)
    }
  }
}

async function seed(customer: DemoCustomer, userId: string): Promise<void> {
  await clearCustomer(userId)

  for (const credential of customer.credentials) {
    const sealed = await sealKey(credential.apiKey, SECRET)
    const { error } = await db.from('provider_keys').upsert({
      user_id: userId,
      role: credential.role,
      provider_id: credential.providerId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      hint: sealed.hint,
      updated_at: new Date().toISOString(),
    })
    if (error) throw new Error(`${customer.id}: storing ${credential.role}: ${error.message}`)
  }

  if (customer.history) {
    const { error } = await db.from('agent_projects').upsert({
      id: customer.history.projectId,
      user_id: userId,
      goal: customer.history.goal,
      started_at: new Date(Date.now() - 86_400_000).toISOString(),
      finished_at: new Date(Date.now() - 86_000_000).toISOString(),
    })
    if (error) throw new Error(`${customer.id}: seeding project: ${error.message}`)

    const { error: runError } = await db.from('agent_runs').insert({
      user_id: userId,
      project_id: customer.history.projectId,
      goal: customer.history.goal,
      status: 'completed',
      options: {},
      answer: 'Seeded fixture run.',
      finished_at: new Date(Date.now() - 86_000_000).toISOString(),
    })
    if (runError) throw new Error(`${customer.id}: seeding run: ${runError.message}`)
  }
}

async function teardown(): Promise<void> {
  for (const customer of DEMO_CUSTOMERS) {
    const userId = await findUser(customer.email)
    if (!userId) {
      console.log(`—  ${customer.id}: not present`)
      continue
    }
    await clearCustomer(userId)
    const { error } = await db.auth.admin.deleteUser(userId)
    console.log(error ? `!  ${customer.id}: ${error.message}` : `✓  ${customer.id}: removed`)
  }
}

async function main(): Promise<void> {
  if (!productionCompatible) {
    console.log([
      'NOTE: KEY_ENCRYPTION_SECRET is not set, so these fixtures are sealed with',
      '      a local secret (scripts/.fixture-secret, gitignored).',
      '      RLS and isolation are fully testable either way.',
      '      The DEPLOYED worker will NOT be able to decrypt these credentials —',
      '      set KEY_ENCRYPTION_SECRET and re-run to make them production-usable.',
      '',
    ].join('\n'))
  }

  if (process.argv.includes('--teardown')) {
    console.log('Removing demo customers…\n')
    await teardown()
    return
  }

  console.log(`Seeding ${DEMO_CUSTOMERS.length} demo customers into ${URL}\n`)
  for (const customer of DEMO_CUSTOMERS) {
    const userId = await ensureUser(customer)
    await seed(customer, userId)
    const creds = customer.credentials.map((c) => c.providerId).join(', ') || 'none'
    console.log(`✓  ${customer.id.padEnd(19)} ${userId}  [${creds}]`)
    console.log(`   ${customer.purpose}`)
  }
  console.log('\nDone. Run scripts/verify-customer-isolation.ts to prove they are isolated.')
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
