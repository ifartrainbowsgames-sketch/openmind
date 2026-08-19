// MCP client + live-connection tests — fetch is stubbed, './supabase' is
// mocked (Node 20 has no WebSocket/localStorage for the real module), exactly
// like auth.test.ts. State is hoisted so tests can flip "configured" per case.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const supaMock = vi.hoisted(() => ({
  isSupabaseConfigured: false,
  SUPABASE_URL: null as string | null,
  SUPABASE_KEY: null as string | null,
}))
vi.mock('./supabase', () => supaMock)

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}
const localStore = new MemStorage()
Object.defineProperty(globalThis, 'localStorage', { value: localStore })

import type { Employee, LiveConnectionConfig } from './agent'

const mcp = await import('./mcp')
const agent = await import('./agent')

// ── fetch stub ───────────────────────────────────────────────────────────────

type FetchHandler = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<Response> | Response

const fetchMock = vi.fn<FetchHandler>()
vi.stubGlobal('fetch', fetchMock)

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const sseRes = (messages: unknown[]) =>
  new Response(messages.map((msg) => `data: ${JSON.stringify(msg)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })

/** A fake MCP server: echoes the request id, routes by JSON-RPC method. */
function fakeMcpServer(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: { method: string; params: Record<string, unknown>; headers: Record<string, string> }[] = []
  const impl: FetchHandler = async (_url, init) => {
    const req = JSON.parse(init.body ?? '{}') as { id?: number; method: string; params?: Record<string, unknown> }
    calls.push({ method: req.method, params: req.params ?? {}, headers: init.headers ?? {} })
    if (req.id === undefined) return new Response('', { status: 202 }) // notification
    const handler = handlers[req.method]
    if (!handler) return jsonRes({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'no such method' } })
    return jsonRes({ jsonrpc: '2.0', id: req.id, result: handler(req.params ?? {}) })
  }
  return { impl, calls }
}

const SERVER = { id: 'github', url: 'https://mcp.example.test/mcp' } as const

beforeEach(() => {
  fetchMock.mockReset()
  localStore.clear()
  supaMock.isSupabaseConfigured = false
  supaMock.SUPABASE_URL = null
})

// ── (a) initialize + tools/list, plain JSON ──────────────────────────────────

describe('listServerTools', () => {
  it('handshakes and maps tools from a plain-JSON tools/list reply', async () => {
    const server = fakeMcpServer({
      initialize: () => ({ protocolVersion: '2025-03-26', serverInfo: { name: 'fake' }, capabilities: {} }),
      'tools/list': () => ({
        tools: [
          { name: 'search_issues', description: 'Search issues', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
          { name: 'get_issue' },
        ],
      }),
    })
    fetchMock.mockImplementation(server.impl)

    const tools = await mcp.listServerTools(SERVER, 'tok123')
    expect(tools).toEqual([
      { name: 'search_issues', description: 'Search issues', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'get_issue', description: undefined, inputSchema: undefined },
    ])

    // initialize → notifications/initialized → tools/list
    expect(server.calls.map((c) => c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    const init = server.calls[0]
    expect(init.params.protocolVersion).toBe('2025-03-26')
    expect(init.params.clientInfo).toEqual({ name: 'openmind', version: '1.0.0' })
    expect(init.headers.Authorization).toBe('Bearer tok123')
    expect(init.headers.Accept).toBe('application/json, text/event-stream')
    // direct transport (supabase not configured)
    expect(fetchMock.mock.calls[0][0]).toBe(SERVER.url)
  })

  // ── (b) SSE-framed responses ───────────────────────────────────────────────
  it('parses SSE data: frames', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const req = JSON.parse(init.body ?? '{}') as { id?: number; method: string }
      if (req.id === undefined) return new Response('', { status: 202 })
      const result = req.method === 'tools/list' ? { tools: [{ name: 'sse_tool' }] } : {}
      return sseRes([{ jsonrpc: '2.0', id: req.id, result }])
    })
    const tools = await mcp.listServerTools(SERVER)
    expect(tools.map((t) => t.name)).toEqual(['sse_tool'])
  })

  it('throws a typed McpError on unparseable bodies', async () => {
    fetchMock.mockResolvedValue(new Response('<html>nope</html>', { status: 200 }))
    await expect(mcp.listServerTools(SERVER)).rejects.toBeInstanceOf(mcp.McpError)
  })
})

// ── (c) tools/call text extraction ───────────────────────────────────────────

describe('callServerTool', () => {
  it('joins multiple text content blocks', async () => {
    const server = fakeMcpServer({
      initialize: () => ({}),
      'tools/call': (params) => {
        expect(params).toEqual({ name: 'search_issues', arguments: { query: 'refund' } })
        return { content: [{ type: 'text', text: 'issue #1' }, { type: 'text', text: 'issue #2' }] }
      },
    })
    fetchMock.mockImplementation(server.impl)
    const out = await mcp.callServerTool(SERVER, 'search_issues', { query: 'refund' }, 'tok')
    expect(out).toBe('issue #1\nissue #2')
  })

  it('throws when the tool reports isError', async () => {
    const server = fakeMcpServer({
      initialize: () => ({}),
      'tools/call': () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }),
    })
    fetchMock.mockImplementation(server.impl)
    await expect(mcp.callServerTool(SERVER, 'x', {})).rejects.toMatchObject({ name: 'McpError' })
  })
})

// ── (d) HTTP errors → typed McpError ─────────────────────────────────────────

describe('errors', () => {
  it('maps HTTP failures to McpError with the status code', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }))
    const err = await mcp.listServerTools(SERVER).catch((e) => e)
    expect(err).toBeInstanceOf(mcp.McpError)
    expect((err as InstanceType<typeof mcp.McpError>).code).toBe(401)
    expect((err as Error).message).toContain('401')
  })

  it('maps JSON-RPC error replies to McpError', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const req = JSON.parse(init.body ?? '{}') as { id?: number }
      if (req.id === undefined) return new Response('', { status: 202 })
      return jsonRes({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'bad params' } })
    })
    await expect(mcp.listServerTools(SERVER)).rejects.toMatchObject({ code: -32602 })
  })
})

// ── (e) transport selection: proxy when Supabase configured ─────────────────

describe('transport', () => {
  const handshake = {
    initialize: () => ({}),
    'tools/list': () => ({ tools: [] }),
  }

  it('posts { url, headers, payload } to the mcp-proxy when Supabase is configured', async () => {
    supaMock.isSupabaseConfigured = true
    supaMock.SUPABASE_URL = 'https://proj.supabase.co'
    const server = fakeMcpServer(handshake)
    fetchMock.mockImplementation(async (url, init) => {
      // unwrap the proxy envelope, then answer as the upstream server
      const wrapper = JSON.parse(init.body ?? '{}') as { url: string; headers: Record<string, string>; payload: unknown }
      expect(url).toBe('https://proj.supabase.co/functions/v1/mcp-proxy')
      expect(wrapper.url).toBe(SERVER.url)
      expect(wrapper.headers.Authorization).toBe('Bearer tok')
      return server.impl(SERVER.url, { ...init, body: JSON.stringify(wrapper.payload) })
    })
    const tools = await mcp.listServerTools(SERVER, 'tok')
    expect(tools).toEqual([])
    expect(fetchMock).toHaveBeenCalled()
  })

  it('goes browser-direct when Supabase is not configured', async () => {
    const server = fakeMcpServer(handshake)
    fetchMock.mockImplementation(server.impl)
    await mcp.listServerTools(SERVER)
    expect(fetchMock.mock.calls.every((c) => c[0] === SERVER.url)).toBe(true)
  })

  it('getTransport reflects the supabase mock', async () => {
    expect(await mcp.getTransport()).toEqual({ kind: 'direct' })
    supaMock.isSupabaseConfigured = true
    supaMock.SUPABASE_URL = 'https://proj.supabase.co'
    expect(await mcp.getTransport()).toEqual({ kind: 'proxy', url: 'https://proj.supabase.co/functions/v1/mcp-proxy' })
  })
})

// ── (f) resolveConnectionTools: LIVE vs MOCK stamping ────────────────────────

const empWith = (connections: string[]): Employee => ({
  id: 'e1', name: 'Ada', role: 'Support Agent', prompt: 'Be helpful.',
  tools: [], connections, accent: '#ff4d00',
})

describe('resolveConnectionTools stamping', () => {
  it('stamps canned data [MOCK · id] when nothing is configured', async () => {
    const tools = agent.resolveConnectionTools(empWith(['github']))
    const github = tools.find((t) => t.id === 'github')
    expect(github).toBeDefined()
    const out = agent.normalizeToolResult(await github!.run('pull requests'))
    expect(out.source).toBe('mock')
    expect(out.content).toMatch(/^\[MOCK · github\] /)
    expect(out.content).toContain('PR #12')
  })

  it('stamps real MCP results [LIVE · id] and exposes server tools', async () => {
    const server = fakeMcpServer({
      initialize: () => ({}),
      'tools/call': () => ({ content: [{ type: 'text', text: 'REAL issue #87 from github' }] }),
    })
    fetchMock.mockImplementation(server.impl)
    const cfg: LiveConnectionConfig = {
      connectionId: 'github', mode: 'mcp', status: 'live',
      serverUrl: SERVER.url, token: 'tok', toolNames: ['search_issues'],
    }
    const tools = agent.resolveConnectionTools(empWith(['github']), [cfg])
    expect(tools.map((t) => t.id)).toContain('github__search_issues')
    const out = agent.normalizeToolResult(await tools.find((t) => t.id === 'github__search_issues')!.run('open bugs'))
    expect(out.content).toMatch(/^\[LIVE · github\] /)
    expect(out.content).toContain('REAL issue #87')
    expect(out.arguments).toEqual({ query: 'open bugs' })
    // dispatcher on the plain connection id also hits live data
    const dispatched = agent.normalizeToolResult(await tools.find((t) => t.id === 'github')!.run('search issues please'))
    expect(dispatched.content).toMatch(/^\[LIVE · github\] /)
  })

  it('stamps live-call errors honestly instead of silently mocking', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    const cfg: LiveConnectionConfig = {
      connectionId: 'github', mode: 'mcp', status: 'live', serverUrl: SERVER.url, toolNames: ['search_issues'],
    }
    const out = agent.normalizeToolResult(await agent.resolveConnectionTools(empWith(['github']), [cfg])
      .find((t) => t.id === 'github')!.run('anything'))
    expect(out.content).toMatch(/^\[LIVE · github\] error: /)
    expect(out.error?.kind).toBe('error')
  })
})

// ── (g) Zendesk REST tools ───────────────────────────────────────────────────

describe('zendesk REST mode', () => {
  const zendeskCfg: LiveConnectionConfig = {
    connectionId: 'zendesk', mode: 'rest', status: 'live',
    serverUrl: 'https://acme.zendesk.com', token: 'me@acme.com/token:abc123',
    toolNames: [...agent.ZENDESK_TOOLS],
  }

  it('exposes the three REST tools plus a dispatcher', () => {
    const ids = agent.resolveConnectionTools(empWith(['zendesk']), [zendeskCfg]).map((t) => t.id)
    expect(ids).toEqual(['zendesk__search_tickets', 'zendesk__get_ticket', 'zendesk__ticket_stats', 'zendesk'])
  })

  it('search_tickets hits /api/v2/search.json with basic auth and stamps LIVE', async () => {
    fetchMock.mockImplementation(async () =>
      jsonRes({ results: [{ id: 3381, subject: 'Refund status?', status: 'pending', priority: 'high' }] }))
    const tools = agent.resolveConnectionTools(empWith(['zendesk']), [zendeskCfg])
    const out = await tools.find((t) => t.id === 'zendesk__search_tickets')!.run('refund')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://acme.zendesk.com/api/v2/search.json?query=type%3Aticket%20refund')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('me@acme.com/token:abc123')}`)
    expect(out).toMatch(/^\[LIVE · zendesk\] /)
    expect(out).toContain('#3381')
  })

  it('get_ticket extracts the id from free text', async () => {
    fetchMock.mockImplementation(async (url) => {
      expect(url).toBe('https://acme.zendesk.com/api/v2/tickets/3381.json')
      return jsonRes({ ticket: { id: 3381, subject: 'Refund status?', status: 'open', description: 'Where is my refund?' } })
    })
    const tools = agent.resolveConnectionTools(empWith(['zendesk']), [zendeskCfg])
    const out = await tools.find((t) => t.id === 'zendesk__get_ticket')!.run('ticket 3381 please')
    expect(out).toContain('Where is my refund?')
  })

  it('ticket_stats reads the queue count', async () => {
    fetchMock.mockImplementation(async () => jsonRes({ count: { value: 42, refreshed_at: 'now' } }))
    const tools = agent.resolveConnectionTools(empWith(['zendesk']), [zendeskCfg])
    const out = await tools.find((t) => t.id === 'zendesk__ticket_stats')!.run('')
    expect(out).toContain('42')
  })
})

