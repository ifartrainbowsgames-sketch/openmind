import { describe, expect, it } from 'vitest'
import { LIVE_PROVIDERS } from './agent'

describe('LIVE_PROVIDERS', () => {
  it('Kimi K3 is the default brain', () => {
    const first = LIVE_PROVIDERS[0]
    expect(first.id).toBe('kimi')
    expect(first.model).toBe('kimi-k3')
    expect(first.baseUrl).toBe('https://api.moonshot.ai/v1')
    expect(first.fixedParams).toBe(true) // k3 pins sampling params
  })

  it('every provider has a /v1 OpenAI-compatible endpoint and unique id', () => {
    const ids = LIVE_PROVIDERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of LIVE_PROVIDERS) expect(p.baseUrl).toMatch(/\/v1$/)
  })

  it('offers both global and China Kimi endpoints', () => {
    expect(LIVE_PROVIDERS.some((p) => p.baseUrl.includes('moonshot.cn'))).toBe(true)
    expect(LIVE_PROVIDERS.some((p) => p.baseUrl.includes('moonshot.ai'))).toBe(true)
  })
})
