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
import { liveBrain, providerSpec, simulatedBrain, type AgentBrain } from '../src/lib/agent'
import { runTaskGraph } from '../src/lib/task-runner'
import { setExecutionMode } from '../src/lib/execution-mode'
import { setProjectOwner } from '../src/lib/project-store'
import { openKey } from './crypto'
import { registerWorkerRuntimes } from './runtimes'
import { createCredentialVault } from './credential-vault'
import { createRoutingStore } from './routing-store'
import { credentialFor } from './credential-resolution'

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
      const entry = { providerId: row.provider_id, apiKey: await openKey(row, SECRET) }
      // Indexed by BOTH, because a row is reachable two ways. A provider
      // connection is stored under its own id, so role and provider agree and
      // this writes one entry. A legacy row (`worker` holding an OpenAI key)
      // writes two, which is what lets old rows keep working unchanged while
      // new lookups go by provider.
      out.set(row.role, entry)
      if (!out.has(row.provider_id)) out.set(row.provider_id, entry)
    } catch {
      // A key encrypted under a rotated secret cannot be recovered. Skip it and
      // let the run block on a missing capability rather than crash the worker.
      console.warn(`run: could not decrypt ${row.role} key for user (secret rotated?)`)
    }
  }
  return out
}

/**
 * The brain for one stored credential, or null if this build does not know the
 * provider.
 *
 * Null is the whole point. This used to end in `?? LIVE_PROVIDERS[0]`, which
 * meant a provider id this build did not recognise — retired, renamed, or
 * mistyped — quietly sent the customer's key to Moonshot's endpoint. A
 * credential disclosure to an unrelated third party, from a stale string.
 * An unknown provider now blocks the run instead.
 */
function brainFor(entry?: { providerId: string; apiKey: string }): AgentBrain | null {
  if (!entry) return simulatedBrain()
  const spec = providerSpec(entry.providerId)
  if (!spec) return null
  return liveBrain({
    baseUrl: spec.baseUrl,
    model: spec.model,
    key: entry.apiKey,
    fixedParams: spec.fixedParams,
  })
}

/**
 * Write a terminal status, but only over a row still marked `running`.
 *
 * Without the guard, a run the user cancelled mid-flight was overwritten with
 * `completed` when the worker finished — the cancellation was not merely
 * ignored, it was erased, and the UI then showed the run as having succeeded.
 */
async function finishRun(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('agent_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'running')
  if (error) console.error(`run ${id}: terminal write failed — ${error.message}`)
}

/** How often a claimed run re-reads its own status to notice a cancellation. */
const CANCEL_POLL_MS = 5000

/**
 * Watch for the row being cancelled while the run is in flight.
 *
 * The client can only set `cancelled`; nothing else moves a running row. So a
 * status that is no longer `running` means the user stopped it, and the run
 * loop should not start another task.
 */
function watchForCancel(id: string): { cancelled: () => boolean; stop: () => void } {
  let cancelled = false
  const timer = setInterval(() => {
    void db
      .from('agent_runs')
      .select('status')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.status !== 'running') cancelled = true
      })
  }, CANCEL_POLL_MS)
  return {
    cancelled: () => cancelled,
    stop: () => clearInterval(timer),
  }
}

async function executeRun(run: RunRow): Promise<void> {
  const started = Date.now()
  console.log(`run ${run.id}: claimed (attempt ${run.attempts}) — ${run.goal.slice(0, 80)}`)

  // Ledger rows are written as this user, and strict mode is per-run.
  setProjectOwner(run.user_id)

  // Re-register runtimes for THIS customer, so an external runtime resolves
  // their credential and not the machine's ambient login. The secret is never
  // held here — only a resolver that fetches it at launch.
  await registerWorkerRuntimes({ vault: createCredentialVault(db, SECRET), userId: run.user_id })
  const strict = run.options.strictMode === true
  setExecutionMode(strict ? 'strict' : 'demo')
  const cancel = watchForCancel(run.id)

  try {
    const keys = await loadKeys(run.user_id)
    const worker = credentialFor(keys, run.options.providerId, 'worker')
    if (!worker) {
      await finishRun(run.id, {
        status: 'needs_user',
        error: keys.size === 0
          ? 'No provider connected. Add one in Settings → Connected providers so Cloud runs can execute.'
          : 'Several providers are connected and none was chosen for this run. '
            + 'Pick a worker model in Settings → Models.',
        finished_at: new Date().toISOString(),
      })
      return
    }

    // Unknown provider: block, do not substitute. See brainFor.
    const brain = brainFor(worker)
    if (!brain) {
      await finishRun(run.id, {
        status: 'needs_user',
        error: `Stored key names provider "${worker.providerId}", which this worker does not know. `
          + 'Re-select a provider in Settings → AI Providers.',
        finished_at: new Date().toISOString(),
      })
      return
    }

    const planner = credentialFor(keys, run.options.plannerProviderId, 'planner') ?? worker
    // Same rule for the planner. A planner whose provider is unrecognised is
    // dropped rather than redirected; strict mode then blocks on
    // planner_unreachable, which is a true statement about the run.
    const plannerSpec = planner ? providerSpec(planner.providerId) : null

    const result = await runTaskGraph(run.goal, brain, {
      persist: true,
      // The browser sends an id, never an implementation. An id this worker
      // has not registered throws rather than falling back to the builtin
      // runtime, because answering with a different agent is worse than not
      // answering.
      runtimeId: typeof run.options.runtimeId === 'string' ? run.options.runtimeId : undefined,
      // Routing evidence, attributed to the customer whose run this is. Nothing
      // reads it yet — it accrues so that a router, when there is one, inherits
      // history instead of starting from zero.
      userId: run.user_id,
      evidence: createRoutingStore(db),
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
      shouldStop: cancel.cancelled,
    })

    if (cancel.cancelled()) {
      // The row already says `cancelled`; write nothing over it. Reporting a
      // status here would be the erasure this fix exists to prevent.
      console.log(`run ${run.id}: cancelled by the user`)
      return
    }

    const blocked = result.project.tasks.some((t) => t.status === 'needs_user')
    await finishRun(run.id, {
      status: blocked ? 'needs_user' : 'completed',
      project_id: result.project.id,
      snapshot: result.project,
      answer: result.answer,
      // The exact trace, so "View Trace" resolves rather than searches.
      trace_id: result.traceId ?? null,
      finished_at: new Date().toISOString(),
    })
    console.log(`run ${run.id}: done in ${Math.round((Date.now() - started) / 1000)}s`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`run ${run.id}: failed — ${message}`)
    await finishRun(run.id, {
      status: 'failed',
      error: message.slice(0, 2000),
      finished_at: new Date().toISOString(),
    })
  } finally {
    cancel.stop()
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

  // Boot-time check reports the CLI. The credential is per customer, so it is
  // checked when a run is claimed, not here.
  for (const runtime of await registerWorkerRuntimes()) {
    console.log(
      `runtime ${runtime.id}: ${runtime.available ? 'available' : 'UNAVAILABLE'}`
      + (runtime.detail ? ` — ${runtime.detail}` : ''),
    )
  }

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
