import { describe, expect, it } from 'vitest'
import {
  MAX_STRING, REDACTED, safeAttributes, safeEnvSummary, sanitizeTelemetry, scrubText, truncate,
} from './sanitize'
import { providerCredential } from '../workforce/credentials'

/**
 * Nothing secret leaves as telemetry.
 *
 * `ProviderCredential.toJSON()` protects one shape from one path. Telemetry
 * arrives from everywhere, most of it never designed with a wire in mind, so
 * these tests aim at the paths a key actually takes: nested in run options,
 * echoed by a provider's error, pasted into a shell command, or sitting in a
 * child process environment.
 */

const ANTHROPIC = 'sk-ant-api03-REALLOOKINGKEY1234567890abcdef'
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop'

describe('field names', () => {
  it('redacts a secret by its key, whatever the value looks like', () => {
    const out = sanitizeTelemetry({ apiKey: 'anything', password: 'x', ciphertext: 'y', iv: 'z' })
    expect(out).toEqual({ apiKey: REDACTED, password: REDACTED, ciphertext: REDACTED, iv: REDACTED })
  })

  it('catches the many spellings', () => {
    const out = sanitizeTelemetry({
      api_key: 'a', 'API-KEY': 'b', Authorization: 'c', access_token: 'd',
      refresh_token: 'e', SUPABASE_SERVICE_ROLE_KEY: 'f', KEY_ENCRYPTION_SECRET: 'g',
    }) as Record<string, unknown>
    for (const value of Object.values(out)) expect(value).toBe(REDACTED)
  })

  it('redacts a provider session id, which is internal runtime metadata', () => {
    const out = sanitizeTelemetry({ providerSessionId: 'b5944241-203e' }) as Record<string, unknown>
    expect(out.providerSessionId).toBe(REDACTED)
  })
})

describe('value shapes', () => {
  it('redacts a key pasted somewhere nobody named apiKey', () => {
    // The case that matters most. A Bash tool input is a plain string, and a
    // provider's error message sometimes echoes the submitted credential.
    expect(scrubText(`curl -H "x-api-key: ${ANTHROPIC}" https://api`)).not.toContain(ANTHROPIC)
    expect(scrubText(`Incorrect API key provided: ${ANTHROPIC}`)).toContain(REDACTED)
  })

  it('redacts a JWT anywhere in free text', () => {
    expect(scrubText(`Bearer ${SERVICE_ROLE}`)).not.toContain(SERVICE_ROLE)
  })

  it('leaves ordinary text alone', () => {
    const prose = 'The task completed in 67s and produced research/report.json.'
    expect(scrubText(prose)).toBe(prose)
  })
})

describe('nesting', () => {
  it('finds a secret four levels down', () => {
    const dump = JSON.stringify(sanitizeTelemetry({
      run: { options: { toolKeys: { tavily: 'sk-tavily-SECRETVALUE1234567890' } } },
    }))
    expect(dump).not.toContain('SECRETVALUE')
  })

  it('finds one inside an array of objects', () => {
    const dump = JSON.stringify(sanitizeTelemetry({
      calls: [{ tool: 'bash', input: `export ANTHROPIC_API_KEY=${ANTHROPIC}` }],
    }))
    expect(dump).not.toContain(ANTHROPIC)
  })

  it('does not recurse forever on a cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(() => JSON.stringify(sanitizeTelemetry(cyclic))).not.toThrow()
  })

  it('redacts an Error message that echoes a key', () => {
    const error = new Error(`401 unauthorized for key ${ANTHROPIC}`)
    expect(JSON.stringify(sanitizeTelemetry(error))).not.toContain(ANTHROPIC)
  })
})

describe('a ProviderCredential', () => {
  it('never appears, even reached directly rather than via toJSON', () => {
    // toJSON protects JSON.stringify. The sanitiser has to protect the object
    // being walked field by field, which is what a telemetry helper does.
    const credential = providerCredential('anthropic', ANTHROPIC)
    const dump = JSON.stringify(sanitizeTelemetry({ credential }))
    expect(dump).not.toContain(ANTHROPIC)
    expect(dump).not.toContain('sk-ant')
  })
})

describe('size', () => {
  it('truncates a huge string rather than embedding it', () => {
    // A 4 MB stdout in a span attribute is a denial-of-service against your own
    // tracing backend.
    const huge = 'x'.repeat(500_000)
    const out = truncate(huge)
    expect(out.length).toBeLessThan(MAX_STRING + 60)
    expect(out).toContain('+496000 chars')
  })

  it('caps a long array', () => {
    const out = sanitizeTelemetry(Array.from({ length: 500 }, (_, i) => i)) as unknown[]
    expect(out.length).toBeLessThanOrEqual(51)
    expect(String(out.at(-1))).toContain('more')
  })
})

describe('span attributes', () => {
  it('flattens to values OpenTelemetry accepts', () => {
    const attributes = safeAttributes({ count: 3, ok: true, name: 'research', nested: { a: 1 } })
    expect(attributes.count).toBe(3)
    expect(attributes.ok).toBe(true)
    expect(attributes.name).toBe('research')
    expect(typeof attributes.nested).toBe('string')
  })

  it('sanitises BEFORE encoding, so the key-name rule still applies', () => {
    // Encoding first would bury the secret inside a string the key rule can no
    // longer see — the exact mistake this ordering exists to prevent.
    const attributes = safeAttributes({ config: { apiKey: ANTHROPIC } })
    expect(String(attributes.config)).not.toContain(ANTHROPIC)
    expect(String(attributes.config)).toContain(REDACTED)
  })

  it('drops nothing silently that a reader would expect', () => {
    const attributes = safeAttributes({ present: 'yes', absent: undefined, empty: null })
    expect(attributes.present).toBe('yes')
    expect('absent' in attributes).toBe(false)
    expect('empty' in attributes).toBe(false)
  })
})

describe('a process environment', () => {
  it('is summarised, never recorded', () => {
    // The worker holds the service-role key, the encryption secret and the
    // platform's tool credentials. "We only logged the names" is one refactor
    // away from being false, so the names do not go either.
    const summary = safeEnvSummary({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: ANTHROPIC,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
    })
    const dump = JSON.stringify(summary)
    expect(dump).not.toContain(ANTHROPIC)
    expect(dump).not.toContain(SERVICE_ROLE)
    expect(dump).not.toContain('ANTHROPIC_API_KEY')
    expect(summary['env.count']).toBe(3)
    expect(summary['env.secret_names']).toBe(2)
  })
})
