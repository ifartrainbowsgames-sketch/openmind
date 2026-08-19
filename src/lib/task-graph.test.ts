import { describe, expect, it } from 'vitest'
import { judgeArtifact, judgeTask } from './task-judge'
import { planProject, needsTaskGraph } from './task-planner'
import { isSimpleChat, makeTaskId, type ArtifactRecord, type TaskRecord } from './task-ledger'
import { parseWorkerArtifacts } from './task-runner'

describe('task-ledger', () => {
  it('detects simple chat', () => {
    expect(isSimpleChat('hi')).toBe(true)
    expect(isSimpleChat('Build a competitor analysis for AI website builders')).toBe(false)
  })
})

describe('task-planner', () => {
  it('builds a research → analysis → build DAG for compound goals', () => {
    const { project } = planProject('Build a competitor analysis for AI website builders and create a landing page')
    expect(project.tasks.length).toBeGreaterThanOrEqual(4)
    expect(project.tasks.some((t) => t.worker === 'research')).toBe(true)
    expect(project.tasks.some((t) => t.worker === 'code')).toBe(true)
    const analysis = project.tasks.find((t) => t.worker === 'analyst')
    if (analysis) expect(analysis.dependsOn.length).toBeGreaterThan(0)
  })

  it('skips task graph for greetings', () => {
    expect(needsTaskGraph('hi')).toBe(false)
    expect(needsTaskGraph('Research the latest trends in open-source AI agents')).toBe(true)
  })
})

describe('task-judge', () => {
  const task: TaskRecord = {
    id: makeTaskId(1),
    type: 'research',
    goal: 'Find competitors',
    inputs: {},
    outputs: ['research/competitors.json'],
    acceptance: { minArrayLength: { competitors: 3 }, minSources: 2 },
    dependsOn: [],
    status: 'running',
    worker: 'research',
    limits: { maxSteps: 15, maxRetries: 3, maxDelegations: 2, maxCostUsd: 0.5 },
    retries: 0,
    stepsUsed: 1,
    costUsd: 0,
    artifactIds: [],
  }

  it('fails when JSON array too short', () => {
    const artifact: ArtifactRecord = {
      id: 'a1',
      path: 'research/competitors.json',
      kind: 'json',
      title: 'competitors.json',
      body: JSON.stringify({ competitors: [{ name: 'A' }] }),
      taskId: task.id,
      worker: 'research',
      sources: 1,
      createdAt: Date.now(),
    }
    const v = judgeTask(task, [artifact])
    expect(v.passed).toBe(false)
    expect(v.problems.some((p) => p.includes('competitors'))).toBe(true)
  })

  it('passes valid research artifact', () => {
    const artifact: ArtifactRecord = {
      id: 'a1',
      path: 'research/competitors.json',
      kind: 'json',
      title: 'competitors.json',
      body: JSON.stringify({
        competitors: [
          { name: 'A', url: 'https://a.com' },
          { name: 'B', url: 'https://b.com' },
          { name: 'C', url: 'https://c.com' },
        ],
      }),
      taskId: task.id,
      worker: 'research',
      sources: 3,
      createdAt: Date.now(),
    }
    expect(judgeArtifact(task, artifact).passed).toBe(true)
  })
})

describe('parseWorkerArtifacts', () => {
  it('extracts fenced path artifacts', () => {
    const task: TaskRecord = {
      id: makeTaskId(2),
      type: 'research',
      goal: 'test',
      inputs: {},
      outputs: ['research/pricing.json'],
      dependsOn: [],
      status: 'running',
      worker: 'research',
      limits: { maxSteps: 15, maxRetries: 3, maxDelegations: 2, maxCostUsd: 0.5 },
      retries: 0,
      stepsUsed: 0,
      costUsd: 0,
      artifactIds: [],
    }
    const answer = '```json research/pricing.json\n{"tiers":[]}\n```'
    const arts = parseWorkerArtifacts(task, answer, 'research')
    expect(arts[0]?.path).toBe('research/pricing.json')
  })
})
