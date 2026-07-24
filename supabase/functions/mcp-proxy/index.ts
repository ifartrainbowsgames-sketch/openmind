// Authenticated browser → proxy → remote MCP/REST endpoint.
const MAX_BODY_BYTES = 1_048_576
const MAX_RESPONSE_BYTES = 2_097_152
const UPSTREAM_TIMEOUT_MS = 25_000

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get('ALLOWED_ORIGINS') ??
    'http://localhost:3000,http://127.0.0.1:3000'
  return new Set(configured.split(',').map((origin) => origin.trim()).filter(Boolean))
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Expose-Headers': 'content-type, mcp-session-id',
    Vary: 'Origin',
  }
  if (origin && allowedOrigins().has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  })
}

function blockedIpv4(ip: string): boolean {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some((part) => part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function blockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (!normalized.includes(':')) return false
  if (normalized === '::' || normalized === '::1') return true
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return true
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? blockedIpv4(mapped[1]) : false
}

async function assertPublicTarget(target: URL): Promise<void> {
  if (target.protocol !== 'https:') throw new Error('https only')
  if (target.username || target.password) throw new Error('credentials in URLs are not allowed')
  if (target.port && target.port !== '443') throw new Error('only HTTPS port 443 is allowed')
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || blockedIpv4(host) || blockedIpv6(host)) {
    throw new Error('host not allowed')
  }

  // Resolve before fetching so public-looking names cannot point at private or
  // metadata addresses. fetch redirects are disabled below to prevent a second hop.
  if (!/^[\d.]+$/.test(host) && !host.includes(':')) {
    let addresses: string[]
    try {
      const [v4, v6] = await Promise.all([
        Deno.resolveDns(host, 'A').catch(() => []),
        Deno.resolveDns(host, 'AAAA').catch(() => []),
      ])
      addresses = [...v4, ...v6]
    } catch {
      throw new Error('could not resolve target host')
    }
    if (!addresses.length) throw new Error('target host has no public DNS address')
    if (addresses.some((address) => blockedIpv4(address) || blockedIpv6(address))) {
      throw new Error('target resolves to a private or reserved address')
    }
  }
}

async function authenticated(req: Request): Promise<boolean> {
  const authorization = req.headers.get('authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey) return false
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
      signal: AbortSignal.timeout(5_000),
    })
    return response.ok
  } catch {
    return false
  }
}

const STRIP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade',
  'cookie', 'proxy-authorization', 'proxy-authenticate', 'x-forwarded-for',
  'x-forwarded-host', 'x-forwarded-proto',
])

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  if (origin && !allowedOrigins().has(origin)) return json(req, 403, { error: 'origin not allowed' })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' })
  if (!await authenticated(req)) return json(req, 401, { error: 'valid user session required' })

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return json(req, 413, { error: 'request body too large' })

  const bodyText = await req.text().catch(() => '')
  if (!bodyText || new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return json(req, 413, { error: 'request body missing or too large' })
  }

  let body: { url?: unknown; method?: unknown; headers?: unknown; payload?: unknown }
  try {
    body = JSON.parse(bodyText)
  } catch {
    return json(req, 400, { error: 'body must be valid JSON' })
  }
  if (typeof body.url !== 'string') return json(req, 400, { error: 'missing url' })

  let target: URL
  try {
    target = new URL(body.url)
    await assertPublicTarget(target)
  } catch (error) {
    return json(req, 403, { error: error instanceof Error ? error.message : 'target not allowed' })
  }

  const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST'
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return json(req, 400, { error: `method "${method}" not allowed` })
  }

  const headers: Record<string, string> = {}
  if (body.headers && typeof body.headers === 'object') {
    for (const [key, value] of Object.entries(body.headers as Record<string, unknown>)) {
      if (!STRIP_HEADERS.has(key.toLowerCase()) && typeof value === 'string') headers[key] = value
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      redirect: 'manual',
      body: body.payload !== undefined && body.payload !== null && method !== 'GET' && method !== 'HEAD'
        ? JSON.stringify(body.payload)
        : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    return json(req, timeout ? 504 : 502, { error: timeout ? 'upstream timed out' : 'upstream request failed' })
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return json(req, 502, { error: 'upstream redirects are not allowed' })
  }
  const responseBody = await upstream.arrayBuffer()
  if (responseBody.byteLength > MAX_RESPONSE_BYTES) {
    return json(req, 502, { error: 'upstream response exceeded 2 MB' })
  }

  const responseHeaders: Record<string, string> = {
    ...cors(req),
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
  }
  const sessionId = upstream.headers.get('mcp-session-id')
  if (sessionId) responseHeaders['Mcp-Session-Id'] = sessionId
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders })
})
