/**
 * The live BrowserProvider: hosted Chrome, reached through `agent-tools`.
 *
 * This is the file that makes the browser split real rather than tidy. Before
 * it, `BrowserProvider` was an interface nothing implemented and `web_act` was
 * a tool that returned prose — the exact split-brain the kernel keeps
 * eliminating everywhere else.
 *
 * It is deliberately a thin adapter over `invokeCrewTool`, for the same reason
 * `sandbox-runtime` is: that transport is the one exercised against the real
 * Browserless deployment, and a parallel client would be a second thing to
 * keep correct. Everything here is translation — typed actions in, a typed
 * session result out — plus the one thing the tool layer cannot do, which is
 * refuse to report a simulated page as a real visit.
 *
 * ## What this provider cannot do
 *
 * No screenshots. The `agent-tools` web_act path returns page text from
 * Browserless `/content` or `/function`; it never captures an image. A plan
 * containing a screenshot action is therefore **blocked with a reason**, not
 * quietly run without it — a vision step that silently becomes a DOM step
 * produces an answer about a chart nobody looked at.
 */

import { invokeCrewTool, isCrewToolLive } from '../crew-tools'
import { isSimulated } from './runtime'
import type { ExecutionContext } from './execution-context'
import {
  emptySessionResult,
  type BrowserAction, type BrowserProvider, type BrowserSessionResult, type VisitRecord,
} from './browser-runtime'

/** The `web_act` request shape, mirroring the edge function's parser. */
interface WebActRequest {
  url: string
  goal: string
  steps: Array<{ click?: string; type?: { selector: string; text: string }; waitMs?: number }>
}

const LIVE_ENVELOPE = /^\[LIVE · web_act[^\]]*\]\s*(\S+)?/

/**
 * Turn a typed plan into the one request the backend understands.
 *
 * Returns undefined when the plan has no navigation: hosted Chrome is
 * stateless between calls, so a plan that starts by clicking has no page to
 * click on. Reporting that is better than sending a request that will act on
 * whatever `about:blank` does.
 */
export function toWebActRequest(actions: readonly BrowserAction[]): WebActRequest | undefined {
  const navigate = actions.find((a) => a.kind === 'navigate' && a.url)
  if (!navigate?.url) return undefined

  const steps: WebActRequest['steps'] = []
  const wanted: string[] = []
  for (const action of actions) {
    if (action.kind === 'click' && action.target) steps.push({ click: action.target })
    if (action.kind === 'type' && action.target) {
      steps.push({ type: { selector: action.target, text: action.value ?? '' } })
    }
    if (action.kind === 'extract' && action.fields?.length) wanted.push(...action.fields)
  }

  return {
    url: navigate.url,
    goal: wanted.length ? `extract: ${wanted.join(', ')}` : 'read the page',
    steps: steps.slice(0, 8),
  }
}

/**
 * Turn the `web_act` tool's own input vocabulary into typed actions.
 *
 * The model still writes `{"url","goal","steps":[{"click"},{"type"}]}` — that
 * is the documented tool contract and changing it would invalidate every
 * prompt. This is the adapter between what a model writes and what the
 * provider executes, and it lives here rather than in the worker because the
 * worker must not know the transport's request shape.
 */
export function actionsFromWebAct(spec: {
  url: string
  goal: string
  steps: readonly { click?: string; type?: { selector: string; text: string }; waitMs?: number }[]
}): BrowserAction[] {
  const actions: BrowserAction[] = [{ kind: 'navigate', url: spec.url }]
  for (const step of spec.steps) {
    if (step.click) actions.push({ kind: 'click', target: step.click })
    else if (step.type) {
      actions.push({ kind: 'type', target: step.type.selector, value: step.type.text })
    }
    // waitMs has no typed action: it is a transport detail of a click, not
    // something a plan should express. It survives in the request below.
  }
  const fields = goalFields(spec.goal)
  actions.push(fields.length ? { kind: 'extract', fields } : { kind: 'extract' })
  return actions
}

