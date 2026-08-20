import catalog from '@/data/nango-providers.json'

export interface NangoProvider {
  id: string
  name: string
  categories: string[]
  auth: string
}

export interface NangoCatalog {
  generatedAt: string
  source: string
  count: number
  categories: string[]
  providers: NangoProvider[]
}

export const NANGO_CONNECTIONS_KEY = 'om-nango-connections'
export const NANGO_OWNER_KEY = 'om-nango-owner'

export interface NangoConnection {
  providerId: string
  connectionId?: string
  connectedAt: number
  userId?: string
}

export const NANGO_TO_OPENMIND: Record<string, string> = {
  github: 'github',
  'github-app': 'github',
  slack: 'slack',
  notion: 'notion',
  linear: 'linear',
  jira: 'jira',
  hubspot: 'hubspot',
  zendesk: 'zendesk',
  google: 'gmail',
  gmail: 'gmail',
  'google-mail': 'gmail',
  'google-calendar': 'gcal',
  'google-drive': 'gdrive',
  outlook: 'outlook',
}

/** Map a connected integration to OpenMind live-connection ids the crew already uses. */
export function liveIdsForNangoProvider(providerId: string): string[] {
  if (providerId === 'google' || providerId === 'gmail' || providerId === 'google-mail') return ['gmail', 'gdrive']
  if (providerId === 'google-drive') return ['gdrive']
  const one = NANGO_TO_OPENMIND[providerId]
  return one ? [one] : []
}

/** Never surface operator secrets or infra names in the product UI. */
export function customerConnectError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/NANGO_|secret key|nango-session|nango-act|VITE_|edge function/i.test(raw)) {
    return 'This app isn’t ready to connect yet. Try again in a moment.'
  }
  const trimmed = raw.trim()
  if (trimmed.length > 0 && trimmed.length < 160 && !/secret|mcp|supabase/i.test(trimmed)) return trimmed
  return 'Couldn’t connect. Try again.'
}

const SEARCH_ALIASES: Record<string, string[]> = {
  gmail: ['google'],
  mail: ['google', 'outlook'],
  calendar: ['google'],
  drive: ['google'],
  docs: ['google', 'notion'],
}

export function nangoCatalog(): NangoCatalog {
  return catalog as NangoCatalog
}

export function nangoLogoUrl(providerId: string): string {
  return `https://app.nango.dev/images/template-logos/${providerId}.svg`
}

export function searchNangoProviders(
  query: string,
  category = 'all',
  list: NangoProvider[] = nangoCatalog().providers,
): NangoProvider[] {
  const q = query.trim().toLowerCase()
  const terms = q
    ? [q, ...Object.entries(SEARCH_ALIASES).flatMap(([alias, ids]) => (q.includes(alias) ? ids : []))]
    : []
  return list.filter((p) => {
    if (category !== 'all' && !p.categories.includes(category)) return false
    if (!terms.length) return true
    const hay = `${p.name} ${p.id} ${p.categories.join(' ')} ${p.auth}`.toLowerCase()
    return terms.some((term) => hay.includes(term))
  })
}

export function nangoOwnerId(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(NANGO_OWNER_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function setNangoOwner(userId: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(NANGO_OWNER_KEY, userId)
}

function connectionsStorageKey(): string {
  const owner = nangoOwnerId()
  return owner ? `${NANGO_CONNECTIONS_KEY}:${owner}` : NANGO_CONNECTIONS_KEY
}

export function nangoLinked(providerId: string): NangoConnection | null {
  return (
    loadNangoConnections().find((c) => {
      if (providerId === 'github') return c.providerId === 'github' || c.providerId.startsWith('github')
      if (providerId === 'slack') return c.providerId === 'slack' || c.providerId.startsWith('slack')
      if (providerId === 'gmail' || providerId === 'google') {
        return c.providerId === 'google' || c.providerId === 'gmail' || c.providerId === 'google-mail'
      }
      if (providerId === 'gdrive' || providerId === 'google-drive') {
        return c.providerId === 'google-drive' || c.providerId === 'google'
      }
      return c.providerId === providerId
    }) ?? null
  )
}

export function loadNangoConnections(): NangoConnection[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(connectionsStorageKey())
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const owner = nangoOwnerId()
    return parsed.filter((c): c is NangoConnection =>
      !!c && typeof c === 'object' && typeof (c as NangoConnection).providerId === 'string',
    ).filter((c) => !owner || !c.userId || c.userId === owner)
  } catch {
    return []
  }
}

export function saveNangoConnections(list: NangoConnection[]): void {
  localStorage.setItem(connectionsStorageKey(), JSON.stringify(list))
}

export function upsertNangoConnection(conn: NangoConnection): NangoConnection[] {
  const all = loadNangoConnections().filter((c) => c.providerId !== conn.providerId)
  all.unshift(conn)
  saveNangoConnections(all)
  return all
}

export function removeNangoConnection(providerId: string): NangoConnection[] {
  const all = loadNangoConnections().filter((c) => c.providerId !== providerId)
  saveNangoConnections(all)
  return all
}

export function nangoConfigured(): boolean {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
  return Boolean(env.VITE_SUPABASE_URL && (env.VITE_SUPABASE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY))
}

function pickConnectionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Connect UI posts `type: 'connect'` with `payload.connectionId` (also snake_case / nested data). */
export function extractNangoConnectionId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const rec = data as Record<string, unknown>
  const payload = rec.payload && typeof rec.payload === 'object' ? rec.payload as Record<string, unknown> : undefined
  const nested = rec.data && typeof rec.data === 'object' ? rec.data as Record<string, unknown> : undefined
  const payloadData = payload?.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : undefined
  return (
    pickConnectionId(rec.connectionId)
    ?? pickConnectionId(rec.connection_id)
    ?? pickConnectionId(payload?.connectionId)
    ?? pickConnectionId(payload?.connection_id)
    ?? pickConnectionId(nested?.connectionId)
    ?? pickConnectionId(nested?.connection_id)
    ?? pickConnectionId(payloadData?.connectionId)
    ?? pickConnectionId(payloadData?.connection_id)
  )
}
