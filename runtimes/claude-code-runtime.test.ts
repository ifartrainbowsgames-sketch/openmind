import { describe, expect, it } from 'vitest'
import {
  CLAUDE_CODE_CAPABILITIES, buildPrompt, parseStatus, parseStreamLine, toolResultText,
} from './claude-code-runtime'
import { confine } from './local-runtime'
import { runtimeShortfall } from '../src/lib/workforce/capabilities'
import type { TaskContext } from '../src/lib/workforce/agent-runtime'
import type { TaskRecord } from '../src/lib/task-ledger'

/**
 * Claude Code is the conformance test for AgentRuntime, so most of what
 * matters is proved live by scripts/verify-claude-code.ts against the real
 * CLI. What lives here is the parsing and policy that a live run would only
 * exercise by accident, plus the boundary that keeps the integration honest.
 */

const task: TaskRecord = {
  id: 't1', type: 'code', goal: 'write a file', inputs: {}, outputs: ['notes.md'], dependsOn: [],
  status: 'running', worker: 'code',
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
}

const context = (text: string, failures: string[] = []): TaskContext => ({
  memory: {
    text,
    entries: [],
    priorFailures: failures.map((t, i) => ({
      id: `f${i}`, layer: 'project' as const, kind: 'failure' as const, text: t, createdAt: 0,
    })),
  },
})

describe('the prompt', () => {
  it('carries canonical memory', () => {
    const prompt = buildPrompt(task, context('ESTABLISHED: the port is 8080'), false)
    expect(prompt).toContain('the port is 8080')
    expect(prompt).toContain('t1')
    expect(prompt).toContain('notes.md')
  })

  it('tells a resumed session that OpenMind memory outranks what it remembers', () => {
    // The whole risk of a resumable provider: it argues with its own
    // recollection. Claude Code's session context is local continuity;
    // OpenMind's memory is the project's facts.
    const resumed = buildPrompt(task, context('ESTABLISHED: the port is 8080'), true)
    expect(resumed).toMatch(/canonical|wins/i)
    expect(buildPrompt(task, context('x'), false)).not.toMatch(/Where it disagrees/)
  })

  it('passes prior failures forward so a retry does not repeat them', () => {
    const prompt = buildPrompt(task, context('', ['forgot to run the tests']), false)
    expect(prompt).toContain('forgot to run the tests')
  })
})

describe('the provider stream', () => {
  it('reads a JSON line and ignores anything else', () => {
    expect(parseStreamLine('{"type":"system","subtype":"init"}')).toEqual({ type: 'system', subtype: 'init' })
    expect(parseStreamLine('not json')).toBeNull()
    expect(parseStreamLine('')).toBeNull()
  })

  it('survives a truncated line rather than failing the task', () => {
    // Stream framing is the transport's business. A half-written line is not
    // a reason to fail work the provider may have completed.
    expect(parseStreamLine('{"type":"assis')).toBeNull()
  })

  it('flattens a tool result to the text a model would have seen', () => {
    expect(toolResultText('plain')).toBe('plain')
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb')
    expect(toolResultText(undefined)).toBe('')
  })

  it('reads changed paths out of git status', () => {
    expect(parseStatus(' M src/a.ts\n?? new.md\n')).toEqual(['src/a.ts', 'new.md'])
  })
})

describe('what this runtime claims it can do', () => {
  it('does not claim capabilities it has no tools for', () => {
    // A capability listed here that the provider cannot serve makes the
    // scheduler confident and wrong.
    expect(CLAUDE_CODE_CAPABILITIES.skills.has('filesystem.write')).toBe(true)
    expect(CLAUDE_CODE_CAPABILITIES.skills.has('terminal.exec')).toBe(true)
    expect(CLAUDE_CODE_CAPABILITIES.skills.has('browser.act')).toBe(false)
    expect(CLAUDE_CODE_CAPABILITIES.skills.has('mcp.call')).toBe(false)
  })

  it('is eligible for coding work and not for browser work', () => {
    expect(runtimeShortfall('code', CLAUDE_CODE_CAPABILITIES)).toEqual([])
    expect(runtimeShortfall('browser', CLAUDE_CODE_CAPABILITIES)).toEqual(['browser.navigate'])
  })

  it('reports resumable but not checkpointable', () => {
    // It resumes a conversation, not a machine. The workspace can be gone
    // while the session id still resolves, which is why recovery verifies the
    // workspace separately.
    expect(CLAUDE_CODE_CAPABILITIES.traits.resumable).toBe(true)
    expect(CLAUDE_CODE_CAPABILITIES.traits.checkpointable).toBe(false)
  })
})

describe('the local runtime confines paths to its workspace', () => {
  it('resolves an ordinary relative path', () => {
    expect(confine('/root', 'src/a.ts')).toBe('/root/src/a.ts')
    expect(confine('/root', './a.ts')).toBe('/root/a.ts')
    expect(confine('/root', '.')).toBe('/root')
  })

  it('refuses to escape', () => {
    // A runtime that reads /etc/passwd because an agent asked nicely is not a
    // workspace. Rejected rather than clamped: silently rewriting a path means
    // writing somewhere the caller did not name.
    expect(() => confine('/root', '../secrets')).toThrow()
    expect(() => confine('/root', '/etc/passwd')).toThrow()
    expect(() => confine('/root', 'C:/Windows')).toThrow()
    expect(() => confine('/root', 'a/../../b')).toThrow()
  })

  it('allows traversal that stays inside', () => {
    expect(confine('/root', 'a/../b')).toBe('/root/b')
  })
})

// ── Gate 9 ──────────────────────────────────────────────────────────────────

const appSources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

const runtimeSources = import.meta.glob('/runtimes/**/*.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

describe('there is no Claude Code path outside AgentRuntime', () => {
  it('finds both trees, so the checks are not vacuous', () => {
    expect(Object.keys(appSources).length).toBeGreaterThan(20)
    expect(Object.keys(runtimeSources).length).toBeGreaterThan(1)
  })

  it('only the runtime speaks the Claude Code CLI protocol', () => {
    // Not "only it spawns a process" — `local-runtime` spawns shell commands,
    // which is its entire job. The thing that must have exactly one home is
    // knowledge of *this provider's* wire format.
    const speakers = Object.entries({ ...appSources, ...runtimeSources })
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => /stream-json|--resume/.test(text))
      .map(([path]) => path)
    expect(speakers).toEqual(['/runtimes/claude-code-runtime.ts'])
  })

  it('no browser code imports a node-only runtime', () => {
    // These files load node:child_process and node:fs. An app import would
    // break the bundle — or worse, succeed and ship a spawn call to a browser.
    const offenders = Object.entries(appSources)
      .filter(([, text]) => /from '[^']*runtimes\/(claude-code|local)-runtime'/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('the runtime implements the kernel contract rather than a private one', () => {
    const text = runtimeSources['/runtimes/claude-code-runtime.ts']
    expect(text).toMatch(/AgentRuntime/)
    expect(text).toMatch(/runTask\(/)
    expect(text).toMatch(/taskContext: TaskContext/)
    // And memory reaches it through the kernel's context, not a private store.
    expect(text).toMatch(/buildPrompt\(task, taskContext/)
  })

  it('never falls back to another agent', () => {
    // A missing or broken provider must fail the task. Substituting the
    // builtin runtime would answer with a different agent entirely and look
    // like success.
    const text = runtimeSources['/runtimes/claude-code-runtime.ts']
    expect(text).not.toMatch(/createBuiltinRuntime|runEmployee/)
  })
})
