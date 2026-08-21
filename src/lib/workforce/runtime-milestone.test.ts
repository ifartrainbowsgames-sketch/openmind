import { describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import { createBuiltinRuntime } from './builtin-runtime'
import {
  _resetRuntimes, emptyTaskContext, registerRuntime, runtimeFor, type AgentRuntime,
} from './agent-runtime'
import type { OpenMindEvent } from './events'
import type { AgentBrain } from '../agent'
import type { TaskRecord } from '../task-ledger'
import { ALL_CAPABILITIES, runtimeCapabilities, type WorkerCapability } from './capabilities'

vi.mock('../supabase')

/**
 * The four gates for the AgentRuntime consolidation:
 *
 *   1. task-runner no longer calls runEmployee directly  (runtime-boundary.test.ts)
 *   2. the builtin runtime wraps it with no regression
 *   3. a session is created and reused during a real task run
 *   4. runtime events reach the orchestrator so the UI can observe them
 */

const ARTIFACT = [
  '```json research/competitors.json',
  '{"competitors":[{"name":"A","url":"https://a.com"}]}',
  '```',
].join('\n')

const GOAL = 'Research AI website builders and compare their pricing'
const BUDGET = { maxAgentRuns: 20, maxToolCalls: 20, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000 }

function brain(onRespond?: () => void): AgentBrain {
  return {
    plan: async () => [],
    respond: async () => { onRespond?.(); return ARTIFACT },
  }
}

const task: TaskRecord = {
  id: 't1', type: 'code', goal: 'build', inputs: {}, outputs: [], dependsOn: [],
  status: 'running', worker: 'code',
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
}

const deps = (b: AgentBrain) => ({
  brain: b,
  employeeFor: () => ({
    id: 'worker-code', name: 'Code', role: 'code worker',
    prompt: 'do it', tools: [], accent: '#000',
  }),
  promptFor: () => 'prompt',
})

async function drain(events: AsyncIterable<OpenMindEvent>): Promise<OpenMindEvent[]> {
  const out: OpenMindEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

// ── Gate 3: sessions ────────────────────────────────────────────────────────

describe('sessions are created and reused', () => {
  it('creates a session for a project and worker', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    expect(session.projectId).toBe('p1')
    expect(session.provider).toBe('builtin')
    expect(session.workspace).toBeDefined()
  })

  it('reuses one session across tasks for the same worker', async () => {
    // The point of sessions: a coder should not start over for each task in a
    // project. Two createSession calls must land on the same session.
    const runtime = createBuiltinRuntime(deps(brain()))
    const first = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const second = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    expect(second.id).toBe(first.id)
  })

  it('keeps different workers on different sessions', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const code = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const research = await runtime.createSession({ projectId: 'p1', worker: 'research' })
    expect(research.id).not.toBe(code.id)
  })

  it('records the tasks a session served', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(session, task, emptyTaskContext()))
    const resumed = await runtime.resumeSession(session.id)
    expect(resumed?.taskIds).toContain('t1')
  })

  it('resumeSession returns null for an unknown id rather than inventing one', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    expect(await runtime.resumeSession('nope')).toBeNull()
  })
})

// ── Gate 4: events ──────────────────────────────────────────────────────────

describe('runtime events describe the run', () => {
  it('brackets a run with task_started and a terminal task_finished', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const events = await drain(runtime.runTask(session, task, emptyTaskContext()))
    expect(events[0].kind).toBe('task_started')
    expect(events.at(-1)?.kind).toBe('task_finished')
    expect(events.at(-1)?.outcome).toBe('completed')
  })

  it('carries the result on the terminal event, since the stream is the only channel', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const events = await drain(runtime.runTask(session, task, emptyTaskContext()))
    expect(events.at(-1)?.result).toBeDefined()
  })

  it('stamps every event with the session and task it belongs to', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const events = await drain(runtime.runTask(session, task, emptyTaskContext()))
    for (const e of events) {
      expect(e.sessionId).toBe(session.id)
      expect(e.taskId).toBe('t1')
    }
  })

  it('reports a thrown provider error as failed rather than letting it escape', async () => {
    const runtime = createBuiltinRuntime(deps({
      plan: async () => { throw new Error('provider down') },
      respond: async () => '',
    }))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const events = await drain(runtime.runTask(session, task, emptyTaskContext()))
    expect(events.at(-1)?.outcome).toBe('failed')
    expect(events.at(-1)?.text).toMatch(/provider down/)
  })

  it('honours cancel before the task starts', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await runtime.cancel(session.id)
    const events = await drain(runtime.runTask(session, task, emptyTaskContext()))
    expect(events.at(-1)?.outcome).toBe('cancelled')
  })
})

// ── Honest capability reporting ─────────────────────────────────────────────

