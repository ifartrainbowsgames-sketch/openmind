import { describe, expect, it } from 'vitest'
import { isTerminal, sanitizeOptions, TERMINAL_STATUSES, type RunOptions } from './run-queue'

describe('run status', () => {
  it('treats only finished states as terminal', () => {
    expect(isTerminal('queued')).toBe(false)
    expect(isTerminal('running')).toBe(false)
    for (const s of TERMINAL_STATUSES) expect(isTerminal(s), s).toBe(true)
  })
})

describe('sanitizeOptions', () => {
  it('keeps the non-secret run configuration', () => {
    const options: RunOptions = {
      skill: 'multitask',
      strictMode: true,
      workspace: {
        kind: 'github', slug: 'acme/app', branch: 'main', source: 'live', summary: 'repo',
      },
    }
    const out = sanitizeOptions(options)
    expect(out.skill).toBe('multitask')
    expect(out.strictMode).toBe(true)
    expect((out.workspace as { slug: string }).slug).toBe('acme/app')
  })

  it('never lets tool keys reach the queued row', () => {
    const out = sanitizeOptions({
      toolKeys: { tavily: 'tvly-secret', e2b: 'e2b-secret', browserless: 'bl-secret' },
    })
    expect(out.toolKeys).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('secret')
  })

  it('defaults strictMode to false rather than undefined', () => {
    expect(sanitizeOptions({}).strictMode).toBe(false)
  })

  it('passes runtimeId when set', () => {
    expect(sanitizeOptions({ runtimeId: 'claude-code' }).runtimeId).toBe('claude-code')
  })

  it('drops unknown fields instead of passing them through', () => {
    const out = sanitizeOptions({ apiKey: 'sk-leak', foo: 1 } as unknown as RunOptions)
    expect(JSON.stringify(out)).not.toContain('sk-leak')
    expect(Object.keys(out).sort()).toEqual(['skill', 'strictMode', 'workspace'])
  })
})
