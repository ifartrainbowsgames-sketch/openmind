import { describe, expect, it } from 'vitest'
import { LIVE_PROVIDERS, providerSpec } from './agent'

describe('LIVE_PROVIDERS', () => {
  it('Kimi K3 is the default brain', () => {
    const first = LIVE_PROVIDERS[0]
    expect(first.id).toBe('kimi')
    expect(first.model).toBe('kimi-k3')
    expect(first.baseUrl).toBe('https://api.moonshot.ai/v1')
    expect(first.fixedParams).toBe(true) // k3 pins sampling params
  })

  it('every provider composes a valid chat-completions URL, and has a unique id', () => {
    // This used to assert `/\/v1$/`. That was a proxy for "OpenAI-compatible",
    // and it is simply not true of two providers that were verified working
    // against their live APIs: Google serves the compatible surface at
    // /v1beta/openai, and Perplexity at the bare host. The property the code
    // actually depends on is that `${baseUrl}/chat/completions` is a URL —
    // see chatComplete — so that is what is asserted now.
    const ids = LIVE_PROVIDERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const p of LIVE_PROVIDERS) {
      expect(p.baseUrl, `${p.id} baseUrl`).toMatch(/^https?:\/\//)
      expect(p.baseUrl, `${p.id} must not end in / — it is concatenated`).not.toMatch(/\/$/)
      expect(() => new URL(`${p.baseUrl}/chat/completions`)).not.toThrow()
      expect(p.model.length, `${p.id} needs a default model`).toBeGreaterThan(0)
    }
  })

  it('carries the providers a customer is likely to already pay for', () => {
    const ids = new Set(LIVE_PROVIDERS.map((p) => p.id))
    for (const id of ['anthropic', 'openai', 'xai', 'google', 'deepseek', 'mistral']) {
      expect(ids.has(id), `missing provider: ${id}`).toBe(true)
    }
  })

  describe('an unknown provider id resolves to nothing, never to a neighbour', () => {
    // The regression this pins is a credential disclosure, not a lookup miss.
    //
    // Callers wrote `LIVE_PROVIDERS.find(...) ?? LIVE_PROVIDERS[0]`, so a
    // provider id that had been retired, renamed, or mistyped did not fail —
    // it resolved to whatever sat first in the array and the customer's API key
    // was then POSTed to THAT provider's endpoint. A stored credential must
    // only ever be presented to the provider it belongs to.
    it('returns null rather than a default', () => {
      expect(providerSpec('a-provider-that-does-not-exist')).toBeNull()
      expect(providerSpec('')).toBeNull()
    })

    it('does not quietly hand back the first provider', () => {
      // Named explicitly: under the old fallback this expression WAS the first
      // entry, so this assertion fails against the bug rather than restating it.
      expect(providerSpec('retired-provider')).not.toBe(LIVE_PROVIDERS[0])
      expect(providerSpec('retired-provider')?.baseUrl).not.toBe(LIVE_PROVIDERS[0].baseUrl)
    })

    it('still resolves the providers that do exist', () => {
      expect(providerSpec('anthropic')?.baseUrl).toBe('https://api.anthropic.com/v1')
      expect(providerSpec('xai')?.baseUrl).toBe('https://api.x.ai/v1')
    })
  })

  it('offers both global and China Kimi endpoints', () => {
    expect(LIVE_PROVIDERS.some((p) => p.baseUrl.includes('moonshot.cn'))).toBe(true)
    expect(LIVE_PROVIDERS.some((p) => p.baseUrl.includes('moonshot.ai'))).toBe(true)
  })
})
