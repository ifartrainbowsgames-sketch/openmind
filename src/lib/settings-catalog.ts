/**
 * The settings surface, described once.
 *
 * Nav order, page titles, search results and deep-link anchors all read from
 * this file. Settings used to live in two stacked bottom sheets where a label
 * existed in the markup only, so nothing could link to a row and nothing could
 * find one. A row that is not in this catalog is not searchable — that is the
 * point: adding a setting means declaring it here.
 */

export const SETTINGS_SECTIONS = [
  'general',
  'models',
  'keys',
  'tools',
  'execution',
  'appearance',
  'connections',
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const DEFAULT_SECTION: SettingsSection = 'general'

export interface SectionMeta {
  /** Sidebar label and page heading. */
  label: string
  /** One line under the heading. Says what the section is for, not what it contains. */
  blurb: string
  /** lucide-react icon name, resolved by the layout. */
  icon: string
}

export const SECTION_META: Readonly<Record<SettingsSection, SectionMeta>> = {
  general: {
    label: 'Account',
    blurb: 'Who you are signed in as, and what that unlocks.',
    icon: 'UserRound',
  },
  models: {
    label: 'Models',
    blurb: 'The model that does the work, and the separate one that plans and grades it.',
    icon: 'Brain',
  },
  keys: {
    label: 'Keys',
    blurb: 'Where each key is stored, and which runs can reach it.',
    icon: 'KeyRound',
  },
  tools: {
    label: 'Tools',
    blurb: 'Search, browsing, hosted Chrome and the code sandbox.',
    icon: 'Wrench',
  },
  execution: {
    label: 'Execution',
    blurb: 'Strict mode, background runs, and the spend ceiling per project.',
    icon: 'Play',
  },
  appearance: {
    label: 'Appearance',
    blurb: 'Theme and reduced motion.',
    icon: 'Palette',
  },
  connections: {
    label: 'Connections',
    blurb: 'MCP servers and connected apps.',
    icon: 'Blocks',
  },
}

export interface SettingsSearchItem {
  readonly id: string
  readonly title: string
  readonly section: SettingsSection
  /** Element id to scroll to. Rows render this id via `anchorProps`. */
  readonly anchor: string
  /** Extra words that should match but do not belong in the visible title. */
  readonly keywords?: string
}

/**
 * Every findable row, in result order. `anchor` must match an element that
 * actually renders, otherwise a result scrolls nowhere — `settingsAnchors`
 * in the panels is the other half of that contract.
 */
export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  { id: 'account', title: 'Signed-in account', section: 'general', anchor: 'account', keywords: 'sign in out email login logout session' },
  { id: 'plan', title: 'What signing in unlocks', section: 'general', anchor: 'capabilities', keywords: 'background worker sync history' },

  { id: 'worker-model', title: 'Worker model', section: 'models', anchor: 'worker-model', keywords: 'openai anthropic model chat provider' },
  { id: 'planner-model', title: 'Planner model', section: 'models', anchor: 'planner-model', keywords: 'plan separate independent review' },
  { id: 'judge-model', title: 'Judge model', section: 'models', anchor: 'judge-model', keywords: 'grade verdict acceptance review' },

  { id: 'browser-keys', title: 'Keys held in this browser', section: 'keys', anchor: 'browser-keys', keywords: 'local device localstorage foreground' },
  { id: 'server-keys', title: 'Keys held on the server', section: 'keys', anchor: 'server-keys', keywords: 'vault encrypted background worker' },
  { id: 'key-storage', title: 'Where keys are stored', section: 'keys', anchor: 'storage-explainer', keywords: 'encryption aes security privacy' },

  { id: 'search-tool', title: 'Search provider', section: 'tools', anchor: 'search', keywords: 'tavily duckduckgo searxng' },
  { id: 'browse-tool', title: 'Browse provider', section: 'tools', anchor: 'browse', keywords: 'firecrawl jina scrape fetch' },
  { id: 'browserless', title: 'Hosted Chrome', section: 'tools', anchor: 'browserless', keywords: 'browserless headless puppeteer' },
  { id: 'sandbox', title: 'Code sandbox', section: 'tools', anchor: 'sandbox', keywords: 'e2b run code workspace terminal' },

  { id: 'strict-mode', title: 'Strict mode', section: 'execution', anchor: 'strict-mode', keywords: 'mock demo blocked honest' },
  { id: 'background-runs', title: 'Run in background', section: 'execution', anchor: 'background-runs', keywords: 'queue worker close tab' },
  { id: 'budget', title: 'Spend ceiling', section: 'execution', anchor: 'budget', keywords: 'cost usd budget limit tokens' },

  { id: 'theme', title: 'Theme', section: 'appearance', anchor: 'theme', keywords: 'dark light system colour color' },
  { id: 'motion', title: 'Reduced motion', section: 'appearance', anchor: 'motion', keywords: 'animation accessibility' },

  { id: 'mcp', title: 'MCP servers', section: 'connections', anchor: 'mcp', keywords: 'model context protocol tools' },
  { id: 'apps', title: 'Connected apps', section: 'connections', anchor: 'apps', keywords: 'integrations google slack' },
]

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

/**
 * Substring match over title, section label and keywords. Deliberately not
 * fuzzy: a settings search that returns near-misses is worse than one that
 * returns nothing, because the user cannot tell a miss from an absent feature.
 */
export function searchSettings(query: string): SettingsSearchItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = q.split(/\s+/)
  return SETTINGS_SEARCH_ITEMS.filter((item) => {
    const haystack = `${item.title} ${SECTION_META[item.section].label} ${item.keywords ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export function sectionPath(section: SettingsSection): string {
  return `/settings/${section}`
}

/** Props for a row that search can scroll to. Keeps the id spelling in one place. */
export function anchorProps(anchor: string): { id: string; 'data-settings-anchor': string } {
  return { id: `settings-${anchor}`, 'data-settings-anchor': anchor }
}

export function scrollToAnchor(anchor: string): void {
  const el = document.getElementById(`settings-${anchor}`)
  if (!el) return
  el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  el.classList.add('settings-flash')
  window.setTimeout(() => el.classList.remove('settings-flash'), 1200)
}
