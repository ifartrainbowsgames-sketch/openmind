/**
 * Browser work that produces artifacts.
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
 */

import type { ArtifactRecord } from '../task-ledger'

export type BrowserActionKind = 'navigate' | 'click' | 'type' | 'extract' | 'screenshot' | 'download'

export interface BrowserAction {
  kind: BrowserActionKind
  /** For navigate. */
  url?: string
  /** For click/type — prefer a role/name pair over a CSS selector. */
  target?: string
  /** For type. */
  value?: string
  /** For extract — what shape the caller wants back. */
  fields?: string[]
}

export interface VisitRecord {
  url: string
  title?: string
  at: number
  /** How the content was obtained. */
  via: 'dom' | 'vision' | 'download'
}

export interface BrowserSessionResult {
  visits: VisitRecord[]
  /** Structured data extracted, keyed by whatever the caller asked for. */
  data: Record<string, unknown>[]
  screenshots: string[]
  downloads: string[]
  /** Set when the session could not run at all. */
  blocked?: string
}

export function emptySessionResult(): BrowserSessionResult {
  return { visits: [], data: [], screenshots: [], downloads: [] }
}

/**
 * The interface a browser provider implements. Playwright, Browser Use and an
 * MCP browser server all fit; none is assumed.
 */
export interface BrowserProvider {
  readonly id: string
  available(): Promise<boolean>
  run(actions: BrowserAction[]): Promise<BrowserSessionResult>
}

/**
 * Turn a session into the artifacts the ledger expects.
 *
 * A blocked session produces NO artifacts. Emitting an empty `page-data.json`
 * would pass an `artifact_exists` check while containing nothing — the precise
 * shape of fake success this system keeps removing.
 */
export function browserArtifacts(
  result: BrowserSessionResult,
  taskId: string,
  now = Date.now(),
): ArtifactRecord[] {
  if (result.blocked) return []

  const artifacts: ArtifactRecord[] = []
  const add = (path: string, body: string, sources: number) => {
    artifacts.push({
      id: `art-${taskId}-${path.replace(/\W/g, '-')}`,
      path,
      kind: path.endsWith('.json') ? 'json' : 'markdown',
      title: path.split('/').pop() ?? path,
      body,
      taskId,
      worker: 'browser',
      sources,
      confidence: 0.8,
      createdAt: now,
    })
  }

  if (result.data.length) {
    add('browser/page-data.json', JSON.stringify({ items: result.data }, null, 2), result.visits.length)
  }
  if (result.visits.length) {
    add(
      'browser/sources.json',
      JSON.stringify({ sources: result.visits.map((v) => ({ url: v.url, title: v.title, via: v.via })) }, null, 2),
      result.visits.length,
    )
  }
  return artifacts
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
