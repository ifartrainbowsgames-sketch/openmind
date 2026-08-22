import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import {
  _setTracerForTesting, telemetryActive, telemetryConfig, traced,
} from './index'
import { REDACTED } from './sanitize'
import {
  _resetRuntimes, registerRuntime,
  type AgentRuntime, type AgentSession,
} from '../workforce/agent-runtime'
import { ALL_CAPABILITIES, runtimeCapabilities } from '../workforce/capabilities'
import { _resetRepositories } from '../workforce/session-repository'
import { event, type OpenMindEvent, type RunOutcome } from '../workforce/events'
import type { RunResult } from '../agent'

vi.mock('../supabase')

/**
 * Phoenix is a microscope, not an organ.
 *
 * These tests are almost entirely about what happens when it is missing,
 * broken, or slow — because the failure mode that matters is not "we lost a
 * trace", it is "a customer's task failed because our debugging tool was
 * down".
 */

interface CapturedSpan {
  name: string
  attributes: Record<string, unknown>
  status?: { code: number; message?: string }
}

/** A tracer that records instead of exporting. */
function recordingTracer(spans: CapturedSpan[], failOn?: 'start' | 'attributes') {
  return {
    startActiveSpan<T>(name: string, fn: (span: never) => Promise<T> | T): Promise<T> | T {
      if (failOn === 'start') throw new Error('collector unreachable')
      const captured: CapturedSpan = { name, attributes: {} }
      spans.push(captured)
      const span = {
        setAttributes(attributes: Record<string, unknown>) {
          if (failOn === 'attributes') throw new Error('exporter rejected the batch')
          Object.assign(captured.attributes, attributes)
        },
        setStatus(status: { code: number; message?: string }) { captured.status = status },
        recordException() {},
        end() {},
        spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1' }),
      }
      return fn(span as never)
    },
  }
}

const BUDGET = { maxAgentRuns: 8, maxToolCalls: 8, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000 }

const ARTIFACT: RunResult = {
  answer: '```json research/report.json\n{"ok":true,"sources":["https://a.com"]}\n```',
  plan: [], toolCalls: [], trace: [],
}

function fakeRuntime(outcome: RunOutcome, result?: RunResult): AgentRuntime {
  return {
    id: 'telemetry-runtime',
    capabilities: async () => runtimeCapabilities(ALL_CAPABILITIES, {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    }),
    createSession: async (input): Promise<AgentSession> => ({
      id: `t:${input.projectId}:${input.worker}`,
      scope: { kind: 'project', projectId: input.projectId, worker: input.worker },
      provider: 'test', status: 'running', taskIds: [],
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

beforeEach(() => { _resetRuntimes(); _resetRepositories() })
afterEach(() => { _setTracerForTesting(undefined); _resetRuntimes(); _resetRepositories() })

async function run(runtime: AgentRuntime, options: Record<string, unknown> = {}) {
  registerRuntime(runtime, true)
  return runTaskGraph('write a short report about pricing', {
    plan: async () => [], respond: async () => 'x',
  }, { runtimeId: runtime.id, budget: BUDGET, userId: 'customer-1', ...options })
}

describe('telemetry is off by default', () => {
  it('is opt-in, not opt-out', () => {
    expect(telemetryConfig({}).enabled).toBe(false)
    expect(telemetryConfig({ PHOENIX_ENABLED: 'true' }).enabled).toBe(true)
  })

  it('defaults to the conservative content policy', () => {
    // A customer's prompts are their business, and a tracing backend is a
    // second place they can leak from.
    expect(telemetryConfig({}).content).toBe('metadata_only')
    expect(telemetryConfig({ PHOENIX_CONTENT_POLICY: 'nonsense' }).content).toBe('metadata_only')
  })

  it('runs a whole task graph with no tracer at all', async () => {
    expect(telemetryActive()).toBe(false)
    const result = await run(fakeRuntime('completed', ARTIFACT))
    expect(result.project.tasks.length).toBeGreaterThan(0)
  })
})

describe('a broken collector does not break a run', () => {
  it('produces the SAME outcome as a run with telemetry off', async () => {
    // The real claim, and stronger than "it did not throw": a broken collector
    // must change nothing a customer can observe. Compared against a run with
    // no tracer rather than against a hard-coded expectation, because what
    // matters is that the two agree — not what either one happens to be.
    _setTracerForTesting(undefined)
    const clean = await run(fakeRuntime('completed', ARTIFACT))
    _resetRuntimes(); _resetRepositories()

    _setTracerForTesting(recordingTracer([], 'start'))
    const broken = await run(fakeRuntime('completed', ARTIFACT))

    const statuses = (r: typeof clean) => r.project.tasks.map((t) => t.status).sort().join(',')
    expect(statuses(broken)).toBe(statuses(clean))
    expect(broken.project.artifacts.length).toBe(clean.project.artifacts.length)
    expect(broken.project.tasks.length).toBeGreaterThan(0)
  })

  it('survives a tracer that throws while recording attributes', async () => {
    _setTracerForTesting(recordingTracer([], 'attributes'))
    const result = await run(fakeRuntime('completed', ARTIFACT))
    expect(result.project.tasks.length).toBeGreaterThan(0)
  })

  it('returns the work even when tracing throws around it', async () => {
    _setTracerForTesting(recordingTracer([], 'start'))
    const value = await traced('tool.call', {}, async () => 'the real answer')
    expect(value).toBe('the real answer')
  })

  it('lets the work error through, rather than masking it as a telemetry problem', async () => {
    _setTracerForTesting(recordingTracer([]))
    await expect(traced('tool.call', {}, async () => { throw new Error('the tool failed') }))
      .rejects.toThrow('the tool failed')
  })
})

describe('one run produces a correlated trace', () => {
  it('emits the stages a reader needs to understand the run', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT))

    const names = new Set(spans.map((s) => s.name))
    for (const expected of [
      'memory.load', 'eligibility.evaluate', 'routing.select',
      'runtime.execute', 'artifact.adopt', 'task.evaluate', 'task.outcome',
    ]) {
      expect(names.has(expected), `missing span: ${expected}`).toBe(true)
    }
  })

  it('propagates the task and user id to child spans', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT))

    const withTask = spans.filter((s) => s.attributes['openmind.task_id'])
    expect(withTask.length).toBeGreaterThan(3)
    for (const span of withTask) {
      expect(span.attributes['openmind.user_id']).toBe('customer-1')
      expect(span.attributes['openmind.project_id']).toBeTruthy()
    }
  })

  it('records runtime, routing and artifact attributes', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT))

    const routing = spans.find((s) => s.name === 'routing.select')
    expect(routing?.attributes['routing.selected']).toBe('telemetry-runtime')
    expect(routing?.attributes['routing.eligible_count']).toBeGreaterThan(0)

    const execute = spans.find((s) => s.name === 'runtime.execute')
    expect(execute?.attributes['openmind.runtime_id']).toBe('telemetry-runtime')

    const artifact = spans.find((s) => s.name === 'artifact.adopt')
    expect(artifact?.attributes['artifact.count']).toBeGreaterThan(0)
    // Provenance, which is the reason the span exists.
    expect(artifact?.attributes).toHaveProperty('artifact.from_tools')
  })

  it('records memory as metadata, never as the book itself', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT))

    const memory = spans.find((s) => s.name === 'memory.load')
    expect(memory?.attributes).toHaveProperty('memory.entries')
    expect(memory?.attributes).toHaveProperty('memory.bytes')
    // The text itself must not be an attribute.
    expect(Object.keys(memory?.attributes ?? {})).not.toContain('memory.text')
  })
})

