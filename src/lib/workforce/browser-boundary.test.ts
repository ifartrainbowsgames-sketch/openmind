import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTaskGraph } from '../task-runner'
import { toolArtifacts } from '../task-runner'
import { ALL_TOOLS } from '../agent/connections'
import { normalizeToolResult } from '../agent'
import { withExecutionMode } from '../execution-mode'
import {
  _resetRuntimes, registerRuntime,
  type AgentRuntime, type AgentSession,
} from './agent-runtime'
import { ALL_CAPABILITIES, runtimeCapabilities } from './capabilities'
import { runBrowserPlan } from './browser-worker'
import { actionsFromWebAct, extractFields, parseWebActOutput, toWebActRequest } from './browser-provider'
import { emptySessionResult, type BrowserProvider, type BrowserSessionResult } from './browser-runtime'
import { event, type OpenMindEvent } from './events'
import type { RunResult } from '../agent'
import type { TaskRecord } from '../task-ledger'

vi.mock('../supabase')

/**
 * The browser invariant, stated like the runtime one:
 *
 *   No production browser task can complete without going through a
 *   BrowserProvider.
 *
 * Before this, `BrowserProvider` was an interface nothing implemented and
 * `web_act` was a tool returning prose. The architecture was clean and dead,
 * while the real path went straight to the transport — the same split-brain
 * the kernel has been eliminating everywhere else.
 */

const task = (id: string, worker: TaskRecord['worker'] = 'browser'): TaskRecord => ({
  id, type: worker, goal: `task ${id}`, inputs: {}, outputs: ['browser/page-data.json'], dependsOn: [],
  status: 'running', worker,
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
})

function fakeProvider(over: Partial<BrowserProvider> = {}): BrowserProvider {
  return {
    id: 'fake',
    available: async () => true,
    run: async (): Promise<BrowserSessionResult> => ({
      visits: [{ url: 'https://a.com/pricing', at: 0, via: 'dom' }],
      data: [{ url: 'https://a.com/pricing', text: 'Pro: $20' }],
      screenshots: [],
      downloads: [],
    }),
    ...over,
  }
}

// ── The tool goes through the provider ──────────────────────────────────────

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('the browser has exactly one production path', () => {
  it('only the provider talks to the web_act transport', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => /invokeCrewTool\(\s*'web_act'/.test(text))
      .map(([path]) => path)

    expect(
      offenders,
      'web_act must be reached through a BrowserProvider. A direct call recreates ' +
      'the prose-returning path that the browser split exists to remove.',
    ).toEqual(['/src/lib/workforce/browser-provider.ts'])
  })

  it('the tool runs a plan rather than forwarding a string', () => {
    const tools = sources['/src/lib/agent/tools.ts']
    expect(tools).toMatch(/runBrowserPlan\(/)
    expect(tools).toMatch(/webActProvider\(ctx\)/)
    // The old shape, gone: a bare forward with no session, no plan, no artifacts.
    expect(tools).not.toMatch(/invokeCrewTool\('web_act', q/)
  })

  it('both halves of the split are now reachable from production', () => {
    // The point of the exercise. They were correct and imported by nothing.
    // Static and dynamic imports both count — the tool loads the provider
    // lazily, and a reachability check that only saw `from '...'` would report
    // the file as an orphan while it was running in production.
    const importers = (module: string) => Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.endsWith(`${module}.ts`))
      .filter(([, text]) => text.includes(`'../workforce/${module}'`) || text.includes(`'./${module}'`))
      .map(([path]) => path)

    expect(importers('browser-provider').length).toBeGreaterThan(0)
    expect(importers('browser-worker').length).toBeGreaterThan(0)
    expect(importers('browser-runtime').length).toBeGreaterThan(0)
  })
})

// ── The plan runner refuses what it cannot do ───────────────────────────────

