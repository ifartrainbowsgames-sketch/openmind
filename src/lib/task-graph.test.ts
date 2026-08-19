import { describe, expect, it } from 'vitest'
import { judgeArtifact, judgeTask } from './task-judge'
import { planProject, needsTaskGraph } from './task-planner'
import { createProject, isSimpleChat, makeTaskId, type ArtifactRecord, type TaskRecord } from './task-ledger'
import { buildRevisionBlock, parseWorkerArtifacts } from './task-runner'

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

describe('buildRevisionBlock', () => {
  const baseTask: TaskRecord = {
    id: makeTaskId(1),
    type: 'research',
    goal: 'Find competitors',
    inputs: {},
    outputs: ['research/competitors.json'],
    acceptance: { minArrayLength: { competitors: 3 }, minSources: 2 },
    dependsOn: [],
    status: 'pending',
    worker: 'research',
    limits: { maxSteps: 15, maxRetries: 3, maxDelegations: 2, maxCostUsd: 0.5 },
    retries: 0,
    stepsUsed: 1,
    costUsd: 0,
    artifactIds: [],
  }

  const rejected: ArtifactRecord = {
    id: 'a1',
    path: 'research/competitors.json',
    kind: 'json',
    title: 'competitors.json',
    body: JSON.stringify({ competitors: [{ name: 'OnlyOne' }] }),
    taskId: baseTask.id,
    worker: 'research',
    sources: 0,
    createdAt: Date.now(),
  }

  it('is empty on the first attempt', () => {
    const project = createProject('goal')
    expect(buildRevisionBlock(project, baseTask)).toBe('')
  })

  it('is empty when the verdict passed', () => {
    const project = createProject('goal')
    const task = { ...baseTask, retries: 1, verdict: { passed: true, score: 100, problems: [], requiredFixes: [] } }
    expect(buildRevisionBlock(project, task)).toBe('')
  })

  it('carries the judge problems, required fixes, and rejected body into the retry', () => {
    const project = { ...createProject('goal'), artifacts: [rejected] }
    const verdict = judgeTask(baseTask, [rejected])
    expect(verdict.passed).toBe(false)

    const task = { ...baseTask, retries: 1, verdict }
    const block = buildRevisionBlock(project, task)

    expect(block).toContain('ATTEMPT 2 of 3')
    for (const problem of verdict.problems) expect(block).toContain(problem)
    for (const fix of verdict.requiredFixes) expect(block).toContain(fix)
    expect(block).toContain('REJECTED research/competitors.json')
    expect(block).toContain('OnlyOne')
  })

  it('makes the retry prompt differ from the first attempt', () => {
    const project = { ...createProject('goal'), artifacts: [rejected] }
    const verdict = judgeTask(baseTask, [rejected])
    const first = buildRevisionBlock(project, baseTask)
    const second = buildRevisionBlock(project, { ...baseTask, retries: 1, verdict })
    expect(second).not.toBe(first)
    expect(second.length).toBeGreaterThan(0)
  })
})
