import { beforeEach, describe, expect, it } from 'vitest'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

const store = new MemStorage()
Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true })

const agent = await import('./agent')
const nango = await import('./nango')
const connect = await import('./nango-connect')

describe('customer Connect apps', () => {
  beforeEach(() => {
    store.clear()
  })

  it('lists GitHub, Slack, Gmail, and Drive for customers', () => {
    expect(connect.CUSTOMER_APPS.map((a) => a.name)).toEqual(['GitHub', 'Slack', 'Gmail', 'Drive'])
    expect(connect.CUSTOMER_APPS.map((a) => a.providerId)).toEqual(['github', 'slack', 'google', 'google'])
  })

  it('maps Google OAuth to both Gmail and Drive crew tools', () => {
    expect(nango.liveIdsForNangoProvider('google')).toEqual(['gmail', 'gdrive'])
    expect(nango.liveIdsForNangoProvider('github')).toEqual(['github'])
    expect(nango.liveIdsForNangoProvider('slack')).toEqual(['slack'])
  })

  it('records a GitHub connect so crew write tools can find it', () => {
    connect.recordConnectedProvider('github', 'conn-gh-1')
    expect(nango.nangoLinked('github')?.connectionId).toBe('conn-gh-1')
    const live = agent.loadLiveConnections()
    expect(live.some((c) => c.connectionId === 'github' && c.status === 'live')).toBe(true)
  })

  it('marks Gmail and Drive live after one Google connect', () => {
    connect.recordConnectedProvider('google', 'conn-g-1')
    expect(nango.nangoLinked('gmail')?.connectionId).toBe('conn-g-1')
    expect(nango.nangoLinked('gdrive')?.connectionId).toBe('conn-g-1')
    const ids = agent.loadLiveConnections().map((c) => c.connectionId)
    expect(ids).toEqual(expect.arrayContaining(['gmail', 'gdrive']))
  })

  it('disconnects GitHub without leftover live config', () => {
    connect.recordConnectedProvider('github', 'x')
    connect.disconnectProvider('github')
    expect(nango.nangoLinked('github')).toBeNull()
    expect(agent.loadLiveConnections().some((c) => c.connectionId === 'github')).toBe(false)
  })
})

describe('customerConnectError', () => {
  it('never shows operator secrets or infra names', () => {
    expect(nango.customerConnectError(new Error('NANGO_SECRET_KEY is not set on this function'))).not.toMatch(/NANGO|secret/i)
    expect(nango.customerConnectError('Deploy nango-session with VITE_SUPABASE_URL')).not.toMatch(/nango-session|VITE_/i)
    expect(nango.customerConnectError(new Error('Couldn’t start Connect. Try again in a moment.'))).toBe(
      'Couldn’t start Connect. Try again in a moment.',
    )
  })
})
