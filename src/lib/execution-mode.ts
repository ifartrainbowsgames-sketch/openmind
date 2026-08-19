// ── Execution mode — demo vs strict ──────────────────────────────────────────
// Demo mode keeps the experience moving: a dead planner falls back to the
// offline one, a dead judge falls back to heuristics, an unconnected app falls
// back to canned data. That resilience is exactly what makes failure look like
// success, so a real run sets strict mode: no substitution, no quiet downgrade.
// Every degradation becomes an outcome instead of a plausible-looking result.

export type ExecutionMode = 'demo' | 'strict'

/**
 * Why work stopped. These are the only non-completed outcomes a strict run can
 * produce — anything that would have been silently patched over lands here.
 */
export type BlockReason =
  | 'capability_unavailable'
  | 'planner_unreachable'
  | 'judge_unavailable'
  | 'budget_exhausted'
  | 'no_matching_tool'
  | 'tool_error'
  | 'user_declined'

let mode: ExecutionMode = 'demo'

export function setExecutionMode(next: ExecutionMode): void {
  mode = next
}

export function getExecutionMode(): ExecutionMode {
  return mode
}

export function isStrict(): boolean {
  return mode === 'strict'
}

/** Run `fn` in a mode, restoring the previous one even if it throws. */
export async function withExecutionMode<T>(next: ExecutionMode, fn: () => Promise<T>): Promise<T> {
  const previous = mode
  mode = next
  try {
    return await fn()
  } finally {
    mode = previous
  }
}

/** Thrown when strict mode refuses to substitute for a missing capability. */
export class CapabilityBlockedError extends Error {
  readonly reason: BlockReason
  readonly capability: string

  constructor(reason: BlockReason, capability: string, detail?: string) {
    super(blockedMessage(reason, capability, detail))
    this.name = 'CapabilityBlockedError'
    this.reason = reason
    this.capability = capability
  }
}

/** The one wire format for a refusal — greppable, and never mistakable for data. */
export function blockedMessage(reason: BlockReason, capability: string, detail?: string): string {
  return `TASK_BLOCKED [${reason}] required capability "${capability}" unavailable${detail ? ` — ${detail}` : ''}`
}