describe('runBrowserPlan', () => {
  it('produces artifacts from a real session', async () => {
    const { result, artifacts } = await runBrowserPlan(fakeProvider(), [
      { kind: 'navigate', url: 'https://a.com/pricing' },
    ])
    expect(result.blocked).toBeUndefined()
    expect(artifacts.map((a) => a.path)).toEqual(['browser/page-data.json', 'browser/sources.json'])
  })

  it('produces nothing when the provider is unavailable', async () => {
    const { result, artifacts } = await runBrowserPlan(
      fakeProvider({ available: async () => false }),
      [{ kind: 'navigate', url: 'https://a.com' }],
    )
    expect(result.blocked).toContain('not available')
    expect(artifacts).toEqual([])
  })

  it('normalises a plan that acts before it navigates', async () => {
    let seen: string[] = []
    await runBrowserPlan(
      fakeProvider({
        run: async (actions) => {
          seen = actions.map((a) => a.kind)
          return emptySessionResult()
        },
      }),
      [{ kind: 'click', target: '#next' }, { kind: 'navigate', url: 'https://a.com' }],
    )
    // Clicking before navigating targets whatever page happened to be open.
    expect(seen[0]).toBe('navigate')
  })
})

// ── The provider is honest about what it cannot do ──────────────────────────

describe('the web_act provider', () => {
  it('refuses a screenshot rather than silently returning DOM text', async () => {
    // A vision step that quietly becomes a DOM step produces an answer about a
    // chart nobody looked at.
    const { webActProvider } = await import('./browser-provider')
    const result = await webActProvider().run([
      { kind: 'navigate', url: 'https://a.com' },
      { kind: 'screenshot' },
    ])
    expect(result.blocked).toContain('screenshot')
    expect(result.visits).toEqual([])
  })

  it('refuses a plan with no navigation', () => {
    expect(toWebActRequest([{ kind: 'click', target: '#a' }])).toBeUndefined()
    expect(toWebActRequest([{ kind: 'navigate', url: 'https://a.com' }])?.url).toBe('https://a.com')
  })

  it.each([
    ['[MOCK · web_act] Hosted Chrome not configured.', 'a mock'],
    ['TASK_BLOCKED [capability_unavailable] required capability "web_act" unavailable', 'a strict refusal'],
    ['[BLOCKED · web_act] You declined this action.', 'a declined confirmation'],
    ['[LIVE FAILED · web_act] browserless 402', 'a failed live call'],
  ])('treats %s as no visit at all', (output) => {
    // Three different refusal formats, none of which looks like the others.
    // Missing one is silent: the refusal text becomes the page content and the
    // URL becomes a source nobody visited.
    const request = { url: 'https://a.com', goal: 'read the page', steps: [] }
    const result = parseWebActOutput(output, request, [])
    expect(result.blocked).toBeTruthy()
    expect(result.visits).toEqual([])
  })

  it('records a real visit from a live envelope', () => {
    const request = { url: 'https://a.com', goal: 'extract: price', steps: [] }
    const output = '[LIVE · web_act · chrome] https://a.com/pricing\nGoal: extract: price\nPro plan\nprice: $20'
    const result = parseWebActOutput(output, request, ['price'])
    expect(result.blocked).toBeUndefined()
    expect(result.visits[0].url).toBe('https://a.com/pricing')
    expect((result.data[0] as { fields: Record<string, string> }).fields.price).toBe('$20')
  })

  it('reports a field it could not find instead of an empty value', () => {
    // An empty string looks like a value that was read, and nothing downstream
    // can tell the difference.
    const found = extractFields('Pro plan\nprice: $20', ['price', 'seats'])
    expect(found).toEqual({ price: '$20' })
    expect('seats' in found).toBe(false)
  })

  it('carries clicks and typing into the request', () => {
    const actions = actionsFromWebAct({
      url: 'https://a.com',
      goal: 'extract: price, plan',
      steps: [{ click: '#more' }, { type: { selector: '#q', text: 'hi' } }],
    })
    expect(actions.map((a) => a.kind)).toEqual(['navigate', 'click', 'type', 'extract'])
    expect(actions.at(-1)?.fields).toEqual(['price', 'plan'])
    const request = toWebActRequest(actions)
    expect(request?.steps).toEqual([
      { click: '#more' },
      { type: { selector: '#q', text: 'hi' } },
    ])
  })
})

