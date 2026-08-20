import { describe, expect, it } from 'vitest'
import {
  CONNECTION_IDS, CONNECTION_TOOLS, normalizeToolResult, reviewCode, runEmployee, simulatedBrain,
  type Employee,
} from './agent'

const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 't',
  name: 'Ada',
  role: 'Executive Assistant',
  prompt: 'Be helpful.',
  tools: ['search_docs', 'summarize'],
  connections: ['gmail', 'gcal', 'github'],
  accent: '#ff4d00',
  ...over,
})

describe('connection tools', () => {
  it('every connection has a callable tool that returns data', async () => {
    for (const id of CONNECTION_IDS) {
      const out = normalizeToolResult(await CONNECTION_TOOLS[id].run('status')).content
      expect(out.length, id).toBeGreaterThan(0)
    }
  })

  it('filters by query keywords', async () => {
    const out = normalizeToolResult(await CONNECTION_TOOLS.gmail.run('any refund emails?')).content
    expect(out.toLowerCase()).toContain('refund')
  })
})

describe('reviewCode', () => {
  it('flags smells', () => {
    const out = reviewCode('var x = 1\nif (x == 1) { console.log(x) } // TODO fix\neval("x")')
    expect(out).toContain('var')
    expect(out).toContain('==')
    expect(out).toContain('console')
    expect(out).toContain('TODO')
    expect(out).toContain('eval')
  })
  it('passes clean code', () => {
    expect(reviewCode('const add = (a, b) => a + b')).toContain('No issues found')
  })
})

describe('runEmployee with connections', () => {
  it('answers inbox questions through the gmail connection', async () => {
    const r = await runEmployee(simulatedBrain(), emp(), 'Any refund emails in my inbox?')
    expect(r.toolCalls.map((c) => c.tool)).toContain('gmail')
    expect(r.answer.toLowerCase()).toContain('refund')
  })

  it('checks the calendar through gcal', async () => {
    const r = await runEmployee(simulatedBrain(), emp(), 'What meetings are on my calendar today?')
    expect(r.toolCalls.map((c) => c.tool)).toContain('gcal')
    expect(r.answer).toContain('Sprint planning')
  })

  it('a coder reviews code via the code_review tool', async () => {
    const coder = emp({ tools: ['code_review'], connections: ['github'] })
    const r = await runEmployee(simulatedBrain(), coder, 'Review this code: var x = 1; if (x == 2) console.log(x)')
    expect(r.toolCalls.map((c) => c.tool)).toContain('code_review')
    expect(r.answer).toContain('var')
  })

  it('employees without a connection cannot use it', async () => {
    const noConns = emp({ connections: [] })
    const r = await runEmployee(simulatedBrain(), noConns, 'What is on my calendar?')
    expect(r.toolCalls.map((c) => c.tool)).not.toContain('gcal')
  })
})
