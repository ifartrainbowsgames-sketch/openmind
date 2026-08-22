import { describe, expect, it } from 'vitest'
import { MODEL_ROLE_META, TOOL_CAPABILITIES, TOOL_META, describeReadiness, summarise } from './key-mode'
import { loadMobileProvider, type MobileProviderConfig } from './mobile-provider'
import type { StoredKey } from './provider-vault'
import { credentialFor, type Credential } from '../../worker/credential-resolution'

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
    // Wording follows the card it points at, which is now "Connected
    // providers"; what matters is that it names the server as the fix.
    expect(r.reason).toMatch(/on the server/i)
    expect(r.reason).toMatch(/no browser/i)
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

  it('uses a lone connection whatever slot it sits in', () => {
    // This asserted `false` while there were three fixed model slots and only
    // a `worker` row counted. A customer with one provider connected now has
    // no ambiguity to resolve, and the worker uses it — see rule 3 of
    // credentialFor. Reporting "not ready" would nag them to add a key that
    // already works.
    const r = describeReadiness(bare, stored('planner'), { background: true })
    expect(r.usable).toBe(true)
  })

  it('blocks when several are connected and none is chosen', () => {
    const many: StoredKey[] = [
      { role: 'anthropic', providerId: 'anthropic', hint: '••••1' },
      { role: 'xai', providerId: 'xai', hint: '••••2' },
    ]
    const r = describeReadiness({ ...bare, providerId: 'mistral' }, many, { background: true })
    expect(r.usable).toBe(false)
    expect(r.reason).toMatch(/several providers/i)
  })

  it('is ready once the chosen provider is one of them', () => {
    const many: StoredKey[] = [
      { role: 'anthropic', providerId: 'anthropic', hint: '••••1' },
      { role: 'xai', providerId: 'xai', hint: '••••2' },
    ]
    const r = describeReadiness({ ...bare, providerId: 'xai' }, many, { background: true })
    expect(r.usable).toBe(true)
  })
})

describe('the badge predicts what the worker will actually do', () => {
  // The failure this exists to catch is a green "Ready" followed by a blocked
  // run, or a nag to add a key that would have worked. describeReadiness is a
  // PREDICTION of credentialFor, so the two are checked against each other
  // across the cases that distinguish them rather than trusted to stay in step.
  const cases: { name: string; chosen: string; keys: StoredKey[] }[] = [
    { name: 'nothing connected', chosen: 'anthropic', keys: [] },
    {
      name: 'one connection, not the chosen one',
      chosen: 'mistral',
      keys: [{ role: 'anthropic', providerId: 'anthropic', hint: '•' }],
    },
    {
      name: 'several connected, none chosen',
      chosen: 'mistral',
      keys: [
        { role: 'anthropic', providerId: 'anthropic', hint: '•' },
        { role: 'xai', providerId: 'xai', hint: '•' },
      ],
    },
    {
      name: 'several connected, one chosen',
      chosen: 'xai',
      keys: [
        { role: 'anthropic', providerId: 'anthropic', hint: '•' },
        { role: 'xai', providerId: 'xai', hint: '•' },
      ],
    },
    {
      name: 'legacy worker slot alongside a connection',
      chosen: 'mistral',
      keys: [
        { role: 'worker', providerId: 'openai', hint: '•' },
        { role: 'anthropic', providerId: 'anthropic', hint: '•' },
      ],
    },
  ]

  it.each(cases)('agrees for: $name', ({ chosen, keys }) => {
    // Rebuild the map exactly as loadKeys does: a legacy row is reachable
    // under both its slot and its provider.
    const map = new Map<string, Credential>()
    for (const k of keys) {
      const entry = { providerId: k.providerId, apiKey: `k-${k.providerId}` }
      map.set(k.role, entry)
      if (!map.has(k.providerId)) map.set(k.providerId, entry)
    }

    const workerWouldRun = credentialFor(map, chosen, 'worker') !== undefined
    const badgeSaysReady = describeReadiness(
      { providerId: chosen, apiKey: '' }, keys, { background: true },
    ).usable

    expect(badgeSaysReady).toBe(workerWouldRun)
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
