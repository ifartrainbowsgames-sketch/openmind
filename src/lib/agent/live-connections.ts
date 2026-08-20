import { callServerTool, listServerTools, restFetch, type McpServerSpec } from '../mcp'
import { guardMcpWrite } from './connections'
import { blockedMessage, isStrict } from '../execution-mode'
import { CONNECTION_IDS, CONNECTIONS, mockLookup } from './connections'
import { argumentsForSchema } from './plan'
import type { Employee, ToolResult, ToolSpec } from './types'

export type LiveConnectionMode = 'mcp' | 'rest' | 'webhook' | 'mock'
export type ConnectionStatus = 'untested' | 'ready' | 'live' | 'error' | 'mock'

export interface LiveConnectionConfig {
  connectionId: string
  mode: LiveConnectionMode
  /** MCP server, REST base, or webhook endpoint URL. */
  serverUrl?: string
  /** Session-only credential; never written to persistent localStorage. */
  token?: string
  /** Server-side OAuth installation; its credential never enters browser JS. */
  installationId?: string
  authSource?: 'oauth' | 'manual'
  accountLabel?: string
  status: ConnectionStatus
  toolNames?: string[]
  toolSchemas?: Record<string, unknown>
  /** Advertised descriptions, kept so the write gate can read them. */
  toolDescriptions?: Record<string, string>
  /** Non-secret, plugin-specific settings safe to persist locally. */
  options?: {
    agentId?: string
  }
  lastError?: string
}

export interface McpPreset {
  connectionId: string
  mode: 'mcp' | 'rest' | 'webhook' | 'aggregator'
  supportedModes?: ('mcp' | 'webhook')[]
  serverUrl?: string
  auth: 'bearer' | 'basic' | 'none'
  tokenLabel: string
  note: string
}

