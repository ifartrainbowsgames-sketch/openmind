import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTaskGraph, simulatedBrain } from '../task-runner'
import {
  _resetRuntimes, emptyTaskContext, registerRuntime,
  type AgentRuntime, type AgentSession, type TaskContext,
} from './agent-runtime'
import { createMemoryService, extractOutcome, initialBook } from './memory-service'
import { recall } from './memory-layers'
import { event, type OpenMindEvent } from './events'
import { createProject, recordDecision, recordEvidence, type TaskRecord } from '../task-ledger'
import type { RunResult } from '../agent'

vi.mock('../supabase')

/**
 * The invariant, stated the way the runtime boundary is stated:
 *
 *   Every production task receives canonical project memory before execution
 *   and has its outcome recorded afterwards, regardless of which runtime ran it.
 *
 * This is enforced here rather than by convention because the failure is
 * silent in the same way the last one was. Memory used to be a *tool*, so
 * whether a project remembered anything depended on a model choosing to call
 * `memory_search`. Nothing errors when it doesn't — the work just gets redone,
 * and the second worker contradicts the first.
 *
 * The foreign-runtime test below is the one that matters most. Before
 * `TaskContext` existed, the builtin runtime composed its own prompt from the
 * ledger, so canonical memory reached OpenMind's worker and nothing else. A
 * Claude Code or Codex runtime would have started every task knowing nothing
 * about the project, and would have looked like it was working.
 */

/** A runtime that is not the builtin one, recording what the kernel gave it. */
function foreignRuntime(): {
  runtime: AgentRuntime
  seen: TaskContext[]
} {
  const seen: TaskContext[] = []
  const result: RunResult = {
    answer: '```json report.json\n{"ok":true}\n```',
    plan: [],
    toolCalls: [],
    trace: [],
  }
  const runtime: AgentRuntime = {
    id: 'foreign',
    capabilities: async () => ({
      resumable: false, writesFiles: false, runsCommands: false, checkpointable: false,
    }),
    createSession: async (input): Promise<AgentSession> => ({
      id: `foreign:${input.projectId}:${input.worker}`,
      projectId: input.projectId,
      worker: input.worker,
      provider: 'foreign',
      status: 'running',
      taskIds: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    }),
    resumeSession: async () => null,
    async *runTask(session, task, context): AsyncIterable<OpenMindEvent> {
      seen.push(context)
      yield event('task_finished', 'done', {
        sessionId: session.id, taskId: task.id, worker: task.worker,
        outcome: 'completed', result,
      })
    },
    checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
    inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
    cancel: async () => {},
    close: async () => {},
  }
  return { runtime, seen }
}

const task = (id: string): TaskRecord => ({
  id, type: 'research', goal: `task ${id}`, inputs: {}, outputs: ['report.json'], dependsOn: [],
  status: 'running', worker: 'research',
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
})

beforeEach(() => _resetRuntimes())
afterEach(() => _resetRuntimes())

describe('memory reaches every runtime', () => {
  it('hands canonical memory to a runtime that is not the builtin one', async () => {
    const { runtime, seen } = foreignRuntime()
    registerRuntime(runtime, true)

    await runTaskGraph('write a short report', simulatedBrain(), { runtimeId: 'foreign' })

    expect(seen.length).toBeGreaterThan(0)
    // Not "the runtime may look memory up" — it arrives as an argument, so a
    // runtime cannot be invoked without it.
    for (const context of seen) {
      expect(context).toBeDefined()
      expect(context.memory).toBeDefined()
      expect(Array.isArray(context.memory.entries)).toBe(true)
    }
  })

  it('carries what earlier tasks established into later ones', async () => {
    const { runtime, seen } = foreignRuntime()
    registerRuntime(runtime, true)

    await runTaskGraph('research and then summarise', simulatedBrain(), { runtimeId: 'foreign' })

    // The first task starts with an empty project. By the last one, the
    // artifacts and decisions of everything before it are in the context —
    // which is the whole reason memory is a kernel service.
    expect(seen.length).toBeGreaterThan(1)
    // Asserted both ways round: an assertion that memory is present is worth
    // nothing unless it would have been absent at the start.
    expect(seen[0].memory.entries).toEqual([])
    const last = seen.at(-1)
    expect(last?.memory.entries.length ?? 0).toBeGreaterThan(0)
    expect(last?.memory.text).toContain('do not re-derive')
  })
})

