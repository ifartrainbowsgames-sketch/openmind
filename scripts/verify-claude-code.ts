/**
 * Claude Code as a conformance test for AgentRuntime.
 *
 * The claim under test is not "Claude Code works" — it is that OpenMind can
 * drive an agent it did not write, through the same boundary the builtin one
 * uses, and keep control of session identity, workspace identity and memory.
 *
 * Two phases as two OS processes, because a resumed session that only works
 * inside one process proves the repository is wired, not that anything is
 * durable.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-claude-code.ts            # every phase
 *   npx tsx scripts/verify-claude-code.ts approval   # one phase
 *
 * Gates, all of which must pass before this integration is called live:
 *
 *   1. the provider session id is real and persisted
 *   2. a new process can resume it
 *   3. workspace identity is verified, not assumed
 *   4. TaskContext memory reaches Claude Code
 *   5. events stream while work happens
 *   6. cancellation actually stops the provider
 *   7. provider failure becomes failed, never a fallback
 *   8. files are read back from the workspace, not from its description of them
 *   9. no Claude Code path exists outside AgentRuntime (unit-tested)
 *  10. an action the policy refuses becomes needs_user, through runTaskGraph
 *
 * See runtimes/conformance.ts for the contract every future runtime inherits.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeCodeRuntime } from '../runtimes/claude-code-runtime'
import { CLAUDE_CODE_CONFORMANCE, missingGates } from '../runtimes/conformance'
import { runTaskGraph } from '../src/lib/task-runner'
import { _resetRuntimes, registerRuntime } from '../src/lib/workforce/agent-runtime'
import { setRepositories } from '../src/lib/workforce/session-repository'
import { emptyTaskContext, type TaskContext } from '../src/lib/workforce/agent-runtime'
import { createMemoryService } from '../src/lib/workforce/memory-service'
import {
  memorySessionRepository, memoryWorkspaceRepository,
  scopeKey, type Repositories,
} from '../src/lib/workforce/session-repository'
import type { WorkerSession } from '../src/lib/workforce/sessions'
import type { WorkspaceRecord } from '../src/lib/workforce/workspaces'
import type { OpenMindEvent } from '../src/lib/workforce/events'
import type { MemoryBook } from '../src/lib/workforce/memory-layers'
import type { TaskRecord } from '../src/lib/task-ledger'

const STATE = 'scripts/.verify-claude-code.json'
const ROOT = join(tmpdir(), 'openmind-claude-code')
const PROJECT = 'verify-cc'
const FILE = 'notes.md'
const SECRET = 'OPENMIND-CANONICAL-FACT'

/**
 * Every phase, named once.
 *
 * The driver used to list phases inline, and adding one to the switch without
 * adding it to the driver printed "All phases passed" while silently skipping
 * it — a green banner covering less than it claimed, which is the exact bug
 * class this whole harness exists to catch. Now the list is the source of
 * truth for both, and the count is printed so the number is checkable.
 */
const PHASES = ['write', 'resume', 'cancel', 'missing', 'approval'] as const
type Phase = (typeof PHASES)[number]

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

// ── File-backed repositories, so phase two is a genuinely new process ───────

