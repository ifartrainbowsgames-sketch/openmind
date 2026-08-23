/**
 * What a finished run should be called.
 *
 * The rule used to be `needs_user ? 'needs_user' : 'completed'`, which never
 * looked at failures at all. A run whose every task failed was written to the
 * ledger as **completed**, with a null error and an answer string whose body
 * was a list of ✗ markers. The UI renders a completed run by printing its
 * answer, so the customer saw prose where they should have seen a failure.
 *
 * That is the exact shape of bug the rest of this system is built to refuse:
 * not work that breaks, but work that breaks and reports success. A model id
 * that does not exist produced it — every task failed on `model_not_found`,
 * and the run said completed.
 *
 * A pure function in its own module because worker/index.ts creates a Supabase
 * client and calls main() at import time, so nothing there can be tested.
 */

export type TerminalStatus = 'completed' | 'failed' | 'needs_user'

export interface TaskOutcome {
  status: string
  goal?: string
}

export interface TerminalDecision {
  status: TerminalStatus
  error: string | null
}

export function terminalStatus(tasks: readonly TaskOutcome[]): TerminalDecision {
  // Someone can unblock a waiting run, so that outranks everything: reporting
  // it as failed would throw away work that is still recoverable.
  if (tasks.some((t) => t.status === 'needs_user')) return { status: 'needs_user', error: null }

  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked')
  const succeeded = tasks.filter((t) => t.status === 'completed')

  // Nothing succeeded and something failed: the run did not do the work.
  if (failed.length > 0 && succeeded.length === 0) {
    const first = failed[0]?.goal
    return {
      status: 'failed',
      error: `${failed.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'} failed`
        + (first ? ` — first: ${first.slice(0, 160)}` : ''),
    }
  }

  // Partial success stays `completed`, deliberately. There IS output, the
  // snapshot carries every task's real status, and the answer already marks
  // failures with ✗ — calling a mostly-successful run "failed" would be its
  // own kind of dishonesty. The line worth defending is that a run which
  // achieved nothing must never be called completed.
  return { status: 'completed', error: null }
}
