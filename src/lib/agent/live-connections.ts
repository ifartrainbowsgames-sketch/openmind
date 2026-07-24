import { callServerTool, listServerTools, restFetch, type McpServerSpec } from '../mcp'
import { CONNECTION_IDS, CONNECTIONS, mockLookup } from './connections'
import { argsFromSchema } from './plan'
import type { Employee, ToolSpec } from './types'

export type LiveConnectionMode = 'mcp' | 'rest' | 'mock'
type ConnectionStatus = 'untested' | 'live' | 'error' | 'mock'

export interface LiveConnectionConfig {
  connectionId: string
  mode: LiveConnectionMode
  /** MCP server URL, or Zendesk base URL for REST mode. */
  serverUrl?: string
  /** Session-only credential; never written to persistent localStorage. */
  token?: string
  status: ConnectionStatus
  toolNames?: string[]
  toolSchemas?: Record<string, unknown>
  lastError?: string
}

export interface McpPreset {
  connectionId: string
  mode: 'mcp' | 'rest' | 'aggregator'
  serverUrl?: string
  auth: 'bearer' | 'basic' | 'none'
  tokenLabel: string
  note: string
}

export const MCP_PRESETS: Record<string, McpPreset> = {
  github: {
    connectionId: 'github', mode: 'mcp', serverUrl: 'https://api.githubcopilot.com/mcp/',
    auth: 'bearer', tokenLabel: 'GitHub personal access token',
    note: 'First-party GitHub MCP server; a PAT works as a plain bearer token.',
  },
  notion: {
    connectionId: 'notion', mode: 'mcp', serverUrl: 'https://mcp.notion.com/mcp',
    auth: 'bearer', tokenLabel: 'Notion integration token / OAuth access token',
    note: 'Hosted Notion MCP; inherits the user’s workspace access.',
  },
  linear: {
    connectionId: 'linear', mode: 'mcp', serverUrl: 'https://mcp.linear.app/mcp',
    auth: 'bearer', tokenLabel: 'Linear OAuth access token or personal API key',
    note: 'First-party Linear MCP over Streamable HTTP.',
  },
  jira: {
    connectionId: 'jira', mode: 'mcp', serverUrl: 'https://mcp.atlassian.com/v1/mcp',
    auth: 'bearer', tokenLabel: 'Atlassian OAuth access token',
    note: 'Atlassian Rovo MCP — covers Jira, Confluence and Compass.',
  },
  hubspot: {
    connectionId: 'hubspot', mode: 'mcp', serverUrl: 'https://mcp.hubspot.com',
    auth: 'bearer', tokenLabel: 'HubSpot OAuth access token / private app token',
    note: 'First-party HubSpot MCP; contacts, deals and tickets.',
  },
  slack: {
    connectionId: 'slack', mode: 'mcp', serverUrl: 'https://mcp.slack.com/mcp',
    auth: 'bearer', tokenLabel: 'Slack OAuth token',
    note: 'Slack’s hosted MCP may require an approved client; use an aggregator when needed.',
  },
  gmail: {
    connectionId: 'gmail', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key',
    note: 'Google has no first-party Gmail MCP; paste a server URL from your aggregator.',
  },
  gcal: {
    connectionId: 'gcal', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key',
    note: 'Use a trusted aggregator URL for Google Calendar.',
  },
  gdrive: {
    connectionId: 'gdrive', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key',
    note: 'Use a trusted aggregator URL for Google Drive.',
  },
  outlook: {
    connectionId: 'outlook', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key',
    note: 'Use a trusted aggregator URL for Outlook.',
  },
  zendesk: {
    connectionId: 'zendesk', mode: 'rest', serverUrl: 'https://{subdomain}.zendesk.com',
    auth: 'basic', tokenLabel: 'email/token:API_TOKEN',
    note: 'Zendesk REST is called through the authenticated proxy.',
  },
}

export const ZENDESK_TOOLS = ['search_tickets', 'get_ticket', 'ticket_stats'] as const

export function stampToolResult(source: 'LIVE' | 'MOCK', connectionId: string, body: string): string {
  return `[${source} · ${connectionId}] ${body}`
}

export const LIVE_CONNECTIONS_KEY = 'om-live-connections'
const CREDENTIAL_PREFIX = 'om-live-credential:'

function sessionStore(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage
    if (typeof localStorage !== 'undefined') return localStorage // test/non-browser compatibility
  } catch {
    // Storage can be unavailable in hardened/private browsing contexts.
  }
  return null
}

