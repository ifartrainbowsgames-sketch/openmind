import { describe, expect, it } from 'vitest'
import {
  PLAN_PARSE_CEILING,
  TOOL_IDS,
  TOOL_REGISTRY,
  argsFromSchema,
  argumentsForSchema,
  calc,
  normalizeToolResult,
  parsePlan,
  parsePlannerOutput,
  parseStructuredPlan,
  runEmployee,
  simulatedBrain,
  type Employee,
  type TraceLine,
} from './agent'

const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 'test',
  name: 'Ada',
  role: 'Research Analyst',
  prompt: 'Answer with evidence and keep it short.',
  tools: ['search_docs', 'summarize', 'sentiment', 'calculator'],
  accent: '#ff4d00',
  ...over,
})

describe('calc', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(calc('2 + 3 * 4')).toBe('14')
    expect(calc('(2 + 3) * 4')).toBe('20')
    expect(calc('10 / 4')).toBe('2.5')
  })

  it('rejects anything that is not arithmetic', () => {
    expect(calc('process.exit()')).toMatch(/^error/)
    expect(calc('2; alert(1)')).toMatch(/^error/)
    expect(calc('abc')).toMatch(/^error/)
  })

  it('rejects non-finite results', () => {
    expect(calc('1/0')).toMatch(/^error/)
  })
})

describe('parsePlan', () => {
  it('parses TOOL lines and ignores noise', () => {
    const out = parsePlan('Sure!\nTOOL: calculator | 2+2\nblah blah\nTOOL: summarize | the text', ['calculator', 'summarize'])
    expect(out).toEqual([
      { tool: 'calculator', input: '2+2' },
      { tool: 'summarize', input: 'the text' },
    ])
  })

  it('drops tools the employee does not have', () => {
    expect(parsePlan('TOOL: sentiment | text', ['calculator'])).toEqual([])
  })

  it('caps at the parse ceiling, not the per-employee budget', () => {
    const raw = Array(30).fill('TOOL: calculator | 1+1').join('\n')
    expect(parsePlan(raw, ['calculator'])).toHaveLength(PLAN_PARSE_CEILING)
  })

  it('honours an explicit cap', () => {
    const raw = Array(8).fill('TOOL: calculator | 1+1').join('\n')
    expect(parsePlan(raw, ['calculator'], 2)).toHaveLength(2)
  })

  it('returns empty for NONE', () => {
    expect(parsePlan('NONE', ['calculator'])).toEqual([])
  })

  it('accepts real MCP ids and preserves their canonical casing', () => {
    expect(parsePlan(
      'TOOL: github__search-issues | open bugs\nTOOL: GitHub__Get_Issue_2 | 42',
      ['github__search-issues', 'GitHub__Get_Issue_2'],
    )).toEqual([
      { tool: 'github__search-issues', input: 'open bugs' },
      { tool: 'GitHub__Get_Issue_2', input: '42' },
    ])
  })
})

describe('MCP argument mapping', () => {
  it('uses required and common string fields from advertised schemas', () => {
    expect(argsFromSchema({ properties: { q: { type: 'string' } }, required: ['q'] }, 'refund')).toEqual({ q: 'refund' })
    expect(argsFromSchema({ properties: { limit: { type: 'number' } } }, 'refund')).toEqual({})
    expect(argsFromSchema(undefined, 'refund')).toEqual({ query: 'refund' })
  })

  it('parses structured plans with canonical tool ids and typed arguments', () => {
    const output = JSON.stringify({
      steps: [{
        tool: 'github__search-issues',
        input: 'Find open bugs',
        arguments: { query: 'is:issue is:open label:bug', limit: 10 },
      }],
    })
    expect(parseStructuredPlan(output, ['GitHub__Search-Issues'])).toEqual([{
      tool: 'GitHub__Search-Issues',
      input: 'Find open bugs',
      args: { query: 'is:issue is:open label:bug', limit: 10 },
    }])
  })

  it('accepts fenced JSON and falls back to legacy plans', () => {
    expect(parsePlannerOutput(
      '```json\n{"steps":[{"tool":"calculator","input":"2+2"}]}\n```',
      ['calculator'],
    )).toEqual([{ tool: 'calculator', input: '2+2' }])
    expect(parsePlannerOutput('TOOL: calculator | 2+2', ['calculator']))
      .toEqual([{ tool: 'calculator', input: '2+2' }])
  })

  it('validates complete multi-field arguments against tool schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
        state: { type: 'string' },
      },
      required: ['query', 'limit'],
    }
    expect(argumentsForSchema(schema, {
      query: 'bugs',
      limit: 5,
      state: 'open',
      unknown: 'drop me',
    }, 'fallback')).toEqual({ query: 'bugs', limit: 5, state: 'open' })
    expect(() => argumentsForSchema(schema, { query: 'bugs', limit: 'five' }, 'fallback'))
      .toThrow(/limit/)
  })
})

