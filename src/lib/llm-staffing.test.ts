import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  explicitHeadcount,
  extractJson,
  generateStaffLLM,
  normalizeEmployees,
  planWorkforce,
  StaffingError,
  type StaffingStage,
} from './llm-staffing'
import { CONNECTION_IDS, TOOL_IDS } from './agent'
import { MAX_HIRES } from './staffing'

// ── fetch mocking helpers ────────────────────────────────────────────────────

function completionResponse(content: string, status = 200): Response {
  if (status === 200) {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      statusText: 'OK',
    })
  }
  return new Response('{"error":{"message":"invalid api key"}}', { status, statusText: 'Unauthorized' })
}

/** Queue of reply strings; each fetch call shifts one. Extra calls throw. */
function stubFetchSequence(...contents: string[]) {
  const calls: { url: string; body: { model: string; messages: { role: string; content: string }[] } }[] = []
  const mock = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    const next = contents.shift()
    if (next === undefined) throw new Error('unexpected extra fetch call')
    return completionResponse(next)
  })
  vi.stubGlobal('fetch', mock)
  return calls
}

const PROMPT_3_SENTENCES =
  'I am a diligent support specialist who lives in the ticket queue. ' +
  'I answer from the knowledge base and use my tools to find evidence before replying. ' +
  'When I cannot verify something I say "I\'m not sure" and escalate.'

function plannerJson(employees: Record<string, unknown>[], rationale = 'a balanced team'): string {
  return '```json\n' + JSON.stringify({ rationale, employees }, null, 2) + '\n```'
}

function rawEmployee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Mara',
    role: 'Support Agent',
    tagline: 'owns the queue',
    prompt: PROMPT_3_SENTENCES,
    tools: ['search_docs', 'summarize'],
    connections: ['zendesk'],
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── (a) happy path ───────────────────────────────────────────────────────────