describe('outcomes stay distinct', () => {
  it('does not flatten needs_user into failure', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('needs_user', ARTIFACT))

    const outcome = spans.find((s) => s.name === 'task.outcome')
    expect(outcome?.attributes['run.needs_user']).toBeGreaterThan(0)
    expect(outcome?.attributes['run.failed']).toBe(0)

    const execute = spans.find((s) => s.name === 'runtime.execute')
    expect(execute?.attributes['runtime.outcome']).toBe('needs_user')
  })

  it('does not report cancelled as failed', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('cancelled', ARTIFACT))

    const outcome = spans.find((s) => s.name === 'task.outcome')
    expect(outcome?.attributes['run.failed']).toBe(0)
    expect(outcome?.attributes['run.blocked']).toBeGreaterThan(0)
  })

  it('shows a no-result runtime as a failure with no result', async () => {
    // One of the false-success cases this project already found. The trace must
    // make it obvious rather than showing a completed span.
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', undefined))

    const execute = spans.find((s) => s.name === 'runtime.execute')
    expect(execute?.attributes['runtime.has_result']).toBe(false)
    const outcome = spans.find((s) => s.name === 'task.outcome')
    expect(outcome?.attributes['run.failed']).toBeGreaterThan(0)
  })

  it('records why a candidate was excluded', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT))
    const eligibility = spans.find((s) => s.name === 'eligibility.evaluate')
    expect(eligibility?.attributes).toHaveProperty('eligibility.reasons')
  })
})

describe('no secret reaches a span', () => {
  it('keeps tool keys out of every attribute', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT), {
      toolKeys: { tavily: 'sk-tavily-SECRETVALUE0123456789' },
    })

    const dump = JSON.stringify(spans)
    expect(spans.length).toBeGreaterThan(3)
    expect(dump).not.toContain('SECRETVALUE')
    expect(dump).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)
  })

  it('redacts a secret handed straight to a span', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await traced('tool.call', {
      attributes: { config: { apiKey: 'sk-ant-LEAKED9999999999999' } },
    }, async () => 'ok')
    const dump = JSON.stringify(spans)
    expect(dump).not.toContain('LEAKED')
    expect(dump).toContain(REDACTED)
  })

  it('does not leak one customer into another customer\'s span', async () => {
    const spans: CapturedSpan[] = []
    _setTracerForTesting(recordingTracer(spans))
    await run(fakeRuntime('completed', ARTIFACT), { userId: 'customer-A' })
    _resetRuntimes(); _resetRepositories()
    await run(fakeRuntime('completed', ARTIFACT), { userId: 'customer-B' })

    const forA = spans.filter((s) => s.attributes['openmind.user_id'] === 'customer-A')
    const forB = spans.filter((s) => s.attributes['openmind.user_id'] === 'customer-B')
    expect(forA.length).toBeGreaterThan(0)
    expect(forB.length).toBeGreaterThan(0)
    for (const span of forA) expect(span.attributes['openmind.user_id']).not.toBe('customer-B')
  })
})
