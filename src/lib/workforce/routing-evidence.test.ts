import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import {
  _resetRuntimes, registerRuntime,
  type AgentRuntime, type AgentSession,
} from './agent-runtime'
import { ALL_CAPABILITIES, runtimeCapabilities } from './capabilities'
import { _resetRepositories } from './session-repository'
import {
  _recordedEvidence, _resetEvidence, applyOutcome, emptyArm, memoryEvidenceStore,
  projectOutcome, rebuildStats,
  type RoutingDecision, type RoutingObservation,
} from './routing-evidence'
import { event, type OpenMindEvent, type RunOutcome } from './events'
import type { RunResult } from '../agent'

vi.mock('../supabase')

/**
 * Stage B: the evidence exists before any router does.
 *
 * A router whose statistics begin the day it ships has nothing to learn from,
 * and one whose learning lives in process memory would look adaptive while
 * relearning from scratch on every restart. So these tests are about the
 * RECORD, not about any decision.
 */

const BUDGET = { maxAgentRuns: 8, maxToolCalls: 8, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000 }

const decision = (over: Partial<RoutingDecision> = {}): RoutingDecision => ({
  id: 'd1', userId: 'u1', projectId: 'p1', taskId: 't1',
  decisionType: 'runtime', scope: 'code', chosenCandidateId: 'builtin',
  candidateSet: ['builtin', 'claude-code'], contextFeatures: {},
  policy: 'default', createdAt: 1, ...over,
})

const observation = (over: Partial<RoutingObservation> = {}): RoutingObservation => ({
  id: 'o1', decisionId: 'd1', userId: 'u1', outcome: 'success',
  metrics: {}, createdAt: 2, ...over,
})

describe('projecting an outcome', () => {
  it('counts a completed task as success and a failed one as failure', () => {
    expect(projectOutcome({ taskStatus: 'completed' })).toBe('success')
    expect(projectOutcome({ taskStatus: 'failed' })).toBe('failure')
  })

  it('treats a blocked or waiting task as NEUTRAL, not failure', () => {
    // The most important line in the projection. A task blocked on a missing
    // credential or waiting for an approval says nothing about the candidate
    // that was chosen. Counting it as failure would teach the router to avoid
    // whichever runtime the customer happened not to have configured — it would
    // be learning about customers, not candidates.
    expect(projectOutcome({ taskStatus: 'needs_user' })).toBe('neutral')
    expect(projectOutcome({ taskStatus: 'blocked' })).toBe('neutral')
    expect(projectOutcome({ neededUser: true, taskStatus: 'completed' })).toBe('neutral')
  })

  it('treats absent evidence as neutral rather than guessing', () => {
    expect(projectOutcome({})).toBe('neutral')
  })

  it('neutral does not move the counters', () => {
    const arm = emptyArm('code', 'runtime', 'builtin')
    expect(applyOutcome(arm, 'neutral')).toEqual(arm)
    expect(applyOutcome(arm, 'success').successes).toBe(1)
    expect(applyOutcome(arm, 'failure').failures).toBe(1)
  })
})

describe('counters are derived, never canonical', () => {
  it('rebuilds from raw observations', () => {
    const stats = rebuildStats(
      [decision()],
      [observation({ id: 'o1' }), observation({ id: 'o2', outcome: 'failure' })],
    )
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ candidateId: 'builtin', successes: 1, failures: 1 })
  })

  it('applies a CORRECTED reward function to existing history', () => {
    // The reason raw evidence is canonical. SAP's router pickles its algorithm
    // state and keeps no observations, so a wrong reward function takes the
    // history with it. Here a better projection can be applied to what already
    // happened instead of starting from zero.
    const raw = [
      observation({ id: 'o1', outcome: 'success', metrics: { acceptanceScore: 42 } }),
      observation({ id: 'o2', outcome: 'success', metrics: { acceptanceScore: 95 } }),
    ]
    const strict = rebuildStats([decision()], raw, (o) =>
      (o.metrics.acceptanceScore ?? 0) >= 80 ? 'success' : 'failure')
    expect(strict[0]).toMatchObject({ successes: 1, failures: 1 })
  })

  it('ignores a decision that had only one candidate', () => {
    // A choice made because there was nothing else is not evidence about what
    // was chosen. Counting it would teach the router that whatever we always
    // do is what works.
    const stats = rebuildStats(
      [decision({ policy: 'sole-candidate', candidateSet: ['builtin'] })],
      [observation()],
    )
    expect(stats).toEqual([])
  })

  it('drops an observation whose decision is unknown', () => {
    expect(rebuildStats([], [observation({ decisionId: 'gone' })])).toEqual([])
  })

  it('separates arms by scope, so one task type does not teach another', () => {
    const stats = rebuildStats(
      [decision({ id: 'd1', scope: 'code' }), decision({ id: 'd2', scope: 'research' })],
      [observation({ decisionId: 'd1' }), observation({ id: 'o2', decisionId: 'd2', outcome: 'failure' })],
    )
    expect(stats).toHaveLength(2)
    expect(stats.find((s) => s.scope === 'code')?.successes).toBe(1)
    expect(stats.find((s) => s.scope === 'research')?.failures).toBe(1)
  })
})

