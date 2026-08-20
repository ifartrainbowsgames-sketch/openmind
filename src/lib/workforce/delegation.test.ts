import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_WORKER, DEFAULT_DELEGATION_LIMITS, depthOf, emptyDelegationState,
  evaluateSpawn, recordSpawn, type SpawnRequest,
} from './delegation'
import { ALL_CAPABILITIES } from './capabilities'

const tasks = [{ id: 't1' }, { id: 't2' }]
const artifactPaths = ['research/competitors.json']

const request = (over: Partial<SpawnRequest> = {}): SpawnRequest => ({
  parentTaskId: 't1',
  capability: 'data_analysis',
  goal: 'Cluster the pricing tiers',
  inputArtifacts: [],
  expectedOutputs: [{ path: 'analysis/pricing.json', kind: 'json' }],
  ...over,
})

const ctx = (over: Partial<Parameters<typeof evaluateSpawn>[1]> = {}) => ({
  tasks, artifactPaths, state: emptyDelegationState(), ...over,
})

describe('evaluateSpawn — refusals', () => {
  it('refuses a request naming no output', () => {
    // The core rule: a delegation that cannot say what it will produce is a
    // conversation, and conversations are what this system exists to avoid.
    const d = evaluateSpawn(request({ expectedOutputs: [] }), ctx())
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('no_expected_outputs')
  })

  it('refuses an empty goal', () => {
    expect(evaluateSpawn(request({ goal: '   ' }), ctx()).reason).toBe('empty_goal')
  })

  it('refuses an unknown parent task', () => {
    expect(evaluateSpawn(request({ parentTaskId: 'nope' }), ctx()).reason).toBe('unknown_parent')
  })

  it('refuses an input artifact that does not exist', () => {
    const d = evaluateSpawn(request({ inputArtifacts: ['missing.json'] }), ctx())
    expect(d.reason).toBe('unknown_input_artifact')
    expect(d.detail).toContain('missing.json')
  })

  it('refuses regenerating an artifact that already exists', () => {
    const d = evaluateSpawn(
      request({ expectedOutputs: [{ path: 'research/competitors.json', kind: 'json' }] }),
      ctx(),
    )
    expect(d.reason).toBe('duplicate_output')
  })
})

describe('evaluateSpawn — limits', () => {
  it('allows a first-level delegation', () => {
    const d = evaluateSpawn(request(), ctx())
    expect(d.allowed).toBe(true)
    expect(d.childDepth).toBe(1)
  })

  it('stops at the depth limit', () => {
    // t1 already sits at max depth, so its child would be one too deep.
    const state = { ...emptyDelegationState(), depth: { t1: DEFAULT_DELEGATION_LIMITS.maxDepth } }
    const d = evaluateSpawn(request(), ctx({ state }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('depth_exceeded')
  })

  it('stops one task spawning more than maxChildren', () => {
    const state = { ...emptyDelegationState(), children: { t1: DEFAULT_DELEGATION_LIMITS.maxChildren } }
    expect(evaluateSpawn(request(), ctx({ state })).reason).toBe('sibling_limit')
  })

  it('counts siblings per parent, not globally', () => {
    const state = { ...emptyDelegationState(), children: { t2: 3 } }
    expect(evaluateSpawn(request(), ctx({ state })).allowed).toBe(true)
  })

  it('stops at the project-wide total', () => {
    const state = { ...emptyDelegationState(), total: DEFAULT_DELEGATION_LIMITS.maxPerProject }
    expect(evaluateSpawn(request(), ctx({ state })).reason).toBe('project_limit')
  })

  it('cannot be walked past by repeated requests', () => {
    // The guard has to hold across a sequence, not just on one call — this is
    // the shape of runaway spawning.
    let state = emptyDelegationState()
    let allowed = 0
    for (let i = 0; i < 20; i++) {
      const req = request({ expectedOutputs: [{ path: `out/${i}.json`, kind: 'json' }] })
      const d = evaluateSpawn(req, ctx({ state }))
      if (!d.allowed) continue
      allowed++
      state = recordSpawn(state, 't1', `child-${i}`, d.childDepth ?? 1)
    }
    expect(allowed).toBe(DEFAULT_DELEGATION_LIMITS.maxChildren)
  })
})

describe('recordSpawn', () => {
  it('tracks depth, siblings and total without mutating the input', () => {
    const before = emptyDelegationState()
    const after = recordSpawn(before, 't1', 'c1', 1)
    expect(before.total).toBe(0)
    expect(after.total).toBe(1)
    expect(after.children.t1).toBe(1)
    expect(depthOf(after, 'c1')).toBe(1)
  })

  it('makes a grandchild deeper than its parent', () => {
    let state = recordSpawn(emptyDelegationState(), 't1', 'c1', 1)
    const d = evaluateSpawn(request({ parentTaskId: 'c1' }), {
      tasks: [...tasks, { id: 'c1' }], artifactPaths, state,
    })
    expect(d.allowed).toBe(true)
    expect(d.childDepth).toBe(2)
    state = recordSpawn(state, 'c1', 'g1', 2)
    // Depth 3 is past the default ceiling.
    const tooDeep = evaluateSpawn(request({ parentTaskId: 'g1' }), {
      tasks: [...tasks, { id: 'c1' }, { id: 'g1' }], artifactPaths, state,
    })
    expect(tooDeep.reason).toBe('depth_exceeded')
  })
})

describe('CAPABILITY_WORKER', () => {
  it('routes every capability to a worker kind', () => {
    // A capability with no worker would make a valid delegation unfulfillable.
    for (const capability of ALL_CAPABILITIES) {
      expect(CAPABILITY_WORKER[capability], capability).toBeTruthy()
    }
  })
})