describe('generateStaffLLM — happy path', () => {
  it('parses fenced JSON into exactly 3 distinct employees and filters invalid tool ids', async () => {
    const calls = stubFetchSequence(
      plannerJson([
        rawEmployee({ name: 'Mara', role: 'Support Agent', tools: ['search_docs', 'teleporter', 'gmail'] }),
        rawEmployee({ name: 'Jonas', role: 'Escalation Lead', tools: ['summarize', 'bogus_tool'] }),
        rawEmployee({ name: 'Priya', role: 'Knowledge Curator', tools: ['search_docs'] }),
      ]),
    )
    const stages: StaffingStage[] = []
    const result = await generateStaffLLM('hire 3 support agents', { providerId: 'kimi', apiKey: 'sk-test' }, (s) =>
      stages.push(s),
    )

    expect(result.source).toBe('llm')
    expect(result.note).toBeUndefined()
    expect(result.rationale).toBe('a balanced team')
    expect(result.employees).toHaveLength(3)

    // distinct names and roles
    expect(new Set(result.employees.map((e) => e.name)).size).toBe(3)
    expect(new Set(result.employees.map((e) => e.role)).size).toBe(3)

    for (const e of result.employees) {
      expect(e.id).toMatch(/^emp-/)
      expect(e.accent).toMatch(/^#/)
      expect(e.preset).toBeUndefined()
      expect(e.prompt.trim().length).toBeGreaterThan(0)
      expect(e.prompt.split(/[.!?]+/).filter((s) => s.trim()).length).toBeGreaterThanOrEqual(3)
      expect(e.tools.every((t) => TOOL_IDS.includes(t))).toBe(true)
      expect((e.connections ?? []).every((c) => CONNECTION_IDS.includes(c))).toBe(true)
    }

    // invalid tool ids dropped; connection id misplaced in tools moved to connections
    expect(result.employees[0].tools).toEqual(['search_docs'])
    expect(result.employees[0].connections).toEqual(expect.arrayContaining(['gmail', 'zendesk']))
    expect(result.employees[1].tools).toEqual(['summarize'])

    // went to the kimi endpoint with the kimi model and no sampling params (fixedParams)
    expect(calls[0].url).toBe('https://api.moonshot.ai/v1/chat/completions')
    expect(calls[0].body.model).toBe('kimi-k3')
    expect('temperature' in calls[0].body).toBe(false)
    expect(calls[0].body.messages[0].content).toContain('staffing director')

    // stage sequence: contacting → designing → 3× hired → done
    expect(stages.map((s) => s.key)).toEqual(['contacting-planner', 'designing-team', 'hired-0', 'hired-1', 'hired-2', 'done'])
    expect(stages[0].label).toContain('Kimi')
    expect(stages[2].label).toMatch(/^Hired Mara — Support Agent$/)
    expect(stages.at(-1)?.status).toBe('done')
  })
})

// ── (b) repair retry ─────────────────────────────────────────────────────────

describe('generateStaffLLM — JSON repair', () => {
  it('retries once with a repair prompt when the first reply is not JSON', async () => {
    const calls = stubFetchSequence(
      'Sure! Here is the team I designed for you — hope that helps!',
      plannerJson([rawEmployee()]),
    )
    const result = await generateStaffLLM('a support agent', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.source).toBe('llm')
    expect(result.employees).toHaveLength(1)
    expect(calls).toHaveLength(2)
    // repair turn includes the bad assistant reply and asks for bare JSON
    const repairMessages = calls[1].body.messages
    expect(repairMessages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(repairMessages[3].content).toMatch(/not valid JSON/i)
  })
})

// ── (c) double failure → fallback ────────────────────────────────────────────

describe('generateStaffLLM — unparseable twice', () => {
  it('falls back to the offline planner with a note', async () => {
    stubFetchSequence('no json here', 'still no json')
    const stages: StaffingStage[] = []
    const result = await generateStaffLLM('two support agents', { providerId: 'kimi', apiKey: 'sk-test' }, (s) =>
      stages.push(s),
    )
    expect(result.source).toBe('fallback')
    expect(result.note).toBe('planner returned unparseable JSON — used offline planner')
    expect(result.employees).toHaveLength(2) // heuristic planner still honors the ask
    expect(stages.some((s) => s.status === 'error')).toBe(true)
    expect(stages.at(-1)?.key).toBe('done')
  })
})

// ── (d) HTTP error → fallback ────────────────────────────────────────────────

describe('generateStaffLLM — HTTP failure', () => {
  it('falls back with a readable note on 401 and never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => completionResponse('', 401)),
    )
    const result = await generateStaffLLM('a support agent', { providerId: 'kimi', apiKey: 'sk-bad' })
    expect(result.source).toBe('fallback')
    expect(result.note).toContain('401')
    expect(result.note).toContain('used offline planner')
    expect(result.employees.length).toBeGreaterThan(0)
  })

  it('falls back when fetch rejects (network down)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const result = await generateStaffLLM('a support agent', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.source).toBe('fallback')
    expect(result.note).toContain('fetch failed')
  })
})

// ── (e) NO_KEY ───────────────────────────────────────────────────────────────

describe('generateStaffLLM — missing key', () => {
  it('throws a typed StaffingError(NO_KEY) for key-required providers without calling fetch', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    await expect(generateStaffLLM('a team', { providerId: 'kimi' })).rejects.toThrow(StaffingError)
    await expect(generateStaffLLM('a team', { providerId: 'kimi', apiKey: '   ' })).rejects.toMatchObject({
      code: 'NO_KEY',
    })
    expect(mock).not.toHaveBeenCalled()
  })
})

// ── (f) keyless provider ─────────────────────────────────────────────────────

describe('generateStaffLLM — keyless provider', () => {
  it('works without an api key for ollama', async () => {
    const calls = stubFetchSequence(plannerJson([rawEmployee({ name: 'Ola', role: 'Generalist' })]))
    const result = await generateStaffLLM('someone to help out', { providerId: 'ollama' })
    expect(result.source).toBe('llm')
    expect(result.employees).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions')
    // ollama is not fixedParams → temperature allowed
    expect('temperature' in calls[0].body).toBe(true)
  })
})

// ── (g) headcount shortfall topped up ────────────────────────────────────────

