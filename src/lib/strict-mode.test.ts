import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  argsFromSchema,
  canFillRequired,
  normalizeToolResult,
  pickTool,
  resolveConnectionTools,
  type Employee,
  type LiveConnectionConfig,
} from './agent'
import { getExecutionMode, isStrict, setExecutionMode, withExecutionMode } from './execution-mode'
import { invokeCrewTool } from './crew-tools'
import { scoreRun, heuristicScore } from './reportcard'
import {
  budgetBreach,
  budgetPressure,
  createProject,
  DEFAULT_BUDGET,
  recordSpend,
  shouldSynthesizeNow,
  ZERO_SPEND,
} from './task-ledger'
import type { McpToolInfo } from './mcp'

const emp = (connections: string[]): Employee => ({
  id: 'e1',
  name: 'Ada',
  role: 'Assistant',
  prompt: 'help',
  tools: [],
  connections,
  accent: '#000',
})

afterEach(() => {
  setExecutionMode('demo')
  vi.restoreAllMocks()
})

// ── execution mode ───────────────────────────────────────────────────────────

describe('execution mode', () => {
  it('defaults to demo and restores after withExecutionMode', async () => {
    expect(getExecutionMode()).toBe('demo')
    const inside = await withExecutionMode('strict', async () => isStrict())
    expect(inside).toBe(true)
    expect(getExecutionMode()).toBe('demo')
  })

  it('restores the previous mode even when the body throws', async () => {
    await expect(
      withExecutionMode('strict', async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')
    expect(isStrict()).toBe(false)
  })
})

// ── strict mode refuses mock substitution ────────────────────────────────────

describe('strict mode: no mock substitution', () => {
  it('serves canned connection data in demo mode', async () => {
    const tool = resolveConnectionTools(emp(['github'])).find((t) => t.id === 'github')!
    const out = normalizeToolResult(await tool.run('pull requests'))
    expect(out.source).toBe('mock')
    expect(out.error).toBeUndefined()
  })

  it('blocks the same call in strict mode instead of faking it', async () => {
    setExecutionMode('strict')
    const tool = resolveConnectionTools(emp(['github'])).find((t) => t.id === 'github')!
    const out = normalizeToolResult(await tool.run('pull requests'))
    expect(out.error?.kind).toBe('blocked')
    expect(out.content).toContain('TASK_BLOCKED')
    expect(out.content).not.toContain('PR #12')
  })

  it('blocks crew tools with no live backend rather than returning canned results', async () => {
    const demo = await invokeCrewTool('web_search', 'competitors')
    expect(demo).toContain('[MOCK · web_search]')

    setExecutionMode('strict')
    const strict = await invokeCrewTool('web_search', 'competitors')
    expect(strict).toContain('TASK_BLOCKED')
    expect(strict).not.toContain('[MOCK')
  })
})

// ── strict mode refuses a silently-degraded judge ────────────────────────────

describe('strict mode: judge', () => {
  const run = {
    employee: emp([]),
    input: 'do the thing',
    trace: [],
    output: 'here is a fairly substantial answer about the thing that was asked',
  }

  it('falls back to heuristic scoring in demo mode', async () => {
    const score = await scoreRun(run, null)
    expect(score.source).toBe('heuristic')
    expect(score).toEqual(expect.objectContaining({ source: 'heuristic' }))
  })

  it('reports the judge as unavailable in strict mode', async () => {
    setExecutionMode('strict')
    const score = await scoreRun(run, null)
    expect(score.source).toBe('unavailable')
    expect(score.verdict).toBe('unsure')
    expect(score.note).toContain('TASK_BLOCKED')
  })

  it('still scores heuristically when asked directly — strict only gates the fallback', () => {
    setExecutionMode('strict')
    expect(heuristicScore(run).source).toBe('heuristic')
  })
})

// ── MCP schema plumbing ──────────────────────────────────────────────────────

describe('argsFromSchema', () => {
  it('falls back to {query} only when no schema is known', () => {
    expect(argsFromSchema(undefined, 'open bugs')).toEqual({ query: 'open bugs' })
  })

  it('fills the required string property named by the schema', () => {
    const schema = { properties: { q: { type: 'string' } }, required: ['q'] }
    expect(argsFromSchema(schema, 'open bugs')).toEqual({ q: 'open bugs' })
  })

  it('throws rather than shipping a half-built call', () => {
    // The contract changed from returning a `missing` list to throwing. Louder
    // is right here: a caller that ignored `missing` sent an incomplete call to
    // a live server, which is the failure this guards.
    const schema = {
      properties: { owner: { type: 'string' }, repo: { type: 'string' }, query: { type: 'string' } },
      required: ['owner', 'repo', 'query'],
    }
    expect(() => argsFromSchema(schema, 'open bugs')).toThrow(/required tool arguments/)
  })

  it('prefers a query-shaped name over the first declared property', () => {
    const schema = { properties: { cursor: { type: 'string' }, query: { type: 'string' } }, required: [] }
    expect(argsFromSchema(schema, 'bugs')).toEqual({ query: 'bugs' })
  })

  it('reports unfillable schemas without throwing, for tool scoring', () => {
    const schema = {
      properties: { owner: { type: 'string' }, repo: { type: 'string' } },
      required: ['owner', 'repo'],
    }
    expect(canFillRequired(schema, 'open bugs')).toBe(false)
    expect(canFillRequired({ properties: { q: { type: 'string' } }, required: ['q'] }, 'x')).toBe(true)
  })
})

describe('pickTool', () => {
  const tools: McpToolInfo[] = [
    { name: 'search_issues', description: 'Search issues and pull requests' },
    { name: 'create_release', description: 'Cut a new release' },
    { name: 'delete_repo', description: 'Permanently remove a repository' },
  ]

  it('matches on description, not just tool name', () => {
    expect(pickTool(tools, 'any pull requests open?')?.name).toBe('search_issues')
  })

  it('returns undefined when nothing matches rather than guessing', () => {
    expect(pickTool(tools, 'what is the weather in oslo')).toBeUndefined()
  })

  it('routes to the only advertised tool without needing a match', () => {
    expect(pickTool([{ name: 'whatever' }], 'anything')?.name).toBe('whatever')
  })

  it('returns undefined for an empty server', () => {
    expect(pickTool([], 'anything')).toBeUndefined()
  })
})

describe('live MCP tools use the advertised schema', () => {
  const cfg: LiveConnectionConfig = {
    connectionId: 'github',
    mode: 'mcp',
    status: 'live',
    serverUrl: 'https://example.test/mcp',
    toolNames: ['search_issues'],
    toolDescriptions: { search_issues: 'Search issues' },
    toolSchemas: {
      search_issues: {
        properties: { owner: { type: 'string' }, repo: { type: 'string' }, q: { type: 'string' } },
        required: ['owner', 'repo', 'q'],
      },
    },
  }

  it('blocks a call whose required arguments cannot be derived', async () => {
    const tool = resolveConnectionTools(emp(['github']), [cfg])
      .find((t) => t.id === 'github__search_issues')!
    const out = normalizeToolResult(await tool.run('open bugs'))
    expect(out.error?.kind).toBe('blocked')
    // `owner` is satisfiable from the free text; the ones that are not get
    // named, which is the point — the call is refused rather than half-built.
    expect(out.content).toContain('repo')
    expect(out.content).toMatch(/required tool arguments/)
  })

  it('exposes the tool description so the model can choose properly', () => {
    const tool = resolveConnectionTools(emp(['github']), [cfg])
      .find((t) => t.id === 'github__search_issues')!
    expect(tool.desc).toContain('Search issues')
  })
})

// ── budget ───────────────────────────────────────────────────────────────────

describe('project budget', () => {
  it('starts with a zeroed spend and no breach', () => {
    const p = createProject('goal')
    expect(p.spend).toEqual(ZERO_SPEND)
    expect(budgetBreach(p.spend, p.budget, 0)).toBeUndefined()
  })

  it('accumulates spend across runs', () => {
    let p = createProject('goal')
    p = recordSpend(p, { tokens: 100, costUsd: 0.01, toolCalls: 2, agentRuns: 1 })
    p = recordSpend(p, { tokens: 50, toolCalls: 1, agentRuns: 1 })
    expect(p.spend).toEqual({ tokens: 150, costUsd: 0.01, toolCalls: 3, agentRuns: 2 })
  })

  it('breaches on whichever dimension runs out first', () => {
    const spend = { ...ZERO_SPEND, agentRuns: DEFAULT_BUDGET.maxAgentRuns }
    expect(budgetBreach(spend, DEFAULT_BUDGET, 0)?.dimension).toBe('agentRuns')
  })

  it('breaches on the deadline even with nothing else spent', () => {
    expect(budgetBreach(ZERO_SPEND, DEFAULT_BUDGET, DEFAULT_BUDGET.deadlineMs + 1)?.dimension).toBe('deadline')
  })

  it('reports pressure from the tightest dimension', () => {
    const spend = { ...ZERO_SPEND, toolCalls: DEFAULT_BUDGET.maxToolCalls / 2 }
    expect(budgetPressure(spend, DEFAULT_BUDGET, 0)).toBeCloseTo(0.5)
  })

  it('switches to synthesis at 80% of budget', () => {
    let p = createProject('goal')
    expect(shouldSynthesizeNow(p)).toBe(false)
    p = recordSpend(p, { toolCalls: Math.ceil(DEFAULT_BUDGET.maxToolCalls * 0.8) })
    expect(shouldSynthesizeNow(p)).toBe(true)
  })
})
