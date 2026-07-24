// Authenticated browser → proxy → remote MCP/REST endpoint.
import { decryptSecret, encryptSecret } from '../_shared/oauth-vault.ts'

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

async function authenticated(req: Request): Promise<{ id: string } | null> {
  const authorization = req.headers.get('authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const user = await response.json() as { id?: unknown }
    return typeof user.id === 'string' ? { id: user.id } : null
  } catch {
    return null
  }
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

async function database<T>(
  table: string,
  query = '',
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!baseUrl || !serviceKey) throw new Error('database service credentials are unavailable')
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: init.method ?? 'GET',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) throw new Error(`database ${init.method ?? 'GET'} ${table} failed (${response.status})`)
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

interface VaultedConnection {
  installationId: string
  pluginId: string
  serverUrl: string
  token: string
  tokenType: string
}

interface ConnectorSecretRow {
  access_token_ciphertext: string
  refresh_token_ciphertext?: string | null
  token_type?: string
}

const OAUTH_HOSTS: Record<string, string> = {
  github: 'api.githubcopilot.com',
}

async function vaultedConnection(userId: string, installationId: string): Promise<VaultedConnection> {
  const installationQuery = new URLSearchParams({
    id: `eq.${installationId}`,
    user_id: `eq.${userId}`,
    status: 'in.(authorized,live)',
    select: 'id,plugin_id,server_url,token_expires_at',
    limit: '1',
  })
  const installations = await database<{
    id: string
    plugin_id: string
    server_url: string
    token_expires_at?: string | null
  }[]>('connector_installations', installationQuery.toString())
  const installation = installations[0]
  if (!installation) throw new Error('OAuth connector installation not found or needs authorization')
  const target = new URL(installation.server_url)
  if (target.hostname !== OAUTH_HOSTS[installation.plugin_id]) throw new Error('OAuth connector host is not allowlisted')

  const secretQuery = new URLSearchParams({
    installation_id: `eq.${installation.id}`,
    select: 'access_token_ciphertext,refresh_token_ciphertext,token_type',
    limit: '1',
  })
  const secrets = await database<ConnectorSecretRow[]>(
    'connector_secrets',
    secretQuery.toString(),
  )
  let secret = secrets[0]
  if (!secret) throw new Error('OAuth connector credentials are unavailable')
  if (installation.token_expires_at && new Date(installation.token_expires_at).getTime() <= Date.now() + 60_000) {
    try {
      secret = await refreshGithubCredential(installation.id, secret)
    } catch {
      await markInstallation(installation.id, {
        status: 'needs_reauth',
        last_error: 'OAuth token expired and could not be refreshed',
      }).catch(() => undefined)
      throw new Error('OAuth connector authorization expired; reinstall the connector')
    }
  }
  return {
    installationId: installation.id,
    pluginId: installation.plugin_id,
    serverUrl: installation.server_url,
    token: await decryptSecret(secret.access_token_ciphertext),
    tokenType: secret.token_type || 'Bearer',
  }
}

async function refreshGithubCredential(
  installationId: string,
  current: ConnectorSecretRow,
): Promise<ConnectorSecretRow> {
  const clientId = Deno.env.get('GITHUB_CONNECTOR_CLIENT_ID')
  const clientSecret = Deno.env.get('GITHUB_CONNECTOR_CLIENT_SECRET')
  if (!clientId || !clientSecret || !current.refresh_token_ciphertext) throw new Error('refresh unavailable')
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: await decryptSecret(current.refresh_token_ciphertext),
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const token = await response.json().catch(() => ({})) as {
    access_token?: unknown
    refresh_token?: unknown
    token_type?: unknown
    expires_in?: unknown
  }
  if (!response.ok || typeof token.access_token !== 'string') throw new Error('refresh failed')
  const next: ConnectorSecretRow = {
    access_token_ciphertext: await encryptSecret(token.access_token),
    refresh_token_ciphertext: typeof token.refresh_token === 'string'
      ? await encryptSecret(token.refresh_token)
      : current.refresh_token_ciphertext,
    token_type: typeof token.token_type === 'string' ? token.token_type : current.token_type,
  }
  await database(
    'connector_secrets',
    new URLSearchParams({ installation_id: `eq.${installationId}` }).toString(),
    { method: 'PATCH', body: next },
  )
  await markInstallation(installationId, {
    status: 'authorized',
    token_expires_at: typeof token.expires_in === 'number'
      ? new Date(Date.now() + token.expires_in * 1_000).toISOString()
      : null,
    last_error: null,
  })
  return next
}

