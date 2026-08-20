import { describe, expect, it } from 'vitest'
import { MODEL_ROLE_META, TOOL_CAPABILITIES, TOOL_META, describeReadiness, summarise } from './key-mode'
import { loadMobileProvider, type MobileProviderConfig } from './mobile-provider'
import type { StoredKey } from './provider-vault'

const bare: MobileProviderConfig = { providerId: 'openai', apiKey: '' }
const withKey: MobileProviderConfig = { ...bare, apiKey: 'sk-test' }

function stored(...roles: StoredKey['role'][]): StoredKey[] {
  return roles.map((role) => ({ role, providerId: role, hint: '••••1234' }))
}

describe('describeReadiness', () => {
  it('blocks a foreground run with no key anywhere', () => {
    const r = describeReadiness(bare, [], { background: false })
    expect(r.usable).toBe(false)
    expect(r.reason).toMatch(/add your model key/i)
  })

  it('accepts a browser key for a foreground run', () => {
    const r = describeReadiness(withKey, [], { background: false })
    expect(r.usable).toBe(true)
    expect(r.viaVault).toBe(false)
  })

  it('rejects a browser key for a background run', () => {
    // The worker has no localStorage — this is the failure users hit when a
    // queued run sat at "Queued" forever.
    const r = describeReadiness(withKey, [], { background: true })
    expect(r.usable).toBe(false)
    expect(r.reason).toMatch(/stored on the server/i)
  })

  it('accepts a vaulted key for a background run', () => {
    const r = describeReadiness(bare, stored('worker'), { background: true })
    expect(r.usable).toBe(true)
    expect(r.viaVault).toBe(true)
  })

  it('falls back to the vault for a foreground run with no browser key', () => {
    const r = describeReadiness(bare, stored('worker'), { background: false })
    expect(r.usable).toBe(true)
    expect(r.viaVault).toBe(true)
  })

  it('ignores a vaulted planner key when no worker key exists', () => {
    const r = describeReadiness(bare, stored('planner'), { background: true })
    expect(r.usable).toBe(false)
  })
})

describe('summarise', () => {
  it('says which key a ready run will use', () => {
    expect(summarise(describeReadiness(withKey, [], { background: false }))).toMatch(/this browser/i)
    expect(summarise(describeReadiness(bare, stored('worker'), { background: true }))).toMatch(/on the server/i)
  })

  it('leads with the blocking reason when not ready', () => {
    const r = describeReadiness(bare, [], { background: false })
    expect(summarise(r)).toBe(r.reason)
  })
})

describe('platform tool credentials never reach the client', () => {
  it('gives the client config no field to hold a tool key', () => {
    // Structural, not a convention: a field here would be a field in the JS
    // bundle, and a bundle is public. The keys live in Edge Function secrets.
    const config = loadMobileProvider() as unknown as Record<string, unknown>
    for (const forbidden of ['tavilyKey', 'firecrawlKey', 'e2bKey', 'browserlessKey']) {
      expect(Object.keys(config), forbidden).not.toContain(forbidden)
    }
  })

  it('describes each tool capability without naming a credential field', () => {
    for (const capability of TOOL_CAPABILITIES) {
      const meta = TOOL_META[capability]
      expect(meta.label).toBeTruthy()
      expect(meta.blurb).toBeTruthy()
      expect(Object.keys(meta)).toEqual(['label', 'blurb', 'freeFallback'])
    }
  })

  it('offers a free fallback for the capabilities that have one', () => {
    expect(TOOL_META.search.freeFallback).toBe('DuckDuckGo')
    expect(TOOL_META.browse.freeFallback).toBe('Jina Reader')
    // These need a real provider; there is no free stand-in.
    expect(TOOL_META.sandbox.freeFallback).toBeNull()
    expect(TOOL_META.chrome.freeFallback).toBeNull()
  })
})

describe('MODEL_ROLE_META', () => {
  it('covers exactly the three roles the vault stores', () => {
    expect(MODEL_ROLE_META.map((m) => m.role)).toEqual(['worker', 'planner', 'judge'])
  })
})