/**
 * Source-level checks, for the same reason `runtime-boundary.test.ts` has
 * them: the behavioural tests above pass just as happily if someone quietly
 * reintroduces a second path, because a second path also works.
 */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('memory stays a kernel service', () => {
  it('the orchestrator builds context before dispatch and records after', () => {
    const runner = sources['/src/lib/task-runner.ts']
    expect(runner).toBeDefined()
    expect(runner).toMatch(/memory\.service\.buildContext\(/)
    expect(runner).toMatch(/memory\.service\.recordOutcome\(/)
    // And the built context is what travels to the runtime, not a copy the
    // builtin worker happens to compose for itself.
    expect(runner).toMatch(/runtime\.runTask\(session, task, taskContext\)/)
  })

  it('no worker tool can write canonical memory', () => {
    // MemoryReader is read-only by design. `memory_save` still writes the
    // account's cross-project notes — that is the user's memory, not the
    // project's, and the kernel reads it as the user layer.
    const context = sources['/src/lib/workforce/execution-context.ts']
    expect(context).toMatch(/interface MemoryReader \{[^}]*search\(/s)
    expect(context).not.toMatch(/interface MemoryReader \{[^}]*(save|record|write)\(/s)
  })

  it('the memory layers module is reachable, not a design document', () => {
    // It was written, tested, and imported by nothing. That is what this whole
    // pass exists to stop happening again.
    const importers = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => /from '\.{1,2}\/(workforce\/)?memory-layers'/.test(text))
      .map(([path]) => path)
    expect(importers.length).toBeGreaterThan(1)
    expect(importers).toContain('/src/lib/workforce/memory-service.ts')
  })
})

describe('the kernel records outcomes, not the worker', () => {
  it('records a passing verdict as a decision', () => {
    const t = task('t1')
    const book = extractOutcome({
      book: { entries: [] },
      projectId: 'p',
      task: t,
      artifacts: [],
      verdict: { passed: true, score: 90, problems: [], requiredFixes: [] },
    })
    const decisions = recall(book, 'project').filter((e) => e.kind === 'decision')
    expect(decisions).toHaveLength(1)
    expect(decisions[0].source).toBe('t1')
  })

  it('supersedes an earlier failure when the retry passes', () => {
    const t = task('t1')
    let book = extractOutcome({
      book: { entries: [] },
      projectId: 'p',
      task: t,
      artifacts: [],
      verdict: { passed: false, score: 10, problems: ['no sources'], requiredFixes: ['cite'] },
    })
    expect(recall(book, 'project').some((e) => e.kind === 'failure')).toBe(true)

    book = extractOutcome({
      book,
      projectId: 'p',
      task: t,
      artifacts: [],
      verdict: { passed: true, score: 90, problems: [], requiredFixes: [] },
    })

    // The fixed problem stops being recalled. A corrected decision that still
    // appears — even ranked down — is a decision the model may act on.
    expect(recall(book, 'project').some((e) => e.kind === 'failure')).toBe(false)
    expect(recall(book, 'project').some((e) => e.kind === 'decision')).toBe(true)
  })

  it('records a blocked capability as a project constraint', () => {
    const result: RunResult = {
      answer: '',
      plan: [],
      toolCalls: [{
        tool: 'slack_post',
        input: 'x',
        output: '',
        error: { kind: 'blocked', message: 'Slack is not connected' },
      }],
      trace: [],
    }
    const book = extractOutcome({
      book: { entries: [] }, projectId: 'p', task: task('t1'), artifacts: [], result,
    })
    const constraints = recall(book, 'project').filter((e) => e.kind === 'constraint')
    expect(constraints).toHaveLength(1)
    expect(constraints[0].text).toContain('Slack is not connected')
  })

  it('does not record the same fact twice when a task is retried', () => {
    const t = task('t1')
    const artifacts = [{
      id: 'a1', path: 'report.json', kind: 'json' as const, title: 'report.json',
      body: '{}', taskId: 't1', worker: 'research' as const, sources: 2,
      confidence: 0.8, createdAt: Date.now(),
    }]
    let book = extractOutcome({ book: { entries: [] }, projectId: 'p', task: t, artifacts })
    book = extractOutcome({ book, projectId: 'p', task: t, artifacts })
    expect(book.entries.filter((e) => e.kind === 'finding')).toHaveLength(1)
  })
})

describe('memory survives a project that predates it', () => {
  it('seeds the book from decisions and evidence', () => {
    let project = createProject('goal')
    project = recordDecision(project, 'TASK-001 accepted: competitors found')
    project = recordEvidence(project, ['https://a.com'])

    const book = initialBook(project)
    const entries = recall(book, 'project')
    expect(entries.some((e) => e.text.includes('competitors found'))).toBe(true)
    expect(entries.some((e) => e.text.includes('https://a.com'))).toBe(true)
  })

  it('does not reseed a project that already has memory', () => {
    let project = createProject('goal')
    project = recordDecision(project, 'already decided')
    const first = initialBook(project)
    const second = initialBook({ ...project, memory: first })
    expect(second.entries).toHaveLength(first.entries.length)
  })
})

describe('the explicit tools read the same canonical memory', () => {
  it('search spans the project book', async () => {
    const service = createMemoryService()
    const book = extractOutcome({
      book: { entries: [] },
      projectId: 'p',
      task: task('t1'),
      artifacts: [],
      verdict: { passed: true, score: 90, problems: [], requiredFixes: [] },
    })
    const hits = await service.search(book, { text: 'task t1' })
    expect(hits.length).toBeGreaterThan(0)
  })

  it('consolidate drops superseded entries and the task layer, nothing else', () => {
    const service = createMemoryService()
    let book = extractOutcome({
      book: { entries: [] },
      projectId: 'p',
      task: task('t1'),
      artifacts: [],
      verdict: { passed: false, score: 0, problems: ['broken'], requiredFixes: ['fix'] },
    })
    book = extractOutcome({
      book,
      projectId: 'p',
      task: task('t1'),
      artifacts: [],
      verdict: { passed: true, score: 90, problems: [], requiredFixes: [] },
    })
    const out = service.consolidate(book)
    expect(out.superseded).toBe(1)
    expect(out.after).toBe(out.before - 1)
    // The surviving decision is still there — consolidation prunes what nothing
    // will recall, not what is merely old.
    expect(out.book.entries.some((e) => e.kind === 'decision')).toBe(true)
  })
})

describe('the contract cannot be satisfied without memory', () => {
  it('emptyTaskContext is explicit, so "no memory" is a decision not an omission', () => {
    const ctx = emptyTaskContext()
    expect(ctx.memory.text).toBe('')
    expect(ctx.memory.entries).toEqual([])
  })
})
