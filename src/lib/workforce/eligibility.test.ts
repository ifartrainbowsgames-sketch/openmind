import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY, describeReasons, evaluateEligibility, splitByEligibility,
  type CredentialDirectory, type CredentialStatus, type EligibilityCandidate,
} from './eligibility'
import { ALL_CAPABILITIES, type WorkerCapability } from './capabilities'
import { emptyArm, rebuildStats, type RoutingDecision, type RoutingObservation } from './routing-evidence'

/**
 * Eligibility answers "can this candidate legitimately execute this task for
 * this customer now". Routing answers "among eligible candidates, which".
 *
 * These tests exist to keep those from blurring, and the last one is the point
 * of the whole file: a candidate with a perfect record and no credential must
 * be at probability EXACTLY ZERO, not merely ranked low.
 */

const skills = (...ids: WorkerCapability[]) => new Set(ids)

const CODER: EligibilityCandidate = {
  id: 'claude-code',
  skills: skills('code.write', 'filesystem.write', 'filesystem.read', 'terminal.exec'),
  credentials: [{ provider: 'anthropic', required: true, reason: 'runs on your Anthropic account.' }],
}

function directory(byProvider: Record<string, CredentialStatus>): CredentialDirectory {
  return {
    status: async (_userId, providerId) =>
      byProvider[providerId] ?? { configured: false, verification: 'unknown' },
  }
}

const VERIFIED = directory({ anthropic: { configured: true, verification: 'verified' } })
const UNTESTED = directory({ anthropic: { configured: true, verification: 'unknown' } })
const BROKEN = directory({
  anthropic: { configured: true, verification: 'failed', detail: 'invalid api key' },
})
const NOTHING = directory({})

describe('capability is a hard gate', () => {
  it('admits a candidate that has what the task requires', async () => {
    const result = await evaluateEligibility({
      candidate: CODER, taskType: 'code', userId: 'u1', credentials: VERIFIED,
    })
    expect(result.eligible).toBe(true)
  })

  it('refuses one that does not, naming the capability', async () => {
    const chatOnly: EligibilityCandidate = { id: 'chat', skills: skills('writing.compose') }
    const result = await evaluateEligibility({ candidate: chatOnly, taskType: 'code' })
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reasons.map((r) => r.kind)).toContain('missing_capability')
      expect(describeReasons(result.reasons)).toContain('code.write')
    }
  })

  it('reports EVERY reason, not the first', async () => {
    // Otherwise a customer connects Anthropic, and is then told the runtime is
    // not installed either — one round trip per problem.
    const broken: EligibilityCandidate = {
      ...CODER,
      skills: skills('code.write'),
      available: async () => ({ ok: false, reason: 'not installed on this worker' }),
    }
    const result = await evaluateEligibility({
      candidate: broken, taskType: 'code', userId: 'u1', credentials: NOTHING,
    })
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reasons.map((r) => r.kind).sort()).toEqual([
        'missing_capability', 'missing_provider_credential', 'runtime_unavailable',
      ])
    }
  })
})

describe('configured is not the same as works', () => {
  it('admits a verified credential', async () => {
    const r = await evaluateEligibility({ candidate: CODER, taskType: 'code', userId: 'u1', credentials: VERIFIED })
    expect(r.eligible).toBe(true)
  })

  it('REFUSES a credential that failed verification, whatever the policy', async () => {
    // A row existing is not a working key. Conflating them produces a card
    // reading "Connected ✓" above a runtime that cannot authenticate.
    for (const unverified of ['allow', 'refuse'] as const) {
      const r = await evaluateEligibility({
        candidate: CODER, taskType: 'code', userId: 'u1', credentials: BROKEN,
        policy: { unverified },
      })
      expect(r.eligible, `policy=${unverified}`).toBe(false)
      if (!r.eligible) expect(r.reasons[0].kind).toBe('provider_unverified')
    }
  })

  it('treats an untested credential according to policy', async () => {
    // Three-valued on purpose: "we have not checked" is not "we checked and it
    // is broken", and a boolean would have to call them the same thing.
    const allowed = await evaluateEligibility({
      candidate: CODER, taskType: 'code', userId: 'u1', credentials: UNTESTED,
      policy: { unverified: 'allow' },
    })
    expect(allowed.eligible).toBe(true)

    const refused = await evaluateEligibility({
      candidate: CODER, taskType: 'code', userId: 'u1', credentials: UNTESTED,
      policy: { unverified: 'refuse' },
    })
    expect(refused.eligible).toBe(false)
  })

  it('refuses when no customer is in scope at all', async () => {
    // An unattended run with no owner must not reach for a key belonging to
    // nobody.
    const r = await evaluateEligibility({ candidate: CODER, taskType: 'code' })
    expect(r.eligible).toBe(false)
    if (!r.eligible) expect(r.reasons[0].kind).toBe('missing_provider_credential')
  })

  it('ignores an optional credential', async () => {
    const optional: EligibilityCandidate = {
      ...CODER,
      credentials: [{ provider: 'anthropic', required: false }],
    }
    const r = await evaluateEligibility({ candidate: optional, taskType: 'code', userId: 'u1', credentials: NOTHING })
    expect(r.eligible).toBe(true)
  })
})

