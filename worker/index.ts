// OpenMind run worker — executes queued task graphs off the browser.
//
// The browser used to BE the runtime, so closing the tab killed the work. This
// polls `agent_runs`, claims a row atomically, decrypts the customer's provider
// key, and runs the exact same `runTaskGraph` the client ran — no second
// implementation to drift out of sync.
//
// Runs with the service role, so it sits behind no user session and must derive
// the owner from the claimed row rather than from any request.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { liveBrain, simulatedBrain, type AgentBrain } from '../src/lib/agent'
import { LIVE_PROVIDERS } from '../src/lib/agent'
import { runTaskGraph } from '../src/lib/task-runner'
import { setExecutionMode } from '../src/lib/execution-mode'
import { setProjectOwner } from '../src/lib/project-store'
import { openKey } from './crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SECRET = process.env.KEY_ENCRYPTION_SECRET ?? ''
const WORKER_ID = process.env.RAILWAY_REPLICA_ID ?? `worker-${process.pid}`
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000)
const IDLE_LOG_EVERY = 20

interface RunRow {
  id: string
  user_id: string
  goal: string
  options: Record<string, unknown>
  attempts: number
}

interface KeyRow {
  role: 'worker' | 'planner' | 'judge' | 'tavily' | 'firecrawl' | 'e2b' | 'browserless'
  provider_id: string
  ciphertext: string
  iv: string
}

function must(name: string, value: string): string {
  if (!value) {
    console.error(`FATAL: ${name} is not set`)
    process.exit(1)
  }
  return value
}

const db: SupabaseClient = createClient(
  must('SUPABASE_URL', SUPABASE_URL),
  must('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

/** Provider keys for one user, decrypted. Never logged, never returned upstream. */
async function loadKeys(userId: string): Promise<Map<string, { providerId: string; apiKey: string }>> {
  const { data, error } = await db
    .from('provider_keys')
    .select('role, provider_id, ciphertext, iv')
    .eq('user_id', userId)
  if (error) throw new Error(`key lookup failed: ${error.message}`)

  const out = new Map<string, { providerId: string; apiKey: string }>()
  for (const row of (data ?? []) as KeyRow[]) {
    try {
      out.set(row.role, { providerId: row.provider_id, apiKey: await openKey(row, SECRET) })
    } catch {
      // A key encrypted under a rotated secret cannot be recovered. Skip it and
      // let the run block on a missing capability rather than crash the worker.
      console.warn(`run: could not decrypt ${row.role} key for user (secret rotated?)`)
    }
  }
  return out
}

function brainFor(entry?: { providerId: string; apiKey: string }): AgentBrain {
  if (!entry) return simulatedBrain()
  const spec = LIVE_PROVIDERS.find((p) => p.id === entry.providerId) ?? LIVE_PROVIDERS[0]
  return liveBrain({
    baseUrl: spec.baseUrl,
    model: spec.model,
    key: entry.apiKey,
    fixedParams: spec.fixedParams,
  })
}

async function patchRun(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('agent_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error(`run ${id}: status write failed — ${error.message}`)
}

async function executeRun(run: RunRow): Promise<void> {
  const started = Date.now()
  console.log(`run ${run.id}: claimed (attempt ${run.attempts}) — ${run.goal.slice(0, 80)}`)

  // Ledger rows are written as this user, and strict mode is per-run.
  setProjectOwner(run.user_id)
  const strict = run.options.strictMode === true
  setExecutionMode(strict ? 'strict' : 'demo')

  try {
    const keys = await loadKeys(run.user_id)
    const worker = keys.get('worker')
    if (strict && !worker) {
      await patchRun(run.id, {
        status: 'needs_user',
        error: 'No provider key stored. Add one in Settings so background runs can execute.',
        finished_at: new Date().toISOString(),
      })
      return
    }

    const planner = keys.get('planner') ?? worker
    const plannerSpec = planner
      ? LIVE_PROVIDERS.find((p) => p.id === planner.providerId) ?? LIVE_PROVIDERS[0]
      : undefined

    const result = await runTaskGraph(run.goal, brainFor(worker), {
      persist: true,
      workspace: run.options.workspace as never,
      skill: run.options.skill as never,
      // The vault holds the customer's model key only. Tools run on our
      // credentials here exactly as they do for a foreground run, so a queued
      // run and a live one have identical capabilities.
      platformKeys: true,
      planner:
        planner && plannerSpec
          ? {
              baseUrl: plannerSpec.baseUrl,
              model: plannerSpec.model,
              key: planner.apiKey,
              fixedParams: plannerSpec.fixedParams,
            }
          : null,
      // Progress streams to the row so a reconnecting browser sees it live.
      onTrace: () => undefined,
    })

    const blocked = result.project.tasks.some((t) => t.status === 'needs_user')
    await patchRun(run.id, {
      status: blocked ? 'needs_user' : 'completed',
      project_id: result.project.id,
      snapshot: result.project,
      answer: result.answer,
      finished_at: new Date().toISOString(),
    })
    console.log(`run ${run.id}: done in ${Math.round((Date.now() - started) / 1000)}s`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`run ${run.id}: failed — ${message}`)
    await patchRun(run.id, {
      status: 'failed',
      error: message.slice(0, 2000),
      finished_at: new Date().toISOString(),
    })
  } finally {
    setExecutionMode('demo')
  }
}

async function claimOne(): Promise<RunRow | null> {
  const { data, error } = await db.rpc('claim_agent_run', { worker_id: WORKER_ID })
  if (error) {
    console.error(`claim failed: ${error.message}`)
    return null
  }
  const rows = (data ?? []) as RunRow[]
  return rows[0] ?? null
}

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    // Finish the run in flight rather than abandoning a half-written ledger.
    console.log(`${signal} received — finishing current run, then exiting`)
    stopping = true
  })
}

async function main(): Promise<void> {
  must('KEY_ENCRYPTION_SECRET', SECRET)
  console.log(`worker ${WORKER_ID} polling every ${POLL_MS}ms`)
  let idleTicks = 0

  while (!stopping) {
    const run = await claimOne()
    if (run) {
      idleTicks = 0
      await executeRun(run)
      continue
    }
    if (++idleTicks % IDLE_LOG_EVERY === 0) console.log(`idle (${idleTicks} polls)`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  console.log('worker stopped')
  process.exit(0)
}

main().catch((err) => {
  console.error('worker crashed:', err)
  process.exit(1)
})