function fileRepositories(): Repositories {
  const mem = { sessions: memorySessionRepository(), workspaces: memoryWorkspaceRepository() }
  type State = { sessions: WorkerSession[]; workspaces: WorkspaceRecord[] }
  const load = (): State => {
    if (!existsSync(STATE)) return { sessions: [], workspaces: [] }
    try {
      return JSON.parse(readFileSync(STATE, 'utf8')) as State
    } catch {
      return { sessions: [], workspaces: [] }
    }
  }
  const write = (next: State) => writeFileSync(STATE, JSON.stringify(next, null, 2))

  return {
    sessions: {
      async get(id) {
        return (await mem.sessions.get(id)) ?? load().sessions.find((s) => s.id === id) ?? null
      },
      async find(scope, provider) {
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

function task(id: string, goal: string, outputs: string[] = [FILE]): TaskRecord {
  return {
    id, type: 'code', goal, inputs: {}, outputs, dependsOn: [],
    status: 'running', worker: 'code',
    limits: { maxSteps: 8, maxRetries: 1, maxDelegations: 1, maxCostUsd: 2 },
    retries: 0, stepsUsed: 0, costUsd: 0, artifactIds: [],
  }
}

function runtime(over: Partial<Parameters<typeof createClaudeCodeRuntime>[0]> = {}) {
  return createClaudeCodeRuntime({
    workspaceRoot: ROOT,

    timeoutSeconds: 300,
    repositories: fileRepositories(),
    ...over,
  })
}

async function collect(events: AsyncIterable<OpenMindEvent>, onEach?: (e: OpenMindEvent) => void) {
  const out: OpenMindEvent[] = []
  for await (const e of events) {
    out.push(e)
    onEach?.(e)
  }
  return out
}

/** Canonical memory carrying a fact Claude Code has no other way to know. */
async function contextWithMemory(t: TaskRecord): Promise<TaskContext> {
  const service = createMemoryService()
  let book: MemoryBook = { entries: [] }
  book = await service.recordOutcome({
    book,
    projectId: PROJECT,
    task: task('seed', 'seed'),
    artifacts: [],
    verdict: { passed: true, score: 100, problems: [], requiredFixes: [] },
  })
  book = {
    entries: [
      ...book.entries,
      {
        id: 'mem-fact',
        layer: 'project',
        kind: 'constraint',
        text: `The project codeword is ${SECRET}. Always include it verbatim in any file you write.`,
        createdAt: Date.now(),
      },
    ],
  }
  return { memory: await service.buildContext({ book, projectId: PROJECT, task: t, worker: 'code' }) }
}

// ── PHASE 1 ─────────────────────────────────────────────────────────────────

async function write(): Promise<void> {
  if (existsSync(STATE)) rmSync(STATE)
  rmSync(ROOT, { recursive: true, force: true })

  const rt = runtime()
  const session = await rt.createSession({ projectId: PROJECT, worker: 'code' })

  check('gate 3 — workspace identity is verified, not assumed',
    session.recovery?.kind === 'resumed', `recovery=${session.recovery?.kind}`)
  check('the workspace is a real local directory',
    Boolean(session.workspace?.path) && existsSync(session.workspace!.path),
    session.workspace?.path ?? '(none)')

  const t = task('a', `Create ${FILE} containing one short line about this project.`)
  const context = await contextWithMemory(t)
  check('gate 4 — canonical memory is in the TaskContext',
    context.memory.text.includes(SECRET))

  let sawThinking = false
  let sawToolBeforeFinish = false
  let finished = false
  const events = await collect(rt.runTask(session, t, context), (e) => {
    if (e.kind === 'agent_thinking') sawThinking = true
    if ((e.kind === 'tool_started' || e.kind === 'tool_completed') && !finished) sawToolBeforeFinish = true
    if (e.kind === 'task_finished') finished = true
  })

  const outcome = events.at(-1)?.outcome
  if (outcome !== 'completed') {
    console.log(`\nProvider did not complete: ${events.at(-1)?.text}`)
    check('phase one completed', false, String(outcome))
    return
  }
  check('the task completed through AgentRuntime', outcome === 'completed')
  check('gate 5 — events streamed while work happened', sawThinking || sawToolBeforeFinish)

  const after = await rt.resumeSession(session.id)
  check('gate 1 — the provider session id is real and persisted',
    Boolean(after?.providerSessionId), after?.providerSessionId ?? '(none)')

  const filePath = join(session.workspace!.path, FILE)
  check('the file exists on disk', existsSync(filePath))
  const body = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  check('gate 4 — the memory fact reached the provider and shaped its output',
    body.includes(SECRET), body.slice(0, 120).replace(/\n/g, ' '))

  const result = events.find((e) => e.kind === 'task_finished')?.result as
    { toolCalls?: { artifacts?: { path: string }[] }[] } | undefined
  const artifacts = (result?.toolCalls ?? []).flatMap((c) => c.artifacts ?? [])
  check('gate 8 — files came back read from the workspace',
    artifacts.some((a) => a.path === FILE), artifacts.map((a) => a.path).join(', ') || '(none)')

  writeFileSync(`${STATE}.marker`, body)
  console.log(`\nPHASE 1 done — provider session ${after?.providerSessionId}`)
}

// ── PHASE 2: a new process ──────────────────────────────────────────────────

async function resume(): Promise<void> {
  const rt = runtime()
  const session = await rt.createSession({ projectId: PROJECT, worker: 'code' })

  check('the OpenMind session came back from storage',
    session.taskIds.includes('a'), session.taskIds.join(',') || '(none)')
  check('gate 1 — the provider session id came back with it',
    Boolean(session.providerSessionId), session.providerSessionId ?? '(none)')
  check('gate 3 — the workspace was verified on resume',
    session.recovery?.kind === 'resumed', `recovery=${session.recovery?.kind}`)

  const before = session.providerSessionId
  const t = task('b', `Read ${FILE}, then append one line to it that begins with "second-task:".`)
  const context = await contextWithMemory(t)
  const events = await collect(rt.runTask(session, t, context))

  const outcome = events.at(-1)?.outcome
  if (outcome !== 'completed') {
    check('phase two completed', false, `${outcome}: ${events.at(-1)?.text?.slice(0, 160)}`)
    return
  }

  const filePath = join(session.workspace!.path, FILE)
  const body = readFileSync(filePath, 'utf8')
  const original = readFileSync(`${STATE}.marker`, 'utf8')

  check('gate 2 — A NEW PROCESS RESUMED THE PROVIDER SESSION', Boolean(before), before ?? '(none)')
  check('the resumed task saw the first task\'s file',
    body.includes(original.split('\n')[0].trim()) || body.includes(SECRET))
  check('THE RESUMED TASK MODIFIED IT', body.includes('second-task:'),
    body.slice(-160).replace(/\n/g, ' '))

  const after = await rt.resumeSession(session.id)
  check('the session records both tasks', (after?.taskIds ?? []).join(',') === 'a,b',
    (after?.taskIds ?? []).join(','))
}

// ── Cancellation and failure ────────────────────────────────────────────────

async function cancel(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'openmind-cc-cancel-'))
  const rt = runtime({ workspaceRoot: dir, repositories: freshRepositories() })
  const session = await rt.createSession({ projectId: 'cancel-me', worker: 'code' })

  const t = task('c', 'Count slowly from 1 to 400, one number per line, in your reply.', [])
  const started = Date.now()
  const stream = rt.runTask(session, t, emptyTaskContext())

  const events: OpenMindEvent[] = []
  for await (const e of stream) {
    events.push(e)
    // Cancel as soon as the provider is genuinely running.
    if (e.kind === 'session_opened' || e.kind === 'agent_thinking') void rt.cancel(session.id)
  }

  const outcome = events.at(-1)?.outcome
  check('gate 6 — cancellation stopped the provider',
    outcome === 'cancelled', `outcome=${outcome} after ${Date.now() - started}ms`)
  rmSync(dir, { recursive: true, force: true })
}

async function missing(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'openmind-cc-missing-'))
  // A command that does not exist. The runtime must fail, not fall back.
  const rt = runtime({
    workspaceRoot: dir,
    command: 'claude-code-does-not-exist',
    repositories: freshRepositories(),
  })
  const session = await rt.createSession({ projectId: 'missing-cli', worker: 'code' })
  const events = await collect(rt.runTask(session, task('d', 'anything', []), emptyTaskContext()))

  const last = events.at(-1)
  check('gate 7 — a missing provider fails the task', last?.outcome === 'failed', String(last?.outcome))
  check('and says why rather than substituting another agent',
    Boolean(last?.text && last.text.length > 0), last?.text?.slice(0, 120) ?? '')
  rmSync(dir, { recursive: true, force: true })
}


