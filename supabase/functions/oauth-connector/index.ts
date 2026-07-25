import {
  decryptSecret,
  encryptSecret,
  pkceChallenge,
  randomBase64Url,
  sha256Base64Url,
} from '../_shared/oauth-vault.ts'

interface Provider {
  id: 'github'
  authorizeUrl: string
  tokenUrl: string
  clientIdEnv: string
  clientSecretEnv: string
  scopes: string[]
  serverUrl: string
}

interface PendingRow {
  state_hash: string
  user_id: string
  plugin_id: Provider['id']
  code_verifier_ciphertext: string
  return_origin: string
  expires_at: string
}

const PROVIDERS: Record<string, Provider> = {
  github: {
    id: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CONNECTOR_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CONNECTOR_CLIENT_SECRET',
    scopes: ['repo', 'read:org', 'user:email'],
    serverUrl: 'https://api.githubcopilot.com/mcp/',
  },
}

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
    Vary: 'Origin',
  }
  if (origin && allowedOrigins().has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function fallbackOrigin(): string {
  const configured = Deno.env.get('OAUTH_APP_URL')
  if (configured) {
    try {
      const origin = new URL(configured).origin
      if (allowedOrigins().has(origin)) return origin
    } catch {
      // Use the first configured origin below.
    }
  }
  return [...allowedOrigins()][0] ?? 'http://localhost:3000'
}

function appRedirect(origin: string, provider: string, status: 'connected' | 'error', reason?: string): Response {
  const safeOrigin = allowedOrigins().has(origin) ? origin : fallbackOrigin()
  const url = new URL('/dashboard', safeOrigin)
  url.searchParams.set('view', 'apps')
  url.searchParams.set('oauth', provider)
  url.searchParams.set('oauthStatus', status)
  if (reason) url.searchParams.set('reason', reason.slice(0, 80))
  return Response.redirect(url, 302)
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

async function database<T>(
  table: string,
  query = '',
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!baseUrl || !serviceKey) throw new Error('database service credentials are unavailable')
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: init.method ?? 'GET',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) throw new Error(`database ${init.method ?? 'GET'} ${table} failed (${response.status})`)
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

async function authenticatedUser(req: Request): Promise<{ id: string } | null> {
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

function callbackUrl(): string {
  const configured = Deno.env.get('OAUTH_CONNECTOR_CALLBACK_URL')
  if (configured) return configured
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new Error('OAuth callback URL is not configured')
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/oauth-connector/callback`
}

async function start(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  if (!origin || !allowedOrigins().has(origin)) return json(req, 403, { error: 'origin not allowed' })
  const user = await authenticatedUser(req)
  if (!user) return json(req, 401, { error: 'valid user session required' })

  let body: { pluginId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(req, 400, { error: 'body must be valid JSON' })
  }
  const pluginId = typeof body.pluginId === 'string' ? body.pluginId : ''
  const provider = PROVIDERS[pluginId]
  if (!provider) return json(req, 400, { error: 'this plugin does not support web authorization' })

  const clientId = Deno.env.get(provider.clientIdEnv)
  if (!clientId || !Deno.env.get(provider.clientSecretEnv)) {
    return json(req, 503, { error: `${provider.id} connector OAuth is not configured on the server` })
  }

  const state = randomBase64Url(32)
  const verifier = randomBase64Url(48)
  const stateHash = await sha256Base64Url(state)
  const verifierCiphertext = await encryptSecret(verifier, `pending:${stateHash}`)
  await database(
    'connector_oauth_pending',
    new URLSearchParams({ expires_at: `lt.${new Date().toISOString()}` }).toString(),
    { method: 'DELETE' },
  )
  await database(
    'connector_oauth_pending',
    new URLSearchParams({ user_id: `eq.${user.id}`, plugin_id: `eq.${provider.id}` }).toString(),
    { method: 'DELETE' },
  )
  await database('connector_oauth_pending', '', {
    method: 'POST',
    body: {
      state_hash: stateHash,
      user_id: user.id,
      plugin_id: provider.id,
      code_verifier_ciphertext: verifierCiphertext,
      return_origin: origin,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  })

  const authorize = new URL(provider.authorizeUrl)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', callbackUrl())
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', provider.scopes.join(' '))
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', await pkceChallenge(verifier))
  authorize.searchParams.set('code_challenge_method', 'S256')
  return json(req, 200, { authorizeUrl: authorize.toString() })
}

async function disconnect(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  if (!origin || !allowedOrigins().has(origin)) return json(req, 403, { error: 'origin not allowed' })
  const user = await authenticatedUser(req)
  if (!user) return json(req, 401, { error: 'valid user session required' })
  let body: { installationId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(req, 400, { error: 'body must be valid JSON' })
  }
  if (typeof body.installationId !== 'string') return json(req, 400, { error: 'installationId is required' })

  const installQuery = new URLSearchParams({
    id: `eq.${body.installationId}`,
    user_id: `eq.${user.id}`,
    select: 'id,plugin_id,user_id',
    limit: '1',
  })
  const installations = await database<{ id: string; plugin_id: Provider['id']; user_id: string }[]>(
    'connector_installations',
    installQuery.toString(),
  )
  const installation = installations[0]
  if (!installation) return json(req, 404, { error: 'connector installation not found' })
  const secretQuery = new URLSearchParams({
    installation_id: `eq.${installation.id}`,
    select: 'access_token_ciphertext',
    limit: '1',
  })
  const secrets = await database<{ access_token_ciphertext: string }[]>('connector_secrets', secretQuery.toString())
  const secret = secrets[0]
  const provider = PROVIDERS[installation.plugin_id]
  const clientId = Deno.env.get(provider.clientIdEnv)
  const clientSecret = Deno.env.get(provider.clientSecretEnv)
  if (secret && clientId && clientSecret && provider.id === 'github') {
    const revoke = await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OpenMind-Connector',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        access_token: await decryptSecret(
          secret.access_token_ciphertext,
          `connector:${installation.user_id}:${installation.plugin_id}`,
        ),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!revoke.ok && revoke.status !== 404 && revoke.status !== 422) {
      return json(req, 502, { error: 'GitHub authorization could not be revoked; try again' })
    }
  }
  await database(
    'connector_installations',
    new URLSearchParams({ id: `eq.${installation.id}`, user_id: `eq.${user.id}` }).toString(),
    { method: 'DELETE' },
  )
  return json(req, 200, { disconnected: true })
}

async function githubAccountLabel(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'OpenMind-Connector',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const account = await response.json() as { login?: unknown }
    return typeof account.login === 'string' ? account.login : null
  } catch {
    return null
  }
}

async function callback(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  if (!state) return appRedirect(fallbackOrigin(), 'github', 'error', 'missing_state')

  const stateHash = await sha256Base64Url(state)
  const pendingRows = await database<PendingRow[]>('rpc/claim_connector_oauth_pending', '', {
    method: 'POST',
    body: { p_state_hash: stateHash },
  })
  const pending = pendingRows[0]
  if (!pending) return appRedirect(fallbackOrigin(), 'github', 'error', 'invalid_or_used_state')
  if (url.searchParams.get('error')) {
    return appRedirect(pending.return_origin, pending.plugin_id, 'error', 'authorization_denied')
  }
  const code = url.searchParams.get('code')
  if (!code) return appRedirect(pending.return_origin, pending.plugin_id, 'error', 'missing_code')

  const provider = PROVIDERS[pending.plugin_id]
  const clientId = Deno.env.get(provider.clientIdEnv)
  const clientSecret = Deno.env.get(provider.clientSecretEnv)
  if (!clientId || !clientSecret) {
    return appRedirect(pending.return_origin, pending.plugin_id, 'error', 'provider_not_configured')
  }

  const tokenResponse = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl(),
      code_verifier: await decryptSecret(pending.code_verifier_ciphertext, `pending:${stateHash}`),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const token = await tokenResponse.json().catch(() => ({})) as {
    access_token?: unknown
    refresh_token?: unknown
    token_type?: unknown
    scope?: unknown
    expires_in?: unknown
    error?: unknown
  }
  if (!tokenResponse.ok || typeof token.access_token !== 'string') {
    console.error('connector token exchange failed', provider.id, tokenResponse.status, String(token.error ?? 'unknown'))
    return appRedirect(pending.return_origin, pending.plugin_id, 'error', 'token_exchange_failed')
  }

  const scopes = typeof token.scope === 'string'
    ? token.scope.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean)
    : provider.scopes
  const expiresIn = Number(token.expires_in)
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1_000).toISOString()
    : null
  const accountLabel = await githubAccountLabel(token.access_token)
  const secretContext = `connector:${pending.user_id}:${provider.id}`
  const installationId = await database<string>('rpc/store_connector_oauth_installation', '', {
    method: 'POST',
    body: {
      p_user_id: pending.user_id,
      p_plugin_id: provider.id,
      p_account_label: accountLabel,
      p_scopes: scopes,
      p_server_url: provider.serverUrl,
      p_token_expires_at: expiresAt,
      p_access_token_ciphertext: await encryptSecret(token.access_token, secretContext),
      p_refresh_token_ciphertext: typeof token.refresh_token === 'string'
        ? await encryptSecret(token.refresh_token, secretContext)
        : null,
      p_token_type: typeof token.token_type === 'string' ? token.token_type : 'Bearer',
    },
  })
  if (!installationId) return appRedirect(pending.return_origin, pending.plugin_id, 'error', 'installation_save_failed')
  return appRedirect(pending.return_origin, pending.plugin_id, 'connected')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  const path = new URL(req.url).pathname.replace(/\/+$/, '')
  try {
    if (path.endsWith('/start') && req.method === 'POST') return await start(req)
    if (path.endsWith('/disconnect') && req.method === 'POST') return await disconnect(req)
    if (path.endsWith('/callback') && req.method === 'GET') return await callback(req)
    return json(req, 404, { error: 'OAuth connector route not found' })
  } catch (error) {
    console.error('connector OAuth failed', error instanceof Error ? error.message : String(error))
    if (path.endsWith('/callback')) return appRedirect(fallbackOrigin(), 'github', 'error', 'server_error')
    return json(req, 500, { error: 'connector authorization failed' })
  }
})
