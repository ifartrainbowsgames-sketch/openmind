import { describe, expect, it, vi } from 'vitest'
import type { LiveConnectionConfig } from './agent'

vi.mock('./supabase', () => ({
  SUPABASE_URL: null,
  SUPABASE_KEY: null,
  supabase: {},
}))

const { mergeConnectionConfigs } = await import('./oauth-connections')

const github = (values: Partial<LiveConnectionConfig>): LiveConnectionConfig => ({
  connectionId: 'github',
  mode: 'mcp',
  status: 'live',
  ...values,
})

describe('mergeConnectionConfigs', () => {
  it('replaces an installed OAuth reference with current server metadata', () => {
    const merged = mergeConnectionConfigs(
      [github({ authSource: 'oauth', installationId: 'stale' })],
      [github({ authSource: 'oauth', installationId: 'current' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].installationId).toBe('current')
  })

  it('removes stale OAuth references after a successful empty server load', () => {
    expect(mergeConnectionConfigs(
      [github({ authSource: 'oauth', installationId: 'deleted' })],
      [],
    )).toEqual([])
  })

  it('does not displace a working manual connection with failed OAuth metadata', () => {
    const manual = github({ authSource: 'manual', token: 'session-token' })
    const merged = mergeConnectionConfigs(
      [manual],
      [github({ authSource: 'oauth', status: 'error', installationId: 'expired' })],
    )
    expect(merged).toEqual([manual])
  })
})
