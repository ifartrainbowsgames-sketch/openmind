import { describe, expect, it } from 'vitest'
import {
  GLOBAL_RULES, advisoryRules, defaultConstitution, enforcedRules,
  parseProjectRules, renderConstitution, withProjectRules,
} from './constitution'

describe('GLOBAL_RULES', () => {
  it('gives every rule a unique id and non-empty text', () => {
    const ids = GLOBAL_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of GLOBAL_RULES) expect(rule.text.trim(), rule.id).toBeTruthy()
  })

  it('names a real mechanism for every rule claiming enforcement', () => {
    // A rule that claims enforcement it does not have is worse than no rule:
    // it buys confidence nothing is backing. So `enforcedBy` must point at
    // something specific, not say "yes".
    for (const rule of enforcedRules(defaultConstitution())) {
      expect(rule.enforcedBy, rule.id).toMatch(/\.(ts)\)|agent-tools\)/)
    }
  })

  it('keeps genuinely advisory rules unmarked', () => {
    const advisory = advisoryRules(defaultConstitution())
    expect(advisory.map((r) => r.id)).toContain('no-invented-credentials')
    for (const rule of advisory) expect(rule.enforcedBy).toBeUndefined()
  })
})

describe('parseProjectRules', () => {
  it('reads one rule per line', () => {
    const rules = parseProjectRules('Use TypeScript strict mode\nNever push to main')
    expect(rules.map((r) => r.text)).toEqual(['Use TypeScript strict mode', 'Never push to main'])
  })

  it('ignores comments and blank lines', () => {
    const rules = parseProjectRules('# house rules\n\nUse pnpm\n\n  # trailing note\n')
    expect(rules.map((r) => r.text)).toEqual(['Use pnpm'])
  })

  it('strips list markers so a pasted markdown list works', () => {
    expect(parseProjectRules('- Use pnpm\n* Run tests').map((r) => r.text))
      .toEqual(['Use pnpm', 'Run tests'])
  })

  it('returns nothing for empty input rather than a phantom rule', () => {
    expect(parseProjectRules('')).toEqual([])
    expect(parseProjectRules('   \n  \n')).toEqual([])
  })

  it('marks parsed rules as project scope', () => {
    expect(parseProjectRules('Use pnpm')[0].scope).toBe('project')
  })
})

describe('renderConstitution', () => {
  it('states that rules override the role description', () => {
    // Ordering is the whole point: role personality used to be the only thing
    // in the system prompt, and it is the weakest signal in it.
    expect(renderConstitution(defaultConstitution())).toMatch(/override any instruction below/i)
  })

  it('marks enforced rules so attention goes to the ones without teeth', () => {
    const text = renderConstitution(defaultConstitution())
    expect(text).toContain('[enforced]')
    const enforcedCount = (text.match(/\[enforced\]/g) ?? []).length
    expect(enforcedCount).toBe(enforcedRules(defaultConstitution()).length)
  })

  it('includes project rules under their own heading', () => {
    const text = renderConstitution(withProjectRules('Never deploy on Friday'))
    expect(text).toContain('PROJECT RULES')
    expect(text).toContain('Never deploy on Friday')
  })

  it('omits the project section entirely when there are none', () => {
    expect(renderConstitution(defaultConstitution())).not.toContain('PROJECT RULES')
  })

  it('renders every rule, so none is silently dropped', () => {
    const text = renderConstitution(defaultConstitution())
    for (const rule of GLOBAL_RULES) expect(text, rule.id).toContain(rule.text)
  })

  it('produces empty output for an empty constitution', () => {
    expect(renderConstitution({ global: [], project: [] })).toBe('')
  })
})
