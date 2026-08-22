import { describe, expect, it } from 'vitest'
import {
  CATALOG_PROVIDERS, catalogModels, contextLabel, findModel,
  preferredDefault, priceLabel, selectableModels,
} from './index'
import { LIVE_PROVIDERS } from '../agent'

describe('the catalogue covers what the app can call', () => {
  it('has models for every provider in LIVE_PROVIDERS', () => {
    // The two lists are maintained separately and must not drift: a provider
    // offered in settings with an empty model list is a dropdown with nothing
    // in it.
    const empty = LIVE_PROVIDERS
      .map((p) => p.id)
      .filter((id) => catalogModels(id).length === 0)
    expect(empty, `no catalogue entries for: ${empty.join(', ')}`).toEqual([])
  })

  it('maps every provider to an upstream id', () => {
    for (const p of LIVE_PROVIDERS) {
      expect(CATALOG_PROVIDERS[p.id], `${p.id} has no models.dev mapping`).toBeTruthy()
    }
  })

  it('is substantial, so the checks above are not vacuous', () => {
    const total = LIVE_PROVIDERS.reduce((n, p) => n + catalogModels(p.id).length, 0)
    expect(total).toBeGreaterThan(300)
  })

  it('sorts newest first, because that is what people are looking for', () => {
    const dated = catalogModels('anthropic').filter((m) => m.released)
    const releases = dated.map((m) => m.released as string)
    expect(releases).toEqual([...releases].sort().reverse())
  })
})

describe('selectableModels reconciles the catalogue with one customer’s key', () => {
  it('offers everything when discovery has not run', () => {
    // An empty picker is indistinguishable from a broken one.
    expect(selectableModels('groq')).toEqual(catalogModels('groq'))
    expect(selectableModels('groq').length).toBeGreaterThan(0)
  })

  it('narrows to what the key can actually reach', () => {
    const reachable = catalogModels('groq').slice(0, 2).map((m) => m.id)
    const offered = selectableModels('groq', reachable)
    expect(offered.map((m) => m.id).sort()).toEqual([...reachable].sort())
    expect(offered.length).toBeLessThan(catalogModels('groq').length)
  })

  it('drops a catalogued model the key cannot reach', () => {
    // The exact failure that motivated discovery: llama-3.1-8b-instant was
    // published, was in the catalogue, and returned "does not exist or you do
    // not have access" on a real key.
    const all = catalogModels('groq')
    const offered = selectableModels('groq', [all[0].id])
    expect(offered).toHaveLength(1)
    expect(offered[0].id).toBe(all[0].id)
  })

  it('still offers a reachable model the catalogue has never heard of', () => {
    // The snapshot is a point in time. Intersecting would hide precisely the
    // newest model someone went looking for.
    const offered = selectableModels('groq', ['a-model-shipped-after-the-last-sync'])
    expect(offered).toHaveLength(1)
    expect(offered[0].id).toBe('a-model-shipped-after-the-last-sync')
    expect(offered[0].name).toBe('a-model-shipped-after-the-last-sync')
  })

  it('offers nothing when the key reaches nothing', () => {
    expect(selectableModels('groq', [])).toEqual([])
  })
})

describe('what a picker shows about a model', () => {
  it('finds a model by id', () => {
    const first = catalogModels('anthropic')[0]
    expect(findModel('anthropic', first.id)?.name).toBe(first.name)
    expect(findModel('anthropic', 'no-such-model')).toBeUndefined()
  })

  it('formats price per million tokens', () => {
    expect(priceLabel({ id: 'x', name: 'x', inputCost: 3, outputCost: 15 }))
      .toBe('$3.00 / $15.00 per 1M')
  })

  it('says "free" rather than "$0.00"', () => {
    expect(priceLabel({ id: 'x', name: 'x', inputCost: 0, outputCost: 0 }))
      .toBe('free / free per 1M')
  })

  it('says nothing at all when the price is unknown', () => {
    // A model discovered by /v1/models but absent from the catalogue has no
    // pricing. Showing "$?" everywhere would be noise.
    expect(priceLabel({ id: 'x', name: 'x' })).toBe('')
  })

  it('abbreviates the context window', () => {
    expect(contextLabel({ id: 'x', name: 'x', context: 200_000 })).toBe('200K ctx')
    expect(contextLabel({ id: 'x', name: 'x', context: 1_000_000 })).toBe('1M ctx')
    expect(contextLabel({ id: 'x', name: 'x' })).toBe('')
  })
})

describe('the default model for a provider', () => {
  it('prefers one that can call tools', () => {
    // The graph plans with JSON and calls tools; a model that cannot is a poor
    // default however new it is.
    for (const id of ['anthropic', 'openai', 'google']) {
      const chosen = preferredDefault(id)
      expect(chosen, id).toBeTruthy()
      expect(chosen?.tools, `${id} default ${chosen?.id} cannot call tools`).toBe(true)
    }
  })

  it('returns something for every provider rather than nothing', () => {
    for (const p of LIVE_PROVIDERS) {
      expect(preferredDefault(p.id), p.id).toBeTruthy()
    }
  })
})
