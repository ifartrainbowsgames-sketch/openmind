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

  it('keeps crewRun artifacts on assistant messages', () => {
    const thread = {
      id: 't1',
      title: 'Research',
      employeeId: 'openmind',
      updatedAt: 9,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Done.',
          createdAt: 9,
          crewRun: {
            employeeIds: ['otto', 'rex'],
            memberNames: ['Otto', 'Rex'],
            artifacts: [
              { id: 'artifact-brief', kind: 'markdown', title: 'Crew brief', body: '# Research' },
            ],
          },
        },
      ],
    }
    const parsed = parseMobileThreads(JSON.stringify([thread]))
    expect(parsed[0].messages[0].crewRun?.employeeIds).toEqual(['otto', 'rex'])
    expect(parsed[0].messages[0].crewRun?.artifacts[0]).toMatchObject({
      kind: 'markdown',
      title: 'Crew brief',
    })
  })

  it('strips invalid crewRun but keeps the message', () => {
    const thread = {
      id: 't1',
      title: 'Bad',
      employeeId: 'openmind',
      updatedAt: 1,
      messages: [
        { id: 'ok', role: 'user', content: 'hi', createdAt: 1 },
        { id: 'bad', role: 'assistant', content: 'x', createdAt: 2, crewRun: { employeeIds: 'nope' } },
      ],
    }
    const parsed = parseMobileThreads(JSON.stringify([thread]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].messages[1].crewRun).toBeUndefined()
  })

  it('keeps a GitHub workspace on the thread', () => {
    const thread = {
      id: 't1',
      title: 'Weather',
      employeeId: 'openmind',
      updatedAt: 1,
      workspace: {
        kind: 'github',
        slug: 'weather-app',
        branch: 'main',
        source: 'live',
        summary: 'Created repo.',
        repoUrl: 'https://github.com/me/weather-app',
        repoName: 'me/weather-app',
      },
      messages: [],
    }
    const parsed = parseMobileThreads(JSON.stringify([thread]))
    expect(parsed[0].workspace).toMatchObject({ kind: 'github', branch: 'main', repoName: 'me/weather-app' })
  })
})
