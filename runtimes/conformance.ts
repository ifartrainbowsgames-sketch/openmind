/**
 * The contract every AgentRuntime must prove.
 *
 * Claude Code was the first external runtime, and writing it turned up three
 * silent-success bugs that unit tests could not have found: a prompt truncated
 * by shell quoting, a CLI exiting 0 with no result reported as `completed`, and
 * a permission denial arriving alongside `subtype: "success"`. None of those
 * were failures of the adapter's logic. They were failures of the claim.
 *
 * So this file is deliberately a *checklist of claims*, not a test file. Each
 * entry names what must be true and how a runtime demonstrates it. Codex,
 * Wayland Core and OpenHands each have to pass the same list, and adding a
 * runtime means filling this in rather than inventing a new set of assurances.
 *
 * Gates marked `live` cannot be satisfied by a fake. A mock runtime that
 * returns `{ outcome: 'completed' }` proves that the orchestrator handles the
 * happy path; it proves nothing about the provider.
 */

export type ConformanceGate =
  | 'availability'
  | 'session-creation'
  | 'session-resume'
  | 'workspace-identity'
  | 'task-context-memory'
  | 'live-events'
  | 'cancellation'
  | 'terminal-result'
  | 'no-result-is-failure'
  | 'permission-waiting'
  | 'artifact-return'
  | 'restart-recovery'

export interface GateSpec {
  gate: ConformanceGate
  /** What must be TRUE. Written as a claim, not as a procedure. */
  claim: string
  /**
   * Why a passing call is not enough. Every one of these describes a way the
   * system could report success while being wrong — which is the only kind of
   * bug this suite has ever caught.
   */
  falsePositive: string
  /** Must be exercised against the real provider, not a stand-in. */
  live: boolean
}

export const CONFORMANCE_GATES: readonly GateSpec[] = [
  {
    gate: 'availability',
    claim: 'The runtime reports whether it can run, distinctly from what it can do.',
    falsePositive:
      'A runtime that is registered is assumed installed. A worker deployed without '
      + 'the binary would accept every selected run and fail each one mid-task.',
    live: true,
  },
  {
    gate: 'session-creation',
    claim: 'A session is created with a scope, a provider and a workspace.',
    falsePositive:
      'A session object exists in memory and was never written anywhere, so it '
      + 'survives exactly as long as the process.',
    live: false,
  },
  {
    gate: 'session-resume',
    claim:
      'A NEW OS PROCESS resumes the same session, including the provider\'s own '
      + 'session id where the provider has one.',
    falsePositive:
      'Resumption tested in one process proves the repository is wired, not that '
      + 'anything is durable — the in-memory map answers every read.',
    live: true,
  },
  {
    gate: 'workspace-identity',
    claim:
      'The workspace is verified to be the same one, not merely reachable.',
    falsePositive:
      'THE ONE THAT ACTUALLY HAPPENED: a backend provisions a fresh sandbox when '
      + 'the id it is given no longer exists and returns exit 0. The probe passes '
      + 'from a machine holding none of the previous work. Compare the resource '
      + 'that SERVED the call against the one that was ASKED for.',
    live: true,
  },
  {
    gate: 'task-context-memory',
    claim:
      "OpenMind's canonical memory reaches the provider and shapes its output.",
    falsePositive:
      'Asserting the prompt string contains the memory proves the string was '
      + 'built. Put a fact in memory that the provider has no other way to know, '
      + 'and look for it in what the provider actually produced.',
    live: true,
  },
  {
    gate: 'live-events',
    claim: 'Events are emitted while work happens, not replayed after it.',
    falsePositive:
      'Collecting events and yielding them at the end typechecks, passes every '
      + 'assertion about their content, and leaves a long task looking hung.',
    live: false,
  },
  {
    gate: 'cancellation',
    claim: 'Cancelling stops the provider, not just the stream reading it.',
    falsePositive:
      'A flag checked between tasks looks like cancellation until you notice the '
      + 'install it started is still running against a machine nobody is waiting on.',
    live: true,
  },
  {
    gate: 'terminal-result',
    claim: 'A completed task carries an explicit terminal result from the provider.',
    falsePositive:
      'Absent failure is treated as success. See the next gate — they are the '
      + 'same bug from opposite sides.',
    live: true,
  },
  {
    gate: 'no-result-is-failure',
    claim:
      'A provider process exiting successfully is NOT sufficient evidence that '
      + 'the task completed. No terminal result means failed.',
    falsePositive:
      'THE ONE THAT ACTUALLY HAPPENED: a mis-spawned CLI exited 0 having emitted '
      + 'nothing, and the runtime reported completed. Exit codes describe '
      + 'processes; outcomes describe work.',
    live: true,
  },
  {
    gate: 'permission-waiting',
    claim:
      'A provider blocked on an approval becomes needs_user, all the way to the '
      + 'run row, carrying what it asked for.',
    falsePositive:
      'THE ONE THAT ACTUALLY HAPPENED: Claude Code reports permission_denials '
      + 'alongside subtype "success". A task that could not do its job because it '
      + 'needed approval reads as completed.',
    live: true,
  },
  {
    gate: 'artifact-return',
    claim: 'Files are read back from the workspace, not from the provider\'s prose.',
    falsePositive:
      '"I created report.md" is a sentence. The ledger stored it and the judge '
      + 'counted it, and no such file existed.',
    live: true,
  },
  {
    gate: 'restart-recovery',
    claim:
      'A workspace that is gone is reported lost, never replaced by an empty one '
      + 'presented as the same session.',
    falsePositive:
      'A new empty sandbox runs perfectly. The first thing a resumed task does is '
      + 'assume its files are there.',
    live: true,
  },
]

/** A runtime's declared coverage, so gaps are visible rather than absent. */
export interface ConformanceReport {
  runtimeId: string
  /** Gates proven, and where. A gate with no evidence is not proven. */
  evidence: Partial<Record<ConformanceGate, string>>
}

export function missingGates(report: ConformanceReport): ConformanceGate[] {
  return CONFORMANCE_GATES
    .map((spec) => spec.gate)
    .filter((gate) => !report.evidence[gate])
}

/**
 * Claude Code's coverage. Each entry names the file that proves the gate, so a
 * claim here can be checked rather than believed.
 */
export const CLAUDE_CODE_CONFORMANCE: ConformanceReport = {
  runtimeId: 'claude-code',
  evidence: {
    availability: 'scripts/verify-claude-code.ts — missing phase',
    'session-creation': 'scripts/verify-claude-code.ts — write phase',
    'session-resume': 'scripts/verify-claude-code.ts — resume phase, separate OS process',
    'workspace-identity': 'scripts/verify-claude-code.ts — recovery=resumed on both phases',
    'task-context-memory': 'scripts/verify-claude-code.ts — codeword reaches the file on disk',
    'live-events': 'scripts/verify-claude-code.ts — thinking/tools observed before task_finished',
    cancellation: 'scripts/verify-claude-code.ts — cancel phase',
    'terminal-result': 'runtimes/claude-code-runtime.ts — sawResult gate',
    'no-result-is-failure': 'runtimes/claude-code-runtime.ts — sawResult gate; missing phase',
    'permission-waiting': 'scripts/verify-claude-code.ts — approval phase',
    'artifact-return': 'scripts/verify-claude-code.ts — notes.md read off disk',
    'restart-recovery': 'src/lib/workforce/durability.test.ts + scripts/verify-restart.ts',
  },
}
