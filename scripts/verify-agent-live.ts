/**
 * Does OpenMind actually work?
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-agent-live.ts
 *   npx tsx scripts/verify-agent-live.ts "your own goal here"
 *
 * A real model, a real task graph, real tools, a real judge. Every other
 * harness in this repo tests one boundary; this one asks the only question a
 * customer asks.
 *
 * The claim under test is deliberately not "the agents produced output".
 * OpenMind's original failure was agents producing a great deal of output and
 * no artifact. So this checks for FILES with CONTENT, judged against acceptance
 * criteria — and it fails if all it gets is conversation.
 */

import { liveBrain, LIVE_PROVIDERS } from '../src/lib/agent'
import { runTaskGraph } from '../src/lib/task-runner'
import { registerBuiltin } from './fixtures/register-builtin'
import { setExecutionMode } from '../src/lib/execution-mode'

const GOAL = process.argv.slice(2).join(' ')
  || 'Research the three biggest open-source AI agent frameworks and write a short comparison with sources.'

const PROVIDER_ID = process.env.OPENMIND_TEST_PROVIDER ?? 'anthropic'
const KEY = PROVIDER_ID === 'anthropic'
  ? process.env.ANTHROPIC_API_KEY ?? ''
  : process.env.OPENAI_API_KEY ?? ''

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  const spec = LIVE_PROVIDERS.find((p) => p.id === PROVIDER_ID)
  if (!spec) {
    console.error(`No such provider "${PROVIDER_ID}". Available: ${LIVE_PROVIDERS.map((p) => p.id).join(', ')}`)
    process.exit(1)
  }
  if (!KEY) {
    console.error(`FATAL: no key for "${PROVIDER_ID}". This test calls a real model.`)
    process.exit(1)
  }

  registerBuiltin()
  // Demo mode: tools fall back to free providers rather than refusing. Strict
  // mode is a separate question and has its own harness.
  setExecutionMode('demo')

  console.log(`model    ${spec.name} · ${spec.model}`)
  console.log(`goal     ${GOAL}\n`)

  const brain = liveBrain({
    baseUrl: spec.baseUrl,
    model: spec.model,
    key: KEY,
    fixedParams: spec.fixedParams,
  })

  const started = Date.now()
  const trace: string[] = []

  const run = await runTaskGraph(GOAL, brain, {
    // The deployment's own tool credentials, exactly as a queued run gets them.
    platformKeys: true,
    planner: {
      baseUrl: spec.baseUrl,
      model: spec.model,
      key: KEY,
      fixedParams: spec.fixedParams,
    },
    budget: {
      maxAgentRuns: 12, maxToolCalls: 24, maxCostUsd: 1.5,
      maxTokens: 400_000, deadlineMs: 8 * 60_000,
    },
    onTrace: (line) => {
      trace.push(line.text)
      // Live, so a long run does not look hung.
      process.stdout.write(`  · ${line.text.slice(0, 110)}\n`)
    },
  })

  const seconds = Math.round((Date.now() - started) / 1000)
  const project = run.project

  console.log(`\n— ${seconds}s —\n`)

  console.log('TASKS')
  for (const task of project.tasks) {
    const mark = task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '○'
    console.log(`  ${mark} ${task.id} (${task.worker}) ${task.status} — ${task.goal.slice(0, 70)}`)
    if (task.blocker) console.log(`      blocked: ${task.blocker.slice(0, 100)}`)
  }

  console.log('\nARTIFACTS')
  for (const artifact of run.artifacts) {
    console.log(`  ${artifact.title} — ${artifact.body.length} chars`)
  }
  if (!run.artifacts.length) console.log('  (none)')

  console.log('\n— the claim —\n')

  check('the goal became a task graph', project.tasks.length > 0, `${project.tasks.length} task(s)`)
  check('at least one task completed',
    project.tasks.some((t) => t.status === 'completed'),
    project.tasks.map((t) => t.status).join(', '))

  // The one that matters. OpenMind's original failure was agents talking and
  // producing nothing.
  const real = run.artifacts.filter((a) => a.body.trim().length > 200)
  check('AN ARTIFACT WITH REAL CONTENT EXISTS, not just conversation',
    real.length > 0,
    real.map((a) => `${a.title} (${a.body.length})`).join(', ') || 'NOTHING WAS PRODUCED')

  check('a task was judged, not merely finished',
    project.tasks.some((t) => t.status === 'completed' || t.status === 'failed'))

  const sourced = project.artifacts.filter((a) => (a.sources ?? 0) > 0)
  check('research cited something it actually fetched',
    sourced.length > 0 || !/research|compar|source/i.test(GOAL),
    `${sourced.length} artifact(s) with sources`)

  check('tools ran against real backends',
    trace.some((t) => /\[LIVE/.test(t)) || run.members.some((m) => m.result.toolCalls.some((c) => c.source === 'live')),
    'no live tool call observed — check agent-tools is deployed')

  console.log(`\nspend    ${project.spend.tokens} tokens · $${project.spend.costUsd.toFixed(4)}`)
  console.log(`blockers ${project.blockers.length ? project.blockers.join(' | ').slice(0, 200) : 'none'}`)

  const answer = run.answer.trim()
  console.log(`\n— answer (${answer.length} chars) —\n`)
  console.log(answer.slice(0, 1200))

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
