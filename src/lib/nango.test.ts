import { describe, expect, it } from 'vitest'
import catalog from '@/data/nango-providers.json'
import { extractNangoConnectionId, nangoCatalog, searchNangoProviders } from './nango'

describe('Nango marketplace catalog', () => {
  it('ships hundreds of providers with categories', () => {
    const { count, providers, categories } = nangoCatalog()
    expect(count).toBeGreaterThan(800)
    expect(providers).toHaveLength(count)
    expect(categories.length).toBeGreaterThan(10)
    expect(providers.every((p) => p.id && p.name)).toBe(true)
  })

  it('searches by name, id, and category', () => {
    expect(searchNangoProviders('gmail').some((p) => p.id === 'google' || /gmail/i.test(`${p.id} ${p.name}`))).toBe(true)
    expect(searchNangoProviders('github').some((p) => p.id.includes('github'))).toBe(true)
    expect(searchNangoProviders('', 'crm').length).toBeGreaterThan(5)
    expect(searchNangoProviders('definitely-not-a-real-saas-xyzzy')).toEqual([])
  })

  it('keeps the generated catalog source of truth', () => {
    expect(catalog.count).toBe(catalog.providers.length)
  })
})

describe('Nango Connect UI connectionId', () => {
  it('reads payload.connectionId from type connect', () => {
    expect(extractNangoConnectionId({ type: 'connect', payload: { connectionId: 'conn-github-1' } })).toBe('conn-github-1')
  })

  it('accepts snake_case and nested data', () => {
    expect(extractNangoConnectionId({ connection_id: 'abc' })).toBe('abc')
    expect(extractNangoConnectionId({ payload: { connection_id: 'snake' } })).toBe('snake')
    expect(extractNangoConnectionId({ data: { connectionId: 'nested' } })).toBe('nested')
    expect(extractNangoConnectionId({ payload: { data: { connection_id: 'deep' } } })).toBe('deep')
  })
})
