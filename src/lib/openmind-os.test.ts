import { describe, expect, it } from 'vitest'
import { simulatedBrain } from './agent'
import { OS_APPS, runTurn } from './openmind-os'

describe('OpenMind OS', () => {
  it('lists apps on a kernel instead of a new orchestrator per feature', () => {
    const ids = OS_APPS.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining(['research', 'developer', 'browser', 'memory', 'connect']))
    expect(OS_APPS.every((a) => a.kernel.length > 8)).toBe(true)
  })

  it('runs a turn through the kernel', async () => {
    const run = await runTurn('a team of 2: a researcher and a coder', simulatedBrain())
    expect(run.members.length).toBe(2)
    expect(run.answer.length).toBeGreaterThan(10)
  })
})
