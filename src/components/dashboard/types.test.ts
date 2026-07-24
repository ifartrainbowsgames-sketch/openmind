import { describe, expect, it } from 'vitest'
import { capabilities } from '@/data/capabilities'
import { formatBytes } from './types'

describe('formatBytes', () => {
  it('formats bytes', () => expect(formatBytes(512)).toBe('512 B'))
  it('formats kilobytes', () => expect(formatBytes(2048)).toBe('2.0 KB'))
  it('formats megabytes', () => expect(formatBytes(1.5 * 1024 ** 2)).toBe('1.5 MB'))
  it('formats gigabytes', () => expect(formatBytes(2 * 1024 ** 3)).toBe('2.00 GB'))
  it('respects unit boundaries', () => {
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
  })
})

describe('capabilities catalogue integrity', () => {
  it('ships exactly one capability — the chatbot', () => {
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0].id).toBe('chat')
    expect(new Set(capabilities.map((c) => c.id)).size).toBe(1)
    expect(new Set(capabilities.map((c) => c.index)).size).toBe(1)
  })

  it('every capability has providers and features', () => {
    for (const c of capabilities) {
      expect(c.providers.length, c.id).toBeGreaterThan(0)
      expect(c.features.length, c.id).toBeGreaterThan(0)
    }
  })
})
