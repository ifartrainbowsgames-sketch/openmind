import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import {
  _resetRuntimes, registerRuntime,
  type AgentRuntime, type AgentSession,
} from './agent-runtime'
import { ALL_CAPABILITIES, runtimeCapabilities } from './capabilities'
import { _resetRepositories } from './session-repository'
import { event, type OpenMindEvent, type RunOutcome } from './events'
import type { RunResult } from '../agent'

vi.mock('../supabase')

/**
 * The runtime's outcome is authoritative.
 *
 * It used to reach nothing but a trace line. A runtime reporting `needs_user`
 * — Claude Code waiting on an approval it was refused — fell straight through
 * to artifact parsing and judging, and the task then failed for having
 * produced no artifacts. That is true, and it is not the reason. "Awaiting your
 * approval to run npm install" and "the worker produced nothing" are different
 * states, and a user can only act on one of them.
 *
 * The live version of this is scripts/verify-claude-code.ts `approval`, which
 * drives a real provider denial through the whole chain. These are the fast
 * checks that keep the mapping honest between live runs.
 */

const BUDGET = { maxAgentRuns: 8, maxToolCalls: 8, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000 }

const RESULT: RunResult = {
  answer: 'I could not finish.',
  plan: [],
  toolCalls: [],
  trace: [],
}

/** A runtime that ends every task with one chosen outcome. */
function outcomeRuntime(outcome: RunOutcome, text: string, blockedTexts: string[] = []): AgentRuntime {
  return {
    id: 'outcome',
    capabilities: async () => runtimeCapabilities(ALL_CAPABILITIES, {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    }),
    createSession: async (input): Promise<AgentSession> => ({
      id: `outcome:${input.projectId}:${input.worker}`,
      scope: { kind: 'project', projectId: input.projectId, worker: input.worker },
      provider: 'outcome',
      status: 'running', taskIds: [], startedAt: Date.now(), lastActivityAt: Date.now(),
    }),
    resumeSession: async () => null,
    async *runTask(session, task): AsyncIterable<OpenMindEvent> {
      const ctx = { sessionId: session.id, taskId: task.id, worker: task.worker }
      for (const blocked of blockedTexts) yield event('blocked', blocked, ctx)
      // The trap: a real result alongside a non-completed outcome. That is
      // exactly what Claude Code produces when it is refused a permission.
      yield event('task_finished', text, { ...ctx, outcome, result: RESULT })
    },
    checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
    inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
    cancel: async () => {},
    close: async () => {},
  }
}

const brain = { plan: async () => [], respond: async () => 'done' }

beforeEach(() => { _resetRuntimes(); _resetRepositories() })
afterEach(() => { _resetRuntimes(); _resetRepositories() })

async function runWith(runtime: AgentRuntime) {
  registerRuntime(runtime, true)
  return runTaskGraph('write a short report about pricing', brain, {
    runtimeId: runtime.id,
    budget: BUDGET,
  })
}

describe('a runtime waiting on approval', () => {
  it('produces a needs_user task, not a completed or failed one', async () => {
    const run = await runWith(outcomeRuntime(
      'needs_user',
      'approval required — Bash: npm install left-pad',
      ['Bash needs approval: npm install left-pad'],
    ))
    const statuses = run.project.tasks.map((t) => t.status)
    expect(statuses).toContain('needs_user')
    expect(statuses).not.toContain('completed')
  })

  it('carries the requested action so a UI can render it', async () => {
    const run = await runWith(outcomeRuntime(
      'needs_user',
      'approval required',
      ['Bash needs approval: npm install left-pad'],
    ))
    // The blocked events name what was asked for; the terminal text summarises.
    // Preferring the events means the user sees the command, not a category.
    expect(run.project.blockers.join(' ')).toContain('npm install left-pad')
  })

  it('does not invent artifacts from the answer it never finished', async () => {
    // The old path parsed artifacts out of `answer` and sent them to the judge,
    // which rejected them for not existing — the right verdict on the wrong
    // question. A task waiting for approval has produced nothing, and the
    // ledger should say so.
    const run = await runWith(outcomeRuntime('needs_user', 'approval required'))
    const waiting = run.project.tasks.find((t) => t.status === 'needs_user')
    expect(waiting?.artifactIds ?? []).toEqual([])
    expect(run.project.artifacts.some((a) => a.taskId === waiting?.id)).toBe(false)
  })
})

describe('the other terminal outcomes', () => {
  it('maps failed to a failed task', async () => {
    const run = await runWith(outcomeRuntime('failed', 'the provider exited with code 1'))
    expect(run.project.tasks.map((t) => t.status)).toContain('failed')
  })

  it('maps cancelled to a blocked task rather than a failure', async () => {
    // A user stopping work is not the work failing.
    const run = await runWith(outcomeRuntime('cancelled', 'cancelled'))
    const statuses = run.project.tasks.map((t) => t.status)
    expect(statuses).toContain('blocked')
    expect(statuses).not.toContain('failed')
  })

  it('lets a completed outcome through to the judge', async () => {
    // The check must not be so eager that it swallows the happy path. A judged
    // task ends completed or failed; a short-circuited one would sit at
    // needs_user or blocked without ever being graded.
    const run = await runWith(outcomeRuntime('completed', 'done'))
    const statuses = new Set(run.project.tasks.map((t) => t.status))
    expect(statuses.has('needs_user')).toBe(false)
    expect(statuses.has('blocked')).toBe(false)
    expect([...statuses].every((s) => s === 'completed' || s === 'failed')).toBe(true)
  })
})

describe('the run row a worker would write', () => {
  it('is needs_user when any task is waiting on the user', async () => {
    // worker/index.ts derives the row status from exactly this predicate, so
    // asserting it here keeps the two in step.
    const run = await runWith(outcomeRuntime('needs_user', 'approval required'))
    const blocked = run.project.tasks.some((t) => t.status === 'needs_user')
    expect(blocked).toBe(true)
  })
})
