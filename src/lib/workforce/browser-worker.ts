/**
 * Browser strategy: what to do with a browser, and what survives afterwards.
 *
 * `web_act` already drives hosted Chrome, but it returns prose — "I visited the
 * page and the pricing looks like…". That is unusable downstream: an analyst
 * cannot read it, the judge cannot count sources in it, and nobody can tell
 * whether the page was actually loaded or described from memory.
 *
 * This turns a browsing session into the three things that survive: structured
 * data, the URLs actually visited, and screenshots taken only when the DOM
 * could not answer the question.
 *
 * DOM before vision, deliberately. A screenshot costs more, takes longer, and
 * is read by a model that may hallucinate what it sees; the accessibility tree
 * is already there and is exact. Vision is for when the page genuinely encodes
 * meaning visually — a chart, a layout bug — not as a default.
 *
 * The machine half lives in `browser-runtime.ts`. Nothing here should know how
 * a page is actually fetched.
 */

import type {
  BrowserAction, BrowserProvider, BrowserSessionResult, VisitRecord,
} from './browser-runtime'
import type { ToolArtifact } from '../agent'

/**
 * Turn a session into files.
 *
 * `{ path, body }` rather than `ArtifactRecord` on purpose: this runs inside a
 * tool call, which does not know the task it serves and should not invent a
 * ledger id. The orchestrator shapes these into records with the task it
 * already has, so there is one artifact shaper rather than two that drift.
 *
 * A blocked session produces NO artifacts. Emitting an empty `page-data.json`
 * would pass an `artifact_exists` check while containing nothing — the precise
 * shape of fake success this system keeps removing.
 */
export function browserArtifacts(result: BrowserSessionResult): ToolArtifact[] {
  if (result.blocked) return []

  const artifacts: ToolArtifact[] = []
  if (result.data.length) {
    artifacts.push({
      path: 'browser/page-data.json',
      body: JSON.stringify({ items: result.data }, null, 2),
    })
  }
  if (result.visits.length) {
    artifacts.push({
      path: 'browser/sources.json',
      body: JSON.stringify(
        {
          sources: result.visits.map((v) => ({ url: v.url, title: v.title, via: v.via })),
          // A weak but real independence signal, and the reason distinctHosts
          // exists — three pages from one host is one source wearing three hats.
          hosts: distinctHosts(result.visits),
        },
        null,
        2,
      ),
    })
  }
  return artifacts
}

/**
 * Run a browsing plan and return what survives it.
 *
 * This is the WHO half doing its job: normalise the plan, refuse to run
 * against a provider that is not there, and shape the outcome. It never learns
 * how a page is fetched — that is the provider's business.
 */
export async function runBrowserPlan(
  provider: BrowserProvider,
  actions: BrowserAction[],
): Promise<{ result: BrowserSessionResult; artifacts: ToolArtifact[] }> {
  if (!(await provider.available())) {
    const result: BrowserSessionResult = {
      visits: [], data: [], screenshots: [], downloads: [],
      blocked: `browser provider "${provider.id}" is not available`,
    }
    return { result, artifacts: [] }
  }

  const result = await provider.run(orderActions([...actions]))
  return { result, artifacts: browserArtifacts(result) }
}

/**
 * Should this step use vision?
 *
 * Only when the DOM attempt already failed, or the question is inherently
 * visual. Defaulting to screenshots is how a browser worker becomes slow,
 * expensive and unreliable at the same time.
 */
export function needsVision(opts: { domFailed: boolean; question: string }): boolean {
  if (opts.domFailed) return true
  return /\b(chart|graph|layout|visual|screenshot|looks?\s+like|colou?r|design)\b/i.test(opts.question)
}

/** Normalise a plan so navigation always precedes interaction with a page. */
export function orderActions(actions: BrowserAction[]): BrowserAction[] {
  const firstNavigate = actions.findIndex((a) => a.kind === 'navigate')
  if (firstNavigate <= 0) return actions
  // A plan that clicks before navigating targets whatever page happened to be
  // open — usually the previous task's.
  const [nav] = actions.splice(firstNavigate, 1)
  return [nav, ...actions]
}

/** Distinct hosts visited — a weak but real independence signal for sourcing. */
export function distinctHosts(visits: readonly VisitRecord[]): string[] {
  const hosts = new Set<string>()
  for (const visit of visits) {
    try {
      hosts.add(new URL(visit.url).hostname.replace(/^www\./, ''))
    } catch {
      /* not a parseable URL — not a source */
    }
  }
  return [...hosts]
}