export const MCP_PRESETS: Record<string, McpPreset> = {
  n8n: {
    connectionId: 'n8n', mode: 'mcp', supportedModes: ['mcp', 'webhook'],
    auth: 'bearer', tokenLabel: 'n8n MCP access token or webhook bearer token',
    note: 'Recommended: enable n8n’s instance-level MCP server. Webhook mode can instead run one published workflow.',
  },
  openclaw: {
    connectionId: 'openclaw', mode: 'webhook',
    auth: 'bearer', tokenLabel: 'OpenClaw hooks token',
    note: 'Use the public HTTPS /hooks/agent endpoint. OpenMind sends deliver:false and can target an allowed agent ID.',
  },
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
  const mode: LiveConnectionMode =
    raw.mode === 'mcp' || raw.mode === 'rest' || raw.mode === 'webhook' || raw.mode === 'mock' ? raw.mode : 'mock'
  const status: ConnectionStatus =
    raw.status === 'untested' || raw.status === 'ready' || raw.status === 'live' || raw.status === 'error' || raw.status === 'mock'
      ? raw.status
      : 'untested'
  const token = sessionStore()?.getItem(`${CREDENTIAL_PREFIX}${raw.connectionId}`) ?? undefined
  const rawOptions = raw.options && typeof raw.options === 'object'
    ? raw.options as Record<string, unknown>
    : undefined
  const agentId = typeof rawOptions?.agentId === 'string'
    ? rawOptions.agentId.trim().slice(0, 128)
    : ''
  return {
    connectionId: raw.connectionId,
    mode,
    status,
    ...(typeof raw.serverUrl === 'string' ? { serverUrl: raw.serverUrl } : {}),
    ...(typeof raw.installationId === 'string' ? { installationId: raw.installationId } : {}),
    ...(raw.authSource === 'oauth' || raw.authSource === 'manual' ? { authSource: raw.authSource } : {}),
    ...(typeof raw.accountLabel === 'string' ? { accountLabel: raw.accountLabel } : {}),
    ...(Array.isArray(raw.toolNames) ? { toolNames: raw.toolNames.filter((name): name is string => typeof name === 'string') } : {}),
    ...(raw.toolSchemas && typeof raw.toolSchemas === 'object' ? { toolSchemas: raw.toolSchemas as Record<string, unknown> } : {}),
    ...(agentId ? { options: { agentId } } : {}),
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
  return {
    id: cfg.connectionId,
    url,
    authHeader: preset?.auth === 'none' ? 'none' : 'bearer',
    ...(cfg.installationId ? { installationId: cfg.installationId } : {}),
  }
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

export const WEBHOOK_TOOLS = {
  n8n: 'run_workflow',
  openclaw: 'delegate_task',
} as const

function webhookEndpoint(cfg: LiveConnectionConfig): URL {
  const url = validateConnectionUrl(cfg.serverUrl ?? '')
  if (cfg.connectionId === 'openclaw' && !/\/agent\/?$/.test(url.pathname)) {
    throw new Error('OpenClaw URL must be its agent hook endpoint (normally /hooks/agent).')
  }
  return url
}

function webhookToolName(connectionId: string): string {
  const name = WEBHOOK_TOOLS[connectionId as keyof typeof WEBHOOK_TOOLS]
  if (!name) throw new Error(`Webhook mode is not supported for ${connectionId}.`)
  return name
}

function webhookResult(body: string, status: number): string {
  const trimmed = body.trim()
  if (!trimmed) return `Request accepted (HTTP ${status}).`
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const candidate = parsed.output ?? parsed.result ?? parsed.message ?? parsed.response
    if (typeof candidate === 'string') return candidate.slice(0, 4_000)
    return JSON.stringify(candidate ?? parsed).slice(0, 4_000)
  } catch {
    return trimmed.slice(0, 4_000)
  }
}

export async function webhookTool(
  cfg: LiveConnectionConfig,
  input: string,
  args?: Record<string, unknown>,
): Promise<string> {
  const endpoint = webhookEndpoint(cfg)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
  const payload = cfg.connectionId === 'openclaw'
    ? {
        message: input,
        ...(cfg.options?.agentId ? { agentId: cfg.options.agentId } : {}),
        name: 'OpenMind AI employee',
        deliver: false,
      }
    : {
        task: input,
        arguments: args ?? {},
        source: 'openmind-ai-employee',
      }
  const reply = await restFetch(endpoint.toString(), { method: 'POST', headers, payload }, 60_000)
  if (!reply.ok) {
    throw new Error(`${CONNECTIONS[cfg.connectionId]?.name ?? cfg.connectionId} HTTP ${reply.status} — ${reply.body.slice(0, 140)}`)
  }
  return webhookResult(reply.body, reply.status)
}

export async function probeConnection(cfg: LiveConnectionConfig): Promise<LiveConnectionConfig> {
  if (cfg.mode === 'mock') return { ...cfg, status: 'mock', lastError: undefined }
  try {
    if (cfg.mode === 'webhook') {
      webhookEndpoint(cfg)
      const tool = webhookToolName(cfg.connectionId)
      if (cfg.connectionId === 'openclaw' && !cfg.token) {
        throw new Error('OpenClaw requires the hooks token configured on its gateway.')
      }
      // Testing a webhook would execute a workflow/agent. Validate and save it
      // as READY; the first employee task provides the real execution check.
      return { ...cfg, status: 'ready', toolNames: [tool], lastError: undefined }
    }
    if (cfg.mode === 'rest') {
      if (cfg.connectionId !== 'zendesk') throw new Error('REST mode is currently supported only for Zendesk.')
      await zendeskGet(cfg, '/api/v2/users/me.json')
      return { ...cfg, status: 'live', toolNames: [...ZENDESK_TOOLS], lastError: undefined }
    }
    const tools = await listServerTools(serverSpecFor(cfg), cfg.token)
    const toolSchemas = Object.fromEntries(
      tools.filter((tool) => tool.inputSchema !== undefined).map((tool) => [tool.name, tool.inputSchema]),
    )
    // Descriptions are kept because the write gate matches on them as well as
    // the name: a server that calls a destructive tool `execute` gives nothing
    // away in the name, and `"Permanently delete…"` in the description does.
    const toolDescriptions = Object.fromEntries(
      tools.filter((tool) => tool.description).map((tool) => [tool.name, tool.description as string]),
    )
    return {
      ...cfg,
      status: 'live',
      toolNames: tools.map((tool) => tool.name),
      toolSchemas,
      toolDescriptions,
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

    if ((config?.status === 'ready' || config?.status === 'live') && config.mode === 'webhook') {
      const name = webhookToolName(id)
      const run = (input: string, args?: Record<string, unknown>) =>
        runStamped(id, () => webhookTool(config, input, args))
      output.push({
        id: `${id}__${name}`,
        name: `${connection.name}: ${name.replace(/_/g, ' ')}`,
        desc: `LIVE ${connection.name} webhook "${name}"`,
        inputSchema: {
          type: 'object',
          properties: { task: { type: 'string', description: 'Task to send to the connected workflow or agent' } },
        },
        run,
      })
      output.push({
        id,
        name: connection.name,
        desc: `LIVE ${connection.name} via webhook`,
        run,
      })
      continue
    }

    if (config?.status === 'live' && config.mode === 'mcp' && config.toolNames?.length) {
      const server = serverSpecFor(config)
      const names = config.toolNames
      // Resolve once and keep them: the arguments actually sent are part of the
      // result, not a detail internal to the call. Without them a caller cannot
      // tell what the tool was asked, only what it answered.
      const call = async (name: string, input: string, args?: Record<string, unknown>) => {
        const resolved = argumentsForSchema(config.toolSchemas?.[name], args, input)
        return {
          text: await callServerTool(server, name, resolved, config.token),
          resolved,
        }
      }

      /**
       * Nothing in MCP marks a tool as destructive, so the name and schema are
       * the only signal. A write goes to the confirmation hook first; a decline
       * is a structured outcome, not an error string, so callers can tell
       * "the user said no" from "the server broke".
       */
      const guardedCall = async (
        name: string,
        input: string,
        args?: Record<string, unknown>,
      ): Promise<ToolResult> => {
        const allowed = await guardMcpWrite(
          id,
          {
            name,
            description: config.toolDescriptions?.[name],
            inputSchema: config.toolSchemas?.[name],
          },
          input,
        )
        if (!allowed) {
          const message = `${name} needs approval and it was not granted`
          return {
            content: stampToolResult('LIVE', id, `BLOCKED — declined: ${message}`),
            source: 'live',
            error: { kind: 'declined', message },
          }
        }
        return runStamped(id, () => call(name, input, args))
      }
      for (const name of names) {
        output.push({
          id: `${id}__${name}`,
          name: `${connection.name}: ${name}`,
          desc: config.toolDescriptions?.[name]
            ? `LIVE ${connection.name}: ${config.toolDescriptions[name]}`
            : `LIVE ${connection.name} MCP tool "${name}"`,
          inputSchema: config.toolSchemas?.[name],
          run: (input, args) => guardedCall(name, input, args),
        })
      }
      output.push({
        id,
        name: connection.name,
        desc: `LIVE ${connection.name} via MCP — ${names.length} tools`,
        run: async (input, args) => {
          const name = pickTool(names, input)
          return name
            ? guardedCall(name, input, args)
            : stampToolResult('LIVE', id, 'error: no live tools advertised by the server')
        },
      })
      continue
    }

    // Nothing live for this connection. Demo mode serves canned data (honestly
    // stamped); strict mode refuses — fake data that judges as success is worse
    // than an outcome that says the capability is missing.
    if (isStrict()) {
      const detail = config?.lastError ?? 'no live connection configured'
      output.push({
        id,
        name: connection.name,
        desc: `${connection.name} — not connected (strict mode: no mock substitution)`,
        run: (): ToolResult => ({
          content: blockedMessage('capability_unavailable', id, detail),
          error: { kind: 'blocked', message: detail },
        }),
      })
      continue
    }

    output.push({
      id,
      name: connection.name,
      desc: connection.desc,
      run: (input): ToolResult => ({
        content: stampToolResult('MOCK', id, mockLookup(id, input)),
        source: 'mock',
      }),
    })
  }
  return output
}

/**
 * Run a live call and record where the answer came from.
 *
 * The `source` field is the honesty signal the whole app reads: a mocked
 * result and a real one used to be two strings that differed only by a prefix,
 * which meant any code that reformatted the text lost the distinction.
 */
async function runStamped(
  connectionId: string,
  run: () => Promise<{ text: string; resolved?: Record<string, unknown> } | string>,
): Promise<ToolResult> {
  try {
    const out = await run()
    const text = typeof out === 'string' ? out : out.text
    const resolved = typeof out === 'string' ? undefined : out.resolved
    return {
      content: stampToolResult('LIVE', connectionId, text),
      source: 'live',
      ...(resolved ? { arguments: resolved } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A schema we cannot satisfy is a missing capability, not a transient
    // failure: retrying the same call produces the same gap, so it must reach
    // the user as BLOCKED rather than burn the retry budget.
    const unfillable = /required tool arguments/i.test(message)
    return {
      content: stampToolResult('LIVE', connectionId, `${unfillable ? 'BLOCKED' : 'error'}: ${message}`),
      source: 'live',
      error: { kind: unfillable ? 'blocked' : 'error', message },
    }
  }
}
