import { describe, expect, it } from 'vitest'
import {
  createMobileThread,
  parseMobileThreads,
  sortMobileThreads,
  titleFromPrompt,
} from './mobile-chat'

describe('mobile chat threads', () => {
  it('creates an empty thread for the requested employee', () => {
    const thread = createMobileThread('mara', 123)

    expect(thread.employeeId).toBe('mara')
    expect(thread.updatedAt).toBe(123)
    expect(thread.messages).toEqual([])
    expect(thread.id).toMatch(/^thread-/)
  })

  it('turns the first prompt into a compact title', () => {
    expect(titleFromPrompt('  Review   this pull request  ')).toBe('Review this pull request')
    expect(titleFromPrompt('A'.repeat(50), 10)).toBe('AAAAAAAAA…')
    expect(titleFromPrompt('   ')).toBe('New session')
  })

  it('sorts persisted threads and ignores malformed records', () => {
    const valid = [
      { id: 'old', title: 'Old', employeeId: 'mara', messages: [], updatedAt: 1 },
      { id: 'new', title: 'New', employeeId: 'rex', messages: [], updatedAt: 3 },
    ]
    const raw = JSON.stringify([...valid, { id: 'broken' }])

    expect(parseMobileThreads(raw).map((thread) => thread.id)).toEqual(['new', 'old'])
    expect(sortMobileThreads(valid).map((thread) => thread.id)).toEqual(['new', 'old'])
    expect(parseMobileThreads('{nope')).toEqual([])
  })
})
