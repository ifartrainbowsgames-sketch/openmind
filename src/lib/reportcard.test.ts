// Tests for the report-card scorer — fetch is stubbed, localStorage is a
// MemStorage shim (Node 20 test env has neither), mirroring mcp.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}
const localStore = new MemStorage()
Object.defineProperty(globalThis, 'localStorage', { value: localStore })

import type { Employee, TraceLine } from './agent'
import {
  loadScorecards,
  MAX_SCORES_PER_EMPLOYEE,
  normalizeJudgeScore,
  recordScore,
  scoreRun,
  trendSummary,
  type RunScore,
  type ScoredRun,
} from './reportcard'

// ── fixtures ─────────────────────────────────────────────────────────────────

const employee: Employee = {
  id: 'emp-test',
  name: 'Mara',
  role: 'Support Lead',
  prompt: 'Answer strictly from the knowledge base and cite the docs.',
  tools: ['search_docs'],
  connections: ['zendesk'],
  accent: '#ff4d00',
}

const trace: TraceLine[] = [
  { node: 'plan', text: '1 step queued — zendesk' },
  { node: 'act', text: 'zendesk("refund tickets") → [MOCK · zendesk] • Ticket #3381 — "Refund status?"' },
  { node: 'respond', text: 'answer composed from 1 observation' },
]

const LONG_ANSWER =
  'Ticket #3381 "Refund status?" is pending an agent reply. Per the docs, refunds are processed ' +
  'within five business days — the customer should email billing@openmind.dev to request one. ' +
  'I have flagged the ticket for follow-up.'

const run = (over: Partial<ScoredRun> = {}): ScoredRun => ({
  employee,
  input: 'Any refund tickets waiting?',
  trace,
  output: LONG_ANSWER,
  ...over,
})

const judgeJson = (verdict = 'good', note = 'Grounded in the ticket evidence and in role.'): string =>
  JSON.stringify({
    verdict,
    axes: [
      { label: 'groundedness', verdict: 'good' },
      { label: 'tool use', verdict },
      { label: 'instruction fit', verdict: 'good' },
      { label: 'tone', verdict: 'excellent' },
    ],
    note,
  })

function completionResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, statusText: 'OK' })
}

