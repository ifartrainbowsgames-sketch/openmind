import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinRuntime } from './builtin-runtime'
import { getActiveSandbox, setActiveSandbox } from '../crew-tools'
import type { AgentBrain } from '../agent'
import type { OpenMindEvent } from './events'
import type { TaskRecord } from '../task-ledger'

vi.mock('../supabase')

/**
 * The invariant: one AgentSession has exactly one Workspace identity, and every
 * filesystem, terminal and git operation during that session resolves through it.
 *
 * The failure this prevents is the nastiest kind available here — everything
 * appears live and nothing errors, but the coder edits one sandbox while
 * `inspectWorkspace()` reads another. Two real machines, both working, wrong
 * answers. It is only visible if something asserts the identity.
 */

const task = (id: string): TaskRecord => ({
  id, type: 'code', goal: `task ${id}`, inputs: {}, outputs: [], dependsOn: [],
  status: 'running', worker: 'code',
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
})

/** A brain that records which sandbox was bound while it ran. */
function sandboxSpy(seen: (string | undefined)[], adopt?: string): AgentBrain {
  return {
    plan: async () => [],
    respond: async () => {
      seen.push(getActiveSandbox())
      // Stand in for a tool that created or replaced the machine.
      if (adopt) setActiveSandbox(adopt)
      return 'done'
    },
  }
}

const deps = (brain: AgentBrain) => ({
  brain,
  employeeFor: () => ({
    id: 'worker-code', name: 'Code', role: 'code worker',
    prompt: 'p', tools: [], accent: '#000',
  }),
  promptFor: () => 'prompt',
})

async function drain(events: AsyncIterable<OpenMindEvent>): Promise<OpenMindEvent[]> {
  const out: OpenMindEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

afterEach(() => setActiveSandbox(undefined))

describe('one session, one workspace', () => {
  it("binds the session's sandbox before the agent's tools run", async () => {
    const seen: (string | undefined)[] = []
    const runtime = createBuiltinRuntime(deps(sandboxSpy(seen)))
    const session = await runtime.createSession({
      projectId: 'p1',
      worker: 'code',
      workspace: { id: 'w', projectId: 'p1', path: '/home/user/project', sandboxId: 'sbx-known' },
    })
    await drain(runtime.runTask(session, task('t1')))
    // The tools saw the session's machine, not an unset or unrelated one.
    expect(seen).toEqual(['sbx-known'])
  })

  it('adopts a sandbox the tools created, so the session follows the machine', async () => {
    const seen: (string | undefined)[] = []
    const runtime = createBuiltinRuntime(deps(sandboxSpy(seen, 'sbx-created')))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(session, task('t1')))
    const after = await runtime.resumeSession(session.id)
    expect(after?.workspace?.sandboxId).toBe('sbx-created')
  })

  it('carries that machine into the next task on the same session', async () => {
    // The whole point of session reuse. If task B lands on a different sandbox,
    // sessions are persistent only in metadata.
    const seen: (string | undefined)[] = []
    const runtime = createBuiltinRuntime(deps(sandboxSpy(seen, 'sbx-created')))

    const first = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(first, task('a')))

    const second = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    expect(second.id).toBe(first.id)
    await drain(runtime.runTask(second, task('b')))

    // First run started with nothing; the second started on the adopted machine.
    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toBe('sbx-created')
  })

  it('reports the machine it inspects as the one the session owns', async () => {
    const runtime = createBuiltinRuntime(deps(sandboxSpy([], 'sbx-created')))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(session, task('t1')))
    const state = await runtime.inspectWorkspace(session.id)
    expect(state.workspace?.sandboxId).toBe('sbx-created')
  })

  it('keeps two workers on separate sessions from sharing one machine record', async () => {
    const runtime = createBuiltinRuntime(deps(sandboxSpy([], 'sbx-code')))
    const code = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const research = await runtime.createSession({ projectId: 'p1', worker: 'research' })
    await drain(runtime.runTask(code, task('t1')))

    const codeAfter = await runtime.resumeSession(code.id)
    const researchAfter = await runtime.resumeSession(research.id)
    expect(codeAfter?.workspace?.sandboxId).toBe('sbx-code')
    // The research session never ran, so it must not inherit the coder's machine.
    expect(researchAfter?.workspace?.sandboxId).toBeUndefined()
  })

  it('does not leave a machine bound after a failed run', async () => {
    const runtime = createBuiltinRuntime(deps({
      plan: async () => { throw new Error('provider down') },
      respond: async () => '',
    }))
    const session = await runtime.createSession({
      projectId: 'p1',
      worker: 'code',
      workspace: { id: 'w', projectId: 'p1', path: '/home/user/project', sandboxId: 'sbx-a' },
    })
    const events = await drain(runtime.runTask(session, task('t1')))
    expect(events.at(-1)?.outcome).toBe('failed')
    // The session still owns its machine — a failure is not a reason to forget
    // which sandbox holds the half-finished work.
    const after = await runtime.resumeSession(session.id)
    expect(after?.workspace?.sandboxId).toBe('sbx-a')
  })

  it('inspectWorkspace reports unknown, never clean, without a machine', async () => {
    const runtime = createBuiltinRuntime(deps(sandboxSpy([])))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'research' })
    const state = await runtime.inspectWorkspace(session.id)
    expect(state.inspected).toBe(false)
    expect(state.changedFiles).toEqual([])
  })
})
