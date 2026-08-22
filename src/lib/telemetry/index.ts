/**
 * OpenMind's telemetry boundary.
 *
 * Phoenix is a microscope, not an organ. OpenMind stays authoritative for
 * tasks, artifacts, memory, sessions, workspaces, credentials, routing and
 * outcomes; this file only describes what happened to somebody watching.
 *
 * Three properties it must have, in order of importance:
 *
 *   1. **A run works with telemetry off.** The default is off. Nothing here is
 *      imported for its side effects.
 *   2. **A run works when telemetry is broken.** Every entry point swallows.
 *      An exporter that cannot reach a collector, a span that throws while
 *      being built, a Phoenix container that is restarting — none of it may
 *      reach a customer's task.
 *   3. **Nothing secret leaves.** Everything goes through `sanitize.ts`, and
 *      the helpers here take structured values rather than pre-built strings
 *      so the key-name rule can still see field names.
 *
 * The SDK is loaded dynamically so the browser bundle never pulls in
 * `@opentelemetry/sdk-trace-node`, and so a missing optional dependency
 * degrades to a no-op rather than a build failure.
 */

import { safeAttributes, type SafeAttributes } from './sanitize'

export type { SafeAttributes }
export { REDACTED, sanitizeTelemetry, safeAttributes, scrubText, truncate } from './sanitize'

/**
 * How much of a prompt or a response may be recorded.
 *
 * Default is the conservative one. A customer's prompts are their business,
 * and a tracing backend is a second place they can leak from.
 */
export type ContentPolicy = 'metadata_only' | 'redacted_content' | 'full_content_dev_only'

export interface TelemetryConfig {
  enabled: boolean
  endpoint?: string
  projectName: string
  apiKey?: string
  content: ContentPolicy
}

export function telemetryConfig(
  env: Record<string, string | undefined> = process.env,
): TelemetryConfig {
  const content = env.PHOENIX_CONTENT_POLICY
  return {
    // Opt-in. Observability that turns itself on is observability nobody
    // decided to send.
    enabled: env.PHOENIX_ENABLED === 'true',
    endpoint: env.PHOENIX_COLLECTOR_ENDPOINT?.trim() || 'http://localhost:6006',
    projectName: env.PHOENIX_PROJECT?.trim() || 'openmind',
    apiKey: env.PHOENIX_API_KEY?.trim() || undefined,
    content:
      content === 'full_content_dev_only' || content === 'redacted_content'
        ? content
        : 'metadata_only',
  }
}

// ── The span vocabulary ─────────────────────────────────────────────────────

/**
 * The names a trace is made of.
 *
 * Fixed rather than free-form so that "what happened" reads the same across
 * runs and a missing stage is visible as a missing span.
 */
export type SpanName =
  | 'openmind.run'
  | 'task.prepare'
  | 'memory.load'
  | 'eligibility.evaluate'
  | 'routing.select'
  | 'runtime.execute'
  | 'runtime.session'
  | 'workspace.verify'
  | 'model.call'
  | 'tool.call'
  | 'artifact.adopt'
  | 'task.evaluate'
  | 'task.outcome'

/** Correlation. OpenMind's ids, never an email or anything secret. */
export interface TraceIds {
  userId?: string
  projectId?: string
  runId?: string
  taskId?: string
  sessionId?: string
  workspaceId?: string
  runtimeId?: string
  specialistId?: string
  skillId?: string
  skillVersion?: number
  modelId?: string
  providerId?: string
  routingDecisionId?: string
}

interface Span {
  setAttributes(attributes: SafeAttributes): void
  setStatus(status: { code: number; message?: string }): void
  recordException(error: unknown): void
  end(): void
  spanContext(): { traceId: string; spanId: string }
}

interface Tracer {
  startActiveSpan<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T> | T
}

let tracer: Tracer | undefined
let active = false
let shutdownFn: (() => Promise<void>) | undefined

/**
 * Start exporting, if configured.
 *
 * Returns whether telemetry is live, so a caller can report honestly rather
 * than showing a green badge for a collector nobody reached.
 */
export async function startTelemetry(
  config: TelemetryConfig = telemetryConfig(),
): Promise<boolean> {
  if (!config.enabled || active) return active
  try {
    const phoenix = await import('@arizeai/phoenix-otel')
    const provider = phoenix.register({
      projectName: config.projectName,
      url: config.endpoint,
      apiKey: config.apiKey,
      // Batched. A synchronous export in the hot path would make a customer's
      // task wait on our debugging.
      batch: true,
      global: true,
    }) as unknown as { shutdown?: () => Promise<void> }

    tracer = phoenix.getTracer('openmind') as unknown as Tracer
    shutdownFn = provider.shutdown?.bind(provider)
    active = true
  } catch (error) {
    // The whole point: a broken microscope is not a broken system.
    console.warn(`telemetry disabled — ${error instanceof Error ? error.message : String(error)}`)
    active = false
  }
  return active
}

