/**
 * Can this candidate legitimately execute this task, for this customer, now?
 *
 * That is the only question this file answers. It never asks which candidate is
 * best — the two must not blur, because they fail differently:
 *
 *   eligibility wrong  → work runs somewhere it cannot succeed, or is refused
 *                        when it could have run
 *   routing wrong      → work runs somewhere worse than it might have
 *
 * ## Why eligibility is a hard gate and never a prior
 *
 * A candidate with a thousand successes and no failures, whose provider
 * credential this customer does not hold, must have probability EXACTLY ZERO —
 * not a lower score. A prior can be overcome by evidence; a gate cannot. Wayland
 * samples over every arm with no eligibility filter at all, which is precisely
 * the mistake this file exists to avoid inheriting.
 *
 * ## Why reasons, not a boolean
 *
 * The same rejection has three audiences: the router excludes the candidate, the
 * UI explains what to fix, and the evidence records why an arm was absent. A
 * boolean serves the first and abandons the other two.
 */

import type { RuntimeCredentialRequirement } from './credentials'
import type { WorkerCapability } from './capabilities'
import { TASK_REQUIREMENTS } from './capabilities'
import type { WorkerKind } from '../task-ledger'

export type EligibilityReason =
  | { kind: 'missing_capability'; capability: WorkerCapability }
  | { kind: 'runtime_unavailable'; runtimeId: string; detail?: string }
  | { kind: 'missing_provider_credential'; providerId: string }
  | { kind: 'provider_unverified'; providerId: string; detail?: string }
  | { kind: 'permission_denied'; permission: string }
  | { kind: 'workspace_requirement'; requirement: string }

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reasons: EligibilityReason[] }

export const ELIGIBLE: EligibilityResult = { eligible: true }

/**
 * What we know about a customer's credential for one provider.
 *
 * Metadata only. The eligibility engine must never be able to see a key — it
 * runs in the orchestrator, and the orchestrator has no business holding one.
 *
 * `verification` is three-valued on purpose. A boolean `verified` would have to
 * report `false` for a key nobody has tested, which is a lie of a specific kind:
 * it makes "we have not checked" indistinguishable from "we checked and it does
 * not work". Those warrant different answers and different UI.
 */
export interface CredentialStatus {
  configured: boolean
  verification: 'verified' | 'failed' | 'unknown'
  /** Why verification failed, when it did. Never contains the key. */
  detail?: string
}

export interface CredentialDirectory {
  status(userId: string, providerId: string): Promise<CredentialStatus>
}

export const NO_CREDENTIALS: CredentialDirectory = {
  status: async () => ({ configured: false, verification: 'unknown' }),
}

/**
 * What an unverified-but-configured credential means.
 *
 * `allow` is the current default and it is a compromise, stated rather than
 * hidden: nothing verifies credentials yet, so requiring verification would make
 * every provider-dependent runtime ineligible for every customer. When
 * test-connection exists, unattended production runs should move to `refuse`.
 */
export type UnverifiedPolicy = 'allow' | 'refuse'

export interface EligibilityPolicy {
  unverified: UnverifiedPolicy
}

export const DEFAULT_POLICY: EligibilityPolicy = { unverified: 'allow' }

/** Anything that can be routed to. Runtimes today; specialists at Stage H. */
export interface EligibilityCandidate {
  id: string
  /** What it can do, in the shared vocabulary. */
  skills: ReadonlySet<WorkerCapability>
  /** Provider credentials it needs before it can run at all. */
  credentials?: readonly RuntimeCredentialRequirement[]
  /** Whether the thing itself is installed and answering. */
  available?: () => Promise<{ ok: boolean; reason?: string }>
}

export interface EligibilityInput {
  candidate: EligibilityCandidate
  taskType: WorkerKind
  /** Whose run this is. Without it, no credential can be resolved. */
  userId?: string
  credentials?: CredentialDirectory
  policy?: EligibilityPolicy
}

/**
 * Every reason a candidate is out, not just the first.
 *
 * Stopping at the first would tell a customer to connect Anthropic, and then —
 * after they had — that the runtime is not installed either. One round trip per
 * problem is a bad way to configure anything.
 */