async function markInstallation(
  installationId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await database(
    'connector_installations',
    new URLSearchParams({ id: `eq.${installationId}` }).toString(),
    { method: 'PATCH', body: values },
  )
}

function mcpToolMetadata(body: ArrayBuffer): {
  toolNames: string[]
  toolSchemas: Record<string, unknown>
} | null {
  const text = new TextDecoder().decode(body).trim()
  if (!text) return null
  const candidates: unknown[] = []
  if (text.startsWith('data:') || text.includes('\ndata:')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try {
        candidates.push(JSON.parse(line.slice(5).trim()))
      } catch {
        // Ignore non-JSON keepalive/event lines.
      }
    }
  } else {
    try {
      const parsed = JSON.parse(text) as unknown
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]))
    } catch {
      return null
    }
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const result = (candidate as Record<string, unknown>).result
    const tools = result && typeof result === 'object'
      ? (result as Record<string, unknown>).tools
      : undefined
    if (!Array.isArray(tools)) continue
    const normalized = tools.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const tool = value as Record<string, unknown>
      return typeof tool.name === 'string' && tool.name
        ? [{ name: tool.name, inputSchema: tool.inputSchema }]
        : []
    })
    return {
      toolNames: normalized.map((tool) => tool.name),
      toolSchemas: Object.fromEntries(
        normalized
          .filter((tool) => tool.inputSchema !== undefined)
          .map((tool) => [tool.name, tool.inputSchema]),
      ),
    }
  }
  return null
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
  const user = await authenticated(req)
  if (!user) return json(req, 401, { error: 'valid user session required' })

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return json(req, 413, { error: 'request body too large' })

  const bodyText = await req.text().catch(() => '')
  if (!bodyText || new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return json(req, 413, { error: 'request body missing or too large' })
  }

  let body: {
    url?: unknown
    method?: unknown
    headers?: unknown
    payload?: unknown
    installationId?: unknown
  }
  try {
    body = JSON.parse(bodyText)
  } catch {
    return json(req, 400, { error: 'body must be valid JSON' })
  }
  const installationId = typeof body.installationId === 'string' ? body.installationId : undefined
  let vaulted: VaultedConnection | undefined
  if (installationId) {
    try {
      vaulted = await vaultedConnection(user.id, installationId)
    } catch (error) {
      return json(req, 403, { error: error instanceof Error ? error.message : 'OAuth connector unavailable' })
    }
  }
  if (!vaulted && typeof body.url !== 'string') return json(req, 400, { error: 'missing url' })

  let target: URL
  try {
    target = new URL(vaulted?.serverUrl ?? body.url as string)
    if (vaulted && typeof body.url === 'string' && new URL(body.url).toString() !== target.toString()) {
      throw new Error('OAuth connector target does not match its installation')
    }
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
      if (
        !STRIP_HEADERS.has(key.toLowerCase()) &&
        !(vaulted && key.toLowerCase() === 'authorization') &&
        typeof value === 'string'
      ) {
        headers[key] = value
      }
    }
  }
  if (vaulted) headers.Authorization = `${vaulted.tokenType} ${vaulted.token}`

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
  if (vaulted) {
    const rpcMethod = body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>).method
      : undefined
    if (upstream.status === 401 || upstream.status === 403) {
      await markInstallation(vaulted.installationId, {
        status: 'needs_reauth',
        last_error: `Provider returned HTTP ${upstream.status}`,
      }).catch(() => undefined)
    } else if (upstream.ok && rpcMethod === 'tools/list') {
      const metadata = mcpToolMetadata(responseBody)
      await markInstallation(vaulted.installationId, {
        status: 'live',
        ...(metadata ? { tool_names: metadata.toolNames, tool_schemas: metadata.toolSchemas } : {}),
        last_probed_at: new Date().toISOString(),
        last_error: null,
      }).catch(() => undefined)
    }
  }
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders })
})