// ── (h) probeConnection status transitions ───────────────────────────────────

describe('probeConnection', () => {
  it('mock mode is always mock, no network', async () => {
    const out = await agent.probeConnection({ connectionId: 'gmail', mode: 'mock', status: 'untested' })
    expect(out.status).toBe('mock')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mcp success → live with tool names', async () => {
    const server = fakeMcpServer({
      initialize: () => ({}),
      'tools/list': () => ({ tools: [{ name: 'a' }, { name: 'b' }] }),
    })
    fetchMock.mockImplementation(server.impl)
    const out = await agent.probeConnection({
      connectionId: 'github', mode: 'mcp', status: 'untested', serverUrl: SERVER.url, token: 'tok',
    })
    expect(out.status).toBe('live')
    expect(out.toolNames).toEqual(['a', 'b'])
    expect(out.lastError).toBeUndefined()
  })

  it('mcp failure → error with lastError', async () => {
    fetchMock.mockResolvedValue(new Response('bad token', { status: 401 }))
    const out = await agent.probeConnection({
      connectionId: 'github', mode: 'mcp', status: 'untested', serverUrl: SERVER.url, token: 'wrong',
    })
    expect(out.status).toBe('error')
    expect(out.lastError).toContain('401')
  })

  it('zendesk rest ping → live with the REST tool set', async () => {
    fetchMock.mockImplementation(async (url) => {
      expect(url).toBe('https://acme.zendesk.com/api/v2/users/me.json')
      return jsonRes({ user: { id: 1 } })
    })
    const out = await agent.probeConnection({
      connectionId: 'zendesk', mode: 'rest', status: 'untested',
      serverUrl: 'https://acme.zendesk.com', token: 'me@acme.com/token:abc123',
    })
    expect(out.status).toBe('live')
    expect(out.toolNames).toEqual([...agent.ZENDESK_TOOLS])
  })
})

