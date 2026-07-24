import { describe, expect, it } from 'vitest'
import { simulatedBrain } from './brains'
import { CONNECTION_IDS } from './connections'
import { AGENT_BENCHMARK_CASES, runAgentEvaluation, scoreAgentRun } from './evaluation'
import type { Employee, RunResult } from './types'

const benchmarkEmployee: Employee = {
  id: 'benchmark',
  name: 'Benchmark Agent',
  role: 'Generalist',
  prompt: 'Use the minimum correct tools and answer from their results.',
  tools: ['search_docs', 'summarize', 'sentiment', 'calculator', 'code_review'],
  connections: CONNECTION_IDS,
  accent: '#ff4d00',
}

describe('AI employee evaluation harness', () => {
  it('covers a meaningful range of tasks', () => {
    expect(AGENT_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(30)
    expect(new Set(AGENT_BENCHMARK_CASES.map((testCase) => testCase.category))).toEqual(
      new Set(['knowledge', 'analysis', 'code', 'connection', 'multi-tool', 'direct']),
    )
  })

  it('keeps the deterministic baseline above the quality gate', async () => {
    const summary = await runAgentEvaluation(simulatedBrain(), benchmarkEmployee)
    const failures = summary.results
      .filter((result) => result.score < 1)
      .map((result) => `${result.caseId}: ${result.failures.join('; ')}`)
    expect(failures).toEqual([])
    expect(summary.score).toBe(1)
    expect(summary.passed).toBe(summary.total)
  })

  it('reports selection, answer, execution and trace failures separately', () => {
    const broken: RunResult = {
      plan: [{ tool: 'wrong_tool', input: 'x' }],
      toolCalls: [{ tool: 'wrong_tool', input: 'x', output: 'error: failed' }],
      answer: '',
      trace: [{ node: 'act', text: 'out of order' }],
    }
    const result = scoreAgentRun(AGENT_BENCHMARK_CASES[0], broken)
    expect(result.score).toBe(0)
    expect(result.failures).toHaveLength(4)
  })
})
