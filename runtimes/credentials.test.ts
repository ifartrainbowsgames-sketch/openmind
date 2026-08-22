import { describe, expect, it } from 'vitest'
import { childEnv, CLAUDE_CODE_CREDENTIALS } from './claude-code-runtime'
import {
  EMPTY_VAULT, last4, missingCredentialReason, providerCredential,
} from '../src/lib/workforce/credentials'

/**
 * A decrypted key is resolved in the worker, immediately before launching a
 * runtime, and goes nowhere else. Not to the browser, not into a queued run
 * row, not into the ledger, an event, or a log line.
 *
 * The database half of that rule is enforced by column grants: `authenticated`
 * cannot select `ciphertext` or `iv` at all. These are the in-process half.
 */

const SECRET = 'sk-ant-api03-REAL-SECRET-VALUE-7KQ2'

describe('a credential never serialises', () => {
  it('stringifies to metadata, not to the key', () => {
    // The one field in this codebase that must never be written down. A run's
    // options, an error payload and an event are all JSON.stringify'd
    // somewhere, so this is structural rather than a rule to remember.
    const credential = providerCredential('anthropic', SECRET)
    const encoded = JSON.stringify(credential)
    expect(encoded).not.toContain(SECRET)
    expect(encoded).not.toContain('sk-ant')
    expect(JSON.parse(encoded)).toEqual({ provider: 'anthropic', connected: true, hint: '7KQ2' })
  })

  it('survives being nested inside something larger', () => {
    const payload = JSON.stringify({ run: { id: 'r1', credential: providerCredential('anthropic', SECRET) } })
    expect(payload).not.toContain(SECRET)
  })

  it('masks a short key rather than revealing all of it', () => {
    expect(last4('abc')).toBe('••••')
    expect(last4(SECRET)).toBe('7KQ2')
  })

  it('is still readable where it is meant to be used', () => {
    // The point is not that the key is unreachable — the child process needs
    // it — only that reaching it has to be deliberate.
    expect(providerCredential('anthropic', SECRET).apiKey).toBe(SECRET)
  })
})

describe('the child environment', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/worker',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    SUPABASE_URL: 'https://x.supabase.co',
    KEY_ENCRYPTION_SECRET: 'encryption-secret',
    OPENAI_API_KEY: 'platform-openai-key',
    TAVILY_API_KEY: 'platform-tavily-key',
    VITE_SUPABASE_KEY: 'public-but-irrelevant',
    QSTASH_TOKEN: 'queue-secret',
  }

  it("does not hand the worker's own secrets to a customer's agent", () => {
    // A worker holds the service-role key, the encryption secret and the
    // platform's tool credentials. An agent running arbitrary shell commands
    // in a workspace must not inherit any of it.
    const env = childEnv(base)
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(env.KEY_ENCRYPTION_SECRET).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.TAVILY_API_KEY).toBeUndefined()
    expect(env.QSTASH_TOKEN).toBeUndefined()
    expect(env.SUPABASE_URL).toBeUndefined()
    expect(env.VITE_SUPABASE_KEY).toBeUndefined()
  })

  it('keeps what a process legitimately needs', () => {
    const env = childEnv(base)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/worker')
  })

  it("injects the customer's credential into the child only", () => {
    const env = childEnv(base, {}, providerCredential('anthropic', SECRET))
    expect(env.ANTHROPIC_API_KEY).toBe(SECRET)
    // And never onto the worker itself, which would leak one customer's key
    // into every later run in the same process.
    expect(process.env.ANTHROPIC_API_KEY).not.toBe(SECRET)
  })

  it('does not leave an ambient Anthropic key when no credential was resolved', () => {
    // The dangerous case: a developer machine with its own key set. Without
    // this the runtime would work in development and bill the wrong account in
    // production.
    const env = childEnv({ ...base, ANTHROPIC_API_KEY: 'developers-own-key' })
    expect(env.ANTHROPIC_API_KEY).toBe('developers-own-key')
    // …but a resolved credential always wins.
    const withCredential = childEnv(
      { ...base, ANTHROPIC_API_KEY: 'developers-own-key' },
      {},
      providerCredential('anthropic', SECRET),
    )
    expect(withCredential.ANTHROPIC_API_KEY).toBe(SECRET)
  })

  it('clears alternative auth routes when a key is supplied', () => {
    const env = childEnv(
      { ...base, CLAUDE_CODE_USE_BEDROCK: '1' },
      {},
      providerCredential('anthropic', SECRET),
    )
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
  })
})

describe('a runtime declares what it needs', () => {
  it('names the provider rather than itself', () => {
    // "The Claude Code key" is not a thing. A customer connects Anthropic once
    // and every runtime that needs Anthropic resolves the same row.
    expect(CLAUDE_CODE_CREDENTIALS[0].provider).toBe('anthropic')
    expect(CLAUDE_CODE_CREDENTIALS[0].required).toBe(true)
  })

  it('produces a message that points somewhere', () => {
    const reason = missingCredentialReason('claude-code', CLAUDE_CODE_CREDENTIALS[0])
    expect(reason).toContain('anthropic')
    expect(reason).toContain('Settings')
    // Not "authentication failed", which sends someone to the wrong page.
    expect(reason).not.toMatch(/auth(entication)? failed/i)
  })

  it('an empty vault resolves nothing rather than throwing', async () => {
    expect(await EMPTY_VAULT.resolve({ userId: 'u1', provider: 'anthropic' })).toBeNull()
  })
})

// ── Nothing carries a secret outward ────────────────────────────────────────

const appSources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

const serverSources = import.meta.glob('/{worker,runtimes}/**/*.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

describe('decryption happens only server-side', () => {
  it('names every module that can open a stored key', () => {
    // Two legitimate decryptors, both in the worker: `index.ts` opens the
    // customer's MODEL keys for the brain, `credential-vault.ts` opens their
    // PROVIDER credentials for a runtime. What must never appear in this list
    // is anything under /src, which is the browser bundle.
    const openers = Object.entries({ ...appSources, ...serverSources })
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => /\bopenKey\s*\(/.test(text))
      .map(([path]) => path)
      .sort()
    expect(openers).toEqual([
      '/worker/credential-vault.ts',
      '/worker/crypto.ts',
      '/worker/index.ts',
    ])
    expect(openers.some((path) => path.startsWith('/src/'))).toBe(false)
  })

  it('no browser code imports the vault or the crypto', () => {
    const offenders = Object.entries(appSources)
      .filter(([, text]) => /from '[^']*(worker\/credential-vault|worker\/crypto)'/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('the runtime never writes a key onto the worker process', () => {
    // `process.env.X = key` would outlive the run and reach the next customer.
    const runtime = serverSources['/runtimes/claude-code-runtime.ts']
    expect(runtime).toBeDefined()
    expect(runtime).not.toMatch(/process\.env\.[A-Z_]+\s*=/)
  })

  it('the runtime filters the inherited environment rather than spreading it', () => {
    const runtime = serverSources['/runtimes/claude-code-runtime.ts']
    expect(runtime).not.toMatch(/env:\s*\{\s*\.\.\.process\.env/)
    expect(runtime).toMatch(/childEnv\(process\.env/)
  })
})
