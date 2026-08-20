import { describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import type { AgentBrain } from '../agent'

// The live-MCP path lazily imports ./supabase, which builds an auth client that
// reaches for localStorage under Node.
vi.mock('../supabase')

const ARTIFACT = [
  '```json research/competitors.json',
  '{"competitors":[{"name":"A","url":"https://a.com"},{"name":"B","url":"https://b.com"}]}',
  '```',
].join('\n')

const fenced = (json: string) => ['```delegate', json, '```'].join('\n')

/**
 * A brain that plans no tool calls and answers with fixed text. Enough to
 * drive the orchestrator's delegation path without a live model.
 */
function brainSaying(...answers: string[]): AgentBrain {
  let i = 0
  return {
    plan: async () => [],
    respond: async () => answers[Math.min(i++, answers.length - 1)],
  }
}

const BUDGET = {
  maxAgentRuns: 8,
  maxToolCalls: 12,
  maxCostUsd: 0.5,
  maxTokens: 60_000,
  deadlineMs: 30_000,
}

describe('delegation end to end', () => {
  it('creates a real child task from a fenced request', async () => {
    const brain = brainSaying(
      [
        'Started, but this needs analysis I cannot do.',
        fenced(JSON.stringify({
          capability: 'data_analysis',
          goal: 'Cluster the pricing tiers found so far',
          inputArtifacts: [],
          expectedOutputs: [{ path: 'analysis/clusters.json', kind: 'json' }],
        })),
        ARTIFACT,
      ].join('\n'),
      ARTIFACT,
    )

    const run = await runTaskGraph(
      'Research AI website builders and compare their pricing',
      brain,
      { budget: BUDGET },
    )

    const child = run.project.tasks.find((t) => t.id.includes('-d1'))
    expect(child, 'no delegated task was created').toBeDefined()
    // Capability, not worker: the requester asked for data_analysis and the
    // orchestrator chose who serves it.
    expect(child?.worker).toBe('analyst')
    expect(child?.outputs).toContain('analysis/clusters.json')
  }, 30_000)

  it('creates nothing when the request names no output', async () => {
    const brain = brainSaying(
      [fenced('{"capability":"data_analysis","goal":"help me think"}'), ARTIFACT].join('\n'),
    )
    const run = await runTaskGraph(
      'Research AI website builders and compare their pricing',
      brain,
      { budget: BUDGET },
    )
    expect(run.project.tasks.some((t) => t.id.includes('-d'))).toBe(false)
  }, 30_000)

  it('creates nothing for a capability that does not exist', async () => {
    const brain = brainSaying(
      [
        fenced('{"capability":"time_travel","goal":"go back","expectedOutputs":[{"path":"x.json"}]}'),
        ARTIFACT,
      ].join('\n'),
    )
    const run = await runTaskGraph(
      'Research AI website builders and compare their pricing',
      brain,
      { budget: BUDGET },
    )
    expect(run.project.tasks.some((t) => t.id.includes('-d'))).toBe(false)
  }, 30_000)
})
