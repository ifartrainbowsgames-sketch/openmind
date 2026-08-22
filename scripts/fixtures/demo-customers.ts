/**
 * Demo customers — real authenticated Supabase users in known states.
 *
 * These exist because customer isolation cannot be tested with mocks. RLS is a
 * property of the database under a real JWT; a service-role query proves
 * nothing about it, and a unit test with a fake client proves less. The only
 * honest check is: sign in as customer A, ask for customer B's rows, and get
 * nothing back.
 *
 * They also give the provider and routing work something to be verified
 * against. "Claude Code is READY" is a different claim for a customer with an
 * Anthropic credential and a customer without one, and until both exist as
 * real accounts the difference is untested.
 *
 * Passwords are derived from KEY_ENCRYPTION_SECRET rather than committed, so
 * the fixtures cannot be signed into by anyone reading the repository.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export type DemoStateId =
  | 'empty'
  | 'anthropic'
  | 'openai'
  | 'multi'
  | 'legacy-browser'
  | 'invalid-credential'
  | 'history'

export interface DemoCredential {
  /** Vault slot. See migration 20260822010000 for the allowed set. */
  role: string
  providerId: string
  /** Stored encrypted. Deliberately not a real key — these must never work. */
  apiKey: string
}

export interface DemoCustomer {
  id: DemoStateId
  email: string
  /** What this fixture is for, in one line. Shown by the scripts. */
  purpose: string
  credentials: DemoCredential[]
  /** Seeded project + run history, for resume and readiness checks. */
  history?: { projectId: string; goal: string }
}

/**
 * A fake key that is unmistakably fake.
 *
 * If one of these ever reaches a provider it must fail loudly rather than
 * work, and if one ever appears in a log it must be obvious that it is not a
 * customer's. Real-looking test keys are how a fixture becomes an incident.
 */
function fakeKey(provider: string, owner: string): string {
  // The owner is in the value so a resolution test can prove the vault keyed on
  // the CUSTOMER and not merely on the provider. Two fixtures sharing one fake
  // value would make that assertion unfalsifiable.
  return `sk-OPENMIND-DEMO-FIXTURE-NOT-A-REAL-KEY-${provider}-${owner}`
}

export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    id: 'empty',
    email: 'openmind-demo-empty@openmind.dev',
    purpose: 'No credentials at all. Every runtime must report configuration required.',
    credentials: [],
  },
  {
    id: 'anthropic',
    email: 'openmind-demo-anthropic@openmind.dev',
    purpose: 'Anthropic only. Claude Code must be READY; nothing else should be.',
    credentials: [{ role: 'anthropic', providerId: 'anthropic', apiKey: fakeKey('anthropic', 'anthropic') }],
  },
  {
    id: 'openai',
    email: 'openmind-demo-openai@openmind.dev',
    purpose: 'OpenAI only. Claude Code must report a missing Anthropic credential.',
    credentials: [{ role: 'worker', providerId: 'openai', apiKey: fakeKey('openai', 'openai') }],
  },
  {
    id: 'multi',
    email: 'openmind-demo-multi@openmind.dev',
    purpose: 'Several providers. Resolution must pick by provider, not by luck.',
    credentials: [
      { role: 'worker', providerId: 'openai', apiKey: fakeKey('openai', 'multi') },
      { role: 'anthropic', providerId: 'anthropic', apiKey: fakeKey('anthropic', 'multi') },
      { role: 'planner', providerId: 'kimi', apiKey: fakeKey('kimi', 'multi') },
    ],
  },
  {
    id: 'legacy-browser',
    email: 'openmind-demo-legacy@openmind.dev',
    purpose:
      'Nothing in the vault; keys live in this browser only. The migration prompt '
      + 'must offer, never act.',
    credentials: [],
  },
  {
    id: 'invalid-credential',
    email: 'openmind-demo-invalid@openmind.dev',
    purpose:
      'A stored credential that cannot work. Test-connection must fail cleanly '
      + 'and readiness must not claim READY on the strength of a row existing.',
    credentials: [
      { role: 'anthropic', providerId: 'anthropic', apiKey: 'sk-ant-OPENMIND-DEMO-INVALID' },
    ],
  },
  {
    id: 'history',
    email: 'openmind-demo-history@openmind.dev',
    purpose: 'Past project and run, for resume and for routing evidence to attach to.',
    credentials: [{ role: 'anthropic', providerId: 'anthropic', apiKey: fakeKey('anthropic', 'history') }],
    history: { projectId: 'demo-history-1', goal: 'Summarise the pricing page of three competitors' },
  },
]

export function demoCustomer(id: DemoStateId): DemoCustomer {
  const found = DEMO_CUSTOMERS.find((c) => c.id === id)
  if (!found) throw new Error(`unknown demo customer: ${id}`)
  return found
}

/**
 * Deterministic, unguessable, and not in the repository.
 *
 * Derived from the deployment's encryption secret, so signing in as a fixture
 * requires already holding the thing that protects every real credential —
 * which means committing this file grants nobody anything.
 */
export function demoPassword(email: string, secret: string): string {
  if (!secret) throw new Error('a fixture secret is required to derive demo passwords')
  const digest = createHash('sha256').update(`${email}:${secret}`).digest('base64url')
  // Upper, lower, digit and symbol, so it satisfies any password policy.
  return `Dm0!${digest.slice(0, 28)}`
}

const LOCAL_SECRET_FILE = 'scripts/.fixture-secret'

export interface FixtureSecret {
  secret: string
  /**
   * True when this is the deployment's own KEY_ENCRYPTION_SECRET, so the
   * credentials these fixtures store are readable by the deployed worker.
   */
  productionCompatible: boolean
}

/**
 * The secret the fixtures encrypt with.
 *
 * Prefers the deployment's `KEY_ENCRYPTION_SECRET`. Falls back to a local,
 * gitignored, generated one — and says so, loudly, because the difference
 * matters: credentials sealed under a local secret are unreadable by the
 * deployed worker, and a fixture that looks seeded while being undecryptable in
 * production is a trap for whoever debugs it next.
 *
 * The fallback exists so isolation and RLS can be proven without holding the
 * key that protects every real credential. RLS does not care which secret
 * sealed a row.
 */
export function fixtureSecret(env: Record<string, string | undefined>): FixtureSecret {
  const production = env.KEY_ENCRYPTION_SECRET?.trim()
  if (production) return { secret: production, productionCompatible: true }

  if (!existsSync(LOCAL_SECRET_FILE)) {
    writeFileSync(LOCAL_SECRET_FILE, randomBytes(32).toString('base64'), 'utf8')
  }
  return { secret: readFileSync(LOCAL_SECRET_FILE, 'utf8').trim(), productionCompatible: false }
}

/** Everything the fixtures own, for teardown and for isolation assertions. */
export const FIXTURE_TABLES = [
  'provider_keys',
  'agent_sessions',
  'agent_workspaces',
  'agent_projects',
  'agent_runs',
  'agent_memories',
] as const
