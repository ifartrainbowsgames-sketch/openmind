import { describe, expect, it } from 'vitest'
import { simulatedBrain, type Employee } from './agent'
import { OS_APPS, runTurn } from './openmind-os'

const assistant: Employee = {
  id: 'openmind',
  name: 'OpenMind',
  role: 'Assistant',
  prompt: 'Helpful assistant.',
  tools: ['search_docs', 'calculator'],
  accent: '#ff4d00',
}

describe('OpenMind OS', () => {
  it('lists apps on a kernel instead of a new orchestrator per feature', () => {
    const ids = OS_APPS.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining(['research', 'developer', 'browser', 'memory', 'connect']))
    expect(OS_APPS.every((a) => a.kernel.length > 8)).toBe(true)
  })

  it('runs a single chat turn through the kernel', async () => {
    const run = await runTurn('hi', simulatedBrain(), { lead: assistant })
    expect(run.members.length).toBe(1)
    expect(run.answer).toMatch(/don't need tools for this one/i)
  })

  it('runs crew mode when explicitly requested', async () => {
    const run = await runTurn('a team of 2: a researcher and a coder', simulatedBrain(), { crew: true })
    expect(run.members.length).toBe(2)
    expect(run.answer.length).toBeGreaterThan(10)
  })
})