describe('the candidate set a router may sample from', () => {
  it('separates eligible from rejected, keeping the reasons', async () => {
    const capable = { ...CODER, id: 'ready' }
    const uncredentialed = { ...CODER, id: 'no-key' }
    const split = await splitByEligibility([capable, uncredentialed], {
      taskType: 'code',
      userId: 'u1',
      credentials: {
        status: async (_u, p) => (p === 'anthropic' ? { configured: true, verification: 'verified' } : { configured: false, verification: 'unknown' }),
      },
    })
    // Both need Anthropic and both get it here, so widen the test: one loses
    // its capability instead.
    expect(split.eligible.map((c) => c.id)).toEqual(['ready', 'no-key'])

    const narrowed = await splitByEligibility(
      [capable, { ...uncredentialed, skills: skills('writing.compose') }],
      { taskType: 'code', userId: 'u1', credentials: VERIFIED },
    )
    expect(narrowed.eligible.map((c) => c.id)).toEqual(['ready'])
    expect(narrowed.rejected[0].reasons[0].kind).toBe('missing_capability')
  })

  it('can return nothing eligible, which is a different answer from an error', async () => {
    const split = await splitByEligibility([CODER], { taskType: 'code', userId: 'u1', credentials: NOTHING })
    expect(split.eligible).toEqual([])
    expect(split.rejected).toHaveLength(1)
  })
})

// ── Rule 1 ──────────────────────────────────────────────────────────────────

describe('eligibility is a gate, never a prior', () => {
  it('gives a PERFECT candidate with no credential probability exactly zero', async () => {
    // The load-bearing claim of the whole stage.
    //
    // Build a candidate with an unbeatable record — 999 successes, no failures,
    // a posterior that would win every Thompson draw — and withhold this
    // customer's credential. It must not appear in the set at all. A prior can
    // be overcome by evidence; a gate cannot, and that is the difference.
    const decisions: RoutingDecision[] = Array.from({ length: 999 }, (_, i) => ({
      id: `d${i}`, userId: 'u1', decisionType: 'runtime', scope: 'code',
      chosenCandidateId: 'claude-code', candidateSet: ['claude-code', 'builtin'],
      contextFeatures: {}, policy: 'default', createdAt: i,
    }))
    const observations: RoutingObservation[] = decisions.map((d, i) => ({
      id: `o${i}`, decisionId: d.id, userId: 'u1', outcome: 'success', metrics: {}, createdAt: i,
    }))

    const stats = rebuildStats(decisions, observations)
    const arm = stats.find((s) => s.candidateId === 'claude-code') ?? emptyArm('code', 'runtime', 'claude-code')
    // Beta(1000, 1) — it would beat anything.
    expect(arm.successes).toBe(999)
    expect(arm.failures).toBe(0)

    const split = await splitByEligibility([CODER], {
      taskType: 'code', userId: 'customer-without-anthropic', credentials: NOTHING,
    })

    // Not ranked low. Absent.
    expect(split.eligible).toEqual([])
    expect(split.eligible.some((c) => c.id === 'claude-code')).toBe(false)
    // And any sampler drawing from an empty set cannot return it, whatever its
    // posterior says.
    expect(split.rejected[0].reasons[0]).toMatchObject({
      kind: 'missing_provider_credential', providerId: 'anthropic',
    })
  })

  it('admits the same candidate the moment the credential appears', async () => {
    // The other half: the gate is about the credential, not about the
    // candidate. Nothing else changed between these two calls.
    const before = await splitByEligibility([CODER], { taskType: 'code', userId: 'u1', credentials: NOTHING })
    const after = await splitByEligibility([CODER], { taskType: 'code', userId: 'u1', credentials: VERIFIED })
    expect(before.eligible).toEqual([])
    expect(after.eligible.map((c) => c.id)).toEqual(['claude-code'])
  })
})

describe('the default policy is stated, not hidden', () => {
  it('allows untested credentials for now', () => {
    // A compromise with a reason: nothing verifies credentials yet, so
    // requiring verification would make every provider-dependent runtime
    // ineligible for every customer. When test-connection ships, unattended
    // production runs should move to 'refuse'.
    expect(DEFAULT_POLICY.unverified).toBe('allow')
  })

  it('has a capability vocabulary large enough to describe a runtime', () => {
    expect(ALL_CAPABILITIES.length).toBeGreaterThan(10)
  })
})
