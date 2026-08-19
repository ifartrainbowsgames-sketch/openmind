// nango-session — create a short-lived Nango Connect session (secret stays server-side).
// POST { providerId: string }  Authorization: Bearer <user jwt or anon>
// Env: NANGO_SECRET_KEY, optional NANGO_HOST (default https://api.nango.dev)

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const secret = Deno.env.get('NANGO_SECRET_KEY') ?? ''
  const host = (Deno.env.get('NANGO_HOST') ?? 'https://api.nango.dev').replace(/\/$/, '')
  if (!secret) return json(501, { error: 'Connect is not configured yet' })

  let body: { providerId?: unknown; email?: unknown; userId?: unknown }
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(400, { error: 'body must be JSON: { providerId }' })
  }
  const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) return json(400, { error: 'invalid providerId' })

  const email = typeof body.email === 'string' && body.email.includes('@') ? body.email : 'openmind@local'
  const userId = typeof body.userId === 'string' && body.userId ? body.userId : `om-${email}`

  const res = await fetch(`${host}/connect/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      end_user: { id: userId, email, display_name: email },
      allowed_integrations: [providerId],
    }),
  })
  const text = await res.text()
  let parsed: { data?: { token?: string }; token?: string; sessionToken?: string; error?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    return json(res.ok ? 200 : res.status, { error: text.slice(0, 240) })
  }
  const sessionToken = parsed.data?.token ?? parsed.token ?? parsed.sessionToken
  if (!res.ok || !sessionToken) {
    return json(res.status >= 400 ? res.status : 502, { error: parsed.error ?? text.slice(0, 240) })
  }
  return json(200, { sessionToken, providerId })
})
