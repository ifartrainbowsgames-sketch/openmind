/**
 * The browser as a machine: where actions happen and how.
 *
 * This is the WHERE/HOW half of what used to be one file. `browser-worker.ts`
 * held the provider interface, the action vocabulary and the session result
 * alongside the strategy for using them — vision heuristics, artifact shaping,
 * source counting. Two layers in one module, and the same split the kernel
 * already made everywhere else applies here:
 *
 *   AgentRuntime  = WHO        Runtime        = WHERE
 *   BrowserWorker = WHO        BrowserSession = WHERE / HOW
 *
 * The consequence of leaving them merged is specific: Playwright ends up
 * buried inside a browser agent, and swapping the provider means editing the
 * agent. Nothing here knows what a good browsing plan looks like — that is
 * `browser-worker.ts`, and it may not know what a CDP connection is.
 */

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
 * The interface a browser provider implements. Playwright, Browser Use, hosted
 * Chrome behind `web_act` and an MCP browser server all fit; none is assumed.
 */
export interface BrowserProvider {
  readonly id: string
  available(): Promise<boolean>
  run(actions: BrowserAction[]): Promise<BrowserSessionResult>
}