function normalizeConfig(value: unknown): LiveConnectionConfig | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.connectionId !== 'string' || !CONNECTION_IDS.includes(raw.connectionId)) return null
  const mode: LiveConnectionMode = raw.mode === 'mcp' || raw.mode === 'rest' || raw.mode === 'mock' ? raw.mode : 'mock'
  const status: ConnectionStatus =
    raw.status === 'untested' || raw.status === 'live' || raw.status === 'error' || raw.status === 'mock'
      ? raw.status
      : 'untested'
  const token = sessionStore()?.getItem(`${CREDENTIAL_PREFIX}${raw.connectionId}`) ?? undefined
  return {
    connectionId: raw.connectionId,
    mode,
    status,
    ...(typeof raw.serverUrl === 'string' ? { serverUrl: raw.serverUrl } : {}),
    ...(Array.isArray(raw.toolNames) ? { toolNames: raw.toolNames.filter((name): name is string => typeof name === 'string') } : {}),
    ...(raw.toolSchemas && typeof raw.toolSchemas === 'object' ? { toolSchemas: raw.toolSchemas as Record<string, unknown> } : {}),
    ...(typeof raw.lastError === 'string' ? { lastError: raw.lastError } : {}),
    ...(token ? { token } : {}),
  }
}

export function loadLiveConnections(): LiveConnectionConfig[] {
  try {
    const raw = localStorage.getItem(LIVE_CONNECTIONS_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeConfig).filter((config): config is LiveConnectionConfig => config !== null)
      .slice(0, CONNECTION_IDS.length)
  } catch {
    return []
  }
}

export function saveLiveConnections(configs: LiveConnectionConfig[]): void {
  try {
    const safe = configs.map(({ token, ...config }) => {
      const key = `${CREDENTIAL_PREFIX}${config.connectionId}`
      if (token) sessionStore()?.setItem(key, token)
      else sessionStore()?.removeItem(key)
      return config
    })
    localStorage.setItem(LIVE_CONNECTIONS_KEY, JSON.stringify(safe))
  } catch {
    /* Configs remain in component memory when storage is unavailable. */
  }
}

export function upsertLiveConnection(cfg: LiveConnectionConfig): LiveConnectionConfig[] {
  const all = loadLiveConnections().filter((config) => config.connectionId !== cfg.connectionId)
  all.push(cfg)
  saveLiveConnections(all)
  return all
}

export function removeLiveConnection(connectionId: string): LiveConnectionConfig[] {
  const all = loadLiveConnections().filter((config) => config.connectionId !== connectionId)
  sessionStore()?.removeItem(`${CREDENTIAL_PREFIX}${connectionId}`)
  saveLiveConnections(all)
  return all
}

function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some((part) => part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

export function validateConnectionUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Connection URL is invalid.')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (url.protocol !== 'https:') throw new Error('Connection URLs must use HTTPS.')
  if (url.username || url.password) throw new Error('Credentials are not allowed in connection URLs.')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host.startsWith('fe80:') ||
      host.startsWith('fc') || host.startsWith('fd') || isPrivateIpv4(host)) {
    throw new Error('Private and local connection hosts are not allowed.')
  }
  return url
}

function serverSpecFor(cfg: LiveConnectionConfig): McpServerSpec {
  const preset = MCP_PRESETS[cfg.connectionId]
  const rawUrl = cfg.serverUrl ?? preset?.serverUrl
  if (!rawUrl) throw new Error(`No server URL for ${cfg.connectionId}.`)
  const url = validateConnectionUrl(rawUrl).toString()
  return { id: cfg.connectionId, url, authHeader: preset?.auth === 'none' ? 'none' : 'bearer' }
}

function zendeskBase(cfg: LiveConnectionConfig): string {
  const url = validateConnectionUrl(cfg.serverUrl ?? '')
  if (!url.hostname.endsWith('.zendesk.com')) throw new Error('Zendesk URL must be a zendesk.com subdomain.')
  return url.toString().replace(/\/+$/, '')
}

function zendeskHeaders(cfg: LiveConnectionConfig): Record<string, string> {
  return { Authorization: `Basic ${btoa(cfg.token ?? '')}`, Accept: 'application/json' }
}

async function zendeskGet(cfg: LiveConnectionConfig, path: string): Promise<unknown> {
  const reply = await restFetch(`${zendeskBase(cfg)}${path}`, { headers: zendeskHeaders(cfg) })
  if (!reply.ok) throw new Error(`Zendesk HTTP ${reply.status} — ${reply.body.slice(0, 140)}`)
  return JSON.parse(reply.body) as unknown
}

interface ZendeskTicket {
  id?: number
  subject?: string
  status?: string
  priority?: string | null
  description?: string
}

function fmtTicket(ticket: ZendeskTicket): string {
  const priority = ticket.priority ? ` (${ticket.priority})` : ''
  return `• #${ticket.id ?? '?'} "${ticket.subject ?? '(no subject)'}" — ${ticket.status ?? '?'}${priority}`
}