describe('tool registry', () => {
  it('includes code review in the exported tool id list', () => {
    expect(TOOL_IDS).toContain('code_review')
  })
  it('search_docs finds OpenMind facts', () => {
    expect(TOOL_REGISTRY.search_docs.run('How much is the Pro plan?')).toMatch(/\$?10|ten dollars/i)
  })
  it('sentiment scores feedback', () => {
    expect(TOOL_REGISTRY.sentiment.run('I love it, excellent work')).toMatch(/Positive/)
  })
  it('summarize condenses text', async () => {
    const t = 'Cats are mammals. Cats sleep most of the day. The weather is nice. Cats hunt mice.'
    const out = normalizeToolResult(await TOOL_REGISTRY.summarize.run(t)).content
    expect(out.length).toBeLessThan(t.length)
  })
})

describe('runEmployee (simulated brain, real LangGraph)', () => {
  it('routes math through the calculator node', async () => {
    const r = await runEmployee(simulatedBrain(), emp(), 'What is 12 * (3 + 4)?')
    expect(r.plan).toEqual([{ tool: 'calculator', input: '12 * (3 + 4)' }])
    expect(r.toolCalls[0].output).toBe('84')
    expect(r.answer).toContain('84')
    expect(r.trace.map((t) => t.node)).toEqual(['plan', 'act', 'respond'])
  })

  it('answers doc questions via search_docs', async () => {
    const r = await runEmployee(simulatedBrain(), emp(), 'How do I embed the widget?')
    expect(r.toolCalls.map((c) => c.tool)).toContain('search_docs')
    expect(r.answer.toLowerCase()).toContain('script')
  })

  it('chains multiple tools when the request needs both', async () => {
    const r = await runEmployee(simulatedBrain(), emp(), 'Summarize this feedback and check the sentiment: the app is great and fast. I love it.')
    expect(r.plan.map((p) => p.tool)).toEqual(expect.arrayContaining(['summarize', 'sentiment']))
    // two act visits, in order
    expect(r.trace.filter((t) => t.node === 'act')).toHaveLength(2)
  })

  it('answers directly when nothing matches', async () => {
    const r = await runEmployee(simulatedBrain(), emp(), 'Hello there!')
    expect(r.plan).toEqual([])
    expect(r.toolCalls).toEqual([])
    expect(r.trace.map((t) => t.node)).toEqual(['plan', 'respond'])
    // The simulated brain now names the employee and says why it used no
    // tools, which is more useful than a bare greeting.
    expect(r.answer).toMatch(/don't need tools for this one/i)
  })

  it('an employee with no tools always answers directly', async () => {
    const r = await runEmployee(simulatedBrain(), emp({ tools: [] }), 'What is 2+2?')
    expect(r.plan).toEqual([])
    expect(r.toolCalls).toEqual([])
  })

  it('streams trace lines in graph order', async () => {
    const seen: TraceLine[] = []
    await runEmployee(simulatedBrain(), emp(), 'What is 7 * 6?', (l) => seen.push(l))
    expect(seen.map((t) => t.node)).toEqual(['plan', 'act', 'respond'])
  })

  it('returns tool output in a compact crew-friendly voice', async () => {
    const r = await runEmployee(simulatedBrain(), emp({ prompt: 'Always reply like a pirate.' }), 'Ahoy, what is 2+2?')
    expect(r.answer).toMatch(/Calculator|4/)
  })

  it('routes GitHub workspace coding to github_write_file, not chat-only dumps', async () => {
    const prompt = 'Coding space: GitHub repo me/weather-app (default branch main). Use github_write_file.\n\nUser request:\nAdd a home screen'
    const r = await runEmployee(
      simulatedBrain(),
      emp({ tools: ['github_write_file', 'github_open_pr', 'code_review'] }),
      prompt,
    )
    expect(r.plan.map((p) => p.tool)).toContain('github_write_file')
    expect(r.plan.map((p) => p.tool)).not.toContain('github_create_branch')
    expect(r.plan.find((p) => p.tool === 'github_write_file')?.input).not.toMatch(/^Coding space:/)
    expect(r.toolCalls.find((c) => c.tool === 'github_write_file')?.output).toMatch(/\[MOCK · github_write_file\]/)
    expect(r.toolCalls.find((c) => c.tool === 'github_write_file')?.output).not.toMatch(/Coding space/)
  })

  it('parses a github_write_file plan line', () => {
    const out = parsePlan(
      'TOOL: github_write_file | {"path":"src/a.ts","message":"add","content":"x"}',
      ['github_write_file'],
    )
    expect(out).toEqual([{ tool: 'github_write_file', input: '{"path":"src/a.ts","message":"add","content":"x"}' }])
  })
})
