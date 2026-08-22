import { describe, expect, it } from 'vitest'
import {
  SPECIALISTS, activeSpecialists, requiredSkills, specialistById,
  specialistForWorker, specialistsForCapabilities,
} from './specialists'
import { SOPS, activeSkills, sopById } from './sop'
import { WORKER_CAPABILITIES } from './capabilities'
import type { WorkerKind } from '../task-ledger'
import { splitByEligibility } from './eligibility'

/**
 * H1: the registry defines and finds. It never chooses.
 *
 * The tests that matter here are the negative ones — a specialist that named a
 * model would pre-empt every decision the router exists to make, and would do
 * it silently.
 */

const WORKER_KINDS = Object.keys(WORKER_CAPABILITIES) as WorkerKind[]

describe('every built-in worker kind survived the migration', () => {
  it('has a specialist', () => {
    for (const kind of WORKER_KINDS) {
      expect(specialistForWorker(kind), kind).toBeDefined()
    }
  })

  it('carries the same capabilities, rather than a restated copy', () => {
    // Restating them would let the two drift, and a specialist claiming a
    // capability its worker has no tool for makes the scheduler confident and
    // wrong.
    for (const kind of WORKER_KINDS) {
      expect(specialistForWorker(kind)?.capabilities, kind).toEqual(WORKER_CAPABILITIES[kind])
    }
  })

  it('has a unique id and is active', () => {
    const ids = SPECIALISTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(activeSpecialists()).toHaveLength(SPECIALISTS.length)
  })
})

// ── The separation ──────────────────────────────────────────────────────────

const sources = import.meta.glob('/src/lib/workforce/specialists.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

describe('a specialist describes expertise, never software', () => {
  it('names no model, runtime or provider', () => {
    // The load-bearing negative. `model = Claude` inside a specialist would
    // decide the routing question before the router ever ran, and nothing else
    // in the system would notice.
    for (const specialist of SPECIALISTS) {
      const json = JSON.stringify(specialist).toLowerCase()
      for (const forbidden of [
        'claude', 'anthropic', 'openai', 'gpt-', 'gemini', 'kimi', 'moonshot',
        'deepseek', 'claude-code', 'codex', 'e2b', 'browserless',
      ]) {
        expect(json, `${specialist.id} names ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('and the module itself does not either', () => {
    // Belt and braces: a comment or a default could name one where the data
    // does not.
    const text = sources['/src/lib/workforce/specialists.ts']
    expect(text).toBeDefined()
    const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    expect(code.toLowerCase()).not.toMatch(/\b(anthropic|openai|gemini|kimi|deepseek)\b/)
  })

  it('expresses model needs as capabilities, not as a name', () => {
    const engineer = specialistById('engineer')
    expect(engineer?.model?.requiredCapabilities).toContain('tools')
    // 'tools' is a property a model either has or lacks. 'Claude' is a purchase
    // decision.
    expect(JSON.stringify(engineer?.model)).not.toMatch(/claude|gpt|gemini/i)
  })

  it('treats runtime preference as a hint, never a constraint', () => {
    const engineer = specialistById('engineer')
    expect(engineer?.execution.prefers).toContain('workspace')
    // A preference names a shape of environment, not a product.
    expect(engineer?.execution.prefers).not.toContain('claude-code')
  })
})

// ── Discovery ───────────────────────────────────────────────────────────────

describe('discovery narrows by what is possible', () => {
  it('finds the specialists that can do the work', () => {
    const coders = specialistsForCapabilities(['code.write', 'filesystem.write'])
    expect(coders.map((s) => s.id)).toContain('engineer')
    expect(coders.map((s) => s.id)).not.toContain('writer')
  })

  it('returns nothing when nothing qualifies, rather than the closest match', () => {
    // The closest match is how a task ends up somewhere it cannot succeed.
    expect(specialistsForCapabilities(['browser.act', 'terminal.exec'])).toEqual([])
  })

  it('excludes a specialist that is not active', () => {
    const drafts = [{ ...SPECIALISTS[0], id: 'draft-one', status: 'draft' as const }]
    expect(specialistsForCapabilities([], drafts)).toEqual([])
  })
})

describe('skills a specialist depends on', () => {
  it('resolves every required skill for every specialist', () => {
    // A specialist pointing at a skill that does not exist would produce a
    // prompt missing its procedure, and nothing would report it.
    for (const specialist of SPECIALISTS) {
      const { missing } = requiredSkills(specialist)
      expect(missing, `${specialist.id} is missing ${missing.map((m) => m.skillId).join(', ')}`)
        .toEqual([])
    }
  })

  it('refuses to substitute a different version for a pinned one', () => {
    // Silently falling back would change a specialist's behaviour without its
    // definition changing.
    const pinned = { ...SPECIALISTS[3], skills: [{ skillId: 'build-feature', version: 99, required: true }] }
    const { resolved, missing } = requiredSkills(pinned)
    expect(resolved).toEqual([])
    expect(missing[0].version).toBe(99)
  })

  it('takes the active version when none is pinned', () => {
    const { resolved } = requiredSkills(SPECIALISTS[3])
    expect(resolved[0]?.id).toBe('build-feature')
    expect(resolved[0]?.version).toBe(1)
  })
})

describe('skills carry a version and a lifecycle', () => {
  it('every shipped skill is active and versioned', () => {
    expect(activeSkills()).toHaveLength(SOPS.length)
    for (const skill of SOPS) {
      expect(skill.version, skill.id).toBeGreaterThan(0)
      expect(skill.status, skill.id).toBe('active')
    }
  })

  it('only active skills reach a prompt', () => {
    // A candidate mutation leaking into a customer's run is the failure the
    // lifecycle exists to prevent.
    const withCandidate = [...SOPS, { ...SOPS[0], id: 'mutant', version: 2, parentVersion: 1, status: 'candidate' as const }]
    expect(activeSkills(withCandidate).map((s) => s.id)).not.toContain('mutant')
  })

  it('keeps the judge-enforced acceptance criteria', () => {
    // The reason a skill and an SOP are one object: this is already binding.
    expect(sopById('deep-research')?.acceptance.minSources).toBe(3)
  })
})

// ── Rule 1, at the specialist level ─────────────────────────────────────────

describe('eligibility still gates specialists', () => {
  it('a perfect specialist that cannot run is ABSENT, not ranked low', async () => {
    // The same claim as the runtime-level test, one layer up: a specialist
    // requiring terminal.exec, with an execution target that cannot run
    // commands, must not appear at all.
    const engineer = specialistById('engineer')!
    const split = await splitByEligibility(
      [{ id: engineer.id, skills: new Set(engineer.capabilities) }],
      { taskType: 'code', userId: 'u1' },
    )
    expect(split.eligible.map((c) => c.id)).toEqual(['engineer'])

    const browserOnly = await splitByEligibility(
      [{ id: 'browser-only', skills: new Set(['browser.navigate' as const]) }],
      { taskType: 'code', userId: 'u1' },
    )
    expect(browserOnly.eligible).toEqual([])
    expect(browserOnly.rejected[0].reasons.map((r) => r.kind)).toContain('missing_capability')
  })
})