export async function zendeskTool(
  cfg: LiveConnectionConfig,
  tool: (typeof ZENDESK_TOOLS)[number],
  input: string,
): Promise<string> {
  if (tool === 'search_tickets') {
    const query = encodeURIComponent(`type:ticket ${input}`.trim())
    const data = await zendeskGet(cfg, `/api/v2/search.json?query=${query}`) as { results?: ZendeskTicket[] }
    const tickets = (data.results ?? []).slice(0, 5)
    return tickets.length ? tickets.map(fmtTicket).join('\n') : `No tickets matching "${input}".`
  }
  if (tool === 'get_ticket') {
    const id = input.match(/\d+/)?.[0]
    if (!id) return 'No ticket number found in the input.'
    const data = await zendeskGet(cfg, `/api/v2/tickets/${id}.json`) as { ticket?: ZendeskTicket }
    if (!data.ticket) return `Ticket #${id} not found.`
    const description = (data.ticket.description ?? '').replace(/\s+/g, ' ').slice(0, 240)
    return `${fmtTicket(data.ticket)}${description ? `\n${description}` : ''}`
  }
  const data = await zendeskGet(cfg, '/api/v2/tickets/count.json') as { count?: { value?: number; refreshed_at?: string } }
  return data.count?.value === undefined
    ? 'Ticket count unavailable.'
    : `≈${data.count.value} tickets in the queue (count refreshed ${data.count.refreshed_at ?? 'recently'}).`
}

export async function probeConnection(cfg: LiveConnectionConfig): Promise<LiveConnectionConfig> {
  if (cfg.mode === 'mock') return { ...cfg, status: 'mock', lastError: undefined }
  try {
    if (cfg.mode === 'rest') {
      if (cfg.connectionId !== 'zendesk') throw new Error('REST mode is currently supported only for Zendesk.')
      await zendeskGet(cfg, '/api/v2/users/me.json')
      return { ...cfg, status: 'live', toolNames: [...ZENDESK_TOOLS], lastError: undefined }
    }
    const tools = await listServerTools(serverSpecFor(cfg), cfg.token)
    const toolSchemas = Object.fromEntries(
      tools.filter((tool) => tool.inputSchema !== undefined).map((tool) => [tool.name, tool.inputSchema]),
    )
    return {
      ...cfg,
      status: 'live',
      toolNames: tools.map((tool) => tool.name),
      toolSchemas,
      lastError: undefined,
    }
  } catch (error) {
    return { ...cfg, status: 'error', lastError: error instanceof Error ? error.message : String(error) }
  }
}

function pickTool(toolNames: string[], input: string): string | undefined {
  const words = input.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2)
  return toolNames
    .map((name) => ({
      name,
      score: words.filter((word) => name.toLowerCase().includes(word)).length +
        (/search|list|find|get/.test(name.toLowerCase()) ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.name
}

function normalizeConfigs(
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
): Record<string, LiveConnectionConfig> {
  if (!configs) return {}
  return Array.isArray(configs) ? Object.fromEntries(configs.map((config) => [config.connectionId, config])) : configs
}

export function resolveConnectionTools(
  employee: Employee,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
): ToolSpec[] {
  const byId = normalizeConfigs(configs)
  const output: ToolSpec[] = []
  for (const id of employee.connections ?? []) {
    const connection = CONNECTIONS[id]
    if (!connection) continue
    const config = byId[id]

    if (config?.status === 'live' && config.mode === 'rest' && id === 'zendesk') {
      for (const tool of ZENDESK_TOOLS) {
        output.push({
          id: `zendesk__${tool}`,
          name: `Zendesk: ${tool.replace(/_/g, ' ')}`,
          desc: `LIVE Zendesk ${tool.replace(/_/g, ' ')}`,
          run: async (input) => runStamped(id, () => zendeskTool(config, tool, input)),
        })
      }
      output.push({
        id,
        name: connection.name,
        desc: 'LIVE Zendesk support queue',
        run: async (input) => runStamped(id, () => zendeskTool(config, 'search_tickets', input)),
      })
      continue
    }

    if (config?.status === 'live' && config.mode === 'mcp' && config.toolNames?.length) {
      const server = serverSpecFor(config)
      const names = config.toolNames
      const call = (name: string, input: string) =>
        callServerTool(server, name, argsFromSchema(config.toolSchemas?.[name], input), config.token)
      for (const name of names) {
        output.push({
          id: `${id}__${name}`,
          name: `${connection.name}: ${name}`,
          desc: `LIVE ${connection.name} MCP tool "${name}"`,
          run: async (input) => runStamped(id, () => call(name, input)),
        })
      }
      output.push({
        id,
        name: connection.name,
        desc: `LIVE ${connection.name} via MCP — ${names.length} tools`,
        run: async (input) => {
          const name = pickTool(names, input)
          return name
            ? runStamped(id, () => call(name, input))
            : stampToolResult('LIVE', id, 'error: no live tools advertised by the server')
        },
      })
      continue
    }

    output.push({
      id,
      name: connection.name,
      desc: connection.desc,
      run: (input) => stampToolResult('MOCK', id, mockLookup(id, input)),
    })
  }
  return output
}

async function runStamped(connectionId: string, run: () => Promise<string>): Promise<string> {
  try {
    return stampToolResult('LIVE', connectionId, await run())
  } catch (error) {
    return stampToolResult('LIVE', connectionId, `error: ${error instanceof Error ? error.message : String(error)}`)
  }
}