// ── persistence ──────────────────────────────────────────────────────────────

describe('live connection persistence', () => {
  it('upserts, loads and removes configs via localStorage', () => {
    expect(agent.loadLiveConnections()).toEqual([])
    agent.upsertLiveConnection({ connectionId: 'github', mode: 'mcp', status: 'untested', serverUrl: SERVER.url })
    agent.upsertLiveConnection({ connectionId: 'zendesk', mode: 'rest', status: 'live', serverUrl: 'https://acme.zendesk.com' })
    agent.upsertLiveConnection({ connectionId: 'github', mode: 'mcp', status: 'live', serverUrl: SERVER.url })
    const all = agent.loadLiveConnections()
    expect(all).toHaveLength(2)
    expect(all.find((c) => c.connectionId === 'github')?.status).toBe('live')
    expect(JSON.parse(localStore.getItem(agent.LIVE_CONNECTIONS_KEY) ?? '[]')).toHaveLength(2)
    agent.removeLiveConnection('github')
    expect(agent.loadLiveConnections().map((c) => c.connectionId)).toEqual(['zendesk'])
  })

  it('falls back to presets for server URLs', () => {
    expect(agent.MCP_PRESETS.github.serverUrl).toBe('https://api.githubcopilot.com/mcp/')
    expect(agent.MCP_PRESETS.zendesk.mode).toBe('rest')
    expect(agent.MCP_PRESETS.gmail.mode).toBe('aggregator')
  })
})

// ── graph integration: live configs flow through runEmployee ─────────────────

describe('runEmployee with live configs', () => {
  it('stamps live connection output inside a graph run', async () => {
    const server = fakeMcpServer({
      initialize: () => ({}),
      'tools/call': () => ({ content: [{ type: 'text', text: 'REAL PR #12 merged' }] }),
    })
    fetchMock.mockImplementation(server.impl)
    const cfg: LiveConnectionConfig = {
      connectionId: 'github', mode: 'mcp', status: 'live', serverUrl: SERVER.url, toolNames: ['search_issues'],
    }
    const emp = empWith(['github'])
    const r = await agent.runEmployee(agent.simulatedBrain(), emp, 'Any pull requests on github?', undefined, [cfg])
    expect(r.toolCalls.length).toBeGreaterThan(0)
    expect(r.toolCalls[0].output).toMatch(/^\[LIVE · github\] /)
    expect(r.toolCalls[0].output).toContain('REAL PR #12')
  })

  it('stamps mock output inside a graph run when unconfigured', async () => {
    const r = await agent.runEmployee(agent.simulatedBrain(), empWith(['github']), 'Any pull requests on github?')
    expect(r.toolCalls[0].output).toMatch(/^\[MOCK · github\] /)
  })
})