/** Flush before a short-lived process exits, or spans are lost in the batcher. */
export async function stopTelemetry(): Promise<void> {
  try {
    await shutdownFn?.()
  } catch {
    /* nothing to do about a failed flush */
  } finally {
    active = false
    tracer = undefined
    shutdownFn = undefined
  }
}

export function telemetryActive(): boolean {
  return active
}

/** Test seam, and the mechanism the failure tests use. */
export function _setTracerForTesting(next: Tracer | undefined): void {
  tracer = next
  active = Boolean(next)
}

// ── Emitting ────────────────────────────────────────────────────────────────

export interface SpanOptions {
  ids?: TraceIds
  attributes?: Record<string, unknown>
  /**
   * This span is the run.
   *
   * A root PINS the trace id for its duration, so `currentTraceId()` reports
   * the run's trace rather than whichever span happened to start last. Without
   * it the id handed back to a caller belonged to the final span — which, if
   * that span was emitted outside the root, was a DIFFERENT trace entirely.
   * Phoenix caught exactly that: the id returned resolved to a one-span trace.
   */
  root?: boolean
}

/**
 * Run `fn` inside a span, or just run it.
 *
 * The signature is deliberately "wrap the real work" rather than
 * "start/end a span", so a thrown error cannot leave a span open and no caller
 * has to remember to close one. If anything in the telemetry path fails, `fn`
 * still runs and its result is still returned.
 */
export async function traced<T>(
  name: SpanName,
  options: SpanOptions,
  fn: (record: (attributes: Record<string, unknown>) => void) => Promise<T>,
): Promise<T> {
  const current = tracer
  if (!active || !current) {
    // No span, no overhead, and `record` is a no-op the caller cannot tell
    // apart from a real one.
    return fn(() => {})
  }

  // `started` is what separates "the tracer broke" from "the work broke".
  // Without it a collector that throws on startActiveSpan looks exactly like a
  // failing task, and telemetry becomes the thing that takes a run down.
  let started = false

  try {
    return (await current.startActiveSpan(name, async (span) => {
      const record = (attributes: Record<string, unknown>) => {
        try {
          span.setAttributes(safeAttributes(attributes))
        } catch {
          /* a bad attribute must not fail the work */
        }
      }

      try {
        span.setAttributes(idAttributes(options.ids ?? {}))
        if (options.attributes) record(options.attributes)
        noteTraceId(span.spanContext?.().traceId, options.root)
      } catch {
        /* as above */
      }

      started = true
      try {
        const result = await fn(record)
        span.setStatus({ code: 1 })
        return result
      } catch (error) {
        try {
          span.setStatus({ code: 2, message: errorMessage(error) })
          span.recordException(error)
        } catch {
          /* the original error is what matters */
        }
        throw error
      } finally {
        try {
          span.end()
        } catch {
          /* nothing further to do */
        }
      }
    })) as T
  } catch (error) {
    // The work's own error propagates; anything that went wrong before the work
    // began was ours, and the caller must not see it.
    if (started) throw error
    return fn(() => {})
  }
}

/** The current trace id, so a run row can link to its trace. */
export function currentTraceId(): string | undefined {
  return lastTraceId
}

let lastTraceId: string | undefined

export function _setTraceIdForTesting(id: string | undefined): void {
  lastTraceId = id
}

let pinned = false

export function noteTraceId(id: string | undefined, isRoot = false): void {
  if (!id) return
  if (isRoot) {
    lastTraceId = id
    pinned = true
    return
  }
  // A child never overwrites the run's id.
  if (!pinned) lastTraceId = id
}

/** Release the pin when a run ends, so the next run reports its own trace. */
export function endTraceRoot(): void {
  pinned = false
}

function idAttributes(ids: TraceIds): SafeAttributes {
  // Prefixed so Phoenix groups them, and passed through the sanitiser like
  // everything else — `providerSessionId` is deliberately a secret-shaped key.
  return safeAttributes({
    'openmind.user_id': ids.userId,
    'openmind.project_id': ids.projectId,
    'openmind.run_id': ids.runId,
    'openmind.task_id': ids.taskId,
    'openmind.session_id': ids.sessionId,
    'openmind.workspace_id': ids.workspaceId,
    'openmind.runtime_id': ids.runtimeId,
    'openmind.specialist_id': ids.specialistId,
    'openmind.skill_id': ids.skillId,
    'openmind.skill_version': ids.skillVersion,
    'openmind.model_id': ids.modelId,
    'openmind.provider_id': ids.providerId,
    'openmind.routing_decision_id': ids.routingDecisionId,
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
