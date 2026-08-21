import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinRuntime } from './builtin-runtime'
import { emptyTaskContext } from './agent-runtime'
import { setActiveSandbox } from '../crew-tools'
import { ALL_TOOLS } from '../agent/connections'
import type { AgentBrain, PlanStep } from '../agent'
import type { ExecutionContext } from './execution-context'
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
 *
 * These tests assert it where it now lives: on the ExecutionContext the tool
 * receives. A tool that reads its machine from an argument cannot resolve a
 * different one than the session owns — which is why one of these deliberately
 * poisons the old module-level binding first and expects it to make no
 * difference.
 */

const task = (id: string): TaskRecord => ({
  id, type: 'code', goal: `task ${id}`, inputs: {}, outputs: [], dependsOn: [],
  status: 'running', worker: 'code',
  limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
  retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
})

/**
 * A tool that reports the machine it was handed, and can stand in for one that
 * creates a sandbox by adopting a new id.
 */
const PROBE = '__workspace_probe__'
let seen: (string | undefined)[] = []
let adopt: string | undefined

ALL_TOOLS[PROBE] = {
  id: PROBE,
  name: 'probe',
  desc: 'records the workspace it was given',
  run: (_input: string, _args, ctx?: ExecutionContext) => {
    seen.push(ctx?.workspace.sandboxId)
    if (adopt) ctx?.adoptSandbox(adopt)
    return ctx ? `ctx sandbox=${ctx.workspace.sandboxId ?? 'none'}` : 'no context'
  },
}

/** A brain that runs the probe once, with no model involved. */
function probeBrain(): AgentBrain {
  return {
    plan: async (): Promise<PlanStep[]> => [{ tool: PROBE, input: 'x' }],
    respond: async (_input, observations) => observations.map((o) => o.output).join('\n'),
  }
}

const deps = (brain: AgentBrain) => ({
  brain,
  employeeFor: () => ({
    id: 'worker-code', name: 'Code', role: 'code worker',
    prompt: 'p', tools: [PROBE], accent: '#000',
  }),
  promptFor: () => 'prompt',
})

async function drain(events: AsyncIterable<OpenMindEvent>): Promise<OpenMindEvent[]> {
  const out: OpenMindEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

afterEach(() => {
  seen = []
  adopt = undefined
  setActiveSandbox(undefined)
})

describe('one session, one workspace', () => {
  it("hands the session's own machine to the tools", async () => {
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const session = await runtime.createSession({
      projectId: 'p1',
      worker: 'code',
      workspace: { id: 'w', projectId: 'p1', path: '/home/user/project', sandboxId: 'sbx-known' },
    })
    await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))
    expect(seen).toEqual(['sbx-known'])
  })

  it('resolves the machine from the context, not from module state', async () => {
    // The exact bug the context exists to make impossible: something else set
    // the global to a different live sandbox. Before, the tool would have used
    // it. Now the tool never reads it.
    setActiveSandbox('sbx-WRONG')
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const session = await runtime.createSession({
      projectId: 'p1',
      worker: 'code',
      workspace: { id: 'w', projectId: 'p1', path: '/home/user/project', sandboxId: 'sbx-right' },
    })
    await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))
    expect(seen).toEqual(['sbx-right'])
  })

  it('adopts a sandbox the tools created, so the session follows the machine', async () => {
    adopt = 'sbx-created'
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))
    const after = await runtime.resumeSession(session.id)
    expect(after?.workspace?.sandboxId).toBe('sbx-created')
  })

  it('carries that machine into the next task on the same session', async () => {
    // The whole point of session reuse. If task B lands on a different sandbox,
    // sessions are persistent only in metadata.
    adopt = 'sbx-created'
    const runtime = createBuiltinRuntime(deps(probeBrain()))

    const first = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(first, task('a'), emptyTaskContext()))

    const second = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    expect(second.id).toBe(first.id)
    await drain(runtime.runTask(second, task('b'), emptyTaskContext()))

    // First run started with nothing; the second started on the adopted machine.
    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toBe('sbx-created')
  })

  it('reports the machine it inspects as the one the session owns', async () => {
    adopt = 'sbx-created'
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))
    const state = await runtime.inspectWorkspace(session.id)
    expect(state.workspace?.sandboxId).toBe('sbx-created')
  })

  it('keeps two workers on separate sessions from sharing one machine record', async () => {
    adopt = 'sbx-code'
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const code = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const research = await runtime.createSession({ projectId: 'p1', worker: 'research' })
    await drain(runtime.runTask(code, task('t1'), emptyTaskContext()))

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
    const events = await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))
    expect(events.at(-1)?.outcome).toBe('failed')
    // The session still owns its machine — a failure is not a reason to forget
    // which sandbox holds the half-finished work.
    const after = await runtime.resumeSession(session.id)
    expect(after?.workspace?.sandboxId).toBe('sbx-a')
  })

  it('inspectWorkspace reports unknown, never clean, without a machine', async () => {
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'research' })
    const state = await runtime.inspectWorkspace(session.id)
    expect(state.inspected).toBe(false)
    expect(state.changedFiles).toEqual([])
  })

  it('emits tool events as the call happens, not replayed at the end', async () => {
    // A workspace tool can run for a minute. Events that only arrive with the
    // finished result cannot show that a task is moving — and the previous
    // implementation replayed them from `result.toolCalls` after the fact.
    const runtime = createBuiltinRuntime(deps(probeBrain()))
    const session = await runtime.createSession({ projectId: 'p1', worker: 'code' })
    const events = await drain(runtime.runTask(session, task('t1'), emptyTaskContext()))

    const started = events.findIndex((e) => e.kind === 'tool_started' && e.tool === PROBE)
    const completed = events.findIndex((e) => e.kind === 'tool_completed' && e.tool === PROBE)
    const finished = events.findIndex((e) => e.kind === 'task_finished')
    expect(started).toBeGreaterThanOrEqual(0)
    expect(completed).toBeGreaterThan(started)
    expect(finished).toBeGreaterThan(completed)
    // Emitted once, by the actor — not once there and once in a replay loop.
    expect(events.filter((e) => e.kind === 'tool_started')).toHaveLength(1)
    // And stamped with the run they belong to.
    expect(events[started].taskId).toBe('t1')
    expect(events[started].sessionId).toBe(session.id)
  })
})
