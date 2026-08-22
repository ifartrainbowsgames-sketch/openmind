/**
 * Who pays for what.
 *
 * The split is fixed, not a user choice:
 *
 *   Model    → the customer's key, entered in the settings console.
 *   Tools    → ours, held in Edge Function secrets and never seen by anyone.
 *
 * That is deliberate. Model tokens dominate run cost by an order of magnitude,
 * so the customer funds those directly at the provider's rate with no markup.
 * Search, scrape, sandbox and hosted Chrome are cheap and fixed, so we absorb
 * them and the customer never sees a tool key.
 *
 * The failure this replaced was the same split happening by ACCIDENT: tool
 * calls fell through to our credentials whenever a key was missing, including
 * for customers who thought they were funding their own runs. Deliberate and
 * accidental look identical in the logs; only one of them is billable.
 */

import type { MobileProviderConfig } from './mobile-provider'
import type { StoredKey } from './provider-vault'

/** Capabilities the platform supplies. The customer configures none of these. */
export const TOOL_CAPABILITIES = ['search', 'browse', 'sandbox', 'chrome'] as const
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number]

export const TOOL_META: Readonly<
  Record<ToolCapability, { label: string; blurb: string; freeFallback: string | null }>
> = {
  search: {
    label: 'Search',
    blurb: 'Tavily when configured, DuckDuckGo otherwise.',
    freeFallback: 'DuckDuckGo',
  },
  browse: {
    label: 'Browse',
    blurb: 'Firecrawl when configured, Jina Reader otherwise.',
    freeFallback: 'Jina Reader',
  },
  sandbox: {
    label: 'Code sandbox',
    blurb: 'A real machine per project, via E2B. No free equivalent.',
    freeFallback: null,
  },
  chrome: {
    label: 'Hosted Chrome',
    blurb: 'Drives a real browser for pages that need clicking. No free equivalent.',
    freeFallback: null,
  },
}

/** Model roles the customer can configure. */
export const MODEL_ROLE_META = [
  { role: 'worker', label: 'Worker', blurb: 'Runs every task in the plan.' },
  { role: 'planner', label: 'Planner', blurb: 'Splits the goal into tasks.' },
  { role: 'judge', label: 'Judge', blurb: 'Grades each task against its acceptance criteria.' },
] as const

export interface Readiness {
  /** False when no model key is reachable, which is the only hard blocker. */
  usable: boolean
  reason?: string
  /** True when the key backing this run lives in the vault rather than the browser. */
  viaVault: boolean
}

/**
 * Whether a run can start. Only the model matters here — tools are ours, so
 * their availability is a deployment question, not a customer one, and it is
 * answered by `agent-tools` at call time rather than guessed in the browser.
 */
export function describeReadiness(
  config: MobileProviderConfig,
  stored: StoredKey[],
  opts: { background: boolean },
): Readiness {
  // These three rules MIRROR credentialFor() in worker/credential-resolution.ts,
  // and the mirroring is the requirement, not a coincidence.
  //
  // This function's only job is to predict whether a run will find a
  // credential. If it is more permissive than the worker, it shows a green
  // "Ready" and the run then blocks — the badge lies. If it is stricter, it
  // nags a customer to add a key that would have worked. Either way the two
  // must be changed together.
  //
  // It used to ask for a row literally named `worker`. Once keys live under
  // provider ids that reported a customer with Anthropic and Grok connected as
  // having no key at all.
  const providers = new Set(stored.map((k) => k.providerId))
  const chosen = config.providerId

  const resolves =
    // 1. an explicit choice that is actually connected
    (Boolean(chosen) && providers.has(chosen))
    // 2. a legacy `worker` slot, for accounts predating connections
    || stored.some((k) => k.role === 'worker')
    // 3. exactly one connection, so there is nothing to be ambiguous about
    || providers.size === 1

  // Connected to several, and none of them is the one selected. The worker
  // will not choose on the customer's behalf — that spends their money at a
  // rate they did not pick — so say what actually needs doing.
  const ambiguous = !resolves && providers.size > 1
  const vaultReason = ambiguous
    ? 'Several providers are connected. Pick which one does the work under Models.'
    : 'Background runs need a provider connected on the server — a worker has no browser to read a key from.'

  if (opts.background) {
    // A worker process has no localStorage, so only the vault counts.
    return resolves
      ? { usable: true, viaVault: true }
      : { usable: false, viaVault: false, reason: vaultReason }
  }

  if (config.apiKey) return { usable: true, viaVault: false }
  return resolves
    ? { usable: true, viaVault: true }
    : {
        usable: false,
        viaVault: false,
        reason: ambiguous
          ? 'Several providers are connected. Pick which one does the work under Models.'
          : 'Add your model key to start a run.',
      }
}

export function summarise(readiness: Readiness): string {
  if (!readiness.usable) return readiness.reason ?? 'Not ready.'
  return readiness.viaVault
    ? 'Ready — using the key stored on the server.'
    : 'Ready — using the key held in this browser.'
}
