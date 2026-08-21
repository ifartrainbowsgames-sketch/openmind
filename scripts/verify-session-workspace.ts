/**
 * Live proof of the kernel claim:
 *
 *   "A production OpenMind task can create, retain, inspect and reuse a real
 *    workspace exclusively through AgentRuntime."
 *
 * The unit tests prove the identity rules against a fake. This proves the thing
 * a fake cannot: that TASK B, running later on the same session, sees the file
 * TASK A wrote — on the same E2B machine, reached only through the runtime.
 *
 * If B cannot see A's file, sessions are persistent in metadata only.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-session-workspace.ts
 */

import { createBuiltinRuntime } from '../src/lib/workforce/builtin-runtime'
import { setActiveCrewToolKeys, setPlatformKeysAllowed } from '../src/lib/crew-tools'
import { withCrewTools } from '../src/lib/crew'
import type { AgentRuntime } from '../src/lib/workforce/agent-runtime'
import type { OpenMindEvent } from '../src/lib/workforce/events'
import type { AgentBrain, Employee, PlanStep } from '../src/lib/agent'
import type { TaskRecord } from '../src/lib/task-ledger'

const MARKER = `OpenMind ${Date.now()}`

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const coder: Employee = withCrewTools({
  id: 'worker-code', name: 'Code', role: 'code worker',
  prompt: 'write and read files', tools: [], accent: '#000',
})

function task(id: string): TaskRecord {
  return {
    id, type: 'code', goal: `task ${id}`, inputs: {}, outputs: [], dependsOn: [],
    status: 'running', worker: 'code',
    limits: { maxSteps: 4, maxRetries: 1, maxDelegations: 1, maxCostUsd: 1 },
    retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
  }
}

/** A brain that runs one fixed tool call — no model involved. */
function scriptedBrain(steps: PlanStep[]): AgentBrain {
  return {
    plan: async () => steps,
    respond: async (_input, observations) => observations.map((o) => o.output).join('\n'),
  }
}

async function collect(events: AsyncIterable<OpenMindEvent>): Promise<OpenMindEvent[]> {
  const out: OpenMindEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

function outputOf(events: OpenMindEvent[]): string {
  const finished = events.find((e) => e.kind === 'task_finished')
  const result = finished?.result as { answer?: string } | undefined
  return result?.answer ?? ''
}

async function main(): Promise<void> {
  setPlatformKeysAllowed(true)
  setActiveCrewToolKeys({})

  const deps = (steps: PlanStep[]) => ({
    brain: scriptedBrain(steps),
    employeeFor: () => coder,
    promptFor: () => 'go',
  })

  console.log('— TASK A: write a file through the runtime —')
  const runtimeA: AgentRuntime = createBuiltinRuntime(deps([
    { tool: 'workspace_write_file', input: JSON.stringify({ path: 'hello.txt', content: MARKER }) },
  ]))
  const sessionA = await runtimeA.createSession({ projectId: 'verify-session', worker: 'code' })
  const eventsA = await collect(runtimeA.runTask(sessionA, task('a')))
  const wroteOutput = outputOf(eventsA)

  check('task A ran through the runtime', eventsA.some((e) => e.kind === 'task_started'))
  check('the write reached a real machine', /\[LIVE/.test(wroteOutput), wroteOutput.slice(0, 90))
  if (!/\[LIVE/.test(wroteOutput)) {
    console.log('\nNo live sandbox. Check agent-tools is deployed and E2B_API_KEY is set.')
    process.exit(1)
  }

  const afterA = await runtimeA.resumeSession(sessionA.id)
  const machineA = afterA?.workspace?.sandboxId
  check('the session adopted the machine', Boolean(machineA), machineA ?? '(none)')

  console.log('\n— TASK B: same session, read it back —')
  // Same runtime instance, so the session store is shared — this is exactly
  // what task-runner does across tasks in one project.
  const sessionB = await runtimeA.createSession({ projectId: 'verify-session', worker: 'code' })
  check('B reuses A\'s session', sessionB.id === sessionA.id, `${sessionB.id} vs ${sessionA.id}`)
  check('B inherits A\'s machine', sessionB.workspace?.sandboxId === machineA)

  // Swap in a reader without touching the session.
  const runtimeB = createBuiltinRuntime(deps([
    { tool: 'workspace_read_file', input: 'hello.txt' },
  ]))
  // Hand the reader the same session identity A ended with.
  const readerSession = await runtimeB.createSession({
    projectId: 'verify-session',
    worker: 'code',
    workspace: afterA?.workspace,
  })
  const eventsB = await collect(runtimeB.runTask(readerSession, task('b')))
  const readOutput = outputOf(eventsB)

  check(
    'TASK B SEES TASK A\'S FILE',
    readOutput.includes(MARKER),
    readOutput.includes(MARKER) ? 'the workspace survived across tasks' : readOutput.slice(0, 120),
  )

  console.log('\n— inspectWorkspace against real state —')
  const state = await runtimeB.inspectWorkspace(readerSession.id)
  check('reports the session\'s own machine', state.workspace?.sandboxId === machineA)
  check('reports whether it could actually look', typeof state.inspected === 'boolean',
    `inspected=${state.inspected}`)

  console.log('\n— events —')
  check('every event is stamped with the session', eventsA.every((e) => e.sessionId === sessionA.id))
  check('the run ended in a terminal outcome',
    ['completed', 'failed', 'blocked', 'needs_user', 'cancelled']
      .includes(eventsA.at(-1)?.outcome ?? ''),
    eventsA.at(-1)?.outcome ?? '(none)')

  await runtimeB.close(readerSession.id)

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
