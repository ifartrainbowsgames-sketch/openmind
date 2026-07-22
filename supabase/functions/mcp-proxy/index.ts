// mcp-proxy — Supabase Edge Function (Deno)
// Browser → proxy → remote MCP server (or REST API, e.g. Zendesk).
// Why: SaaS MCP servers rarely send CORS headers a browser needs, and this
// gives us one choke point for SSRF guards, timeouts and (later) server-side
// token vaulting.
//
// Contract:
//   POST { url: string, method?: string, headers?: Record<string,string>, payload?: unknown }
//   → upstream status + body passed through verbatim (content-type and
//     mcp-session-id preserved). Errors come back as { error: string }.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Expose-Headers': 'content-type, mcp-session-id',
}

const MAX_BODY_BYTES = 1_048_576 // 1 MB
const UPSTREAM_TIMEOUT_MS = 25_000

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── SSRF guards: https only, no private/loopback/link-local hosts ───────────

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') return true
  // ipv6 loopback/link-local literals
  if (h.startsWith('[fe80:') || h.startsWith('[::')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0) return true // 10/8, loopback, "this" net
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
  }
  return false
}

// Headers we never forward upstream (hop-by-hop / host spoofing).
const STRIP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade'])

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'request body too large (1 MB max)' })

  let bodyText: string
  try {
    bodyText = await req.text()
  } catch {
    return json(400, { error: 'could not read request body' })
  }
  if (bodyText.length > MAX_BODY_BYTES) return json(413, { error: 'request body too large (1 MB max)' })

  let body: { url?: unknown; method?: unknown; headers?: unknown; payload?: unknown }
  try {
    body = JSON.parse(bodyText)
  } catch {
    return json(400, { error: 'body must be JSON: { url, method?, headers?, payload? }' })
  }

  if (typeof body.url !== 'string' || !body.url) return json(400, { error: 'missing "url"' })
  let target: URL
  try {
    target = new URL(body.url)
  } catch {
    return json(400, { error: 'invalid "url"' })
  }
  if (target.protocol !== 'https:') return json(400, { error: 'https only' })
  if (isBlockedHostname(target.hostname)) return json(403, { error: 'host not allowed' })

  const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST'
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return json(400, { error: `method "${method}" not allowed` })
  }

  const headers: Record<string, string> = {}
  if (body.headers && typeof body.headers === 'object') {
    for (const [k, v] of Object.entries(body.headers as Record<string, unknown>)) {
      const key = k.toLowerCase()
      if (STRIP_HEADERS.has(key)) continue
      if (typeof v === 'string') headers[k] = v
    }
  }

  const hasPayload = body.payload !== undefined && body.payload !== null
  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers,
      body: hasPayload && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body.payload) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const timeout = err instanceof DOMException && err.name === 'TimeoutError'
    return json(timeout ? 504 : 502, { error: `upstream fetch failed: ${msg}` })
  }

  // Pass the upstream answer through verbatim — the MCP client parses the body
  // (plain JSON or SSE frames) exactly as if it had called the server directly.
  const outHeaders: Record<string, string> = {
    ...CORS,
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
  }
  const sessionId = upstream.headers.get('mcp-session-id')
  if (sessionId) outHeaders['Mcp-Session-Id'] = sessionId

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders })
})
