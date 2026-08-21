import { describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import type { AgentBrain } from '../agent'

vi.mock('../supabase')

/**
 * Cancellation, from the run loop's side.
 *
 * The worker half — polling the row and refusing to overwrite a `cancelled`
 * status — lives in worker/index.ts, which vitest does not cover. What is
 * testable here is the contract it depends on: `shouldStop` must be consulted
 * before a task starts, and a stopped run must not keep spending.
 */

const ARTIFACT = [
  '```json research/competitors.json',
  '{"competitors":[{"name":"A","url":"https://a.com"}]}',
  '```',
].join('\n')

function countingBrain(): { brain: AgentBrain; calls: () => number } {
  let calls = 0
  return {
    brain: {
      plan: async () => [],
      respond: async () => { calls++; return ARTIFACT },
    },
    calls: () => calls,
  }
}

const BUDGET = {
  maxAgentRuns: 20, maxToolCalls: 20, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000,
}

const GOAL = 'Research AI website builders and compare their pricing'

describe('shouldStop', () => {
  it('runs every task when nothing asks it to stop', async () => {
    const { brain, calls } = countingBrain()
    const run = await runTaskGraph(GOAL, brain, { budget: BUDGET })
    expect(calls()).toBeGreaterThan(0)
    // Whether the judge accepts the artifact is a separate question — what
    // matters here is that no task was stopped.
    expect(run.project.tasks.some((t) => t.blocker?.match(/cancelled/i))).toBe(false)
  }, 30_000)

  it('starts no worker at all when stopped from the outset', async () => {
    // The cancellation the worker notices is a user decision already made;
    // spending one more task's tokens to discover it is the bug.
    const { brain, calls } = countingBrain()
    const run = await runTaskGraph(GOAL, brain, { budget: BUDGET, shouldStop: () => true })
    expect(calls()).toBe(0)
    expect(run.project.tasks.every((t) => t.status !== 'completed')).toBe(true)
  }, 30_000)

  it('marks stopped tasks blocked with a reason, not silently skipped', async () => {
    const { brain } = countingBrain()
    const run = await runTaskGraph(GOAL, brain, { budget: BUDGET, shouldStop: () => true })
    const stopped = run.project.tasks.filter((t) => t.blocker)
    expect(stopped.length).toBeGreaterThan(0)
    expect(stopped[0].blocker).toMatch(/cancelled/i)
  }, 30_000)

  it('is re-consulted per task, so a mid-run cancel stops the rest', async () => {
    const { brain, calls } = countingBrain()
    let stop = false
    const run = await runTaskGraph(GOAL, brain, {
      budget: BUDGET,
      // Allow exactly one task, then behave as a cancellation.
      shouldStop: () => {
        if (calls() >= 1) stop = true
        return stop
      },
    })
    expect(calls()).toBe(1)
    expect(run.project.tasks.some((t) => t.blocker?.match(/cancelled/i))).toBe(true)
  }, 30_000)

  it('accepts an async check, since the worker reads a row', async () => {
    const { brain, calls } = countingBrain()
    await runTaskGraph(GOAL, brain, {
      budget: BUDGET,
      shouldStop: async () => true,
    })
    expect(calls()).toBe(0)
  }, 30_000)
})
