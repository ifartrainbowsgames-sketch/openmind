/**
 * Prove OpenMind exports a correlated, redacted trace.
 *
 *   npx tsx scripts/verify-telemetry.ts
 *
 * Stands up a real OTLP/HTTP receiver on localhost, points the exporter at it,
 * runs a real task graph, and inspects THE BYTES THAT WENT ON THE WIRE.
 *
 * That last part is the point. A unit test proves the sanitiser redacts what it
 * is given; only the wire proves nothing else got added on the way out. Span
 * attribute names and string values travel as UTF-8 inside protobuf, so a
 * substring search over the raw body is a genuine leak check rather than a
 * proxy for one.
 *
 * This does NOT prove the trace renders in Phoenix — that needs the container.
 * See docker-compose.phoenix.yml.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { runTaskGraph } from '../src/lib/task-runner'
import { startTelemetry, stopTelemetry, telemetryActive } from '../src/lib/telemetry'
import { _resetRuntimes, registerRuntime } from '../src/lib/workforce/agent-runtime'
import { ALL_CAPABILITIES, runtimeCapabilities } from '../src/lib/workforce/capabilities'
import { event } from '../src/lib/workforce/events'
import type { AgentRuntime, AgentSession } from '../src/lib/workforce/agent-runtime'
import type { OpenMindEvent } from '../src/lib/workforce/events'
import type { RunResult } from '../src/lib/agent'

const PORT = 4319
const SECRET = 'sk-ant-api03-TELEMETRY-LEAK-CANARY-9876543210'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const received: Buffer[] = []

function collector(): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        received.push(Buffer.concat(chunks))
        res.writeHead(200, { 'content-type': 'application/x-protobuf' })
        res.end()
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve({
      close: () => new Promise<void>((done) => server.close(() => done())),
    }))
  })
}

const ARTIFACT: RunResult = {
  answer: '```json research/report.json\n{"ok":true,"sources":["https://a.com","https://b.com","https://c.com"]}\n```',
  plan: [], toolCalls: [], trace: [],
}

function fakeRuntime(): AgentRuntime {
  return {
    id: 'telemetry-proof',
    capabilities: async () => runtimeCapabilities(ALL_CAPABILITIES, {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    }),
    createSession: async (input): Promise<AgentSession> => ({
      id: `p:${input.projectId}:${input.worker}`,
      scope: { kind: 'project', projectId: input.projectId, worker: input.worker },
      provider: 'proof', status: 'running', taskIds: [],
      startedAt: Date.now(), lastActivityAt: Date.now(),
    }),
    resumeSession: async () => null,
    async *runTask(session, task): AsyncIterable<OpenMindEvent> {
      yield event('task_finished', 'done', {
        sessionId: session.id, taskId: task.id, worker: task.worker,
        outcome: 'completed', result: ARTIFACT,
      })
    },
    checkpoint: async (sessionId) => ({ sessionId, at: Date.now(), state: null, captured: false }),
    inspectWorkspace: async () => ({ changedFiles: [], inspected: false }),
    cancel: async () => {},
    close: async () => {},
  }
}

async function main(): Promise<void> {
  const server = await collector()
  console.log(`collector listening on http://127.0.0.1:${PORT}/v1/traces\n`)

  const live = await startTelemetry({
    enabled: true,
    endpoint: `http://127.0.0.1:${PORT}`,
    projectName: 'openmind-verify',
    content: 'metadata_only',
  })
  check('the exporter started', live && telemetryActive())

  _resetRuntimes()
  const runtime = fakeRuntime()
  registerRuntime(runtime, true)

  const run = await runTaskGraph('Research competitor pricing and write a comparison', {
    plan: async () => [], respond: async () => 'done',
  }, {
    runtimeId: runtime.id,
    userId: 'customer-telemetry-proof',
    // A secret in the run options, to prove it does not travel.
    toolKeys: { tavily: SECRET } as never,
    budget: { maxAgentRuns: 8, maxToolCalls: 8, maxCostUsd: 1, maxTokens: 100_000, deadlineMs: 30_000 },
  })

  check('the task graph ran', run.project.tasks.length > 0, `${run.project.tasks.length} task(s)`)

  // Flush, or the batcher still holds everything.
  await stopTelemetry()
  await new Promise((r) => setTimeout(r, 500))
  await server.close()

  const body = Buffer.concat(received).toString('utf8')

  console.log()
  check('spans reached the collector', received.length > 0, `${received.length} request(s), ${body.length} bytes`)

  console.log('\n— the trace describes the run —\n')
  for (const span of [
    'memory.load', 'eligibility.evaluate', 'routing.select',
    'runtime.execute', 'artifact.adopt', 'task.evaluate', 'task.outcome',
  ]) {
    check(`span ${span}`, body.includes(span))
  }

  console.log('\n— correlation —\n')
  check('the customer id is on the wire', body.includes('customer-telemetry-proof'))
  check('task ids are on the wire', body.includes('openmind.task_id'))
  check('the runtime is named', body.includes('telemetry-proof'))
  check('routing is described', body.includes('routing.selected'))
  check('artifact provenance is described', body.includes('artifact.from_tools'))

  console.log('\n— nothing secret is on the wire —\n')
  check('the exported bytes are substantial, so the next checks are not vacuous',
    body.length > 2000, `${body.length} bytes`)
  check('THE CANARY KEY NEVER LEFT', !body.includes(SECRET),
    body.includes(SECRET) ? 'IT LEAKED' : 'absent')
  check('no key-shaped string at all', !/sk-[A-Za-z0-9_-]{16,}/.test(body))
  check('no JWT-shaped string', !/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(body))
  check('no memory text was exported', !body.includes('do not re-derive'))

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