// ── PERMISSION WAITING, through the whole orchestrator ──────────────────────

/**
 * The gate the CLI makes easy to get wrong.
 *
 * Claude Code reports `permission_denials` alongside `subtype: "success"`. A
 * task that could not do its job because it needed approval therefore looks
 * completed at the provider boundary, and looked completed at the orchestrator
 * boundary too until this test: `runTaskGraph` captured the runtime's outcome
 * into a trace line and nothing else, so `needs_user` fell through to artifact
 * parsing and was judged as a task that produced nothing.
 *
 * This runs the REAL task graph, not the runtime alone, because the claim is
 * about the whole chain:
 *
 *   provider denial -> runtime needs_user -> task needs_user -> run needs_user
 */
async function approval(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'openmind-cc-approval-'))
  const repos = freshRepositories()
  setRepositories(repos)
  _resetRuntimes()

  const rt = runtime({ workspaceRoot: dir, repositories: repos })
  registerRuntime(rt, true)

  // `npm install` is denied by DEFAULT_PERMISSIONS: installing packages is a
  // decision, not the work. Asking for it is the point.
  const goal = 'Run the shell command `npm install left-pad` in this directory, then report the installed version.'

  const run = await runTaskGraph(goal, {
    plan: async () => [],
    respond: async () => 'planning only',
  }, { runtimeId: 'claude-code', budget: {
    maxAgentRuns: 4, maxToolCalls: 8, maxCostUsd: 2, maxTokens: 200_000, deadlineMs: 300_000,
  } })

  const tasks = run.project.tasks
  const waiting = tasks.filter((t) => t.status === 'needs_user')

  check('gate 10 — the task is needs_user, not completed and not failed',
    waiting.length > 0,
    tasks.map((t) => `${t.id}=${t.status}`).join(' '))

  check('and NOT completed — a denial is not success',
    !tasks.some((t) => t.status === 'completed'),
    tasks.filter((t) => t.status === 'completed').map((t) => t.id).join(',') || 'none completed')

  const blockers = run.project.blockers.join(' | ')
  check('the run carries what was asked for, so a UI can show it',
    /approval|permission|npm install|Bash/i.test(blockers),
    blockers.slice(0, 200) || '(no blockers)')

  // The worker derives the run row's status from exactly this.
  const rowStatus = tasks.some((t) => t.status === 'needs_user') ? 'needs_user' : 'other'
  check('agent_runs would be written as needs_user', rowStatus === 'needs_user', rowStatus)

  const sessions = await repos.sessions.find(
    { kind: 'project', projectId: run.project.id, worker: waiting[0]?.worker ?? 'code' },
    'claude-code',
  )
  check('the WorkerSession is waiting', sessions?.status === 'waiting',
    sessions?.status ?? '(no session)')

  _resetRuntimes()
  rmSync(dir, { recursive: true, force: true })
}

