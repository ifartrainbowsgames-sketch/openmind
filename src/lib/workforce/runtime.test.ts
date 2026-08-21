import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_ROOT, isSimulated, makeWorkspace, parseExitCode, stripEnvelope, toExecResult,
} from './runtime'
import {
  SESSION_IDLE_MS, closed, isResumable, isStale, newSession, touch,
} from './sessions'
import { scopeKey, type SessionScope } from './session-repository'

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
  const scope: SessionScope = { kind: 'project', projectId: 'p1', worker: 'code' }

  it('creates a session on first open', () => {
    const session = newSession(scope, 'builtin')
    expect(session.status).toBe('running')
    expect(session.provider).toBe('builtin')
    expect(session.scope).toEqual(scope)
  })

  it('derives one id per scope and provider', () => {
    // The whole point: a coder should not re-clone and re-read the repo for
    // every task in a project, so the same scope must name the same session.
    expect(newSession(scope, 'builtin').id).toBe(newSession(scope, 'builtin').id)
    expect(newSession(scope, 'builtin').id).not.toBe(newSession(scope, 'claude-code').id)
    expect(newSession(scope, 'builtin').id)
      .not.toBe(newSession({ ...scope, worker: 'tester' }, 'builtin').id)
  })

  it('separates a conversation from a project with the same name', () => {
    // Conversations and tasks share the lifecycle and must not share the key —
    // that collision is how a chat turn ended up on a task's machine.
    const conversation: SessionScope = { kind: 'conversation', conversationId: 'p1' }
    expect(scopeKey(conversation, 'builtin')).not.toBe(scopeKey(scope, 'builtin'))
  })

  it('does not resume a session that went stale', () => {
    const session = newSession(scope, 'builtin', 0)
    expect(isResumable(session, SESSION_IDLE_MS + 1)).toBe(false)
    expect(isResumable(session, SESSION_IDLE_MS - 1)).toBe(true)
  })

  it('does not resume a failed session', () => {
    // Whatever broke the workspace is still there; resuming turns one bad task
    // into a bad session.
    expect(isResumable(touch(newSession(scope, 'builtin'), { status: 'failed' }))).toBe(false)
  })

  it('keeps the workspace id across a failure', () => {
    // A failure is not a reason to forget which machine holds the half-finished
    // work.
    const failed = touch(newSession(scope, 'builtin'), { workspaceId: 'ws-1', status: 'failed' })
    expect(failed.workspaceId).toBe('ws-1')
  })

  it('records task ids without duplicating them', () => {
    let session = newSession(scope, 'builtin')
    session = touch(session, { taskId: 't1' })
    session = touch(session, { taskId: 't1' })
    session = touch(session, { taskId: 't2' })
    expect(session.taskIds).toEqual(['t1', 't2'])
  })

  it('stores a provider session id for resumable external agents', () => {
    const session = touch(newSession(scope, 'claude-code'), { providerSessionId: 'abc-123' })
    expect(session.providerSessionId).toBe('abc-123')
  })

  it('reports stale sessions but never closed ones', () => {
    const session = newSession(scope, 'builtin', 0)
    expect(isStale(session, SESSION_IDLE_MS + 1)).toBe(true)
    expect(isStale(closed(session, 0), SESSION_IDLE_MS + 1)).toBe(false)
  })
})