export async function evaluateEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  const policy = input.policy ?? DEFAULT_POLICY
  const reasons: EligibilityReason[] = []

  // 1. Capability. The cheapest check and the hardest no.
  for (const capability of TASK_REQUIREMENTS[input.taskType]?.required ?? []) {
    if (!input.candidate.skills.has(capability)) {
      reasons.push({ kind: 'missing_capability', capability })
    }
  }

  // 2. Is the thing itself there?
  if (input.candidate.available) {
    const status = await input.candidate.available().catch((error: unknown) => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }))
    if (!status.ok) {
      reasons.push({ kind: 'runtime_unavailable', runtimeId: input.candidate.id, detail: status.reason })
    }
  }

  // 3. Does THIS customer hold the credentials it needs?
  for (const requirement of input.candidate.credentials ?? []) {
    if (!requirement.required) continue

    if (!input.userId || !input.credentials) {
      // No customer in scope means no credential can be resolved. Treating that
      // as eligible would let an unattended run reach for a key that belongs to
      // nobody.
      reasons.push({ kind: 'missing_provider_credential', providerId: requirement.provider })
      continue
    }

    const status = await input.credentials.status(input.userId, requirement.provider)
      .catch(() => ({ configured: false, verification: 'unknown' as const }))

    if (!status.configured) {
      reasons.push({ kind: 'missing_provider_credential', providerId: requirement.provider })
      continue
    }
    if (status.verification === 'failed') {
      // A row existing is not a working key. This is the difference between
      // "connected" and "works", and conflating them makes a card that says
      // Connected ✓ above a runtime that cannot authenticate.
      reasons.push({
        kind: 'provider_unverified',
        providerId: requirement.provider,
        detail: status.detail ?? 'the stored credential failed verification',
      })
      continue
    }
    if (status.verification === 'unknown' && policy.unverified === 'refuse') {
      reasons.push({
        kind: 'provider_unverified',
        providerId: requirement.provider,
        detail: 'this credential has not been tested yet',
      })
    }
  }

  return reasons.length ? { eligible: false, reasons } : ELIGIBLE
}

export interface EligibilitySplit<T extends EligibilityCandidate> {
  eligible: T[]
  rejected: Array<{ candidate: T; reasons: EligibilityReason[] }>
}

/**
 * The candidate set a router is allowed to sample from.
 *
 * Rejected candidates come back with their reasons rather than being dropped,
 * because "nothing was eligible" and "three things were eligible" need very
 * different messages, and both need to be recordable.
 */
export async function splitByEligibility<T extends EligibilityCandidate>(
  candidates: readonly T[],
  input: Omit<EligibilityInput, 'candidate'>,
): Promise<EligibilitySplit<T>> {
  const eligible: T[] = []
  const rejected: EligibilitySplit<T>['rejected'] = []

  for (const candidate of candidates) {
    const result = await evaluateEligibility({ ...input, candidate })
    if (result.eligible) eligible.push(candidate)
    else rejected.push({ candidate, reasons: result.reasons })
  }

  return { eligible, rejected }
}

// ── Presentation ────────────────────────────────────────────────────────────

/** One reason, in words a customer can act on. */
export function describeReason(reason: EligibilityReason): string {
  switch (reason.kind) {
    case 'missing_capability':
      return `cannot ${reason.capability}`
    case 'runtime_unavailable':
      return `${reason.runtimeId} is not available${reason.detail ? `: ${reason.detail}` : ''}`
    case 'missing_provider_credential': {
      const article = /^[aeiou]/i.test(reason.providerId) ? 'an' : 'a'
      return `needs ${article} ${reason.providerId} credential — connect one in Settings → AI Providers`
    }
    case 'provider_unverified':
      return `the ${reason.providerId} credential ${reason.detail ?? 'has not been verified'}`
    case 'permission_denied':
      return `not permitted: ${reason.permission}`
    case 'workspace_requirement':
      return `needs ${reason.requirement}`
  }
}

export function describeReasons(reasons: readonly EligibilityReason[]): string {
  return reasons.map(describeReason).join('; ')
}
