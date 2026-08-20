import { beforeEach, describe, expect, it } from 'vitest'
import { WORKTREE_ROOT, planWorktree, ensureWorktree, worktreeDiff, removeWorktree } from './worktrees'
import {
  TERMINAL_OUTCOMES, _resetAdapters, availableAdapters, drainToOutcome, getAdapter,
  isTerminal, listAdapters, registerAdapter,
  type AgentRuntimeEvent, type CodingAgentAdapter,
} from './adapters'
import {
  RECALL_LIMITS, clearLayer, emptyMemory, priorFailures, recall, remember, renderMemory,
} from './memory-layers'
import {
  browserArtifacts, distinctHosts, emptySessionResult, needsVision, orderActions,
} from './browser-worker'
import type { ExecResult, GitResult, Runtime } from './runtime'

// ── Phase 11: worktrees ─────────────────────────────────────────────────────

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stdout, stderr: '', ran: true })
const dead = (): ExecResult => ({ exitCode: -1, stdout: '', stderr: 'no sandbox', ran: false })

function fakeRuntime(over: Partial<Runtime> = {}): Runtime {
  return {
    id: 'fake',
    readFile: async () => '',
    writeFile: async () => undefined,
    list: async () => [],
    exec: async () => ok(),
    git: async () => ({ ...ok(), summary: undefined }) as GitResult,
    createWorkspace: async () => ({ id: 'w', projectId: 'p', path: '/w' }),
    ...over,
  }
}

describe('planWorktree', () => {
  it('gives each worker its own path and branch', () => {
    const a = planWorktree('proj', 'coder-1')
    const b = planWorktree('proj', 'coder-2')
    expect(a.path).not.toBe(b.path)
    expect(a.branch).not.toBe(b.branch)
    expect(a.path.startsWith(WORKTREE_ROOT)).toBe(true)
  })

  it('sanitises ids that would break a ref or a shell argument', () => {
    // A slash would create a nested ref namespace; a space breaks the command
    // in a way that reads as git failing.
    const plan = planWorktree('My Project/v2', 'coder one')
    expect(plan.branch).not.toMatch(/[ ]/)
    expect(plan.branch.split('/')).toHaveLength(3)
    expect(plan.path).not.toMatch(/[ ]/)
  })

  it('falls back to a usable name for an empty id', () => {
    expect(planWorktree('p', '!!!').path).toContain('worker')
  })
})

describe('ensureWorktree', () => {
  it('creates a worktree when the directory is absent', async () => {
    const calls: string[][] = []
    const runtime = fakeRuntime({
      exec: async () => ok(''),
      git: async (args) => { calls.push(args); return { ...ok(), summary: undefined } },
    })
    const result = await ensureWorktree(runtime, 'p1', 'coder-1')
    expect(result.created).toBe(true)
    expect(result.workspace.worktree).toBe(true)
    expect(calls[0]).toContain('worktree')
    // -B so a rerun reuses the branch instead of failing on "already exists".
    expect(calls[0]).toContain('-B')
  })

  it('reuses an existing worktree so a resumed session keeps its work', async () => {
    const runtime = fakeRuntime({ exec: async () => ok('present') })
    const result = await ensureWorktree(runtime, 'p1', 'coder-1')
    expect(result.created).toBe(false)
    expect(result.workspace.path).toBe(planWorktree('p1', 'coder-1').path)
  })

  it('throws rather than returning a workspace that does not exist', async () => {
    const runtime = fakeRuntime({ exec: async () => ok(''), git: async () => ({ ...dead(), summary: undefined }) })
    await expect(ensureWorktree(runtime, 'p1', 'c')).rejects.toThrow(/no runtime/)
  })

  it('surfaces a git failure instead of pretending it worked', async () => {
    const runtime = fakeRuntime({
      exec: async () => ok(''),
      git: async () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a repository', ran: true }),
    })
    await expect(ensureWorktree(runtime, 'p1', 'c')).rejects.toThrow(/not a repository/)
  })
})

describe('worktreeDiff', () => {
  it('reports the changed files and the patch', async () => {
    const runtime = fakeRuntime({
      exec: async (cmd) => ok(cmd.includes('--name-only') ? 'src/a.ts\nsrc/b.ts' : 'diff --git ...'),
    })
    const diff = await worktreeDiff(runtime, { id: 'w', projectId: 'p', path: '/w', branch: 'b', worktree: true })
    expect(diff.filesChanged).toEqual(['src/a.ts', 'src/b.ts'])
    expect(diff.empty).toBe(false)
  })

  it('marks an unchanged worktree as empty', async () => {
    const diff = await worktreeDiff(fakeRuntime({ exec: async () => ok('') }),
      { id: 'w', projectId: 'p', path: '/w', worktree: true })
    expect(diff.empty).toBe(true)
    expect(diff.filesChanged).toEqual([])
  })
})