// ── Recorded from a real run ────────────────────────────────────────────────

function fakeRuntime(outcome: RunOutcome, result?: RunResult): AgentRuntime {
  return {
    id: 'evidence-runtime',
    capabilities: async () => runtimeCapabilities(ALL_CAPABILITIES, {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    }),
    createSession: async (input): Promise<AgentSession> => ({
      id: `e:${input.projectId}:${input.worker}`,
      scope: { kind: 'project', projectId: input.projectId, worker: input.worker },
      provider: 'e', status: 'running', taskIds: [],
      startedAt: Date.now(), lastActivityAt: Date.now(),
    }),
    resumeSession: async () => null,
    async *runTask(session, task): AsyncIterable<OpenMindEvent> {
      yield event('task_finished', 'done', {
        sessionId: session.id, taskId: task.id, worker: task.worker, outcome, result,
      })
    },
    checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
    inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
    cancel: async () => {},
    close: async () => {},
  }
}

const ARTIFACT: RunResult = {
  answer: '```json research/report.json\n{"ok":true,"sources":["https://a.com"]}\n```',
  plan: [], toolCalls: [], trace: [],
}

beforeEach(() => { _resetRuntimes(); _resetRepositories(); _resetEvidence() })
afterEach(() => { _resetRuntimes(); _resetRepositories(); _resetEvidence() })

async function run(runtime: AgentRuntime, options: Record<string, unknown> = {}) {
  registerRuntime(runtime, true)
  return runTaskGraph('write a short report about pricing', {
    plan: async () => [], respond: async () => 'x',
  }, {
    runtimeId: runtime.id,
    budget: BUDGET,
    userId: 'customer-1',
    evidence: memoryEvidenceStore(),
    ...options,
  })
}

describe('a real run leaves evidence', () => {
  it('records a decision per task, with the candidate set', async () => {
    await run(fakeRuntime('completed', ARTIFACT))
    const { decisions } = _recordedEvidence()
    expect(decisions.length).toBeGreaterThan(0)
    for (const d of decisions) {
      expect(d.decisionType).toBe('runtime')
      expect(d.chosenCandidateId).toBe('evidence-runtime')
      expect(d.candidateSet).toContain('evidence-runtime')
      expect(d.userId).toBe('customer-1')
      expect(d.taskId).toBeTruthy()
    }
  })

  it('records the context features as they were', async () => {
    await run(fakeRuntime('completed', ARTIFACT))
    const [first] = _recordedEvidence().decisions
    // Recomputing these later from the task record would give today's features
    // for yesterday's decision, which looks like data and is not.
    expect(first.contextFeatures.taskType).toBeTruthy()
    expect(first.contextFeatures.attempt).toBe(1)
    expect(typeof first.contextFeatures.goalLength).toBe('number')
  })

  it('correlates every observation with a decision that exists', async () => {
    // The failure SAP's `last_context` design cannot avoid: an outcome landing
    // on the wrong decision. Here the link is an id written at decision time.
    await run(fakeRuntime('completed', ARTIFACT))
    const { decisions, observations } = _recordedEvidence()
    const ids = new Set(decisions.map((d) => d.id))
    expect(observations.length).toBeGreaterThan(0)
    for (const o of observations) expect(ids.has(o.decisionId)).toBe(true)
  })

  it('records a needs_user run as neutral, not as a failure', async () => {
    await run(fakeRuntime('needs_user', ARTIFACT))
    const { observations } = _recordedEvidence()
    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every((o) => o.outcome === 'neutral')).toBe(true)
  })

  it('records nothing at all when no customer owns the run', async () => {
    // A row attributed to nobody is unattributable and unreadable. Better to
    // drop it than to store evidence with no owner.
    await run(fakeRuntime('completed', ARTIFACT), { userId: undefined })
    expect(_recordedEvidence().decisions).toHaveLength(0)
  })

  it('never puts a secret in the evidence', async () => {
    await run(fakeRuntime('completed', ARTIFACT), { toolKeys: { tavily: 'sk-SECRET-VALUE' } })
    const dump = JSON.stringify(_recordedEvidence())
    // Non-vacuity first: a "no secrets found" assertion over an empty record is
    // the kind of green check this project keeps discovering was checking
    // nothing.
    expect(_recordedEvidence().decisions.length).toBeGreaterThan(0)
    expect(dump.length).toBeGreaterThan(100)
    expect(dump).not.toContain('sk-SECRET-VALUE')
    expect(dump).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)
  })

  it('survives a store that throws, because evidence is not load-bearing', async () => {
    const broken = {
      ...memoryEvidenceStore(),
      recordDecision: async () => { throw new Error('database on fire') },
      recordObservation: async () => { throw new Error('still on fire') },
    }
    const result = await run(fakeRuntime('completed', ARTIFACT), { evidence: broken })
    // The customer's task still finished.
    expect(result.project.tasks.length).toBeGreaterThan(0)
  })
})
