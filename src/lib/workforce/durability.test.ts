import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinRuntime } from './builtin-runtime'
import { emptyTaskContext } from './agent-runtime'
import { BUILTIN_CAPABILITIES } from './builtin-runtime'
import { createExecutionContext, NULL_SINK, type ExecutionContext } from './execution-context'
import { newSession, touch } from './sessions'
import {
  _resetRepositories, memorySessionRepository, memoryWorkspaceRepository,
  scopeKey, type Repositories, type SessionScope,
} from './session-repository'
import {
  makeWorkspaceRecord, recoverWorkspace, toWorkspace, verifyWorkspace,
  type WorkspaceRecord,
} from './workspaces'
import type { ExecResult, GitResult, Runtime, Workspace } from './runtime'
import type { AgentBrain, PlanStep } from '../agent'
import type { OpenMindEvent } from './events'
import type { TaskRecord } from '../task-ledger'

vi.mock('../supabase')

/**
 * Durable sessions and workspace recovery.
 *
 * Two failures live here, and they are different:
 *
 *   session durability   who was working, and what they had served
 *   machine durability   whether the sandbox behind the pointer still exists
 *
 * `ProjectState.sandboxId` surviving a restart only ever solved the first. The
 * second is the dangerous one, because a dead sandbox id reads exactly like a
 * live one and the tool backend will happily provision a replacement and
 * report success.
 */

const scope: SessionScope = { kind: 'project', projectId: 'p1', worker: 'code' }

afterEach(() => _resetRepositories())

function repos(): Repositories {
  return { sessions: memorySessionRepository(), workspaces: memoryWorkspaceRepository() }
}

const ok = (stdout = 'ok'): ExecResult => ({ exitCode: 0, stdout, stderr: '', ran: true })
const dead = (): ExecResult => ({ exitCode: -1, stdout: '', stderr: 'no sandbox', ran: false })

function fakeRuntime(exec: () => Promise<ExecResult>): Runtime {
  return {
    id: 'fake',
    readFile: async () => '',
    writeFile: async () => undefined,
    list: async () => [],
    exec,
    git: async () => ({ ...ok(), summary: undefined }) as GitResult,
    createWorkspace: async () => ({ id: 'w', projectId: 'p1', path: '/w' }),
  }
}

/** A context whose probe can substitute a different machine, like the real one. */
function probeContext(input: {
  workspace: Workspace
  exec?: () => Promise<ExecResult>
  substitutes?: string
}): ExecutionContext {
  const ctx = createExecutionContext({
    session: newSession(scope, 'builtin'),
    runtime: () => fakeRuntime(async () => {
      if (input.substitutes) ctx.adoptSandbox(input.substitutes)
      return (input.exec ?? (async () => ok()))()
    }),
    workspace: input.workspace,
    capabilities: BUILTIN_CAPABILITIES,
    permissions: { platformKeys: false },
    eventSink: NULL_SINK,
  })
  return ctx
}

const record = (over: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  ...makeWorkspaceRecord({ projectId: 'p1', externalId: 'sbx-1' }),
  ...over,
})

describe('verifying a machine', () => {
  it('reports active when it answers from the machine we asked about', async () => {
    const r = record()
    const verified = await verifyWorkspace(r, probeContext({ workspace: toWorkspace(r) }))
    expect(verified.status).toBe('active')
    expect(verified.lastVerifiedAt).toBeDefined()
  })

  it('reports missing when a DIFFERENT machine served the probe', async () => {
    // The one an exit code cannot catch. The backend provisions a fresh sandbox
    // when the id it is given no longer exists, and returns success — so the
    // probe passes, from a machine holding none of the previous task's files.
    const r = record()
    const verified = await verifyWorkspace(r, probeContext({
      workspace: toWorkspace(r),
      substitutes: 'sbx-replacement',
    }))
    expect(verified.status).toBe('missing')
  })

  it('reports missing when the command never ran', async () => {
    const r = record()
    const verified = await verifyWorkspace(r, probeContext({
      workspace: toWorkspace(r),
      exec: async () => dead(),
    }))
    expect(verified.status).toBe('missing')
  })

  it('reports failed when the machine lives but the directory is gone', async () => {
    const r = record()
    const verified = await verifyWorkspace(r, probeContext({
      workspace: toWorkspace(r),
      exec: async () => ({ exitCode: 1, stdout: '', stderr: '', ran: true }),
    }))
    expect(verified.status).toBe('failed')
  })

  it('does not probe a record that never had a machine', async () => {
    let probed = false
    const r = makeWorkspaceRecord({ projectId: 'p1' })
    const verified = await verifyWorkspace(r, probeContext({
      workspace: toWorkspace(r),
      exec: async () => { probed = true; return ok() },
    }))
    expect(probed).toBe(false)
    expect(verified.status).toBe('active')
  })
})

