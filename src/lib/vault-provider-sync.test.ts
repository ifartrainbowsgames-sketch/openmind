import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIVE_PROVIDERS } from './agent'

/**
 * The Edge Function's copies of the provider table must match LIVE_PROVIDERS.
 *
 * `vault-keys` is deployed standalone by the Supabase CLI and cannot import
 * from src/, so it hand-copies two tables — the same constraint that makes
 * worker/crypto.ts mirror the function's crypto.ts.
 *
 * Duplication that nothing checks is duplication that drifts, and each table
 * drifts into a different failure:
 *
 *   PROVIDER_IDS      quiet and one-sided. Add a provider, it appears in the
 *                     settings list, the customer pastes a key, and the save
 *                     fails with "unknown provider" — a UI offering something
 *                     the backend refuses.
 *   MODELS_ENDPOINT   worse. This is where the function sends the customer's
 *                     PLAINTEXT key to verify it. A wrong host is a key sent
 *                     somewhere it should never go.
 *
 * So both are read out of the deployed source and compared here.
 */

const SOURCE = 'supabase/functions/vault-keys/index.ts'

function edgeSource(): string {
  return readFileSync(SOURCE, 'utf8')
}

function providerIdsInEdgeFunction(): string[] {
  const block = edgeSource().match(/const PROVIDER_IDS = \[([\s\S]*?)\]/)
  if (!block) throw new Error(`could not find PROVIDER_IDS in ${SOURCE}`)
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/**
 * Scanned line by line rather than with a multi-line regex — the block is a
 * flat literal, and a line scan reads better than a pattern that has to match
 * across newlines.
 */
function endpointsInEdgeFunction(): Record<string, string> {
  const out: Record<string, string> = {}
  let inside = false
  for (const line of edgeSource().split(String.fromCharCode(10))) {
    if (line.includes('const MODELS_ENDPOINT')) { inside = true; continue }
    if (inside && line.startsWith('}')) break
    if (!inside) continue
    const entry = /^\s*'?([a-z0-9-]+)'?:\s*'([^']+)'/.exec(line)
    if (entry) out[entry[1]] = entry[2]
  }
  if (Object.keys(out).length === 0) throw new Error(`could not find MODELS_ENDPOINT in ${SOURCE}`)
  return out
}

describe('vault-keys knows every provider the app offers', () => {
  it('found a list to compare against, so the rest is not vacuous', () => {
    expect(providerIdsInEdgeFunction().length).toBeGreaterThan(5)
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

describe('vault-keys asks the right host when it verifies a key', () => {
  it('found a table to compare, so the rest is not vacuous', () => {
    expect(Object.keys(endpointsInEdgeFunction()).length).toBeGreaterThan(5)
  })

  it('uses the same base URL the app uses for every provider', () => {
    const endpoints = endpointsInEdgeFunction()
    const wrong = LIVE_PROVIDERS
      .filter((p) => endpoints[p.id] && endpoints[p.id] !== p.baseUrl)
      .map((p) => `${p.id}: edge=${endpoints[p.id]} app=${p.baseUrl}`)
    expect(wrong, `MODELS_ENDPOINT disagrees with LIVE_PROVIDERS: ${wrong.join('; ')}`).toEqual([])
  })

  it('names no host the app does not already call', () => {
    // A host here that appears nowhere in LIVE_PROVIDERS is a place the
    // customer's plaintext key gets sent that nothing else in the system
    // talks to. That is the shape of an exfiltration bug, whether or not one
    // is intended.
    const known = new Set(LIVE_PROVIDERS.map((p) => p.baseUrl))
    const stray = Object.entries(endpointsInEdgeFunction())
      .filter(([, url]) => !known.has(url))
      .map(([id, url]) => `${id} -> ${url}`)
    expect(stray, `endpoints not in LIVE_PROVIDERS: ${stray.join(', ')}`).toEqual([])
  })

  it('covers every provider that can be connected', () => {
    const endpoints = endpointsInEdgeFunction()
    const undiscoverable = providerIdsInEdgeFunction().filter((id) => !endpoints[id])
    // Not a hard failure in production — a provider with no endpoint simply
    // gets no discovery and the UI falls back to the whole catalogue — but it
    // should be a deliberate omission, not an oversight.
    expect(undiscoverable, `no discovery endpoint for: ${undiscoverable.join(', ')}`).toEqual([])
  })
})
