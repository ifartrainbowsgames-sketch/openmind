/**
 * External coding agents, behind one interface.
 *
 * OpenMind should not reimplement Claude Code or Codex. Those are mature, they
 * are what people already pay for, and the interesting work is orchestration
 * above them — which task, with which inputs, judged how.
 *
 * The shape here follows ACP (Agent Client Protocol), because that is the
 * standard that actually won: Zed's design, adopted by JetBrains, Google and
 * GitHub, with Claude Code and Codex both reachable through adapters, and
 * Devin Desktop shipping it explicitly so any agent — including in-house ones —
 * can run inside it. Matching its vocabulary means an ACP transport can be
 * dropped in later without reshaping anything above.
 *
 * Two rules hold regardless of provider:
 *  - events stream, so a long task is observable rather than a hang;
 *  - a run ends in a terminal outcome, never in "still talking".
 */

import type { TaskRecord } from '../task-ledger'
import type { Workspace } from './runtime'
import type { WorkerSession } from './sessions'

export type AgentEventKind =
  | 'thinking'
  | 'tool_started'
  | 'tool_completed'
  | 'file_changed'
  | 'message'
  | 'error'
  | 'finished'

export interface AgentRuntimeEvent {
  kind: AgentEventKind
  /** Short, human-readable. Goes to the trace. */
  text: string
  /** Set on tool events. */
  tool?: string
  /** Set on file_changed. */
  path?: string
  /** Set on finished. */
  outcome?: AgentOutcome
  at: number
}

export type AgentOutcome = 'completed' | 'failed' | 'blocked' | 'needs_user' | 'cancelled'

export const TERMINAL_OUTCOMES: readonly AgentOutcome[] = [
  'completed', 'failed', 'blocked', 'needs_user', 'cancelled',
]

export function isTerminal(outcome: string): outcome is AgentOutcome {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(outcome)
}

export interface AdapterCapabilities {
  /** The provider can resume a prior session by id. */
  resumable: boolean
  /** The provider edits files itself rather than returning patches. */
  writesFiles: boolean
  /** The provider can run commands in the workspace. */
  runsCommands: boolean
}

export interface CodingAgentAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: AdapterCapabilities

  /** Is this adapter usable right now? Never throws — absence is normal. */
  available(): Promise<boolean>

  start(workspace: Workspace, projectId: string): Promise<WorkerSession>

  runTask(session: WorkerSession, task: TaskRecord): AsyncIterable<AgentRuntimeEvent>

  cancel(sessionId: string): Promise<void>

  resume(sessionId: string): Promise<WorkerSession | null>
}

/** Registry. Adapters register themselves; the orchestrator picks by id. */
const registry = new Map<string, CodingAgentAdapter>()

export function registerAdapter(adapter: CodingAgentAdapter): void {
  registry.set(adapter.id, adapter)
}

export function getAdapter(id: string): CodingAgentAdapter | undefined {
  return registry.get(id)
}

export function listAdapters(): CodingAgentAdapter[] {
  return [...registry.values()]
}

/** Adapters that report themselves usable. Unavailable is not an error. */
export async function availableAdapters(): Promise<CodingAgentAdapter[]> {
  const checked = await Promise.all(
    listAdapters().map(async (a) => ((await a.available()) ? a : null)),
  )
  return checked.filter((a): a is CodingAgentAdapter => a !== null)
}

/** Test seam. Not exported from the barrel — production never clears this. */
export function _resetAdapters(): void {
  registry.clear()
}

/**
 * Drain an adapter's event stream to a terminal outcome.
 *
 * `maxEvents` exists because an adapter that streams forever is the exact
 * failure this architecture forbids — a worker must terminate. Hitting the cap
 * is reported as `failed`, not as success with partial output.
 */
export async function drainToOutcome(
  events: AsyncIterable<AgentRuntimeEvent>,
  onEvent?: (event: AgentRuntimeEvent) => void,
  maxEvents = 500,
): Promise<{ outcome: AgentOutcome; events: number; capped: boolean }> {
  let count = 0
  for await (const event of events) {
    count++
    onEvent?.(event)
    if (event.kind === 'finished') {
      return { outcome: event.outcome ?? 'completed', events: count, capped: false }
    }
    if (count >= maxEvents) {
      return { outcome: 'failed', events: count, capped: true }
    }
  }
  // The stream ended without saying how. Treating that as success would be a
  // guess, and the guess that costs most is the optimistic one.
  return { outcome: 'failed', events: count, capped: false }
}
