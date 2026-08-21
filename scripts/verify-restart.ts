/**
 * Live proof of the durability claim:
 *
 *   "A session and its machine survive the process that created them, and a
 *    machine that did NOT survive is reported as lost rather than replaced."
 *
 * Two phases, run as two separate OS processes. That separation is the whole
 * point — an in-process test proves the repository is wired, not that anything
 * is durable, because the process map answers every read.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-restart.ts write     # PROCESS A
 *   npx tsx scripts/verify-restart.ts read      # PROCESS B — new process
 *   npx tsx scripts/verify-restart.ts orphan    # PROCESS C — machine deleted
 *
 * Or `npx tsx scripts/verify-restart.ts` to run all three as child processes.
 *
 * State crosses the boundary through a file rather than Supabase, because the
 * durable repositories need a signed-in browser session and this is a CLI. The
 * property under test is the same either way: PROCESS B rebuilds its session
 * from storage it did not write in memory, and reads a file it never wrote.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { createBuiltinRuntime } from '../src/lib/workforce/builtin-runtime'
import { setActiveCrewToolKeys, setPlatformKeysAllowed } from '../src/lib/crew-tools'
import { withCrewTools } from '../src/lib/crew'
import { emptyTaskContext } from '../src/lib/workforce/agent-runtime'
import {
  memorySessionRepository, memoryWorkspaceRepository, setRepositories,
  type Repositories,
} from '../src/lib/workforce/session-repository'
import type { WorkerSession } from '../src/lib/workforce/sessions'
import type { WorkspaceRecord } from '../src/lib/workforce/workspaces'
import type { OpenMindEvent } from '../src/lib/workforce/events'
import type { AgentBrain, Employee, PlanStep } from '../src/lib/agent'
import type { TaskRecord } from '../src/lib/task-ledger'

const STATE = 'scripts/.verify-restart.json'
const MARKER = 'durable-test'
const PROJECT = 'verify-restart'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * Repositories backed by a file.
 *
 * Stands in for Postgres so the test can run without a browser session. The
 * only property that matters is that PROCESS B reads what PROCESS A wrote
 * without sharing memory with it.
 */
