/**
 * Prove a customer's API key cannot be read back — by anyone, including them.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-key-safety.ts
 *
 * Creates two throwaway accounts against the REAL project, has one store a
 * key, and then tries to get it out again through every route a browser has:
 * the vault function, PostgREST with the owner's own JWT, and the other
 * account's JWT. Deletes both accounts at the end.
 *
 * Why against production rather than a local stack: the protection is not in
 * application code. It is column-level GRANTs and RLS policies on the live
 * database, so a local pass proves nothing about what is deployed. Every
 * previous claim here — "never readable back, not even by you" — was a claim
 * about a migration nobody had run an attacker's query against.
 *
 * The canary is a distinctive string. If it ever appears in a response body,
 * that is the leak, and a substring check over the whole body finds it
 * wherever it surfaced rather than only where it was expected.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_KEY ?? ''

const CANARY = 'sk-ant-api03-KEY-SAFETY-CANARY-4417293056'
const PROVIDER = 'anthropic'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function must(name: string, value: string): string {
  if (!value) {
    console.error(`FATAL: ${name} is not set. Run:  set -a; . ./.env; set +a`)
    process.exit(1)
  }
  return value
}

interface Account { id: string; email: string; token: string }

async function makeAccount(admin: SupabaseClient, tag: string): Promise<Account> {
  const email = `key-safety-${tag}-${Date.now()}@openmind-verify.invalid`
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error || !created.user) throw new Error(`could not create ${tag}: ${error?.message}`)

  const asUser = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: session, error: signIn } = await asUser.auth.signInWithPassword({ email, password })
  if (signIn || !session.session) throw new Error(`could not sign in ${tag}: ${signIn?.message}`)

  return { id: created.user.id, email, token: session.session.access_token }
}

async function vault(token: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${URL}/functions/v1/vault-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

/** PostgREST as a signed-in user — RLS and column grants, no function in the way. */
function asUser(token: string): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function main(): Promise<void> {
  const admin = createClient(
    must('SUPABASE_URL', URL),
    must('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  must('SUPABASE_ANON_KEY', ANON)

  console.log('— two throwaway accounts —\n')
  const alice = await makeAccount(admin, 'alice')
  const bob = await makeAccount(admin, 'bob')
  console.log(`  alice ${alice.id.slice(0, 8)}…\n  bob   ${bob.id.slice(0, 8)}…\n`)

  try {
    console.log('— alice stores a key —\n')
    const stored = await vault(alice.token, {
      action: 'set', role: PROVIDER, providerId: PROVIDER, apiKey: CANARY,
    })
    check('the key was accepted', stored.status === 200, `HTTP ${stored.status}`)
    check('the response does NOT echo the key', !stored.text.includes(CANARY))
    check('it returns a masked hint instead', stored.text.includes('••••'),
      stored.text.slice(0, 120))

    console.log('\n— alice tries to read her own key back —\n')
    const listed = await vault(alice.token, { action: 'list' })
    check('list succeeds', listed.status === 200)
    check('THE KEY IS NOT IN THE LISTING', !listed.text.includes(CANARY),
      listed.text.includes(CANARY) ? 'IT LEAKED' : 'absent')
    check('no ciphertext field is returned at all', !listed.text.includes('ciphertext'))
    check('the listing is not empty, so the check is not vacuous',
      listed.text.includes(PROVIDER), listed.text.slice(0, 140))

    console.log('\n— alice goes around the function, straight to the table —\n')
    const direct = await asUser(alice.token).from('provider_keys').select('ciphertext, iv')
    check('selecting ciphertext as the OWNER is refused', Boolean(direct.error),
      direct.error?.message?.slice(0, 90) ?? 'IT WAS ALLOWED')
    check('no ciphertext came back', !JSON.stringify(direct.data ?? []).includes(CANARY))

    const readable = await asUser(alice.token).from('provider_keys').select('role, provider_id, hint')
    check('she can still see WHICH provider is connected', !readable.error,
      readable.error?.message ?? `${readable.data?.length ?? 0} row(s)`)

    console.log('\n— bob tries to read alice’s key —\n')
    const cross = await asUser(bob.token).from('provider_keys').select('role, provider_id, hint')
    const bobSees = (cross.data ?? []) as { provider_id: string }[]
    check('bob sees none of alice’s rows', bobSees.length === 0,
      `${bobSees.length} row(s) visible`)

    const bobVault = await vault(bob.token, { action: 'list' })
    check('the vault shows bob nothing of alice’s', !bobVault.text.includes(CANARY))
    check('and returns bob an empty listing', bobVault.text.includes('[]'),
      bobVault.text.slice(0, 120))

    console.log('\n— an unauthenticated caller —\n')
    const anon = await fetch(`${URL}/functions/v1/vault-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ action: 'list' }),
    })
    check('is refused', anon.status === 401, `HTTP ${anon.status}`)

    console.log('\n— the key really was stored, so none of this was vacuous —\n')
    const { data: row } = await admin
      .from('provider_keys').select('ciphertext, hint').eq('user_id', alice.id).maybeSingle()
    const cipher = (row as { ciphertext?: string } | null)?.ciphertext ?? ''
    check('a ciphertext row exists', cipher.length > 0, `${cipher.length} chars`)
    check('and the stored bytes are NOT the plaintext', !cipher.includes(CANARY))
    check('the hint reveals only the last four', (row as { hint?: string } | null)?.hint === '••••3056',
      (row as { hint?: string } | null)?.hint ?? '(none)')
  } finally {
    console.log('\n— cleanup —\n')
    for (const account of [alice, bob]) {
      const { error } = await admin.auth.admin.deleteUser(account.id)
      check(`deleted ${account.email.split('-')[2]}`, !error, error?.message ?? '')
    }
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