/** Queue of reply strings; each fetch call shifts one. Extra calls throw. */
function stubFetchSequence(...contents: string[]) {
  const mock = vi.fn(async () => {
    const next = contents.shift()
    if (next === undefined) throw new Error('unexpected extra fetch call')
    return completionResponse(next)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const BRAIN = { providerId: 'kimi', apiKey: 'test-key' }

beforeEach(() => {
  localStore.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── LLM judge path ───────────────────────────────────────────────────────────

describe('scoreRun — llm judge', () => {
  it('scores a run from a clean judge JSON reply', async () => {
    stubFetchSequence(judgeJson('excellent'))
    const score = await scoreRun(run(), BRAIN)
    expect(score.source).toBe('llm-judge')
    expect(score.verdict).toBe('excellent')
    expect(score.judge).toContain('kimi-k3')
    expect(score.axes).toHaveLength(4)
    expect(score.axes.map((a) => a.label)).toEqual(['groundedness', 'tool use', 'instruction fit', 'tone'])
    expect(score.note.length).toBeGreaterThan(0)
    expect(score.at).toBeGreaterThan(0)
  })

  it('parses fenced judge JSON', async () => {
    stubFetchSequence('```json\n' + judgeJson('mixed') + '\n```')
    const score = await scoreRun(run(), BRAIN)
    expect(score.source).toBe('llm-judge')
    expect(score.verdict).toBe('mixed')
  })

  it('parses loose JSON with prose around it', async () => {
    stubFetchSequence('Here is my assessment:\n' + judgeJson('poor') + '\nHope that helps!')
    const score = await scoreRun(run(), BRAIN)
    expect(score.source).toBe('llm-judge')
    expect(score.verdict).toBe('poor')
  })

  it('repairs once when the first reply is not JSON', async () => {
    const mock = stubFetchSequence('I cannot score this in JSON, sorry.', judgeJson('good'))
    const score = await scoreRun(run(), BRAIN)
    expect(mock).toHaveBeenCalledTimes(2)
    expect(score.source).toBe('llm-judge')
    expect(score.verdict).toBe('good')
  })

  it('falls back to heuristic when the judge fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const score = await scoreRun(run(), BRAIN)
    expect(score.source).toBe('heuristic')
    expect(score.verdict).toBe('good') // clean trace + long answer
    expect(score.judge).toBeUndefined()
  })

  it('falls back to heuristic when both judge replies are garbage', async () => {
    stubFetchSequence('not json at all', 'still not json')
    const score = await scoreRun(run(), BRAIN)
    expect(score.source).toBe('heuristic')
  })

  it('falls back to heuristic when judge JSON fails validation', async () => {
    stubFetchSequence(JSON.stringify({ verdict: 'amazing', axes: [] }))
    const score = await scoreRun(run(), BRAIN)
    expect(score.source).toBe('heuristic')
  })
})

// ── heuristic path ───────────────────────────────────────────────────────────

describe('scoreRun — heuristic fallback', () => {
  it('uses heuristics when no brain is given', async () => {
    const score = await scoreRun(run(), null)
    expect(score.source).toBe('heuristic')
    expect(score.verdict).toBe('good')
  })

  it('uses heuristics when the provider needs a key and none was given', async () => {
    const score = await scoreRun(run(), { providerId: 'kimi' })
    expect(score.source).toBe('heuristic')
  })

  it('marks an empty answer as poor', async () => {
    const score = await scoreRun(run({ output: '   ' }), null)
    expect(score.verdict).toBe('poor')
  })

  it('says "unsure" when the answer is too thin to judge', async () => {
    const score = await scoreRun(run({ output: 'Done.' }), null)
    expect(score.verdict).toBe('unsure')
    expect(score.note.toLowerCase()).toContain('thin')
  })

  it('marks all-failed tool calls as poor/mixed with an honest note', async () => {
    const errTrace: TraceLine[] = [
      { node: 'plan', text: '1 step queued — gmail' },
      { node: 'act', text: 'gmail("inbox") → error: connection refused' },
      { node: 'respond', text: 'answer composed from 1 observation' },
    ]
    const score = await scoreRun(run({ trace: errTrace, output: 'I could not reach the inbox.' }), null)
    expect(['poor', 'mixed']).toContain(score.verdict)
    expect(score.note).toMatch(/errored/)
    expect(score.axes.find((a) => a.label === 'tool use')?.verdict).toBe('poor')
  })

  it('never throws on a weird run', async () => {
    const score = await scoreRun(run({ trace: [], output: '' }), undefined)
    expect(score.verdict).toBe('poor')
    expect(score.source).toBe('heuristic')
  })
})

// ── validation ───────────────────────────────────────────────────────────────

describe('normalizeJudgeScore', () => {
  it('rejects non-objects and bad verdicts', () => {
    expect(normalizeJudgeScore(null, 'j')).toBeNull()
    expect(normalizeJudgeScore({ verdict: '99%' }, 'j')).toBeNull()
    expect(normalizeJudgeScore({ verdict: 'good', axes: [] }, 'j')).toBeNull()
  })

  it('drops unknown axis labels and caps the note', () => {
    const score = normalizeJudgeScore(
      {
        verdict: 'good',
        axes: [
          { label: 'tone', verdict: 'good' },
          { label: 'vibes', verdict: 'good' },
        ],
        note: 'x'.repeat(400),
      },
      'j',
    )
    expect(score?.axes).toEqual([{ label: 'tone', verdict: 'good' }])
    expect(score?.note).toHaveLength(280)
  })
})

// ── persistence + trends ─────────────────────────────────────────────────────

describe('scorecard persistence', () => {
  const card = (verdict: RunScore['verdict']): RunScore => ({
    verdict,
    axes: [],
    note: 'n',
    source: 'heuristic',
    at: Date.now(),
  })

  it('round-trips scores per employee, newest first', () => {
    recordScore('a', card('good'))
    recordScore('a', card('poor'))
    recordScore('b', card('excellent'))
    const a = loadScorecards('a')
    expect(a.map((s) => s.verdict)).toEqual(['poor', 'good'])
    expect(loadScorecards('b')).toHaveLength(1)
    expect(loadScorecards('nobody')).toEqual([])
  })

  it('caps history at MAX_SCORES_PER_EMPLOYEE', () => {
    for (let i = 0; i < MAX_SCORES_PER_EMPLOYEE + 5; i++) recordScore('cap', card('good'))
    expect(loadScorecards('cap')).toHaveLength(MAX_SCORES_PER_EMPLOYEE)
  })

  it('survives corrupted storage', () => {
    localStore.setItem('om-report-cards', '{"broken":')
    expect(loadScorecards('a')).toEqual([])
    localStore.setItem('om-report-cards', '[1,2,3]')
    expect(loadScorecards('a')).toEqual([])
  })
})

describe('trendSummary', () => {
  it('counts per verdict, zero-filled', () => {
    const scores = [
      { verdict: 'good' }, { verdict: 'good' }, { verdict: 'poor' }, { verdict: 'unsure' },
    ] as RunScore[]
    expect(trendSummary(scores)).toEqual({ excellent: 0, good: 2, mixed: 0, poor: 1, unsure: 1 })
    expect(trendSummary([])).toEqual({ excellent: 0, good: 0, mixed: 0, poor: 0, unsure: 0 })
  })
})