function fileRepositories(): Repositories {
  const mem = { sessions: memorySessionRepository(), workspaces: memoryWorkspaceRepository() }
  const load = (): { sessions: WorkerSession[]; workspaces: WorkspaceRecord[] } => {
    if (!existsSync(STATE)) return { sessions: [], workspaces: [] }
    try {
      return JSON.parse(readFileSync(STATE, 'utf8')) as { sessions: WorkerSession[]; workspaces: WorkspaceRecord[] }
    } catch {
      return { sessions: [], workspaces: [] }
    }
  }
  const write = (next: { sessions: WorkerSession[]; workspaces: WorkspaceRecord[] }) =>
    writeFileSync(STATE, JSON.stringify(next, null, 2))

  return {
    sessions: {
      async get(id) {
        return (await mem.sessions.get(id)) ?? load().sessions.find((s) => s.id === id) ?? null
      },
      async find(scope, provider) {
        const { scopeKey } = await import('../src/lib/workforce/session-repository')
        return this.get(scopeKey(scope, provider))
      },
      async save(session) {
        await mem.sessions.save(session)
        const state = load()
        write({ ...state, sessions: [...state.sessions.filter((s) => s.id !== session.id), session] })
      },
      async delete(id) {
        await mem.sessions.delete(id)
        const state = load()
        write({ ...state, sessions: state.sessions.filter((s) => s.id !== id) })
      },
    },
    workspaces: {
      async get(id) {
        return (await mem.workspaces.get(id)) ?? load().workspaces.find((w) => w.id === id) ?? null
      },
      async forProject(projectId) {
        return load().workspaces.filter((w) => w.projectId === projectId)
      },
      async save(record) {
        await mem.workspaces.save(record)
        const state = load()
        write({ ...state, workspaces: [...state.workspaces.filter((w) => w.id !== record.id), record] })
      },
      async delete(id) {
        await mem.workspaces.delete(id)
        const state = load()
        write({ ...state, workspaces: state.workspaces.filter((w) => w.id !== id) })
      },
    },
  }
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

function answerOf(events: OpenMindEvent[]): string {
  const finished = events.find((e) => e.kind === 'task_finished')
  return ((finished?.result as { answer?: string } | undefined)?.answer) ?? ''
}

function runtimeWith(steps: PlanStep[]) {
  return createBuiltinRuntime({
    brain: scriptedBrain(steps),
    employeeFor: () => coder,
    promptFor: () => 'go',
    permissions: { platformKeys: true },
    repositories: fileRepositories(),
  })
}

function boot(): void {
  setPlatformKeysAllowed(true)
  setActiveCrewToolKeys({})
  setRepositories(fileRepositories())
}

// ── PROCESS A ───────────────────────────────────────────────────────────────

async function write(): Promise<void> {
  boot()
  if (existsSync(STATE)) unlinkSync(STATE)

  const content = `${MARKER} ${Date.now()}`
  const runtime = runtimeWith([
    { tool: 'workspace_write_file', input: JSON.stringify({ path: `${MARKER}.txt`, content }) },
  ])
  const session = await runtime.createSession({ projectId: PROJECT, worker: 'code' })
  const events = await collect(runtime.runTask(session, task('a'), emptyTaskContext()))
  const output = answerOf(events)

  check('the write reached a real machine', /\[LIVE/.test(output), output.slice(0, 90))
  if (!/\[LIVE/.test(output)) {
    console.log('\nNo live sandbox. Check agent-tools is deployed and E2B_API_KEY is set.')
    process.exit(1)
  }

  const after = await runtime.resumeSession(session.id)
  check('the session recorded its machine', Boolean(after?.workspace?.sandboxId),
    after?.workspace?.sandboxId ?? '(none)')
  check('the workspace was persisted outside this process', existsSync(STATE))
  writeFileSync(`${STATE}.marker`, content)
  console.log(`\nPROCESS A done — machine ${after?.workspace?.sandboxId}`)
}

// ── PROCESS B ───────────────────────────────────────────────────────────────

async function read(): Promise<void> {
  boot()
  const expected = readFileSync(`${STATE}.marker`, 'utf8')

  // A brand new runtime with an empty in-memory store. Everything it knows, it
  // learned from the repository.
  const runtime = runtimeWith([{ tool: 'workspace_read_file', input: `${MARKER}.txt` }])
  const session = await runtime.createSession({ projectId: PROJECT, worker: 'code' })

  check('the session was rebuilt from storage', session.taskIds.includes('a'),
    session.taskIds.join(', ') || '(none)')
  check('its machine came back with it', Boolean(session.workspace?.sandboxId),
    session.workspace?.sandboxId ?? '(none)')
  check('recovery reports a resumed workspace', session.recovery?.kind === 'resumed',
    session.recovery?.kind ?? '(none)')

  const events = await collect(runtime.runTask(session, task('b'), emptyTaskContext()))
  const output = answerOf(events)
  check(
    'A NEW PROCESS READS THE FILE THE OLD ONE WROTE',
    output.includes(expected),
    output.includes(expected) ? 'the workspace survived the process' : output.slice(0, 140),
  )
}

// ── PROCESS C ───────────────────────────────────────────────────────────────

async function orphan(): Promise<void> {
  boot()
  const repos = fileRepositories()

  // Point the stored record at a machine that never existed. This is what E2B
  // reclaiming an idle sandbox looks like from here.
  const records = await repos.workspaces.forProject(PROJECT)
  const record = records[0]
  if (!record) {
    console.log('No workspace record — run the write phase first.')
    process.exit(1)
  }
  await repos.workspaces.save({ ...record, externalId: 'sbx-does-not-exist-000000', status: 'sleeping' })

  const runtime = runtimeWith([{ tool: 'workspace_read_file', input: `${MARKER}.txt` }])
  const session = await runtime.createSession({ projectId: PROJECT, worker: 'code' })

  const kind = session.recovery?.kind
  check(
    'A DEAD MACHINE IS REPORTED, NOT REPLACED',
    kind === 'lost' || kind === 'needs_user',
    `recovery=${kind ?? '(none)'}`,
  )
  check(
    'and it is not silently reported as resumed',
    kind !== 'resumed',
    kind === 'resumed' ? 'a fresh empty sandbox was passed off as the same session' : 'correct',
  )
  if (session.recovery && 'reason' in session.recovery) {
    console.log(`      reason: ${session.recovery.reason}`)
  }
}

// ── Driver ──────────────────────────────────────────────────────────────────

function child(phase: string): number {
  const result = spawnSync('npx', ['tsx', 'scripts/verify-restart.ts', phase], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return result.status ?? 1
}

async function main(): Promise<void> {
  const phase = process.argv[2]

  if (!phase) {
    console.log('— PROCESS A: write —')
    if (child('write') !== 0) process.exit(1)
    console.log('\n— PROCESS B: a genuinely new process —')
    if (child('read') !== 0) process.exit(1)
    console.log('\n— PROCESS C: the machine is gone —')
    if (child('orphan') !== 0) process.exit(1)
    console.log('\nAll phases passed')
    return
  }

  if (phase === 'write') await write()
  else if (phase === 'read') await read()
  else if (phase === 'orphan') await orphan()
  else {
    console.log('usage: verify-restart.ts [write|read|orphan]')
    process.exit(1)
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nphase passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
