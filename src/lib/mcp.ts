// ── MCP client — JSON-RPC 2.0 over Streamable HTTP, from the browser ────────
// Talks to remote Model Context Protocol servers (GitHub, Notion, Linear, …).
// When Supabase is configured, every upstream call is routed through the
// `mcp-proxy` Edge Function (CORS + keeps options open for server-side token
// vaulting); otherwise the browser fetches the MCP server directly.

// NOTE: './supabase' is imported lazily (dynamic import inside getTransport),
// not statically. The real module constructs a Supabase client at load time,
// which needs browser globals (localStorage, WebSocket) — a static import here
// would pull it into every consumer of agent.ts, including Node test runners
// that never touch Supabase. Lazy loading keeps the module graph side-effect
// free until a live connection is actually used.

// ── Types ────────────────────────────────────────────────────────────────────

/** A remote MCP server we know how to reach. */
export interface McpServerSpec {
  id: string
  url: string
  /** 'bearer' → send `Authorization: Bearer <token>`; 'none' → no auth header. */
  authHeader?: 'bearer' | 'none'
}

/** One tool as advertised by `tools/list`. */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

/** Typed error for every MCP failure mode (transport, HTTP, JSON-RPC). */
export class McpError extends Error {
  code: number | string
  constructor(code: number | string, message: string) {
    super(message)
    this.name = 'McpError'
    this.code = code
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

export type McpTransport = { kind: 'proxy'; url: string } | { kind: 'direct' }

/** Proxy through Supabase when configured (CORS-safe), else browser-direct. */
export async function getTransport(): Promise<McpTransport> {
  try {
    const { isSupabaseConfigured, SUPABASE_URL } = await import('./supabase')
    if (isSupabaseConfigured && SUPABASE_URL) {
      return { kind: 'proxy', url: `${SUPABASE_URL}/functions/v1/mcp-proxy` }
    }
  } catch {
    /* supabase module unavailable in this environment → browser-direct */
  }
  return { kind: 'direct' }
}

const DEFAULT_TIMEOUT_MS = 20_000

interface RawReply {
  status: number
  ok: boolean
  body: string
  headers: Headers
}

/**
 * One upstream HTTP request, via the proxy when configured.
 * The proxy contract: POST { url, method, headers, payload } → upstream
 * status + body passed straight through (plus mcp-session-id when present).
 */
async function transportFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; payload?: unknown },
  timeoutMs: number,
): Promise<RawReply> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const transport = await getTransport()
    if (transport.kind === 'proxy') {
      const { SUPABASE_KEY, supabase } = await import('./supabase')
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      if (!SUPABASE_KEY || !accessToken) {
        throw new McpError('unauthorized', 'Sign in before using live MCP connections through the secure proxy.')
      }
      const res = await fetch(transport.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ url, method: init.method, headers: init.headers, payload: init.payload }),
        signal: ac.signal,
      })
      return { status: res.status, ok: res.ok, body: await res.text(), headers: res.headers }
    }
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.payload !== undefined ? JSON.stringify(init.payload) : undefined,
      signal: ac.signal,
    })
    return { status: res.status, ok: res.ok, body: await res.text(), headers: res.headers }
  } catch (err) {
    if (err instanceof McpError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new McpError('timeout', `MCP request timed out after ${timeoutMs}ms`)
    }
    throw new McpError('network', `MCP request failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * REST pass-through for non-MCP connections (e.g. Zendesk, whose MCP server is
 * still early-access). Same transport selection as MCP traffic.
 */
export async function restFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; payload?: unknown } = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RawReply> {
  return transportFetch(
    url,
    { method: init.method ?? 'GET', headers: init.headers ?? {}, payload: init.payload },
    timeoutMs,
  )
}

// ── JSON-RPC framing ─────────────────────────────────────────────────────────

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  method?: string
  params?: unknown
}

let nextId = 1

/** Parse a Streamable-HTTP response body: plain JSON, or SSE `data:` frames. */
export function parseStreamableBody(body: string): JsonRpcMessage[] {
  const trimmed = body.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
    const messages: JsonRpcMessage[] = []
    for (const frame of trimmed.split(/\r?\n\r?\n/)) {
      const dataLines = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
      if (!dataLines.length) continue
      const payload = dataLines.join('\n')
      if (payload === '[DONE]') continue
      try {
        messages.push(JSON.parse(payload) as JsonRpcMessage)
      } catch {
        throw new McpError('parse', `Unparseable SSE frame: ${payload.slice(0, 120)}`)
      }
    }
    return messages
  }
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? (parsed as JsonRpcMessage[]) : [parsed as JsonRpcMessage]
  } catch {
    throw new McpError('parse', `Response was neither JSON nor SSE: ${trimmed.slice(0, 120)}`)
  }
}

interface RpcOptions {
  token?: string
  sessionId?: string
  timeoutMs?: number
}

/** One JSON-RPC request against a server. Returns the message matching our id. */
async function rpc(
  server: McpServerSpec,
  method: string,
  params: Record<string, unknown>,
  opts: RpcOptions = {},
): Promise<{ result: unknown; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (server.authHeader !== 'none' && opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.sessionId) headers['Mcp-Session-Id'] = opts.sessionId

  const id = nextId++
  const reply = await transportFetch(
    server.url,
    { method: 'POST', headers, payload: { jsonrpc: '2.0', id, method, params } },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  const sessionId = reply.headers.get('mcp-session-id') ?? opts.sessionId

  if (!reply.ok) {
    throw new McpError(reply.status, `MCP HTTP ${reply.status} from ${server.url} — ${reply.body.slice(0, 160)}`)
  }
  const messages = parseStreamableBody(reply.body)
  const mine = messages.find((m) => m.id === id) ?? messages.find((m) => m.id !== undefined)
  if (!mine) throw new McpError('protocol', `No JSON-RPC response for "${method}" in reply`)
  if (mine.error) throw new McpError(mine.error.code, `MCP error on "${method}": ${mine.error.message}`)
  return { result: mine.result, sessionId: sessionId ?? undefined }
}

/** Notifications carry no id; servers may answer 202 with an empty body. */
async function notify(
  server: McpServerSpec,
  method: string,
  opts: RpcOptions = {},
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (server.authHeader !== 'none' && opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.sessionId) headers['Mcp-Session-Id'] = opts.sessionId
  const reply = await transportFetch(
    server.url,
    { method: 'POST', headers, payload: { jsonrpc: '2.0', method } },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if (!reply.ok) {
    throw new McpError(reply.status, `MCP HTTP ${reply.status} on notification "${method}"`)
  }
}

/** initialize → notifications/initialized; returns the session id if the server issued one. */
async function handshake(server: McpServerSpec, token?: string): Promise<string | undefined> {
  const { sessionId } = await rpc(server, 'initialize', {
    protocolVersion: '2025-03-26',
    clientInfo: { name: 'openmind', version: '1.0.0' },
    capabilities: {},
  }, { token })
  await notify(server, 'notifications/initialized', { token, sessionId })
  return sessionId
}

interface CachedSession {
  sessionId: string
  initializedAt: number
}

const SESSION_TTL_MS = 15 * 60_000
const sessions = new Map<string, CachedSession>()
const sessionKey = (server: McpServerSpec, token?: string) => `${server.url}\0${token ?? ''}`

export function clearMcpSessions(): void {
  sessions.clear()
}

async function sessionFor(server: McpServerSpec, token?: string): Promise<string | undefined> {
  const key = sessionKey(server, token)
  const cached = sessions.get(key)
  if (cached && Date.now() - cached.initializedAt < SESSION_TTL_MS) return cached.sessionId
  sessions.delete(key)
  const sessionId = await handshake(server, token)
  if (sessionId) sessions.set(key, { sessionId, initializedAt: Date.now() })
  return sessionId
}

async function withSession<T>(
  server: McpServerSpec,
  token: string | undefined,
  call: (sessionId?: string) => Promise<T>,
): Promise<T> {
  const key = sessionKey(server, token)
  const hadCachedSession = sessions.has(key)
  const sessionId = await sessionFor(server, token)
  try {
    return await call(sessionId)
  } catch (error) {
    const retryable = hadCachedSession && error instanceof McpError &&
      (error.code === 400 || error.code === 404 || error.code === 'protocol')
    if (!retryable) throw error
    sessions.delete(key)
    return call(await sessionFor(server, token))
  }
}

// ── High-level API ───────────────────────────────────────────────────────────

/** initialize → tools/list → normalized tool descriptors. */
export async function listServerTools(server: McpServerSpec, token?: string): Promise<McpToolInfo[]> {
  const { result } = await withSession(server, token, (sessionId) =>
    rpc(server, 'tools/list', {}, { token, sessionId }))
  const tools = (result as { tools?: unknown } | undefined)?.tools
  if (!Array.isArray(tools)) throw new McpError('protocol', 'tools/list reply had no tools array')
  return tools.map((t) => {
    const tool = t as Record<string, unknown>
    return {
      name: String(tool.name ?? ''),
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: tool.inputSchema,
    }
  }).filter((t) => t.name.length > 0)
}

interface ToolCallResult {
  content?: { type?: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

/** initialize → tools/call → the tool's text output, blocks joined. */
export async function callServerTool(
  server: McpServerSpec,
  toolName: string,
  args: Record<string, unknown>,
  token?: string,
): Promise<string> {
  const { result } = await withSession(server, token, (sessionId) =>
    rpc(server, 'tools/call', { name: toolName, arguments: args }, { token, sessionId }))
  const out = (result ?? {}) as ToolCallResult
  const texts = (out.content ?? [])
    .filter((b) => b && (b.type === undefined || b.type === 'text') && typeof b.text === 'string')
    .map((b) => b.text as string)
  const joined = texts.join('\n').trim()
  if (out.isError) throw new McpError('tool', joined || `Tool "${toolName}" reported an error`)
  if (joined) return joined
  if (out.structuredContent !== undefined) return JSON.stringify(out.structuredContent)
  return ''
}
