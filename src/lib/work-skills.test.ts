import { describe, expect, it } from 'vitest'
import { draftBusinessPlan } from './business-plan'
import { parseWebActInput } from './web-act'
import { invokeCrewTool } from './crew-tools'

describe('usable work skills', () => {
  it('structures a business instead of role theater', () => {
    const plan = draftBusinessPlan('Sell a Genspark-like Super Agent to small teams')
    expect(plan).toMatch(/14-day plan/i)
    expect(plan).toMatch(/Inbox/)
  })

  it('parses a chrome task', () => {
    const spec = parseWebActInput('{"url":"https://example.com/form","goal":"submit","steps":[{"click":"#go"}]}')
    expect(spec.url).toContain('example.com')
    expect(spec.steps[0]?.click).toBe('#go')
  })

  it('mocks inbox and chrome honestly in tests', async () => {
    await expect(invokeCrewTool('gmail_list', 'is:unread')).resolves.toMatch(/gmail_list/)
    await expect(invokeCrewTool('web_act', 'https://example.com')).resolves.toMatch(/web_act/)
  })
})
