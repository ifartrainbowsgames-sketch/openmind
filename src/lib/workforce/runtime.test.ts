import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_ROOT, isSimulated, makeWorkspace, parseExitCode, stripEnvelope, toExecResult,
} from './runtime'
import {
  SESSION_IDLE_MS, closeSession, emptySessionStore, isResumable, openSession,
  recordActivity, sessionsFor, staleSessions,
} from './sessions'

describe('tool output classification', () => {
  it('recognises mock output', () => {
    expect(isSimulated('[MOCK · run_code] Simulated sandbox for: print(1)')).toBe(true)
  })

  it('recognises a live call that fell back to mock', () => {
    expect(isSimulated('[LIVE FAILED → MOCK] duckduckgo: no parseable results')).toBe(true)
  })

  it('does not flag a genuine live result', () => {
    expect(isSimulated('[LIVE · run_code] exit=0\n42')).toBe(false)
  })

  it('reads the exit code out of the envelope', () => {
    expect(parseExitCode('[LIVE · run_checks] exit=1\nCHECKS FAILED')).toBe(1)
    expect(parseExitCode('[LIVE · git_clone] exit=128\nfatal: ...')).toBe(128)
    expect(parseExitCode('no envelope here')).toBeUndefined()
  })

  it('strips the envelope and keeps the body', () => {
    expect(stripEnvelope('[LIVE · workspace_read_file] exit=0\nhello\nworld')).toBe('hello\nworld')
  })
})

describe('toExecResult', () => {
  it('marks simulated output as never having run', () => {
    // The critical case: reporting exitCode 0 for fabricated output would tell
    // a caller the command succeeded.
    const result = toExecResult('[MOCK · run_code] Simulated sandbox')
    expect(result.ran).toBe(false)
    expect(result.exitCode).not.toBe(0)
  })

  it('reports a successful command with its output as stdout', () => {
    const result = toExecResult('[LIVE · run_code] exit=0\n42')
    expect(result).toMatchObject({ ran: true, exitCode: 0, stdout: '42', stderr: '' })
  })

  it('routes a failing command output to stderr', () => {
    const result = toExecResult('[LIVE · run_checks] exit=1\nCHECKS FAILED')
    expect(result.ran).toBe(true)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('CHECKS FAILED')
    expect(result.stdout).toBe('')
  })

  it('treats envelope-less output as an unknown but real run', () => {
    const result = toExecResult('plain output')
    expect(result.ran).toBe(true)
    expect(result.stdout).toBe('plain output')
  })
})

describe('makeWorkspace', () => {
  it('roots at the same path the tools use', () => {
    expect(makeWorkspace('p1').path).toBe(WORKSPACE_ROOT)
    expect(makeWorkspace('p1').worktree).toBe(false)
  })
})

describe('sessions', () => {
  const base = { projectId: 'p1', worker: 'code' as const }

  it('creates a session on first open', () => {
    const { session, resumed } = openSession(emptySessionStore(), base)
    expect(resumed).toBe(false)
    expect(session.status).toBe('running')
    expect(session.provider).toBe('builtin')
  })

  it('resumes the same session for the same project and worker', () => {
    // The whole point: a coder should not re-clone and re-read the repo for
    // every task in a project.
    const first = openSession(emptySessionStore(), base)
    const second = openSession(first.store, base)
    expect(second.resumed).toBe(true)
    expect(second.session.id).toBe(first.session.id)
  })

  it('keeps sessions separate per worker and per provider', () => {
    let store = openSession(emptySessionStore(), base).store
    store = openSession(store, { ...base, worker: 'tester' }).store
    store = openSession(store, { ...base, provider: 'claude-code' }).store
    expect(sessionsFor(store, 'p1')).toHaveLength(3)
  })

  it('does not resume a session that went stale', () => {
    const { store, session } = openSession(emptySessionStore(), base, 0)
    expect(isResumable(session, SESSION_IDLE_MS + 1)).toBe(false)
    const reopened = openSession(store, base, SESSION_IDLE_MS + 1)
    expect(reopened.resumed).toBe(false)
  })

  it('does not resume a failed session', () => {
    // Whatever broke the workspace is still there; resuming turns one bad task
    // into a bad session.
    const opened = openSession(emptySessionStore(), base)
    const session = opened.session
    let store = opened.store
    store = recordActivity(store, session.id, { status: 'failed' })
    expect(openSession(store, base).resumed).toBe(false)
  })

  it('carries the workspace across a rebuild after failure', () => {
    const opened = openSession(emptySessionStore(), base, 0)
    const session = opened.session
    let store = opened.store
    store = recordActivity(store, session.id, {
      status: 'failed',
      workspace: { id: 'ws-1', projectId: 'p1', path: '/w' },
    })
    const again = openSession(store, base)
    expect(again.resumed).toBe(false)
    expect(again.session.workspace?.id).toBe('ws-1')
  })

  it('records task ids without duplicating them', () => {
    const opened = openSession(emptySessionStore(), base)
    const session = opened.session
    let store = opened.store
    store = recordActivity(store, session.id, { taskId: 't1' })
    store = recordActivity(store, session.id, { taskId: 't1' })
    store = recordActivity(store, session.id, { taskId: 't2' })
    expect(store.sessions[session.id].taskIds).toEqual(['t1', 't2'])
  })

  it('stores a provider session id for resumable external agents', () => {
    const opened = openSession(emptySessionStore(), { ...base, provider: 'claude-code' })
    const session = opened.session
    let store = opened.store
    store = recordActivity(store, session.id, { providerSessionId: 'abc-123' })
    expect(store.sessions[session.id].providerSessionId).toBe('abc-123')
  })

  it('ignores activity for an unknown session rather than inventing one', () => {
    const store = recordActivity(emptySessionStore(), 'nope', { taskId: 't1' })
    expect(Object.keys(store.sessions)).toHaveLength(0)
  })

  it('lists stale sessions but never closed ones', () => {
    const opened = openSession(emptySessionStore(), base, 0)
    const session = opened.session
    let store = opened.store
    expect(staleSessions(store, SESSION_IDLE_MS + 1)).toHaveLength(1)
    store = closeSession(store, session.id, 0)
    expect(staleSessions(store, SESSION_IDLE_MS + 1)).toHaveLength(0)
  })
})