describe('removeWorktree', () => {
  it('refuses to remove a primary checkout', async () => {
    const removed = await removeWorktree(fakeRuntime(), { id: 'w', projectId: 'p', path: '/w' })
    expect(removed).toBe(false)
  })
})

// ── Phase 12: adapters ──────────────────────────────────────────────────────

function fakeAdapter(id: string, available = true): CodingAgentAdapter {
  return {
    id,
    name: id,
    capabilities: { resumable: true, writesFiles: true, runsCommands: true },
    available: async () => available,
    start: async () => ({
      id: `${id}-s`, projectId: 'p', worker: 'code', provider: id,
      status: 'running', taskIds: [], startedAt: 0, lastActivityAt: 0,
    }),
    runTask: async function* () { yield event('finished', 'done', 'completed') },
    cancel: async () => undefined,
    resume: async () => null,
  }
}

function event(kind: AgentRuntimeEvent['kind'], text: string, outcome?: AgentRuntimeEvent['outcome']): AgentRuntimeEvent {
  return { kind, text, outcome, at: 0 }
}

async function* stream(...events: AgentRuntimeEvent[]): AsyncIterable<AgentRuntimeEvent> {
  for (const e of events) yield e
}

describe('adapter registry', () => {
  beforeEach(() => _resetAdapters())

  it('registers and finds adapters by id', () => {
    registerAdapter(fakeAdapter('claude-code'))
    expect(getAdapter('claude-code')?.name).toBe('claude-code')
    expect(listAdapters()).toHaveLength(1)
  })

  it('treats an unavailable adapter as absent, not an error', async () => {
    registerAdapter(fakeAdapter('present', true))
    registerAdapter(fakeAdapter('missing', false))
    expect((await availableAdapters()).map((a) => a.id)).toEqual(['present'])
  })
})

describe('drainToOutcome', () => {
  it('returns the outcome the adapter reported', async () => {
    const result = await drainToOutcome(stream(event('thinking', '…'), event('finished', 'ok', 'completed')))
    expect(result.outcome).toBe('completed')
    expect(result.events).toBe(2)
  })

  it('forwards every event to the observer', async () => {
    const seen: string[] = []
    await drainToOutcome(stream(event('tool_started', 'a'), event('finished', 'b', 'completed')),
      (e) => seen.push(e.kind))
    expect(seen).toEqual(['tool_started', 'finished'])
  })

  it('fails a stream that ends without saying how', async () => {
    // Treating an unexplained end as success is a guess, and the optimistic
    // guess is the expensive one.
    const result = await drainToOutcome(stream(event('message', 'hmm')))
    expect(result.outcome).toBe('failed')
  })

  it('caps a stream that never terminates', async () => {
    async function* forever(): AsyncIterable<AgentRuntimeEvent> {
      for (;;) yield event('thinking', 'still going')
    }
    const result = await drainToOutcome(forever(), undefined, 10)
    expect(result.capped).toBe(true)
    expect(result.outcome).toBe('failed')
    expect(result.events).toBe(10)
  })

  it('reports blocked and needs_user as themselves', async () => {
    for (const outcome of ['blocked', 'needs_user', 'cancelled'] as const) {
      const result = await drainToOutcome(stream(event('finished', 'x', outcome)))
      expect(result.outcome).toBe(outcome)
    }
  })

  it('knows which outcomes are terminal', () => {
    for (const o of TERMINAL_OUTCOMES) expect(isTerminal(o)).toBe(true)
    expect(isTerminal('still discussing')).toBe(false)
  })
})

// ── Phase 15: memory ────────────────────────────────────────────────────────

