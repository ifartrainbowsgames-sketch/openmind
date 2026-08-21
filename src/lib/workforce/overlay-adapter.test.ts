import { describe, expect, it, vi } from 'vitest'
import { buildOverlay, employeeForWorker, overlayEdges } from './map-overlay'
import type { ProjectSnapshot } from '../task-ledger'

vi.mock('../supabase')

const employees = [
  { id: 'worker-research', role: 'research worker' },
  { id: 'worker-analyst', role: 'analyst worker' },
  { id: 'custom-1', role: 'Senior Code Reviewer' },
]

function snapshot(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: 'p1',
    goal: 'g',
    tasks: [],
    artifacts: [],
    blockers: [],
    finished: false,
    handoffs: [],
    spend: { costUsd: 0, tokens: 0, toolCalls: 0, agentRuns: 0 },
    budget: { maxAgentRuns: 10, maxToolCalls: 10, maxCostUsd: 1, maxTokens: 1000, deadlineMs: 1000 },
    ...over,
  }
}

const task = (over: Partial<ProjectSnapshot['tasks'][number]>): ProjectSnapshot['tasks'][number] => ({
  id: 't1', goal: 'do it', status: 'pending', worker: 'research', outputs: [], artifactIds: [], ...over,
})

describe('employeeForWorker', () => {
  it('matches a built-in worker exactly', () => {
    expect(employeeForWorker(employees, 'research')).toBe('worker-research')
  })

  it('falls back to a role-text match for custom employees', () => {
    // Loose, but an empty map for a custom team tells the user nothing at all.
    expect(employeeForWorker(employees, 'code')).toBe('custom-1')
  })

  it('returns nothing when no employee fits', () => {
    expect(employeeForWorker(employees, 'browser')).toBeUndefined()
  })
})

describe('buildOverlay', () => {
  it('is empty without a project — an idle map means idle', () => {
    expect(buildOverlay(undefined, employees)).toEqual({})
  })

  it('maps task status onto the employee', () => {
    const overlay = buildOverlay(snapshot({ tasks: [task({ status: 'running' })] }), employees)
    expect(overlay['worker-research'].status).toBe('running')
    expect(overlay['worker-research'].taskGoal).toBe('do it')
  })

  it('treats needs_user as blocked, because both need a person', () => {
    const overlay = buildOverlay(
      snapshot({ tasks: [task({ status: 'needs_user', blocker: 'no key' })] }),
      employees,
    )
    expect(overlay['worker-research'].status).toBe('blocked')
    expect(overlay['worker-research'].blocker).toBe('no key')
  })

  it('shows the most urgent state when a worker has several tasks', () => {
    // Someone scanning the map needs "stuck" before "done".
    const overlay = buildOverlay(
      snapshot({ tasks: [task({ id: 'a', status: 'completed' }), task({ id: 'b', status: 'blocked' })] }),
      employees,
    )
    expect(overlay['worker-research'].status).toBe('blocked')
  })

  it('sums artifacts across a worker tasks', () => {
    const overlay = buildOverlay(
      snapshot({
        tasks: [task({ id: 'a' }), task({ id: 'b' })],
        artifacts: [
          { id: '1', path: 'x.json', kind: 'json', title: 'x', taskId: 'a' },
          { id: '2', path: 'y.json', kind: 'json', title: 'y', taskId: 'b' },
        ],
      }),
      employees,
    )
    expect(overlay['worker-research'].artifactCount).toBe(2)
  })

  it('ignores tasks whose worker has no employee', () => {
    const overlay = buildOverlay(snapshot({ tasks: [task({ worker: 'browser' })] }), employees)
    expect(Object.keys(overlay)).toHaveLength(0)
  })
})

describe('overlayEdges', () => {
  it('draws an edge only for a real handoff', () => {
    const edges = overlayEdges(
      snapshot({
        handoffs: [{ from: 'research', to: 'analyst', fromTaskId: 'a', toTaskId: 'b', label: 'research/data.json', at: 0 }],
      }),
      employees,
    )
    expect(edges).toEqual([
      { fromEmployeeId: 'worker-research', toEmployeeId: 'worker-analyst', label: 'data.json' },
    ])
  })

  it('draws nothing without handoffs', () => {
    expect(overlayEdges(snapshot(), employees)).toEqual([])
  })

  it('skips a worker handing off to itself', () => {
    // Real as a dependency, but an arrow would claim something that never moved
    // between two people.
    const edges = overlayEdges(
      snapshot({ handoffs: [{ from: 'research', to: 'research', fromTaskId: 'a', toTaskId: 'b', label: 'x', at: 0 }] }),
      employees,
    )
    expect(edges).toEqual([])
  })
})