describe('the builtin runtime does not overclaim', () => {
  it('reports that it cannot checkpoint', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    expect((await runtime.capabilities()).traits.checkpointable).toBe(false)
    const cp = await runtime.checkpoint('any')
    // captured:false means "not saved". Reporting true with an empty payload
    // would let a caller build recovery on something that cannot recover.
    expect(cp.captured).toBe(false)
  })

  it('reports workspace inspection as unknown, not clean', async () => {
    const runtime = createBuiltinRuntime(deps(brain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const state = await runtime.inspectWorkspace(session.id)
    expect(state.inspected).toBe(false)
    expect(state.changedFiles).toEqual([])
  })
})

// ── Registry ────────────────────────────────────────────────────────────────

describe('runtime registry', () => {
  it('refuses to execute when nothing is registered, rather than falling back', async () => {
    // A silent fallback to a direct call is exactly how two execution systems
    // grow back: the orchestrator keeps working while the runtime path rots.
    _resetRuntimes()
    expect(() => runtimeFor('claude-code')).toThrow(/No AgentRuntime registered/)
  })

  it('resolves a registered runtime by id', () => {
    _resetRuntimes()
    const fake = { id: 'claude-code' } as AgentRuntime
    registerRuntime(fake)
    expect(runtimeFor('claude-code').id).toBe('claude-code')
    _resetRuntimes()
  })
})

// ── Gate 2: no regression through the real orchestrator ─────────────────────

describe('the task graph runs through the runtime', () => {
  it('still executes tasks and produces artifacts', async () => {
    let calls = 0
    const run = await runTaskGraph(GOAL, brain(() => { calls++ }), { budget: BUDGET })
    expect(calls).toBeGreaterThan(0)
    expect(run.project.artifacts.length).toBeGreaterThan(0)
  }, 30_000)

  it('emits runtime events the UI can observe', async () => {
    const seen: OpenMindEvent[] = []
    await runTaskGraph(GOAL, brain(), { budget: BUDGET, onEvent: (e) => seen.push(e) })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.some((e) => e.kind === 'task_started')).toBe(true)
    expect(seen.some((e) => e.kind === 'task_finished')).toBe(true)
  }, 30_000)

  it('still streams trace lines, which the direct call used to provide', async () => {
    const lines: string[] = []
    await runTaskGraph(GOAL, brain(), { budget: BUDGET, onTrace: (l) => lines.push(l.text) })
    expect(lines.length).toBeGreaterThan(0)
  }, 30_000)
})

// ── Capability routing reaches dispatch ─────────────────────────────────────

/**
 * The half that was missing. `assignWorker` ran once, at plan time, matching a
 * task type to a worker kind — and nothing consulted capabilities when a task
 * was actually handed to a runtime. A runtime that could not do the work would
 * be given it anyway, and would fail in whatever way that runtime fails: a
 * timeout, an empty answer, a judge rejection. Never "this runtime cannot
 * write files".
 */
function limitedRuntime(skills: readonly WorkerCapability[]): AgentRuntime & { ran: string[] } {
  const ran: string[] = []
  return {
    id: 'limited',
    ran,
    capabilities: async () => runtimeCapabilities(skills, {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    }),
    createSession: async (input) => ({
      id: `limited:${input.projectId}:${input.worker}`,
      projectId: input.projectId,
      worker: input.worker,
      provider: 'limited',
      status: 'running' as const,
      taskIds: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    }),
    resumeSession: async () => null,
    async *runTask(_session, t) {
      ran.push(t.id)
      yield { kind: 'task_finished' as const, text: 'ok', at: Date.now(), outcome: 'completed' as const }
    },
    checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
    inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
    cancel: async () => {},
    close: async () => {},
  }
}

describe('a runtime is not given work it cannot do', () => {
  it('blocks the task and names the missing capability', async () => {
    _resetRuntimes()
    // Can browse, cannot search. Every research task requires web.search.
    const runtime = limitedRuntime(['browser.navigate'])
    registerRuntime(runtime, true)

    const run = await runTaskGraph(GOAL, brain(), { runtimeId: 'limited', budget: BUDGET })

    expect(runtime.ran).toEqual([])
    const blocked = run.project.blockers.join(' ')
    expect(blocked).toContain('cannot')
    expect(blocked).toContain('web.search')
    _resetRuntimes()
  })

  it('runs the task when the runtime covers what it requires', async () => {
    _resetRuntimes()
    const runtime = limitedRuntime(ALL_CAPABILITIES)
    registerRuntime(runtime, true)

    await runTaskGraph(GOAL, brain(), { runtimeId: 'limited', budget: BUDGET })

    expect(runtime.ran.length).toBeGreaterThan(0)
    _resetRuntimes()
  })
})