describe('recovering a workspace', () => {
  it('resumes a live machine', async () => {
    const r = record()
    const out = await recoverWorkspace({ record: r, context: probeContext({ workspace: toWorkspace(r) }) })
    expect(out.kind).toBe('resumed')
  })

  it('treats a never-provisioned record as a first run, not a resumption', async () => {
    const r = makeWorkspaceRecord({ projectId: 'p1' })
    const out = await recoverWorkspace({ record: r, context: probeContext({ workspace: toWorkspace(r) }) })
    expect(out.kind).toBe('resumed')
    if (out.kind === 'resumed') expect(out.workspace.sandboxId).toBeUndefined()
  })

  it('asks the user rather than provisioning a replacement', async () => {
    // The whole point. A new empty sandbox would run, and would be wrong: the
    // first thing a resumed task does is assume its files are there.
    const r = record()
    const out = await recoverWorkspace({
      record: r,
      context: probeContext({ workspace: toWorkspace(r), exec: async () => dead() }),
    })
    expect(out.kind).toBe('needs_user')
    if (out.kind === 'needs_user') expect(out.reason).toContain('sbx-1')
  })

  it('recreates only when something can actually restore it', async () => {
    const r = record()
    const out = await recoverWorkspace({
      record: r,
      context: probeContext({ workspace: toWorkspace(r), exec: async () => dead() }),
      restore: async () => ({
        workspace: { id: 'w', projectId: 'p1', path: '/home/user/project', sandboxId: 'sbx-new' },
        from: { sessionId: 's', at: 1 },
      }),
    })
    expect(out.kind).toBe('recreated')
    if (out.kind === 'recreated') expect(out.workspace.sandboxId).toBe('sbx-new')
  })

  it('reports a closed workspace as lost', async () => {
    const r = record({ status: 'closed' })
    const out = await recoverWorkspace({ record: r, context: probeContext({ workspace: toWorkspace(r) }) })
    expect(out.kind).toBe('lost')
  })
})

// ── The runtime, across instances ───────────────────────────────────────────

const task = (id: string): TaskRecord => ({
  id, type: 'code', goal: `task ${id}`, inputs: {}, outputs: [], dependsOn: [],
  status: 'running', worker: 'code',
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
})

function brain(steps: PlanStep[] = []): AgentBrain {
  return { plan: async () => steps, respond: async () => 'done' }
}

const deps = (shared: Repositories) => ({
  brain: brain(),
  employeeFor: () => ({
    id: 'worker-code', name: 'Code', role: 'code worker', prompt: 'p', tools: [], accent: '#000',
  }),
  promptFor: () => 'prompt',
  repositories: shared,
})

async function drain(events: AsyncIterable<OpenMindEvent>): Promise<OpenMindEvent[]> {
  const out: OpenMindEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

describe('sessions outlive the runtime instance that made them', () => {
  it('a second runtime sees the first one\'s session', async () => {
    // The concurrency half of the same problem: the runtime stays per-run
    // because it holds the brain and the prompt, so two runs must not have
    // private, divergent stores.
    const shared = repos()
    const first = createBuiltinRuntime(deps(shared))
    const a = await first.createSession({ projectId: 'p1', worker: 'code' })
    await drain(first.runTask(a, task('t1'), emptyTaskContext()))

    const second = createBuiltinRuntime(deps(shared))
    const b = await second.createSession({ projectId: 'p1', worker: 'code' })
    expect(b.id).toBe(a.id)
    expect(b.taskIds).toContain('t1')
  })

  it('keeps the task history a session served', async () => {
    // Regression: the runtime touched the *parameter* session for each write,
    // so the last save discarded the first and the history came back empty.
    const shared = repos()
    const runtime = createBuiltinRuntime(deps(shared))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))
    await drain(runtime.runTask(session, task('t2'), emptyTaskContext()))
    const after = await runtime.resumeSession(session.id)
    expect(after?.taskIds).toEqual(['t1', 't2'])
  })

  it('does not resume a session another process closed', async () => {
    const shared = repos()
    const first = createBuiltinRuntime(deps(shared))
    const a = await first.createSession({ projectId: 'p1', worker: 'code' })
    await first.close(a.id)

    const second = createBuiltinRuntime(deps(shared))
    const b = await second.createSession({ projectId: 'p1', worker: 'code' })
    // Same id — the scope is the identity — but a fresh, running session.
    expect(b.id).toBe(a.id)
    expect(b.status).toBe('running')
    expect(b.taskIds).toEqual([])
  })
})

describe('a conversation and a project never collide', () => {
  it('scopes to different session ids even with the same name', () => {
    // This collision is precisely how a chat turn ended up on a task's machine.
    const project = scopeKey({ kind: 'project', projectId: 'x', worker: 'code' }, 'builtin')
    const conversation = scopeKey({ kind: 'conversation', conversationId: 'x' }, 'builtin')
    expect(project).not.toBe(conversation)
  })

  it('stores both through the same repository', async () => {
    const shared = repos()
    const conversation: SessionScope = { kind: 'conversation', conversationId: 'u1' }
    await shared.sessions.save(touch(newSession(conversation, 'builtin'), { workspaceId: 'ws-c' }))
    const found = await shared.sessions.find(conversation, 'builtin')
    expect(found?.workspaceId).toBe('ws-c')
    // And a project scope does not find it.
    expect(await shared.sessions.find(scope, 'builtin')).toBeNull()
  })
})
