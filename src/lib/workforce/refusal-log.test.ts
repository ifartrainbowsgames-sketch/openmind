import { describe, expect, it, vi } from 'vitest'
import { applyDelegation } from '../task-runner'
import { createProject, type ProjectState, type TaskRecord } from '../task-ledger'
import { DEFAULT_DELEGATION_LIMITS, emptyDelegationState } from './delegation'

vi.mock('../supabase')

/**
 * A refused delegation must leave a trace. The refusal decisions themselves are
 * covered as pure functions in delegation.test.ts, and the e2e tests prove no
 * task is created — but neither would notice if the `logEvent` call in the
 * refusal branch were deleted. Refusals would then vanish silently, which is
 * the exact failure mode this system exists to prevent: a worker that asked for
 * help and was denied would be indistinguishable from one that did nothing.
 */

function projectWith(task: Partial<TaskRecord> = {}): { project: ProjectState; task: TaskRecord } {
  const base = createProject('test goal')
  const t: TaskRecord = {
    id: 't1',
    type: 'research',
    goal: 'find things',
    inputs: {},
    outputs: ['research/out.json'],
    dependsOn: [],
    status: 'running',
    worker: 'research',
    limits: base.limits,
    retries: 0,
    stepsUsed: 0,
    costUsd: 0,
    artifactIds: [],
    ...task,
  }
  return { project: { ...base, tasks: [t] }, task: t }
}

const fenced = (json: string) => ['```delegate', json, '```'].join('\n')

const valid = (over: Record<string, unknown> = {}) =>
  fenced(JSON.stringify({
    capability: 'data_analysis',
    goal: 'Cluster the tiers',
    expectedOutputs: [{ path: 'analysis/clusters.json', kind: 'json' }],
    ...over,
  }))

function events(project: ProjectState) {
  return project.events.filter((e) => e.action === 'request_subtask')
}

describe('delegation refusals reach the ledger', () => {
  it('records the reason when a request names no output', () => {
    const { project, task } = projectWith()
    const out = applyDelegation(project, task, valid({ expectedOutputs: [] }))

    expect(out.created).toBe(0)
    const [event] = events(out.project)
    expect(event, 'refusal was not logged').toBeDefined()
    expect(event.detail).toContain('refused')
    expect(event.detail).toContain('no_expected_outputs')
    expect(event.taskId).toBe('t1')
    expect(event.worker).toBe('research')
  })

  it('records the reason when the sibling limit is hit', () => {
    const { project, task } = projectWith()
    const withSiblings: ProjectState = {
      ...project,
      delegation: { ...emptyDelegationState(), children: { t1: DEFAULT_DELEGATION_LIMITS.maxChildren } },
    }
    const out = applyDelegation(withSiblings, task, valid())

    expect(out.created).toBe(0)
    const [event] = events(out.project)
    expect(event.detail).toContain('sibling_limit')
    // The detail carries the number, so the trace explains itself.
    expect(event.detail).toContain(String(DEFAULT_DELEGATION_LIMITS.maxChildren))
  })

  it('records the reason when the capability is unknown', () => {
    const { project, task } = projectWith()
    const out = applyDelegation(project, task, valid({ capability: 'time_travel' }))

    expect(out.created).toBe(0)
    const [event] = events(out.project)
    expect(event.detail).toContain('unknown capability')
    expect(event.detail).toContain('time_travel')
  })

  it('records the reason when an input artifact does not exist', () => {
    const { project, task } = projectWith()
    const out = applyDelegation(project, task, valid({ inputArtifacts: ['nope.json'] }))

    expect(events(out.project)[0].detail).toContain('unknown_input_artifact')
  })

  it('logs one event per refused request, not one per answer', () => {
    const { project, task } = projectWith()
    const answer = [valid({ expectedOutputs: [] }), valid({ capability: 'time_travel' })].join('\n\n')
    const out = applyDelegation(project, task, answer)

    expect(out.created).toBe(0)
    expect(events(out.project)).toHaveLength(2)
  })
})

describe('delegation approvals reach the ledger too', () => {
  it('names the child task, its worker and its outputs', () => {
    const { project, task } = projectWith()
    const out = applyDelegation(project, task, valid())

    expect(out.created).toBe(1)
    const [event] = events(out.project)
    expect(event.detail).toContain('spawned')
    expect(event.detail).toContain('analyst')
    expect(event.detail).toContain('analysis/clusters.json')
  })

  it('leaves the ledger untouched when the answer contains no request', () => {
    const { project, task } = projectWith()
    const out = applyDelegation(project, task, 'Just an ordinary answer with no blocks.')

    expect(out.created).toBe(0)
    expect(events(out.project)).toHaveLength(0)
    // Same object back: no request means no work, and no accidental churn.
    expect(out.project).toBe(project)
  })
})