// ── The tool, end to end, in the environment it actually runs in ────────────

describe('the web_act tool', () => {
  it('returns no artifacts from a mocked browser', async () => {
    const raw = await ALL_TOOLS.web_act.run('{"url":"https://a.com","goal":"read"}')
    const result = normalizeToolResult(raw)
    expect(result.source).toBe('mock')
    expect(result.artifacts ?? []).toEqual([])
  })

  it('reports a blocked capability in strict mode', async () => {
    const result = await withExecutionMode('strict', async () =>
      normalizeToolResult(await ALL_TOOLS.web_act.run('{"url":"https://a.com","goal":"read"}')))
    expect(result.error?.kind).toBe('blocked')
  })
})

// ── Tool artifacts reach the ledger ─────────────────────────────────────────

describe('a file a tool wrote becomes a ledger artifact', () => {
  const withArtifacts: RunResult = {
    answer: 'I looked at the page.',
    plan: [],
    toolCalls: [{
      tool: 'web_act',
      input: 'x',
      output: '[LIVE · web_act] https://a.com',
      artifacts: [{ path: 'browser/sources.json', body: '{"sources":[{"url":"https://a.com"}]}' }],
    }],
    trace: [],
  }

  it('records it with the sources counted from its own body', () => {
    const records = toolArtifacts(task('t1'), withArtifacts)
    expect(records).toHaveLength(1)
    expect(records[0].path).toBe('browser/sources.json')
    expect(records[0].sources).toBe(1)
    // Better provenance than a parsed answer: these bytes came from a tool.
    expect(records[0].confidence).toBeGreaterThan(0.8)
  })

  it('ignores artifacts from a failed call', () => {
    const failed: RunResult = {
      ...withArtifacts,
      toolCalls: [{ ...withArtifacts.toolCalls[0], error: { kind: 'blocked', message: 'no chrome' } }],
    }
    expect(toolArtifacts(task('t1'), failed)).toEqual([])
  })

  it('reaches the project ledger through a real run', async () => {
    _resetRuntimes()
    const runtime: AgentRuntime = {
      id: 'artifact-runtime',
      capabilities: async () => runtimeCapabilities(ALL_CAPABILITIES, {
        resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
      }),
      createSession: async (input): Promise<AgentSession> => ({
        id: `x:${input.projectId}:${input.worker}`,
        scope: { kind: 'project', projectId: input.projectId, worker: input.worker },
      provider: 'x',
        status: 'running', taskIds: [], startedAt: Date.now(), lastActivityAt: Date.now(),
      }),
      resumeSession: async () => null,
      async *runTask(session, t): AsyncIterable<OpenMindEvent> {
        yield event('task_finished', 'done', {
          sessionId: session.id, taskId: t.id, worker: t.worker,
          outcome: 'completed', result: withArtifacts,
        })
      },
      checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
      inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
      cancel: async () => {},
      close: async () => {},
    }
    registerRuntime(runtime, true)

    const run = await runTaskGraph('browse a pricing page', {
      plan: async () => [],
      respond: async () => 'done',
    }, { runtimeId: 'artifact-runtime' })

    // ToolCall.artifacts existed and nothing read it — a tool that wrote a real
    // file had it discarded, and the ledger kept only the model's account of it.
    expect(run.project.artifacts.some((a) => a.path === 'browser/sources.json')).toBe(true)
    _resetRuntimes()
  })
})

beforeEach(() => _resetRuntimes())
afterEach(() => _resetRuntimes())
