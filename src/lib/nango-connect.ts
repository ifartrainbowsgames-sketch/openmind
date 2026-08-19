import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'
import { extractNangoConnectionId } from './nango'

export async function createNangoSession(providerId: string, user: { id: string; email: string }): Promise<string> {
  if (!isSupabaseConfigured || !SUPABASE_URL) {
    throw new Error('Deploy the nango-session function and set VITE_SUPABASE_URL to connect from this app.')
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
    throw new Error(err)
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
  overlay.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(15,15,15,.45);display:flex;align-items:center;justify-content:center;padding:24px'
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
