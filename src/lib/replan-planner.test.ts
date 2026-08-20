import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  evaluateObservations,
  MAX_REPLANS,
  replanPrompt,
  runEmployee,
  simulatedBrain,
  type AgentBrain,
  type Employee,
  type PlanStep,
  type ToolCall,
} from './agent'
import { setExecutionMode } from './execution-mode'
import { hasCycle, planProjectSmart, PlannerError, validatePlan } from './task-planner-llm'
import {
  applyAction,
  createProject,
  DEFAULT_LIMITS,
  recordDecision,
  recordEvidence,
  type TaskRecord,
} from './task-ledger'
import { buildSharedContext } from './task-runner'

afterEach(() => {
  setExecutionMode('demo')
  vi.restoreAllMocks()
})

const call = (over: Partial<ToolCall> = {}): ToolCall => ({
  tool: 'web_search',
  input: 'competitors',
  output: 'Found three competitors with pricing pages.',
  ...over,
})

// ── evaluate ─────────────────────────────────────────────────────────────────

describe('evaluateObservations', () => {
  it('is sufficient when no tools were needed', () => {
    expect(evaluateObservations([]).verdict).toBe('sufficient')
  })

  it('is sufficient for a short but real answer', () => {
    expect(evaluateObservations([call({ tool: 'calculator', output: '42' })]).verdict).toBe('sufficient')
  })

  it('retries when a tool errored', () => {
    const v = evaluateObservations([call({ error: { kind: 'error', message: 'HTTP 503' } })])
    expect(v.verdict).toBe('retry')
    expect(v.reason).toContain('503')
  })

  it('retries when every result is a no-result response', () => {
    expect(evaluateObservations([call({ output: 'No results found' })]).verdict).toBe('retry')
  })

  it('does not retry when at least one call returned something usable', () => {
    const v = evaluateObservations([call({ output: 'No results found' }), call()])
    expect(v.verdict).toBe('sufficient')
  })

  it('blocks — not retries — when every call was blocked', () => {
    const v = evaluateObservations([call({ error: { kind: 'blocked', message: 'github not connected' } })])
    expect(v.verdict).toBe('blocked')
    expect(v.reason).toContain('github not connected')
  })
})

describe('replanPrompt', () => {
  it('lists what was already tried so the retry differs', () => {
    const prompt = replanPrompt('find competitors', [call({ output: 'No results found' })], 'empty results')
    expect(prompt).toContain('find competitors')
    expect(prompt).toContain('PREVIOUS ATTEMPT DID NOT WORK')
    expect(prompt).toContain('web_search')
    expect(prompt).toContain('Do not repeat a call that already failed')
  })
})

// ── the graph actually replans ───────────────────────────────────────────────

const emp: Employee = {
  id: 'w', name: 'W', role: 'worker', prompt: 'work', tools: ['search_docs', 'summarize'], accent: '#000',
}

describe('ACT → EVALUATE → REPLAN', () => {
  // search_docs on gibberish returns "No matching passages found in the docs."
  const GIBBERISH = 'qqqzzzwww'

  it('replans when the first round returns nothing usable, and stops at the cap', async () => {
    const plans: string[] = []
    const brain: AgentBrain = {
      plan: async (input) => {
        plans.push(input)
        return [{ tool: 'search_docs', input: GIBBERISH }] as PlanStep[]
      },
      respond: async () => 'done',
    }
    const r = await runEmployee(brain, emp, GIBBERISH)
    // One initial plan plus exactly MAX_REPLANS retries — never an unbounded loop.
    expect(plans).toHaveLength(1 + MAX_REPLANS)
    expect(plans[1]).toContain('PREVIOUS ATTEMPT DID NOT WORK')
    expect(r.answer).toBe('done')
  })

  it('uses brain.replan when the brain provides one', async () => {
    const replan = vi.fn(async () => [] as PlanStep[])
    const brain: AgentBrain = {
      plan: async () => [{ tool: 'search_docs', input: GIBBERISH }] as PlanStep[],
      respond: async () => 'done',
      replan,
    }
    await runEmployee(brain, emp, GIBBERISH)
    expect(replan).toHaveBeenCalledTimes(1)
  })

  it('does not replan on a clean run', async () => {
    const plan = vi.fn(async () => [{ tool: 'calculator', input: '2+2' }] as PlanStep[])
    const brain: AgentBrain = { plan, respond: async () => 'four' }
    const r = await runEmployee(brain, { ...emp, tools: ['calculator'] }, 'what is 2+2')
    expect(plan).toHaveBeenCalledTimes(1)
    expect(r.trace.map((t) => t.node)).toEqual(['plan', 'act', 'respond'])
  })

  it('leaves the simulated brain trace unchanged on the happy path', async () => {
    const r = await runEmployee(simulatedBrain(), { ...emp, tools: ['calculator'] }, 'what is 12 * 12')
    expect(r.trace.map((t) => t.node)).toEqual(['plan', 'act', 'respond'])
  })
})

// ── LLM task planner validation ──────────────────────────────────────────────

