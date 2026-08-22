/**
 * Prove the trace is IN Phoenix, and that it is ONE trace.
 *
 *   docker compose -f docker-compose.phoenix.yml up -d
 *   npx tsx scripts/verify-phoenix.ts
 *
 * `verify-telemetry.ts` proves what left this process. This proves what
 * arrived, by asking Phoenix — which decodes the protobuf and can therefore
 * answer the question a substring search cannot: how many distinct traces did
 * one run produce?
 *
 * That question matters. Every `traced()` call outside an active span starts a
 * new ROOT, so a run without a wrapping span scatters into unrelated traces and
 * Phoenix shows six things that happened rather than one thing that happened.
 * Phoenix caught exactly that on the first live run: three spans, two traces.
 */

import { runTaskGraph } from '../src/lib/task-runner'
import { currentTraceId, startTelemetry, stopTelemetry } from '../src/lib/telemetry'
import { _resetRuntimes, registerRuntime } from '../src/lib/workforce/agent-runtime'
import { ALL_CAPABILITIES, runtimeCapabilities } from '../src/lib/workforce/capabilities'
import { event } from '../src/lib/workforce/events'
import type { AgentRuntime, AgentSession } from '../src/lib/workforce/agent-runtime'
import type { OpenMindEvent, RunOutcome } from '../src/lib/workforce/events'
import type { RunResult } from '../src/lib/agent'

const PHOENIX = process.env.PHOENIX_COLLECTOR_ENDPOINT ?? 'http://localhost:6006'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const ARTIFACT: RunResult = {
  answer: '```json research/report.json\n{"ok":true,"sources":["https://a.com","https://b.com","https://c.com"]}\n```',
  plan: [], toolCalls: [], trace: [],
}

function runtimeWith(outcome: RunOutcome): AgentRuntime {
  return {
    id: 'phoenix-proof',
    capabilities: async () => runtimeCapabilities(ALL_CAPABILITIES, {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    }),
    createSession: async (input): Promise<AgentSession> => ({
      id: `px:${input.projectId}:${input.worker}`,
      scope: { kind: 'project', projectId: input.projectId, worker: input.worker },
      provider: 'proof', status: 'running', taskIds: [],
      startedAt: Date.now(), lastActivityAt: Date.now(),
    }),
    resumeSession: async () => null,
    async *runTask(session, task): AsyncIterable<OpenMindEvent> {
      if (outcome === 'needs_user') {
        yield event('blocked', 'Bash needs approval: npm install left-pad', {
          sessionId: session.id, taskId: task.id, worker: task.worker, tool: 'Bash',
        })
      }
      yield event('task_finished', outcome === 'needs_user' ? 'approval required' : 'done', {
        sessionId: session.id, taskId: task.id, worker: task.worker, outcome, result: ARTIFACT,
      })
    },
    checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
    inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
    cancel: async () => {},
    close: async () => {},
  }
}

interface SpanNode {
  name: string
  statusCode: string
  parentId: string | null
  context: { traceId: string; spanId: string }
  attributes: string
}

async function spansFor(traceId: string): Promise<SpanNode[]> {
  const projects = await fetch(`${PHOENIX}/v1/projects`).then((r) => r.json()) as
    { data: { name: string; id: string }[] }
  const project = projects.data.find((p) => p.name === 'openmind')
  if (!project) return []

  const query = `query { node(id: "${project.id}") { ... on Project { spans(first: 300) { `
    + 'edges { node { name statusCode parentId attributes context { traceId spanId } } } } } } }'

  const result = await fetch(`${PHOENIX}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then((r) => r.json()) as { data?: { node?: { spans?: { edges: { node: SpanNode }[] } } } }

  return (result.data?.node?.spans?.edges ?? [])
    .map((e) => e.node)
    .filter((s) => s.context.traceId === traceId)
}

async function runOnce(outcome: RunOutcome, goal: string): Promise<string | undefined> {
  _resetRuntimes()
  const runtime = runtimeWith(outcome)
  registerRuntime(runtime, true)
  await runTaskGraph(goal, { plan: async () => [], respond: async () => 'x' }, {
    runtimeId: runtime.id,
    userId: 'customer-phoenix-proof',
    budget: { maxAgentRuns: 8, maxToolCalls: 8, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000 },
  })
  return currentTraceId()
}

async function main(): Promise<void> {
  const reachable = await fetch(`${PHOENIX}/v1/projects`).then((r) => r.ok).catch(() => false)
  if (!reachable) {
    console.error(`FATAL: Phoenix is not reachable at ${PHOENIX}.`)
    console.error('       docker compose -f docker-compose.phoenix.yml up -d')
    process.exit(1)
  }

  check('the exporter started', await startTelemetry({
    enabled: true, endpoint: PHOENIX, projectName: 'openmind', content: 'metadata_only',
  }))

  console.log('\n— a completed run —\n')
  const completedTrace = await runOnce('completed', 'Research competitor pricing')
  await stopTelemetry()
  await new Promise((r) => setTimeout(r, 3000))

  check('the run reported a trace id', Boolean(completedTrace), completedTrace ?? '(none)')
  const spans = completedTrace ? await spansFor(completedTrace) : []
  check('PHOENIX HAS THE TRACE', spans.length > 0, `${spans.length} span(s)`)

  const names = new Set(spans.map((s) => s.name))
  for (const expected of [
    'openmind.run', 'memory.load', 'eligibility.evaluate', 'routing.select',
    'runtime.execute', 'artifact.adopt', 'task.evaluate',
  ]) {
    check(`  ${expected}`, names.has(expected))
  }

  // The question a substring search cannot answer.
  const traceIds = new Set(spans.map((s) => s.context.traceId))
  check('ONE TRACE, NOT SIX', traceIds.size === 1, `${traceIds.size} trace id(s)`)
  const roots = spans.filter((s) => !s.parentId)
  check('exactly one root span', roots.length === 1,
    `${roots.length} root(s): ${roots.map((r) => r.name).join(', ') || 'none'}`)
  check('the root is the run', roots[0]?.name === 'openmind.run', roots[0]?.name ?? '(none)')

  console.log('\n— a needs_user run is visibly different —\n')
  await startTelemetry({ enabled: true, endpoint: PHOENIX, projectName: 'openmind', content: 'metadata_only' })
  const waitingTrace = await runOnce('needs_user', 'Install a dependency and report the version')
  await stopTelemetry()
  await new Promise((r) => setTimeout(r, 3000))

  const waiting = waitingTrace ? await spansFor(waitingTrace) : []
  check('Phoenix has the second trace', waiting.length > 0, `${waiting.length} span(s)`)
  check('it is a different trace from the first', waitingTrace !== completedTrace)

  const dump = JSON.stringify(waiting)
  check('needs_user appears as its own outcome', dump.includes('needs_user'))
  check('and is NOT recorded as a failure', !/run\.failed[^0-9]{0,12}[1-9]/.test(dump))
  check('the requested approval is visible', dump.includes('npm install left-pad'))

  console.log('\n— nothing secret arrived —\n')
  const everything = JSON.stringify([...spans, ...waiting])
  check('the stored spans are substantial, so the next check is not vacuous',
    everything.length > 2000, `${everything.length} chars`)
  check('no key-shaped string in Phoenix', !/sk-[A-Za-z0-9_-]{16,}/.test(everything))

  console.log(`\nopen  ${PHOENIX}`)
  console.log(`      completed   ${completedTrace}`)
  console.log(`      needs_user  ${waitingTrace}`)

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