describe('memory layers', () => {
  it('keeps layers separate', () => {
    let book = remember(emptyMemory(), { layer: 'user', kind: 'preference', text: 'pnpm' })
    book = remember(book, { layer: 'project', kind: 'finding', text: 'API is REST' })
    expect(recall(book, 'user')).toHaveLength(1)
    expect(recall(book, 'project')).toHaveLength(1)
    expect(recall(book, 'task')).toHaveLength(0)
  })

  it('drops a superseded entry entirely rather than ranking it down', () => {
    // A corrected decision that still appears, even third, is one the model may
    // act on. "We decided X" then "actually not X" reads as ambiguity.
    let book = remember(emptyMemory(), { layer: 'project', kind: 'decision', text: 'use npm' }, 1)
    const first = book.entries[0].id
    book = remember(book, { layer: 'project', kind: 'decision', text: 'use pnpm', supersedes: [first] }, 2)
    const live = recall(book, 'project')
    expect(live).toHaveLength(1)
    expect(live[0].text).toBe('use pnpm')
  })

  it('returns newest first and honours the layer budget', () => {
    let book = emptyMemory()
    for (let i = 0; i < RECALL_LIMITS.project + 5; i++) {
      book = remember(book, { layer: 'project', kind: 'finding', text: `f${i}` }, i + 1)
    }
    const live = recall(book, 'project')
    expect(live).toHaveLength(RECALL_LIMITS.project)
    expect(live[0].text).toBe(`f${RECALL_LIMITS.project + 4}`)
  })

  it('clears task state without touching project or user memory', () => {
    let book = remember(emptyMemory(), { layer: 'task', kind: 'finding', text: 'tmp' })
    book = remember(book, { layer: 'project', kind: 'finding', text: 'keep' })
    book = clearLayer(book, 'task')
    expect(recall(book, 'task')).toHaveLength(0)
    expect(recall(book, 'project')).toHaveLength(1)
  })

  it('surfaces prior failures for a task so a retry does not repeat them', () => {
    let book = remember(emptyMemory(), { layer: 'project', kind: 'failure', text: 'timeout', source: 't1' })
    book = remember(book, { layer: 'project', kind: 'failure', text: 'other', source: 't2' })
    expect(priorFailures(book, 't1').map((e) => e.text)).toEqual(['timeout'])
  })

  it('renders widest context first and volatile context last', () => {
    let book = remember(emptyMemory(), { layer: 'user', kind: 'preference', text: 'pnpm' })
    book = remember(book, { layer: 'project', kind: 'finding', text: 'REST API' })
    book = remember(book, { layer: 'task', kind: 'finding', text: 'endpoint is /v2' })
    const text = renderMemory(book)
    expect(text.indexOf('HOW THIS USER WORKS')).toBeLessThan(text.indexOf('ESTABLISHED IN THIS PROJECT'))
    expect(text.indexOf('ESTABLISHED IN THIS PROJECT')).toBeLessThan(text.indexOf('YOUR WORKING NOTES'))
  })

  it('renders nothing for an empty book', () => {
    expect(renderMemory(emptyMemory())).toBe('')
  })
})

// ── Phase 16: browser worker ────────────────────────────────────────────────

describe('browser artifacts', () => {
  it('produces page-data and sources from a real session', () => {
    const result = {
      ...emptySessionResult(),
      visits: [{ url: 'https://a.com/pricing', at: 0, via: 'dom' as const }],
      data: [{ plan: 'Pro', price: 20 }],
    }
    const artifacts = browserArtifacts(result, 't1')
    expect(artifacts.map((a) => a.path)).toEqual(['browser/page-data.json', 'browser/sources.json'])
    expect(artifacts[0].sources).toBe(1)
  })

  it('produces NOTHING for a blocked session', () => {
    // An empty page-data.json would satisfy an artifact_exists check while
    // containing no data — fake success in its purest form.
    const result = { ...emptySessionResult(), blocked: 'hosted Chrome unavailable' }
    expect(browserArtifacts(result, 't1')).toEqual([])
  })

  it('omits page-data when nothing was extracted but still records sources', () => {
    const result = { ...emptySessionResult(), visits: [{ url: 'https://a.com', at: 0, via: 'dom' as const }] }
    expect(browserArtifacts(result, 't1').map((a) => a.path)).toEqual(['browser/sources.json'])
  })
})

describe('needsVision', () => {
  it('stays with the DOM by default', () => {
    expect(needsVision({ domFailed: false, question: 'what are the pricing tiers' })).toBe(false)
  })

  it('uses vision once the DOM attempt failed', () => {
    expect(needsVision({ domFailed: true, question: 'what are the pricing tiers' })).toBe(true)
  })

  it('uses vision for genuinely visual questions', () => {
    expect(needsVision({ domFailed: false, question: 'does the chart show growth' })).toBe(true)
    expect(needsVision({ domFailed: false, question: 'is the layout broken' })).toBe(true)
  })
})

describe('orderActions', () => {
  it('moves navigation ahead of interaction', () => {
    // Clicking before navigating targets whatever page was already open —
    // usually the previous task's.
    const ordered = orderActions([
      { kind: 'click', target: 'Pricing' },
      { kind: 'navigate', url: 'https://a.com' },
    ])
    expect(ordered[0].kind).toBe('navigate')
  })

  it('leaves an already-correct plan alone', () => {
    const actions = [{ kind: 'navigate' as const, url: 'https://a.com' }, { kind: 'click' as const, target: 'x' }]
    expect(orderActions([...actions])).toEqual(actions)
  })
})

describe('distinctHosts', () => {
  it('counts independent hosts, ignoring www', () => {
    const hosts = distinctHosts([
      { url: 'https://www.a.com/x', at: 0, via: 'dom' },
      { url: 'https://a.com/y', at: 0, via: 'dom' },
      { url: 'https://b.com', at: 0, via: 'dom' },
    ])
    expect(hosts).toEqual(['a.com', 'b.com'])
  })

  it('ignores anything that is not a URL', () => {
    expect(distinctHosts([{ url: 'not a url', at: 0, via: 'dom' }])).toEqual([])
  })
})