/** Field names a goal names explicitly: "extract: price, plan". */
function goalFields(goal: string): string[] {
  const match = /\bextract\s*:?\s*(.+)$/i.exec(goal)
  if (!match) return []
  return match[1]
    .split(/[,;]/)
    .map((f) => f.trim())
    .filter((f) => f && f.length < 40)
    .slice(0, 8)
}

/**
 * Best-effort field lookup in page text.
 *
 * Only reports what it actually found. A field the page does not contain is
 * absent from the record rather than present and empty — an empty string looks
 * like a value that was read, and downstream nothing can tell the difference.
 */
export function extractFields(text: string, fields: readonly string[]): Record<string, string> {
  const found: Record<string, string> = {}
  for (const field of fields) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^\\s*${escaped}\\s*[:\\-–]\\s*(.+)$`, 'im').exec(text)
    const value = match?.[1]?.trim()
    if (value) found[field] = value.slice(0, 400)
  }
  return found
}

/** Parse the tool envelope into a session result. */
export function parseWebActOutput(
  output: string,
  request: WebActRequest,
  fields: readonly string[],
  now = Date.now(),
): BrowserSessionResult {
  // A mocked, refused or failed call is not a visit. Counting one as a visit is
  // how a browser worker reports sources it never loaded.
  //
  // Both refusal formats are checked because they are different strings and
  // getting this wrong is silent: `TASK_BLOCKED [...]` is the strict-mode wire
  // format, `[BLOCKED · web_act]` is a declined confirmation, and neither looks
  // like a `[MOCK` prefix. A refusal parsed as a page becomes a visit record
  // with the refusal text as its content.
  if (isSimulated(output) || output.startsWith('[BLOCKED') || output.startsWith('TASK_BLOCKED')) {
    return { ...emptySessionResult(), blocked: firstLine(output) }
  }

  const envelope = LIVE_ENVELOPE.exec(output)
  const url = envelope?.[1] ?? request.url
  const body = output.replace(/^\[LIVE[^\]]*\][^\n]*\n?/, '').replace(/^Goal:[^\n]*\n?/, '')

  const visit: VisitRecord = { url, title: titleFrom(body), at: now, via: 'dom' }
  const record: Record<string, unknown> = { url, text: body.slice(0, 8000) }
  if (fields.length) {
    const values = extractFields(body, fields)
    // Recorded even when empty, so "we looked and it was not there" is
    // distinguishable from "we never looked".
    record.fields = values
    record.missing = fields.filter((f) => !(f in values))
  }

  return { visits: [visit], data: [record], screenshots: [], downloads: [] }
}

function firstLine(text: string): string {
  return text.split('\n')[0].slice(0, 300)
}

function titleFrom(body: string): string | undefined {
  const line = body.split('\n').map((l) => l.trim()).find(Boolean)
  return line ? line.slice(0, 160) : undefined
}

/**
 * Hosted Chrome behind `agent-tools`.
 *
 * Bound to an ExecutionContext when one exists, so permissions and
 * cancellation reach the call the same way they do for workspace tools.
 */
export function webActProvider(context?: ExecutionContext): BrowserProvider {
  return {
    id: 'web-act',

    async available() {
      return isCrewToolLive('web_act')
    },

    async run(actions: BrowserAction[]): Promise<BrowserSessionResult> {
      if (actions.some((a) => a.kind === 'screenshot')) {
        return {
          ...emptySessionResult(),
          blocked: 'this provider cannot capture screenshots — hosted Chrome returns page text only',
        }
      }
      if (actions.some((a) => a.kind === 'download')) {
        return { ...emptySessionResult(), blocked: 'this provider cannot download files' }
      }

      const request = toWebActRequest(actions)
      if (!request) {
        return {
          ...emptySessionResult(),
          blocked: 'no navigate action — hosted Chrome has no page open between calls',
        }
      }

      const fields = actions.flatMap((a) => (a.kind === 'extract' ? a.fields ?? [] : []))
      try {
        const output = await invokeCrewTool('web_act', JSON.stringify(request), undefined, context)
        return parseWebActOutput(output, request, fields)
      } catch (error) {
        return {
          ...emptySessionResult(),
          blocked: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
