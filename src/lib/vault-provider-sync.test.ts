import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIVE_PROVIDERS } from './agent'

/**
 * The Edge Function's provider list must match LIVE_PROVIDERS.
 *
 * `vault-keys` is deployed standalone by the Supabase CLI and cannot import
 * from src/, so its PROVIDER_IDS is a hand-copied duplicate — the same
 * constraint that makes worker/crypto.ts mirror the function's crypto.ts.
 *
 * Duplication that nothing checks is duplication that drifts. The failure is
 * quiet and one-sided: add a provider to LIVE_PROVIDERS, it appears in the
 * settings list, the customer pastes a key, and the save fails with "unknown
 * provider" — a UI offering something the backend refuses. This test reads the
 * deployed source and compares, so that mismatch is a red test instead of a
 * support ticket.
 */

const SOURCE = 'supabase/functions/vault-keys/index.ts'

function providerIdsInEdgeFunction(): string[] {
  const source = readFileSync(SOURCE, 'utf8')
  const block = source.match(/const PROVIDER_IDS = \[([\s\S]*?)\]/)
  if (!block) throw new Error(`could not find PROVIDER_IDS in ${SOURCE}`)
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('vault-keys knows every provider the app offers', () => {
  it('found a list to compare against, so the rest is not vacuous', () => {
    const ids = providerIdsInEdgeFunction()
    expect(ids.length).toBeGreaterThan(5)
    expect(LIVE_PROVIDERS.length).toBeGreaterThan(5)
  })

  it('accepts every provider the settings UI can offer', () => {
    const accepted = new Set(providerIdsInEdgeFunction())
    const missing = LIVE_PROVIDERS.map((p) => p.id).filter((id) => !accepted.has(id))
    expect(
      missing,
      `vault-keys would reject these with "unknown provider": ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('does not accept providers the app cannot actually call', () => {
    // The other direction. A key stored for a provider with no entry in
    // LIVE_PROVIDERS has no baseUrl and no model, so the worker blocks the run
    // — the customer's key saved successfully and then never worked.
    const known = new Set(LIVE_PROVIDERS.map((p) => p.id))
    const orphaned = providerIdsInEdgeFunction().filter((id) => !known.has(id))
    expect(
      orphaned,
      `vault-keys accepts providers the app cannot call: ${orphaned.join(', ')}`,
    ).toEqual([])
  })
})
