import { describe, expect, it } from 'vitest'
import { SOPS, mergeAcceptance, renderSop, sopById, sopFor } from './sop'
import type { WorkerKind } from '../task-ledger'

const ALL_KINDS: WorkerKind[] = [
  'planner', 'research', 'browser', 'code', 'analyst', 'writer', 'reviewer', 'tester',
]

describe('SOP catalog', () => {
  it('keeps ids unique', () => {
    const ids = SOPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every SOP steps, outputs and failure conditions', () => {
    for (const sop of SOPS) {
      expect(sop.process.length, sop.id).toBeGreaterThan(0)
      expect(sop.expectedOutputs.length, sop.id).toBeGreaterThan(0)
      expect(sop.failureConditions.length, sop.id).toBeGreaterThan(0)
    }
  })

  it('carries binding acceptance criteria, not just prose', () => {
    // An SOP whose acceptance is empty is a style guide. The point of this
    // system is that the procedure and the definition of done travel together.
    for (const sop of SOPS) {
      expect(Object.keys(sop.acceptance).length, sop.id).toBeGreaterThan(0)
    }
  })

  it('covers the worker kinds that produce artifacts', () => {
    // 'planner' produces no artifacts of its own, so it needs no procedure.
    for (const kind of ALL_KINDS.filter((k) => k !== 'planner')) {
      expect(sopFor(kind), `no SOP for ${kind}`).toBeDefined()
    }
  })

  it('assigns each worker kind at most one SOP', () => {
    for (const kind of ALL_KINDS) {
      const matches = SOPS.filter((s) => s.appliesTo.includes(kind))
      expect(matches.length, kind).toBeLessThanOrEqual(1)
    }
  })

  it('finds an SOP by id', () => {
    expect(sopById('deep-research')?.name).toBe('Deep Research')
    expect(sopById('nope')).toBeUndefined()
  })
})

describe('mergeAcceptance', () => {
  const sop = sopById('deep-research')!

  it('returns the task criteria untouched when there is no SOP', () => {
    expect(mergeAcceptance(undefined, { minSources: 2 })).toEqual({ minSources: 2 })
  })

  it('supplies the SOP criteria when the task declared none', () => {
    expect(mergeAcceptance(sop, undefined)?.minSources).toBe(3)
  })

  it('lets a stricter task requirement win', () => {
    // A planner that asked for 8 sources meant it; an SOP floor of 3 must not
    // quietly relax that.
    expect(mergeAcceptance(sop, { minSources: 8 })?.minSources).toBe(8)
  })

  it('raises a laxer task requirement to the SOP floor', () => {
    expect(mergeAcceptance(sop, { minSources: 1 })?.minSources).toBe(3)
  })

  it('unions mustInclude rather than replacing it', () => {
    const verify = sopById('verify-work')!
    const merged = mergeAcceptance(verify, { mustInclude: ['exitCode'] })
    expect(merged?.mustInclude).toContain('passed')
    expect(merged?.mustInclude).toContain('exitCode')
  })

  it('merges minArrayLength keys from both sides', () => {
    const merged = mergeAcceptance(sop, { minArrayLength: { competitors: 8 } })
    expect(merged?.minArrayLength?.competitors).toBe(8)
  })

  it('leaves absent numeric criteria undefined rather than zero', () => {
    // A 0 floor would read as "a criterion exists and is trivially met".
    const merged = mergeAcceptance(sopById('write-deliverable')!, {})
    expect(merged?.minSources).toBeUndefined()
  })
})

describe('renderSop', () => {
  it('numbers the steps', () => {
    const text = renderSop(sopById('deep-research')!)
    expect(text).toContain('1. ')
    expect(text).toContain('2. ')
  })

  it('includes the failure conditions as stop instructions', () => {
    expect(renderSop(sopById('browser-research')!)).toMatch(/Stop and report BLOCKED if/i)
  })

  it('omits rationales, which are maintenance notes not instructions', () => {
    const sop = sopById('deep-research')!
    const rationale = sop.process.find((s) => s.rationale)?.rationale
    expect(rationale).toBeTruthy()
    expect(renderSop(sop)).not.toContain(rationale!)
  })

  it('renders every step text', () => {
    for (const sop of SOPS) {
      const text = renderSop(sop)
      for (const step of sop.process) expect(text, `${sop.id}: ${step.text}`).toContain(step.text)
    }
  })
})
