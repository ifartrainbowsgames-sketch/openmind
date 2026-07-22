import { describe, expect, it } from 'vitest'
import {
  calc,
  parsePlan,
  runEmployee,
  simulatedBrain,
  TOOL_REGISTRY,
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

  it('caps at 4 steps', () => {
    const raw = Array(8).fill('TOOL: calculator | 1+1').join('\n')
    expect(parsePlan(raw, ['calculator'])).toHaveLength(4)
  })

  it('returns empty for NONE', () => {
    expect(parsePlan('NONE', ['calculator'])).toEqual([])
  })
})

describe('tool registry', () => {
  it('search_docs finds OpenMind facts', () => {
    expect(TOOL_REGISTRY.search_docs.run('How much is the Pro plan?')).toMatch(/\$?10|ten dollars/i)
  })
  it('sentiment scores feedback', () => {
    expect(TOOL_REGISTRY.sentiment.run('I love it, excellent work')).toMatch(/Positive/)
  })
  it('summarize condenses text', () => {
    const t = 'Cats are mammals. Cats sleep most of the day. The weather is nice. Cats hunt mice.'
    expect(TOOL_REGISTRY.summarize.run(t).length).toBeLessThan(t.length)
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
    expect(r.answer).toContain('Ada')
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

  it('carries the owner prompt into the answer', async () => {
    const r = await runEmployee(simulatedBrain(), emp({ prompt: 'Always reply like a pirate.' }), 'Ahoy, what is 2+2?')
    expect(r.answer).toContain('pirate')
  })
})