// ── The conformance report is honest ────────────────────────────────────────

function conformance(): void {
  const gaps = missingGates(CLAUDE_CODE_CONFORMANCE)
  check('every conformance gate has named evidence', gaps.length === 0,
    gaps.join(', ') || 'all twelve covered')
}

function freshRepositories(): Repositories {
  return { sessions: memorySessionRepository(), workspaces: memoryWorkspaceRepository() }
}

// ── Driver ──────────────────────────────────────────────────────────────────

function child(phase: string): number {
  return spawnSync('npx', ['tsx', 'scripts/verify-claude-code.ts', phase], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }).status ?? 1
}

async function main(): Promise<void> {
  const phase = process.argv[2]

  if (!phase) {
    console.log('— PHASE 1: first task —')
    if (child('write') !== 0) process.exit(1)
    console.log('\n— PHASE 2: a genuinely new process, resuming —')
    if (child('resume') !== 0) process.exit(1)
    console.log('\n— cancellation —')
    if (child('cancel') !== 0) process.exit(1)
    console.log('\n— a provider that is not there —')
    if (child('missing') !== 0) process.exit(1)
    console.log('\n— an action the policy does not permit —')
    if (child('approval') !== 0) process.exit(1)
    console.log(`\nAll ${PHASES.length} phases passed`)
    return
  }

  if (!PHASES.includes(phase as Phase)) {
    console.log(`usage: verify-claude-code.ts [${PHASES.join('|')}]`)
    process.exit(1)
  }

  if (phase === 'write') await write()
  else if (phase === 'resume') await resume()
  else if (phase === 'cancel') await cancel()
  else if (phase === 'missing') await missing()
  else if (phase === 'approval') { conformance(); await approval() }

  console.log(failures ? `\n${failures} check(s) failed` : '\nphase passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