describe('generateStaffLLM — headcount enforcement', () => {
  it('tops up from the heuristic planner when the LLM returns too few', async () => {
    stubFetchSequence(plannerJson([rawEmployee({ name: 'Mara' }), rawEmployee({ name: 'Jonas' })]))
    const result = await generateStaffLLM('hire 3 support agents', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.source).toBe('llm')
    expect(result.employees).toHaveLength(3)
    const names = result.employees.map((e) => e.name)
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3)
    expect(result.employees.every((e) => e.id.startsWith('emp-'))).toBe(true)
  })

  // ── (h) over-cap trimmed ─────────────────────────────────────────────────
  it('trims an over-eager planner to MAX_HIRES', async () => {
    const many = Array.from({ length: 9 }, (_, i) => rawEmployee({ name: `Person${i}`, role: `Role ${i}` }))
    stubFetchSequence(plannerJson(many))
    const result = await generateStaffLLM('build me a staffing agency', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.employees).toHaveLength(MAX_HIRES)
    expect(new Set(result.employees.map((e) => e.accent)).size).toBe(MAX_HIRES) // palette cycles cleanly to 6
  })

  it('trims to the explicit count when the planner returns too many', async () => {
    const many = Array.from({ length: 4 }, (_, i) => rawEmployee({ name: `Agent${i}`, role: `Support ${i}` }))
    stubFetchSequence(plannerJson(many))
    const result = await generateStaffLLM('hire 2 support agents', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.employees).toHaveLength(2)
  })

  it('falls back entirely when the planner returns zero usable employees', async () => {
    stubFetchSequence(plannerJson([{ name: '', role: '' }, { name: '  ' }]))
    const result = await generateStaffLLM('a support agent', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.source).toBe('fallback')
    expect(result.note).toContain('no usable employees')
  })
})

// ── planWorkforce ────────────────────────────────────────────────────────────

describe('planWorkforce', () => {
  it('uses the offline planner with a note when no brain is given', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    const stages: StaffingStage[] = []
    const result = await planWorkforce('two support agents', null, (s) => stages.push(s))
    expect(result.source).toBe('fallback')
    expect(result.note).toBe('offline planner (no API key)')
    expect(result.employees).toHaveLength(2)
    expect(stages[0].label).toContain('Offline planner')
    expect(mock).not.toHaveBeenCalled()
  })

  it('uses the offline planner when the brain has no key for a key-required provider', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    const result = await planWorkforce('a coder', { providerId: 'openai' })
    expect(result.source).toBe('fallback')
    expect(mock).not.toHaveBeenCalled()
  })

  it('uses the LLM path when the brain has a key', async () => {
    stubFetchSequence(plannerJson([rawEmployee()]))
    const result = await planWorkforce('a support agent', { providerId: 'kimi', apiKey: 'sk-test' })
    expect(result.source).toBe('llm')
  })

  it('uses the LLM path for a keyless provider without a key', async () => {
    stubFetchSequence(plannerJson([rawEmployee()]))
    const result = await planWorkforce('a support agent', { providerId: 'ollama' })
    expect(result.source).toBe('llm')
  })
})

// ── pure helpers ─────────────────────────────────────────────────────────────

describe('extractJson', () => {
  it('handles fences, prose around the object, and bare JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here you go: {"a":2} — done')).toEqual({ a: 2 })
    expect(extractJson('{"a":3}')).toEqual({ a: 3 })
  })
  it('throws on non-JSON', () => {
    expect(() => extractJson('no object at all')).toThrow()
  })
})

describe('explicitHeadcount', () => {
  it('reads explicit counts and ignores vague prompts', () => {
    expect(explicitHeadcount('hire 3 support agents')).toBe(3)
    expect(explicitHeadcount('team of 4')).toBe(4)
    expect(explicitHeadcount('two agents')).toBe(2)
    expect(explicitHeadcount('a coder')).toBeNull()
    expect(explicitHeadcount('build me a team')).toBeNull()
    expect(explicitHeadcount('hire 99 people')).toBe(MAX_HIRES)
  })
})

describe('normalizeEmployees', () => {
  it('synthesizes a prompt when the planner leaves it empty', () => {
    const [e] = normalizeEmployees({ employees: [rawEmployee({ prompt: '  ' })] }, 'a support agent')
    expect(e.prompt.length).toBeGreaterThan(0)
    expect(e.prompt).toContain("I'm not sure")
  })
})