describe('validatePlan', () => {
  const ok = {
    tasks: [
      { id: 'TASK-001', worker: 'research', goal: 'find competitors', outputs: ['research/c.json'], dependsOn: [] },
      { id: 'TASK-002', worker: 'analyst', goal: 'synthesize', outputs: ['analysis/r.md'], dependsOn: ['TASK-001'] },
    ],
  }

  it('accepts a well-formed DAG', () => {
    const tasks = validatePlan(ok, DEFAULT_LIMITS)
    expect(tasks).toHaveLength(2)
    expect(tasks[1].dependsOn).toEqual(['TASK-001'])
  })

  it('rejects a task with no output artifact', () => {
    const bad = { tasks: [{ id: 'T1', worker: 'research', goal: 'g', outputs: [], dependsOn: [] }] }
    expect(() => validatePlan(bad, DEFAULT_LIMITS)).toThrow(/no output artifact/)
  })

  it('rejects an unknown worker kind', () => {
    const bad = { tasks: [{ id: 'T1', worker: 'chief_happiness_officer', goal: 'g', outputs: ['a.md'] }] }
    expect(() => validatePlan(bad, DEFAULT_LIMITS)).toThrow(/unknown worker/)
  })

  it('rejects a dangling dependency', () => {
    const bad = { tasks: [{ id: 'T1', worker: 'research', goal: 'g', outputs: ['a.md'], dependsOn: ['T9'] }] }
    expect(() => validatePlan(bad, DEFAULT_LIMITS)).toThrow(/unknown task/)
  })

  it('rejects a dependency cycle', () => {
    const bad = {
      tasks: [
        { id: 'A', worker: 'research', goal: 'g', outputs: ['a.md'], dependsOn: ['B'] },
        { id: 'B', worker: 'analyst', goal: 'g', outputs: ['b.md'], dependsOn: ['A'] },
      ],
    }
    expect(() => validatePlan(bad, DEFAULT_LIMITS)).toThrow(/cycle/)
  })

  it('rejects an oversized plan', () => {
    const bad = {
      tasks: Array.from({ length: 9 }, (_, i) => ({
        id: `T${i}`, worker: 'research', goal: 'g', outputs: ['a.md'], dependsOn: [],
      })),
    }
    expect(() => validatePlan(bad, DEFAULT_LIMITS)).toThrow(/max 8/)
  })

  it('detects cycles including self-reference', () => {
    expect(hasCycle([{ id: 'A', dependsOn: ['A'] }])).toBe(true)
    expect(hasCycle([{ id: 'A', dependsOn: [] }, { id: 'B', dependsOn: ['A'] }])).toBe(false)
  })
})

describe('planProjectSmart', () => {
  it('falls back to the heuristic planner in demo mode with no provider', async () => {
    const { project } = await planProjectSmart('Research competitors for AI website builders', null)
    expect(project.tasks.length).toBeGreaterThan(0)
  })

  it('refuses to substitute the heuristic planner in strict mode', async () => {
    setExecutionMode('strict')
    await expect(planProjectSmart('Research competitors', null)).rejects.toThrow(PlannerError)
  })

  it('falls back when the provider call fails in demo mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const { project } = await planProjectSmart('Research competitors and build a page', {
      baseUrl: 'https://x.test/v1', model: 'm', key: 'k',
    })
    expect(project.tasks.length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })
})

// ── shared project context ───────────────────────────────────────────────────

describe('shared project state', () => {
  it('records evidence without duplicates', () => {
    let p = createProject('goal')
    p = recordEvidence(p, ['https://a.com', 'https://b.com'])
    p = recordEvidence(p, ['https://a.com', 'https://c.com'])
    expect(p.evidence).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
  })

  it('records decisions without duplicates', () => {
    let p = createProject('goal')
    p = recordDecision(p, 'TASK-001 accepted')
    p = recordDecision(p, 'TASK-001 accepted')
    expect(p.decisions).toEqual(['TASK-001 accepted'])
  })

  it('puts established facts into the worker prompt', () => {
    let p = createProject('goal')
    p = recordDecision(p, 'TASK-001 accepted: competitors found')
    p = recordEvidence(p, ['https://a.com'])
    const ctx = buildSharedContext(p)
    expect(ctx).toContain('do not re-derive')
    expect(ctx).toContain('competitors found')
    expect(ctx).toContain('https://a.com')
  })

  it('adds nothing to the prompt when nothing is established yet', () => {
    expect(buildSharedContext(createProject('goal'))).toBe('')
  })
})

describe('applyAction', () => {
  const task: Omit<TaskRecord, 'status' | 'retries' | 'stepsUsed' | 'costUsd' | 'artifactIds'> = {
    id: 'TASK-009',
    type: 'research',
    goal: 'extra research',
    inputs: {},
    outputs: ['research/extra.json'],
    dependsOn: [],
    worker: 'research',
    limits: DEFAULT_LIMITS,
  }

  it('creates a task and logs the event', () => {
    const p = applyAction(createProject('goal'), { type: 'create_task', task }, 'planner')
    expect(p.tasks).toHaveLength(1)
    expect(p.tasks[0].status).toBe('pending')
    expect(p.events.at(-1)?.action).toBe('create_task')
  })

  it('ignores a duplicate task id', () => {
    let p = applyAction(createProject('goal'), { type: 'create_task', task }, 'planner')
    p = applyAction(p, { type: 'create_task', task }, 'planner')
    expect(p.tasks).toHaveLength(1)
  })

  it('writes an artifact, replacing any earlier one at the same path', () => {
    let p = createProject('goal')
    const base = { path: 'research/extra.json', kind: 'json' as const, title: 'extra', taskId: 'TASK-009', worker: 'research' as const }
    p = applyAction(p, { type: 'write_artifact', artifact: { ...base, body: 'v1' } })
    p = applyAction(p, { type: 'write_artifact', artifact: { ...base, body: 'v2' } })
    expect(p.artifacts).toHaveLength(1)
    expect(p.artifacts[0].body).toBe('v2')
  })

  it('blocks a task and records the blocker', () => {
    let p = applyAction(createProject('goal'), { type: 'create_task', task }, 'planner')
    p = applyAction(p, { type: 'report_blocker', taskId: 'TASK-009', reason: 'github not connected' })
    expect(p.tasks[0].status).toBe('blocked')
    expect(p.blockers[0]).toContain('github not connected')
  })
})
