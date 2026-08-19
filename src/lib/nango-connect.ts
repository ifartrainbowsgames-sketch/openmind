import { getSession } from './auth'
import { upsertLiveConnection, removeLiveConnection, type LiveConnectionConfig } from './agent'
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'
import {
  extractNangoConnectionId,
  liveIdsForNangoProvider,
  customerConnectError,
  nangoOwnerId,
  removeNangoConnection,
  setNangoOwner,
  upsertNangoConnection,
  type NangoConnection,
} from './nango'

/** Customer-facing apps on /app — Connect GitHub / Slack / Gmail (and Drive). */
export const CUSTOMER_APPS = [
  { id: 'github', providerId: 'github', name: 'GitHub', blurb: 'Create repos and commit files' },
  { id: 'slack', providerId: 'slack', name: 'Slack', blurb: 'Post updates to your workspace' },
  { id: 'gmail', providerId: 'google', name: 'Gmail', blurb: 'Send mail from your inbox' },
  { id: 'gdrive', providerId: 'google', name: 'Drive', blurb: 'Find files in Google Drive' },
] as const

export type CustomerAppId = (typeof CUSTOMER_APPS)[number]['id']

export { customerConnectError, liveIdsForNangoProvider } from './nango'

export function recordConnectedProvider(providerId: string, connectionId?: string): {
  nango: NangoConnection[]
  live: LiveConnectionConfig[]
} {
  const nango = upsertNangoConnection({
    providerId,
    connectionId,
    connectedAt: Date.now(),
    userId: nangoOwnerId() || undefined,
  })
  let live: LiveConnectionConfig[] = []
  for (const omId of liveIdsForNangoProvider(providerId)) {
    live = upsertLiveConnection({
      connectionId: omId,
      mode: 'mcp',
      serverUrl: `nango://${providerId}`,
      status: 'live',
      toolNames: [omId],
    })
  }
  return { nango, live }
}

export function disconnectProvider(providerId: string): NangoConnection[] {
  const nango = removeNangoConnection(providerId)
  for (const omId of liveIdsForNangoProvider(providerId)) {
    removeLiveConnection(omId)
  }
  return nango
}

/** Shared Connect flow: session on Supabase, OAuth iframe, then crew can use the app. */
export async function connectProvider(
  providerId: string,
  onEvent?: (event: { type: 'connect' | 'close'; live?: LiveConnectionConfig[] }) => void,
): Promise<void> {
  const session = await getSession()
  if (!session?.user.id) {
    throw new Error('Sign in to connect your own GitHub, Slack, or Gmail.')
  }
  setNangoOwner(session.user.id)
  const token = await createNangoSession(providerId, {
    id: session.user.id,
    email: session.user.email ?? 'you@openmind.app',
  })
  openNangoConnectUi(token, (event) => {
    if (event.type === 'connect') {
      const { live } = recordConnectedProvider(providerId, event.connectionId)
      onEvent?.({ type: 'connect', live })
      return
    }
    onEvent?.({ type: 'close' })
  })
}

export async function createNangoSession(providerId: string, user: { id: string; email: string }): Promise<string> {
  if (!isSupabaseConfigured || !SUPABASE_URL) {
    throw new Error('Couldn’t start Connect. Try again in a moment.')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (SUPABASE_KEY) headers.Authorization = `Bearer ${SUPABASE_KEY}`
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/nango-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, userId: user.id, email: user.email }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = (await res.json()) as { sessionToken?: string; error?: unknown }
  if (!res.ok || !data.sessionToken) {
    const err = typeof data.error === 'string' ? data.error : JSON.stringify(data.error ?? `HTTP ${res.status}`)
    throw new Error(customerConnectError(err))
  }
  return data.sessionToken
}

/** Opens Nango Connect UI in an overlay iframe (same pattern as @nangohq/frontend). */
export function openNangoConnectUi(
  sessionToken: string,
  onEvent: (event: { type: 'connect' | 'close'; connectionId?: string }) => void,
): () => void {
  const host = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_NANGO_CONNECT_URL
    ?? 'https://connect.nango.dev').replace(/\/$/, '')

  const overlay = document.createElement('div')
  overlay.setAttribute('data-om-nango', '1')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(15,15,15,.45);display:flex;align-items:center;justify-content:center;padding:24px'
  const frame = document.createElement('iframe')
  frame.src = `${host}?session_token=${encodeURIComponent(sessionToken)}`
  frame.allow = 'clipboard-write; identity-credentials-get'
  frame.style.cssText = 'width:min(480px,100%);height:min(720px,92vh);border:0;border-radius:12px;background:#fff'
  overlay.appendChild(frame)
  document.body.appendChild(overlay)

  const cleanup = () => {
    window.removeEventListener('message', onMessage)
    overlay.remove()
  }
  const onMessage = (event: MessageEvent) => {
    const type = (event.data && typeof event.data === 'object' && 'type' in event.data)
      ? String((event.data as { type: unknown }).type)
      : ''
    if (type === 'nango:connect' || type === 'connect') {
      onEvent({ type: 'connect', connectionId: extractNangoConnectionId(event.data) })
      cleanup()
    } else if (type === 'nango:close' || type === 'close') {
      onEvent({ type: 'close' })
      cleanup()
    }
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      onEvent({ type: 'close' })
      cleanup()
    }
  })
  window.addEventListener('message', onMessage)
  return cleanup
}
