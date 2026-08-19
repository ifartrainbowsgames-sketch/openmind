// ── AI Employees — LangGraph runtime ─────────────────────────────────────────
// Every employee runs on a real LangGraph StateGraph: plan → act (tools) ⇢ → respond.
// The "brain" is pluggable — a deterministic local simulation (keyless, like the
// playground demos) or a browser-direct call to any OpenAI-compatible provider,
// where the visitor's key never leaves their browser.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { analyzeSentiment, retrievePassages, summarize } from './demo'
import { draftBusinessPlan } from './business-plan'
import { invokeCrewTool } from './crew-tools'
import {
  callServerToolDetailed,
  listServerTools,
  restFetch,
  type McpServerSpec,
  type McpToolInfo,
} from './mcp'
import { blockedMessage, isStrict } from './execution-mode'
import { stripWorkspacePrompt } from './workspace'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Employee {
  id: string
  name: string
  role: string
  /** The owner's own prompt — becomes the system prompt. */
  prompt: string
  /** Tool ids from TOOL_REGISTRY. */
  tools: string[]
  /** Connection ids from CONNECTIONS (Gmail, Calendar…) — each adds a callable tool. */
  connections?: string[]
  accent: string
  tagline?: string
  preset?: boolean
  /**
   * Steps this employee may plan. Defaults to MAX_STEPS; workers with a
   * sandbox need more, because clone/install/edit/test/fix is a sequence.
   */
  maxSteps?: number
}

export interface PlanStep {
  tool: string
  input: string
}

/** Why a tool call produced no usable result. */
export interface ToolError {
  kind: 'blocked' | 'error' | 'declined'
  message: string
}

/** A file a tool produced directly, rather than describing in prose. */
export interface ToolArtifact {
  path: string
  body: string
}

/**
 * What a tool actually returns. `content` is the text a model reads; `data`
 * is the structured half — MCP `structuredContent`, parsed rows, API objects —
 * kept so a downstream worker can consume the object instead of re-parsing
 * another model's description of it.
 */
export interface ToolResult {
  content: string
  data?: unknown
  /** Structured arguments the tool was actually invoked with. */
  arguments?: Record<string, unknown>
  artifacts?: ToolArtifact[]
  error?: ToolError
  source?: 'live' | 'mock'
}

export interface ToolCall {
  tool: string
  input: string
  output: string
  /** Structured arguments actually sent, when the tool took any. */
  arguments?: Record<string, unknown>
  data?: unknown
  artifacts?: ToolArtifact[]
  error?: ToolError
  source?: 'live' | 'mock'
}

/** Tools may return a bare string; everything downstream sees a ToolResult. */
export function normalizeToolResult(value: string | ToolResult): ToolResult {
  return typeof value === 'string' ? { content: value } : value
}

export interface TraceLine {
  node: 'plan' | 'act' | 'respond'
  text: string
}

export interface RunResult {
  answer: string
  plan: PlanStep[]
  toolCalls: ToolCall[]
  trace: TraceLine[]
}

export interface AgentBrain {
  plan: (input: string, tools: ToolSpec[]) => Promise<PlanStep[]>
  respond: (input: string, observations: ToolCall[], employee: Employee) => Promise<string>
  /**
   * Plan again after a round of tool calls came back useless. Optional — a
   * brain without it gets the default: plan() over a prompt annotated with
   * what already failed.
   */
  replan?: (input: string, observations: ToolCall[], tools: ToolSpec[]) => Promise<PlanStep[]>
}

// ── Knowledge base for the search_docs tool ──────────────────────────────────

export const KNOWLEDGE = `
The chatbot widget embeds on any site with two lines of code: a script tag with a data-service attribute.
OpenMind is the open-source integration layer for AI. Its chatbot ships as an embeddable widget and one unified API.
The chatbot runs on the customer's own provider keys — OpenMind never marks up tokens. You pay your provider directly.
Key modes: Browser-direct keeps the visitor's key in their browser with zero servers. Vaulted keys are encrypted server-side with AES-256. Gateway mode adds rate limiting and caching.
The playground lets visitors test the chatbot in the browser — it answers with real ChatGPT through a secure gateway.
The console includes Data Studio for uploading and indexing company data, a Widget Builder with live preview, Inbox, Engage popups, Prompt Studio and service settings.
Pro is ten dollars per month during early access. The free plan includes the chatbot and one hundred thousand tokens.
Refunds are processed within five business days — email billing@openmind.dev to request one.
The stack is React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Supabase and Stripe. MIT licensed.
AI Employees are LangGraph agents that plan, call tools and respond — create your own with a custom system prompt.
The customer Super Agent lives at /app: a LangGraph crew that can research, write to the user's own GitHub, and use Slack, Gmail, and Drive after they tap Connect apps.
Research tasks run a deep-research step first: several web searches in parallel, then a short browse, then a cited dossier for specialists.
Sends, GitHub writes, and checkout-like pages wait for a confirm tap. Notes can be saved with memory_save and recalled with memory_search (this device, or your account when signed in).
MCP connects agents to tools; A2A connects separate agent runtimes. OpenMind's in-process crew does not use AutoGen.
`

// ── Tools ────────────────────────────────────────────────────────────────────

/** Anything the graph can call — sync (built-ins, mocks) or async (live MCP/REST). */
export interface ToolSpec {
  id: string
  name: string
  desc: string
  /** A plain string is shorthand for `{ content }` — see normalizeToolResult. */
  run: (input: string) => string | ToolResult | Promise<string | ToolResult>
}

export type AgentTool = ToolSpec

/** Safe arithmetic — whitelist means no identifiers can reach Function. */
export function calc(expr: string): string {
  const clean = expr.replace(/,/g, '').trim()
  if (!/^[0-9+\-*/().%\s]+$/.test(clean)) return 'error: only digits and + - * / ( ) % are allowed'
  try {
    const v = Function(`"use strict"; return (${clean})`)() as number
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'error: result is not a finite number'
    return String(Math.round(v * 1e6) / 1e6)
  } catch {
    return `error: could not evaluate "${clean}"`
  }
}

export const TOOL_REGISTRY: Record<string, AgentTool> = {
  search_docs: {
    id: 'search_docs',
    name: 'Search docs',
    desc: 'Find answers in the OpenMind knowledge base',
    run: (q) => {
      const hits = retrievePassages(KNOWLEDGE, q, 2)
      return hits.length ? hits.map((h) => h.sentence).join(' ') : 'No matching passages found in the docs.'
    },
  },
  summarize: {
    id: 'summarize',
    name: 'Summarize',
    desc: 'Condense long text into the key sentences',
    run: (t) => {
      const out = summarize(t, 0.4)
      return out.length ? out.map((o) => o.sentence).join(' ') : 'Nothing to summarize.'
    },
  },
  sentiment: {
    id: 'sentiment',
    name: 'Sentiment',
    desc: 'Score tone, emotion and urgency of feedback',
    run: (t) => {
      const r = analyzeSentiment(t)
      return `${r.label} (score ${r.score.toFixed(2)}, confidence ${Math.round(r.confidence * 100)}%, urgency ${Math.round(r.urgency * 100)}%)` +
        (r.hits.length ? ` — key signals: ${r.hits.slice(0, 5).map((h) => h.word).join(', ')}` : '')
    },
  },
  calculator: {
    id: 'calculator',
    name: 'Calculator',
    desc: 'Evaluate arithmetic expressions',
    run: calc,
  },
}

export const TOOL_IDS = Object.keys(TOOL_REGISTRY)

// ── Code tools ───────────────────────────────────────────────────────────────

/** Static-analysis heuristics on pasted code — no parser, just honest signals. */
export function reviewCode(code: string): string {
  if (!code.trim()) return 'No code provided.'
  const lines = code.split('\n')
  const findings: string[] = []
  const count = (re: RegExp) => (code.match(re) ?? []).length
  const fns = count(/function\s+\w+|=>|def\s+\w+/g)
  if (count(/console\.(log|debug|warn)\s*\(/g)) findings.push(`${count(/console\.(log|debug|warn)\s*\(/g)}× console.* left in — strip before shipping`)
  if (/\bdebugger\b/.test(code)) findings.push('debugger statement present')
  if (count(/\bvar\s+\w+/g)) findings.push(`${count(/\bvar\s+\w+/g)}× var — prefer const/let`)
  if (/[^=!<>]==[^=]/.test(code)) findings.push('loose == comparison — use ===')
  if (count(/\b(TODO|FIXME|HACK)\b/g)) findings.push(`${count(/\b(TODO|FIXME|HACK)\b/g)}× TODO/FIXME/HACK unresolved`)
  if (/\beval\s*\(/.test(code)) findings.push('eval() — security risk, remove')
  if (/innerHTML\s*=/.test(code)) findings.push('innerHTML assignment — XSS risk, sanitize or use textContent')
  if (lines.some((l) => l.length > 120)) findings.push('lines over 120 chars — wrap for readability')
  const head = `${lines.length} lines, ~${fns} function${fns === 1 ? '' : 's'}.`
  return findings.length ? `${head} Findings: ${findings.join(' · ')}` : `${head} No issues found — clean.`
}

TOOL_REGISTRY.code_review = {
  id: 'code_review',
  name: 'Code smell scan',
  desc: 'Regex smell scan of a pasted snippet (console.log, var, eval). Not a substitute for run_checks on a real repo.',
  run: reviewCode,
}

TOOL_REGISTRY.run_checks = {
  id: 'run_checks',
  name: 'Run project checks',
  desc: "Run the repo's OWN typecheck/lint/test/build in the sandbox and report real exit codes. Use this to verify code works.",
  run: (q) => invokeCrewTool('run_checks', q),
}

TOOL_REGISTRY.web_search = {
  id: 'web_search',
  name: 'Web search',
  desc: 'Search the public web (DuckDuckGo / SearXNG; Tavily optional)',
  run: (q) => invokeCrewTool('web_search', q),
}

TOOL_REGISTRY.browse_url = {
  id: 'browse_url',
  name: 'Browse URL',
  desc: 'Read a URL to text (Jina Reader / fetch; Firecrawl optional)',
  run: (q) => invokeCrewTool('browse_url', q),
}

TOOL_REGISTRY.run_code = {
  id: 'run_code',
  name: 'Run code',
  desc: 'Execute Python in the project sandbox (mock if no E2B key)',
  run: (q) => invokeCrewTool('run_code', q),
}

// ── Workspace tools — one persistent sandbox per project ─────────────────────
// These share a machine, so a clone survives into the install and the install
// into the test run. That sequence is what a coding worker actually needs.

TOOL_REGISTRY.workspace_run = {
  id: 'workspace_run',
  name: 'Run shell command',
  desc: 'Run any shell command in the project sandbox — npm install, pytest, build. Input: the command, or {"command":"..."}',
  run: (q) => invokeCrewTool('workspace_run', q),
}

TOOL_REGISTRY.workspace_write_file = {
  id: 'workspace_write_file',
  name: 'Write file',
  desc: 'Write a file in the project sandbox. Input: {"path":"src/x.ts","content":"..."}',
  run: (q) => invokeCrewTool('workspace_write_file', q),
}

TOOL_REGISTRY.workspace_read_file = {
  id: 'workspace_read_file',
  name: 'Read file',
  desc: 'Read a file from the project sandbox. Input: the path, or {"path":"..."}',
  run: (q) => invokeCrewTool('workspace_read_file', q),
}

TOOL_REGISTRY.workspace_ls = {
  id: 'workspace_ls',
  name: 'List files',
  desc: 'List the project sandbox tree. Input: a path, or {"path":"."}',
  run: (q) => invokeCrewTool('workspace_ls', q),
}

TOOL_REGISTRY.git_clone = {
  id: 'git_clone',
  name: 'Clone repo',
  desc: 'Clone an https git repo into the project sandbox. Input: the URL, or {"repo":"...","branch":"main"}',
  run: (q) => invokeCrewTool('git_clone', q),
}

TOOL_REGISTRY.github_write_file = {
  id: 'github_write_file',
  name: 'GitHub write file',
  desc: 'Commit a file to the GitHub · main workspace. Required one-line JSON only: {"path","content"} with optional "message" and "branch". Do not pass the workspace prompt.',
  run: (q) => invokeCrewTool('github_write_file', q),
}

TOOL_REGISTRY.github_create_branch = {
  id: 'github_create_branch',
  name: 'GitHub create branch',
  desc: 'Create a branch from main on the GitHub workspace. One-line JSON: {"name","from?"}.',
  run: (q) => invokeCrewTool('github_create_branch', q),
}

TOOL_REGISTRY.github_open_pr = {
  id: 'github_open_pr',
  name: 'GitHub open PR',
  desc: 'Open a pull request into main. One-line JSON: {"title","body?","head","base?"}.',
  run: (q) => invokeCrewTool('github_open_pr', q),
}

TOOL_REGISTRY.slack_post = {
  id: 'slack_post',
  name: 'Slack post',
  desc: 'Post to Slack. One-line JSON: {"text","channel?"}. Connect Slack first.',
  run: (q) => invokeCrewTool('slack_post', q),
}

TOOL_REGISTRY.gmail_send = {
  id: 'gmail_send',
  name: 'Gmail send',
  desc: 'Send mail from Gmail. One-line JSON: {"to","subject","body"}. Connect Gmail first.',
  run: (q) => invokeCrewTool('gmail_send', q),
}

TOOL_REGISTRY.gmail_list = {
  id: 'gmail_list',
  name: 'Gmail list',
  desc: 'List inbox threads. Optional JSON {"query"} e.g. is:unread. Connect Gmail first.',
  run: (q) => invokeCrewTool('gmail_list', q),
}

TOOL_REGISTRY.gmail_read = {
  id: 'gmail_read',
  name: 'Gmail read',
  desc: 'Read one message. JSON {"id"} from gmail_list. Connect Gmail first.',
  run: (q) => invokeCrewTool('gmail_read', q),
}

TOOL_REGISTRY.web_act = {
  id: 'web_act',
  name: 'Web act',
  desc: 'Hosted Chrome: JSON {"url","goal","steps":[{"click":"css"},{"type":{"selector","text"}}]}. Confirm first.',
  run: (q) => invokeCrewTool('web_act', q),
}

TOOL_REGISTRY.business_plan = {
  id: 'business_plan',
  name: 'Business plan',
  desc: 'Structure the business: offer, 14-day plan, risks. Teammates argue it on the table.',
  run: (q) => draftBusinessPlan(q),
}

TOOL_REGISTRY.gdrive_list = {
  id: 'gdrive_list',
  name: 'Drive list',
  desc: 'List Google Drive files. Optional JSON: {"query"}. Connect Drive first.',
  run: (q) => invokeCrewTool('gdrive_list', q),
}

TOOL_REGISTRY.memory_search = {
  id: 'memory_search',
  name: 'Memory search',
  desc: 'Recall notes saved for this user (account or this device)',
  run: (q) => import('./memory').then((m) => m.searchMemory(q)),
}

TOOL_REGISTRY.memory_save = {
  id: 'memory_save',
  name: 'Memory save',
  desc: 'Save a note. Plain text, or JSON {"content","scope?"} where scope is user, project, or ephemeral.',
  run: (q) => import('./memory').then((m) => m.saveMemory(q)),
}

// ── Connections — external apps as agent tools ───────────────────────────────

export interface Connection {
  id: string
  name: string
  desc: string
  category: 'email' | 'calendar' | 'docs' | 'chat' | 'code' | 'tickets' | 'crm' | 'notes'
}

export const CONNECTIONS: Record<string, Connection> = {
  gmail: { id: 'gmail', name: 'Gmail', desc: 'Read and triage the inbox', category: 'email' },
  outlook: { id: 'outlook', name: 'Outlook', desc: 'Read and triage the inbox', category: 'email' },
  gcal: { id: 'gcal', name: 'Google Calendar', desc: 'Check schedule and meetings', category: 'calendar' },
  gdrive: { id: 'gdrive', name: 'Google Drive', desc: 'Find files and documents', category: 'docs' },
  notion: { id: 'notion', name: 'Notion', desc: 'Search workspace pages', category: 'notes' },
  slack: { id: 'slack', name: 'Slack', desc: 'Read channels and mentions', category: 'chat' },
  github: { id: 'github', name: 'GitHub', desc: 'Issues, PRs and reviews', category: 'code' },
  linear: { id: 'linear', name: 'Linear', desc: 'Track issues and cycles', category: 'tickets' },
  jira: { id: 'jira', name: 'Jira', desc: 'Track tickets and sprints', category: 'tickets' },
  zendesk: { id: 'zendesk', name: 'Zendesk', desc: 'Support ticket queue', category: 'tickets' },
  hubspot: { id: 'hubspot', name: 'HubSpot', desc: 'Deals, contacts and CRM', category: 'crm' },
}

export const CONNECTION_IDS = Object.keys(CONNECTIONS)

// Canned-but-plausible datasets — in live mode the provider reasons over these;
// real data flows through the live-connection machinery below. Keyword
// filtering keeps answers relevant.
export const MOCK: Record<string, string[]> = {
  gmail: [
    'From sara@acme.com — "Refund request #4821": customer on the Pro plan asks for a refund, order 4821.',
    'From tom@beta.io — "Widget not loading on Safari": console shows a CORS error when the script loads.',
    'From lena@gamma.co — "Invoice for March": please resend the March invoice to accounting.',
    'From noreply@github.com — "[openmind] PR #12 approved": feat: ai employees was approved.',
  ],
  outlook: [
    'From finance@acme.com — "Q3 budget sign-off": please confirm the tooling budget by Friday.',
    'From hr@acme.com — "New hire starts Monday": onboarding pack attached.',
  ],
  gcal: [
    'Sprint planning — today 10:00, eng team.',
    'Customer demo: Beta.io — today 14:30, sales.',
    '1:1 with Mara — tomorrow 09:00.',
    'Roadmap review — Friday 15:00, product.',
  ],
  gdrive: [
    'roadmap-2026.docx — product roadmap, edited 2 days ago.',
    'brand-guide.pdf — logos, colors, tone of voice.',
    'q3-metrics.xlsx — activation and retention dashboards.',
    'support-macros.txt — canned replies for the top 20 tickets.',
  ],
  notion: [
    'Page "Company wiki" — policies, benefits, onboarding.',
    'Page "Launch checklist" — 14 items, 9 done.',
    'Page "Meeting notes — roadmap" — decisions from last Friday.',
  ],
  slack: [
    '#support — "refund question from Acme, anyone?" 20m ago.',
    '#eng — "deploy to Pages is green" 1h ago.',
    '#general — "welcome Priya, starting Monday!" 3h ago.',
  ],
  github: [
    'Issue #87 — "Chat widget overflows on mobile" — open, labeled bug.',
    'PR #12 — "feat: ai employees" — approved, 2 checks green.',
    'Issue #91 — "Add dark mode to console" — open, labeled enhancement.',
  ],
  linear: [
    'ENG-204 — "Streaming answers in playground" — In Progress.',
    'ENG-198 — "Widget a11y pass" — Todo, cycle 24.',
  ],
  jira: [
    'SUP-142 — "Customer cannot find API key" — open, high priority.',
    'SUP-138 — "Billing page 500 on Safari" — in review.',
  ],
  zendesk: [
    'Ticket #3381 — "Refund status?" — pending agent.',
    'Ticket #3375 — "How do I embed the widget?" — solved with macro #4.',
  ],
  hubspot: [
    'Deal "Beta.io — Pro annual" — $1,200, stage: negotiation.',
    'Contact "Lena Fischer" — gamma.co, last touch: invoice question.',
  ],
}

export function mockLookup(id: string, query: string): string {
  const items = MOCK[id] ?? []
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)
  const hits = items.filter((it) => words.some((w) => it.toLowerCase().includes(w)))
  const picked = (hits.length ? hits : items).slice(0, 3)
  return picked.map((p) => `• ${p}`).join('\n')
}

export const CONNECTION_TOOLS: Record<string, AgentTool> = Object.fromEntries(
  CONNECTION_IDS.map((id) => [
    id,
    {
      id,
      name: CONNECTIONS[id].name,
      desc: CONNECTIONS[id].desc,
      run: (q: string) => mockLookup(id, q),
    },
  ]),
)

/** Every callable tool: built-ins + code tools + one per connection. */
export const ALL_TOOLS: Record<string, AgentTool> = { ...TOOL_REGISTRY, ...CONNECTION_TOOLS }

export function toolName(id: string): string {
  return ALL_TOOLS[id]?.name ?? id
}

// ── Live connections — real MCP/REST behind honest LIVE/MOCK stamping ───────
// Every connection starts as a mock (canned data, stamped [MOCK · id]). The
// owner can upgrade it to a real upstream: a first-party MCP server (GitHub,
// Notion, Linear, Jira, HubSpot, Stripe, Slack), an aggregator MCP URL the
// user supplies for Gmail/GCal/Drive/Outlook (Composio/Zapier/Klavis — Google
// ships no first-party MCP), or REST for Zendesk (its MCP server is still
// early-access). Calls go through the Supabase mcp-proxy edge function when
// Supabase is configured, browser-direct otherwise.

export type LiveConnectionMode = 'mcp' | 'rest' | 'mock'

export interface LiveConnectionConfig {
  connectionId: string
  mode: LiveConnectionMode
  /** MCP server URL, or Zendesk base URL (https://{subdomain}.zendesk.com) for rest mode. */
  serverUrl?: string
  /**
   * Bearer token (MCP) or "email/token:API_TOKEN" (Zendesk basic auth).
   * Stored in localStorage — a deliberate BYOK tradeoff, same as the app's
   * existing provider-key handling: the key never leaves the user's browser
   * except to the upstream service (via the proxy). Server-side vaulting is
   * the documented next step, not implemented here.
   */
  token?: string
  status: 'untested' | 'live' | 'error' | 'mock'
  /** Tool names only — kept for persisted configs written before schemas were retained. */
  toolNames?: string[]
  /**
   * The full `tools/list` result, schemas included. `toolNames` used to be the
   * only thing kept, which forced every live MCP call through a `{query: …}`
   * guess; the schema is what lets arguments be built properly.
   */
  tools?: McpToolInfo[]
  lastError?: string
}

export interface McpPreset {
  connectionId: string
  mode: 'mcp' | 'rest' | 'aggregator'
  /** Fixed first-party URL; undefined for aggregator mode (user supplies their own). */
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
    note: 'First-party Linear MCP over Streamable HTTP, 25+ read/write tools.',
  },
  jira: {
    connectionId: 'jira', mode: 'mcp', serverUrl: 'https://mcp.atlassian.com/v1/mcp',
    auth: 'bearer', tokenLabel: 'Atlassian OAuth access token',
    note: 'Atlassian Rovo MCP — covers Jira + Confluence + Compass.',
  },
  hubspot: {
    connectionId: 'hubspot', mode: 'mcp', serverUrl: 'https://mcp.hubspot.com',
    auth: 'bearer', tokenLabel: 'HubSpot OAuth access token / private app token',
    note: 'First-party HubSpot MCP; contacts, deals and tickets read+write.',
  },
  slack: {
    connectionId: 'slack', mode: 'mcp', serverUrl: 'https://mcp.slack.com/mcp',
    auth: 'bearer', tokenLabel: 'Slack OAuth token (partner-gated — aggregator URL often needed)',
    note: 'Slack’s hosted MCP only accepts approved clients; if it rejects the handshake, use a Composio/Pipedream aggregator URL instead.',
  },
  gmail: {
    connectionId: 'gmail', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key (Composio / Zapier / Klavis)',
    note: 'Prefer Nango Connect (Google) so the crew can gmail_send. Or paste a self-hosted MCP URL from @modelcontextprotocol/servers.',
  },
  gcal: {
    connectionId: 'gcal', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key (Composio / Zapier / Klavis)',
    note: 'Same aggregator pattern as Gmail; Klavis hosts per-user Gmail/GCal MCP servers with OAuth.',
  },
  gdrive: {
    connectionId: 'gdrive', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key (Composio / Zapier / Klavis)',
    note: 'Prefer Nango Connect (google-drive) so the crew can gdrive_list. Official OSS MCP is stdio (@modelcontextprotocol/server-filesystem) if you tunnel it here.',
  },
  outlook: {
    connectionId: 'outlook', mode: 'aggregator',
    auth: 'bearer', tokenLabel: 'Aggregator MCP URL + key (Composio / Pipedream)',
    note: 'No first-party Outlook MCP — bring an aggregator URL.',
  },
  zendesk: {
    connectionId: 'zendesk', mode: 'rest', serverUrl: 'https://{subdomain}.zendesk.com',
    auth: 'basic', tokenLabel: 'email/token:API_TOKEN and your subdomain in the URL',
    note: 'Zendesk’s MCP server is still early-access, so we call the REST API (search, get, stats) through the same proxy.',
  },
}

/** Zendesk REST tools — what a live Zendesk connection exposes. */
export const ZENDESK_TOOLS = ['search_tickets', 'get_ticket', 'ticket_stats'] as const

/** Honesty stamp — every connection tool result is prefixed with its data source. */
export function stampToolResult(source: 'LIVE' | 'MOCK', connectionId: string, body: string): string {
  return `[${source} · ${connectionId}] ${body}`
}

// ── Persistence (localStorage, BYOK — see note on LiveConnectionConfig.token) ─

export const LIVE_CONNECTIONS_KEY = 'om-live-connections'

export function loadLiveConnections(): LiveConnectionConfig[] {
  try {
    const raw = localStorage.getItem(LIVE_CONNECTIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((c): c is LiveConnectionConfig =>
      !!c && typeof c === 'object' && typeof (c as LiveConnectionConfig).connectionId === 'string')
  } catch {
    return []
  }
}

export function saveLiveConnections(configs: LiveConnectionConfig[]): void {
  try {
    localStorage.setItem(LIVE_CONNECTIONS_KEY, JSON.stringify(configs))
  } catch {
    /* storage unavailable (private mode, quota) — configs stay in memory */
  }
}

/** Insert or replace one config, persist, and return the full list. */
export function upsertLiveConnection(cfg: LiveConnectionConfig): LiveConnectionConfig[] {
  const all = loadLiveConnections().filter((c) => c.connectionId !== cfg.connectionId)
  all.push(cfg)
  saveLiveConnections(all)
  return all
}

export function removeLiveConnection(connectionId: string): LiveConnectionConfig[] {
  const all = loadLiveConnections().filter((c) => c.connectionId !== connectionId)
  saveLiveConnections(all)
  return all
}

// ── Zendesk REST helpers (MCP server still EAP → REST through the proxy) ────

function zendeskBase(cfg: LiveConnectionConfig): string {
  const url = (cfg.serverUrl ?? '').replace(/\/+$/, '')
  if (!url) throw new Error('Zendesk base URL missing (https://{subdomain}.zendesk.com)')
  return url
}

function zendeskHeaders(cfg: LiveConnectionConfig): Record<string, string> {
  // Zendesk basic auth: base64("email/token:api_token") — the token field holds
  // the whole "email/token:api_token" string.
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

function fmtTicket(t: ZendeskTicket): string {
  const bits = [`#${t.id ?? '?'} "${t.subject ?? '(no subject)'}" — ${t.status ?? '?'}`]
  if (t.priority) bits[0] += ` (${t.priority})`
  return `• ${bits[0]}`
}

/** Zendesk as three agent tools: search the queue, read one ticket, queue stats. */
export async function zendeskTool(
  cfg: LiveConnectionConfig,
  tool: (typeof ZENDESK_TOOLS)[number],
  input: string,
): Promise<string> {
  if (tool === 'search_tickets') {
    const q = encodeURIComponent(`type:ticket ${input}`.trim())
    const data = (await zendeskGet(cfg, `/api/v2/search.json?query=${q}`)) as { results?: ZendeskTicket[] }
    const tickets = (data.results ?? []).slice(0, 5)
    return tickets.length
      ? tickets.map(fmtTicket).join('\n')
      : `No tickets matching "${input}".`
  }
  if (tool === 'get_ticket') {
    const id = input.match(/\d+/)?.[0]
    if (!id) return 'No ticket number found in the input — give me something like "ticket 3381".'
    const data = (await zendeskGet(cfg, `/api/v2/tickets/${id}.json`)) as { ticket?: ZendeskTicket }
    const t = data.ticket
    if (!t) return `Ticket #${id} not found.`
    const desc = (t.description ?? '').replace(/\s+/g, ' ').slice(0, 240)
    return `${fmtTicket(t)}${desc ? `\n${desc}` : ''}`
  }
  // ticket_stats
  const data = (await zendeskGet(cfg, '/api/v2/tickets/count.json')) as { count?: { value?: number; refreshed_at?: string } }
  const value = data.count?.value
  return value === undefined
    ? 'Ticket count unavailable.'
    : `≈${value} tickets in the queue (count refreshed ${data.count?.refreshed_at ?? 'recently'}).`
}

// ── Probing & tool resolution ────────────────────────────────────────────────

function serverSpecFor(cfg: LiveConnectionConfig): McpServerSpec {
  const preset = MCP_PRESETS[cfg.connectionId]
  const url = cfg.serverUrl ?? preset?.serverUrl
  if (!url) throw new Error(`No server URL for ${cfg.connectionId} — aggregator connections need one pasted in.`)
  return { id: cfg.connectionId, url, authHeader: preset?.auth === 'none' ? 'none' : 'bearer' }
}

/**
 * Test a configured connection end-to-end and return the updated config.
 * MCP: initialize + tools/list (captures the real tool names).
 * Zendesk REST: GET /api/v2/users/me.json as an auth ping.
 * Mock: nothing to test — always "mock".
 */
export async function probeConnection(cfg: LiveConnectionConfig): Promise<LiveConnectionConfig> {
  if (cfg.mode === 'mock') return { ...cfg, status: 'mock', lastError: undefined }
  try {
    if (cfg.mode === 'rest') {
      await zendeskGet(cfg, '/api/v2/users/me.json')
      return { ...cfg, status: 'live', toolNames: [...ZENDESK_TOOLS], lastError: undefined }
    }
    const tools = await listServerTools(serverSpecFor(cfg), cfg.token)
    return { ...cfg, status: 'live', tools, toolNames: tools.map((t) => t.name), lastError: undefined }
  } catch (err) {
    return { ...cfg, status: 'error', lastError: err instanceof Error ? err.message : String(err) }
  }
}

/** Argument names that conventionally carry a free-text query. */
const QUERY_HINTS = [
  'query', 'q', 'search', 'searchquery', 'keywords', 'prompt', 'text',
  'input', 'name', 'title', 'path', 'url', 'message', 'body', 'content',
]

export interface SchemaArgs {
  args: Record<string, unknown>
  /** Required properties nothing could fill — a call sent anyway would just 400. */
  missing: string[]
}

/**
 * Map a free-text tool input onto the MCP tool's declared input schema.
 * Reports what it could not fill rather than shipping a half-built call:
 * `{query: <raw text>}` against a tool wanting `{owner, repo, query}` fails
 * upstream in a way that reads like the tool having no results.
 */
export function argsFromSchema(schema: unknown, input: string): SchemaArgs {
  const s = schema as
    | { properties?: Record<string, { type?: string }>; required?: string[] }
    | undefined
  const props = s?.properties
  if (!props || !Object.keys(props).length) {
    return { args: input ? { query: input } : {}, missing: [] }
  }

  const required = s?.required ?? []
  const stringProps = Object.entries(props)
    .filter(([, v]) => v?.type === 'string' || v?.type === undefined)
    .map(([k]) => k)
  const requiredStrings = required.filter((r) => stringProps.includes(r))
  const byHint = (names: string[]) => names.find((n) => QUERY_HINTS.includes(n.toLowerCase()))
  const target = byHint(requiredStrings) ?? requiredStrings[0] ?? byHint(stringProps) ?? stringProps[0]

  const args: Record<string, unknown> = {}
  if (target && input) args[target] = input
  return { args, missing: required.filter((r) => !(r in args)) }
}

/**
 * Pick the live tool best matching the input, scoring name and description.
 * Returns undefined when nothing matches at all — "no appropriate tool" is a
 * real outcome, not a reason to fire the alphabetically luckiest candidate.
 */
export function pickTool(tools: McpToolInfo[], input: string): McpToolInfo | undefined {
  if (!tools.length) return undefined
  // One advertised tool is not a choice — routing to the server *is* the pick.
  // Selection only needs evidence when there are candidates to choose between.
  if (tools.length === 1) return tools[0]
  const words = input.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  if (!words.length) return undefined

  const scored = tools.map((tool) => {
    const name = tool.name.toLowerCase()
    const desc = (tool.description ?? '').toLowerCase()
    let score = 0
    let matched = 0
    for (const w of words) {
      if (name.includes(w)) { score += 2; matched++ }
      else if (desc.includes(w)) { score += 1; matched++ }
    }
    if (/search|list|find|get|read/.test(name)) score += 0.5
    if (!argsFromSchema(tool.inputSchema, input).missing.length) score += 0.5
    return { tool, score, matched }
  })

  const viable = scored.filter((s) => s.matched > 0).sort((a, b) => b.score - a.score)
  return viable[0]?.tool
}

/**
 * MCP tools that change or destroy remote state. A server advertises whatever
 * it likes — `delete_repo`, `merge_pull_request`, `send_message` — and nothing
 * in the protocol marks which are destructive, so the name and description are
 * the only signal available. Matching here is deliberately eager: a false
 * positive costs one confirmation tap, a false negative costs a repository.
 */
const MCP_WRITE_RE =
  /\b(delete|remove|destroy|drop|purge|erase|create|add|update|edit|write|put|patch|post|set|send|publish|merge|close|archive|transfer|revoke|grant|invite|assign|move|rename|upload|deploy|trigger|run|execute|cancel|approve|reject|pay|charge|refund)\b/i

/** Read-only verbs that would otherwise trip the write matcher (get_run, list_deployments). */
const MCP_READ_RE = /^(get|list|search|find|read|fetch|query|describe|show|view|count|check)[_\-.\s]/i

/**
 * Confirmation hook for live MCP writes. Mirrors setCrewToolGuard so the app
 * can reuse one approval sheet for both. Unset means allow — the guard is the
 * UI's job to install, and headless callers opt out by leaving it unset.
 */
let mcpGuard: ((connectionId: string, summary: string) => Promise<boolean>) | undefined

export function setMcpToolGuard(
  guard?: (connectionId: string, summary: string) => Promise<boolean>,
): void {
  mcpGuard = guard
}

export function isMcpWriteTool(tool: McpToolInfo): boolean {
  if (MCP_READ_RE.test(tool.name)) return false
  return MCP_WRITE_RE.test(normalizeToolName(tool.name)) || MCP_WRITE_RE.test(tool.description ?? '')
}

/**
 * Tool names are snake_case, and `_` is a word character — so `\bdelete\b`
 * does NOT match `delete_repo`. Separators become spaces before matching, or
 * every destructive snake_case tool would score as safe.
 */
function normalizeToolName(name: string): string {
  return name.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** Persisted configs predate schema retention — degrade to name-only entries. */
function mcpToolsFor(cfg: LiveConnectionConfig): McpToolInfo[] {
  if (cfg.tools?.length) return cfg.tools
  return (cfg.toolNames ?? []).map((name) => ({ name }))
}

function normalizeConfigs(
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
): Record<string, LiveConnectionConfig> {
  if (!configs) return {}
  if (Array.isArray(configs)) return Object.fromEntries(configs.map((c) => [c.connectionId, c]))
  return configs
}

/**
 * The tools an employee's connections expose, given the configured live
 * connections. Live config (status 'live') → real MCP/REST tools plus a
 * plain-id dispatcher, all stamped [LIVE · id]. Anything else → the canned
 * mock dataset, stamped [MOCK · id].
 */
export function resolveConnectionTools(
  employee: Employee,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
): ToolSpec[] {
  const byId = normalizeConfigs(configs)
  const out: ToolSpec[] = []
  for (const id of employee.connections ?? []) {
    const conn = CONNECTIONS[id]
    if (!conn) continue
    const cfg = byId[id]

    if (cfg && cfg.status === 'live' && cfg.mode === 'rest' && id === 'zendesk') {
      for (const tool of ZENDESK_TOOLS) {
        out.push({
          id: `zendesk__${tool}`,
          name: `Zendesk: ${tool.replace(/_/g, ' ')}`,
          desc: `LIVE Zendesk ${tool.replace(/_/g, ' ')} — real support queue data`,
          run: async (input: string) => {
            try {
              return stampToolResult('LIVE', id, await zendeskTool(cfg, tool, input))
            } catch (err) {
              return stampToolResult('LIVE', id, `error: ${err instanceof Error ? err.message : String(err)}`)
            }
          },
        })
      }
      out.push({
        id,
        name: conn.name,
        desc: 'LIVE Zendesk support queue — searches real tickets',
        run: async (input: string) => {
          try {
            return stampToolResult('LIVE', id, await zendeskTool(cfg, 'search_tickets', input))
          } catch (err) {
            return stampToolResult('LIVE', id, `error: ${err instanceof Error ? err.message : String(err)}`)
          }
        },
      })
      continue
    }

    if (cfg && cfg.status === 'live' && cfg.mode === 'mcp' && mcpToolsFor(cfg).length > 0) {
      const server = serverSpecFor(cfg)
      const mcpTools = mcpToolsFor(cfg)

      const callMcp = async (tool: McpToolInfo, input: string): Promise<ToolResult> => {
        // Live MCP calls hit the user's real GitHub / Notion / Linear. Writes
        // wait for the same confirmation that crew-tool writes already do.
        if (isMcpWriteTool(tool)) {
          const summary = `${conn.name}: ${tool.name}${tool.description ? ` — ${tool.description}` : ''}\n${input.slice(0, 200)}`
          const allowed = await (mcpGuard?.(id, summary) ?? Promise.resolve(true))
          if (!allowed) {
            return {
              content: stampToolResult('LIVE', id, `[BLOCKED · ${tool.name}] You declined this action.`),
              error: { kind: 'declined', message: 'user declined the write' },
              source: 'live',
            }
          }
        }
        const { args, missing } = argsFromSchema(tool.inputSchema, input)
        if (missing.length) {
          const detail = `"${tool.name}" needs ${missing.join(', ')} — not derivable from the request`
          return {
            content: stampToolResult('LIVE', id, blockedMessage('capability_unavailable', id, detail)),
            arguments: args,
            error: { kind: 'blocked', message: detail },
            source: 'live',
          }
        }
        try {
          const { text, data } = await callServerToolDetailed(server, tool.name, args, cfg.token)
          return { content: stampToolResult('LIVE', id, text), data, arguments: args, source: 'live' }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: stampToolResult('LIVE', id, `error: ${message}`),
            error: { kind: 'error', message },
            source: 'live',
          }
        }
      }

      for (const tool of mcpTools) {
        out.push({
          id: `${id}__${tool.name}`,
          name: `${conn.name}: ${tool.name}`,
          desc: tool.description
            ? `LIVE ${conn.name} MCP tool "${tool.name}" — ${tool.description}`
            : `LIVE ${conn.name} MCP tool "${tool.name}"`,
          run: (input: string) => callMcp(tool, input),
        })
      }

      // Plain-id dispatcher so keyword routing ("check github") hits live data too.
      out.push({
        id,
        name: conn.name,
        desc: `LIVE ${conn.name} via MCP — ${mcpTools.length} real tools available`,
        run: async (input: string): Promise<ToolResult> => {
          const tool = pickTool(mcpTools, input)
          if (!tool) {
            const detail = `no tool among ${mcpTools.length} advertised matches this request`
            return {
              content: stampToolResult('LIVE', id, blockedMessage('no_matching_tool', id, detail)),
              error: { kind: 'blocked', message: detail },
              source: 'live',
            }
          }
          return callMcp(tool, input)
        },
      })
      continue
    }

    // Nothing live for this connection. Demo mode serves canned data (honestly
    // stamped); strict mode refuses — fake data that judges as success is worse
    // than an outcome that says the capability is missing.
    if (isStrict()) {
      const detail = cfg?.lastError ?? 'no live connection configured'
      out.push({
        id,
        name: conn.name,
        desc: `${conn.name} — not connected (strict mode: no mock substitution)`,
        run: (): ToolResult => ({
          content: blockedMessage('capability_unavailable', id, detail),
          error: { kind: 'blocked', message: detail },
        }),
      })
      continue
    }

    out.push({
      id,
      name: conn.name,
      desc: conn.desc,
      run: (q: string): ToolResult => ({
        content: stampToolResult('MOCK', id, mockLookup(id, q)),
        source: 'mock',
      }),
    })
  }
  return out
}

// ── Plan parsing (live brain output) ─────────────────────────────────────────

/** Default steps per plan. Employees can raise it — see Employee.maxSteps. */
export const MAX_STEPS = 4

/**
 * Hard ceiling on parsing, not policy. How many steps an employee may actually
 * run is decided by the graph from Employee.maxSteps; parsePlan only refuses to
 * build an unbounded list out of a runaway reply.
 */
export const PLAN_PARSE_CEILING = 12

/** Parse "TOOL: <id> | <input>" lines; tolerates noise, drops unknown tools. */
export function parsePlan(text: string, allowedTools: string[], cap = PLAN_PARSE_CEILING): PlanStep[] {
  const steps: PlanStep[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]\s*)?TOOL:\s*([a-z_]+)\s*\|\s*(.+)$/i)
    if (!m) continue
    const tool = m[1].toLowerCase()
    if (!allowedTools.includes(tool)) continue
    steps.push({ tool, input: m[2].trim() })
    if (steps.length >= cap) break
  }
  return steps
}

// ── The LangGraph state ──────────────────────────────────────────────────────

const AgentState = Annotation.Root({
  input: Annotation<string>(),
  plan: Annotation<PlanStep[]>({ reducer: (_a, b) => b, default: () => [] }),
  step: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  observations: Annotation<ToolCall[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  replans: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  trace: Annotation<TraceLine[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})

/**
 * One replan is allowed per run. A plan is capped at MAX_STEPS tools, so this
 * bounds worst-case tool calls at 2×MAX_STEPS — enough to recover from a bad
 * search, cheap enough that a project of a dozen tasks still fits its budget.
 */
export const MAX_REPLANS = 1

export type EvaluationVerdict = 'sufficient' | 'retry' | 'blocked'

export interface Evaluation {
  verdict: EvaluationVerdict
  reason: string
}

/**
 * Outputs that came back technically fine but carry no information. Kept broad
 * on purpose: tools phrase this a dozen ways ("No matching passages found",
 * "0 results", "nothing matched") and a missed phrasing means the graph
 * composes an answer out of nothing.
 */
const EMPTY_RESULT_RE =
  /\b(no\s+(matching|results?|matches|data|records|items|hits|passages)|not\s+found|nothing\s+(found|matched)|returned\s+nothing|empty\s+result|0\s+results)\b/i

/**
 * Decide what a round of tool calls actually achieved. This is the node the
 * graph was missing: without it a search returning "No results found" flowed
 * straight to the responder, which composed an answer anyway.
 */
export function evaluateObservations(observations: ToolCall[]): Evaluation {
  if (!observations.length) return { verdict: 'sufficient', reason: 'no tools were needed' }

  const blocked = observations.filter((o) => o.error?.kind === 'blocked')
  if (blocked.length === observations.length) {
    return { verdict: 'blocked', reason: blocked[0].error?.message ?? 'required capability unavailable' }
  }

  const failed = observations.filter((o) => o.error?.kind === 'error')
  if (failed.length) {
    return { verdict: 'retry', reason: `${failed.length} tool call(s) errored: ${failed[0].error?.message ?? 'unknown'}` }
  }

  // Short is not the same as useless — a calculator answering "42" is a
  // complete result. Only genuinely empty or explicitly no-result output counts.
  const useful = observations.filter(
    (o) => !o.error && o.output.trim().length > 0 && !EMPTY_RESULT_RE.test(o.output),
  )
  if (!useful.length) {
    return { verdict: 'retry', reason: 'every tool returned an empty or no-result response' }
  }

  return { verdict: 'sufficient', reason: `${useful.length} of ${observations.length} calls returned usable output` }
}

/** Annotate the original request with what already failed, for brains without replan(). */
export function replanPrompt(input: string, observations: ToolCall[], reason: string): string {
  const tried = observations
    .map((o) => `- ${o.tool}("${o.input.slice(0, 80)}") → ${o.error ? `ERROR: ${o.error.message}` : o.output.slice(0, 160)}`)
    .join('\n')
  return (
    `${input}\n\n` +
    `PREVIOUS ATTEMPT DID NOT WORK — ${reason}\n` +
    `Already tried:\n${tried}\n` +
    `Plan different tool calls. Do not repeat a call that already failed.`
  )
}

type S = typeof AgentState.State

/** Build (and compile) the StateGraph for one employee + brain. */
export function buildEmployeeGraph(
  brain: AgentBrain,
  employee: Employee,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
) {
  // Built-in tools from the registry + connection tools resolved against the
  // live-connection configs (mock-stamped when nothing live is configured).
  const toolMap: Record<string, ToolSpec> = {}
  for (const id of employee.tools) if (ALL_TOOLS[id]) toolMap[id] = ALL_TOOLS[id]
  for (const t of resolveConnectionTools(employee, configs)) toolMap[t.id] = t
  const tools = Object.values(toolMap)

  const planNode = async (state: S): Promise<Partial<S>> => {
    const plan = (await brain.plan(state.input, tools)).slice(0, employee.maxSteps ?? MAX_STEPS)
    return {
      plan,
      trace: [{
        node: 'plan',
        text: plan.length
          ? `${plan.length} step${plan.length > 1 ? 's' : ''} queued — ${plan.map((p) => p.tool).join(' → ')}`
          : 'no tools needed — answering directly',
      }],
    }
  }

  const actNode = async (state: S): Promise<Partial<S>> => {
    const spec = state.plan[state.step]
    const tool = toolMap[spec.tool] ?? ALL_TOOLS[spec.tool]
    const result: ToolResult = tool
      ? normalizeToolResult(await tool.run(spec.input))
      : { content: `error: unknown tool "${spec.tool}"`, error: { kind: 'error', message: `unknown tool "${spec.tool}"` } }
    const output = result.content
    return {
      step: state.step + 1,
      observations: [{
        tool: spec.tool,
        input: spec.input,
        output,
        arguments: result.arguments,
        data: result.data,
        artifacts: result.artifacts,
        error: result.error,
        source: result.source,
      }],
      trace: [{ node: 'act', text: `${spec.tool}("${spec.input.length > 60 ? spec.input.slice(0, 57) + '…' : spec.input}") → ${output.length > 110 ? output.slice(0, 107) + '…' : output}` }],
    }
  }

  const respondNode = async (state: S): Promise<Partial<S>> => {
    const answer = await brain.respond(state.input, state.observations, employee)
    return {
      answer,
      trace: [{
        node: 'respond',
        text: state.observations.length
          ? `answer composed from ${state.observations.length} observation${state.observations.length > 1 ? 's' : ''}`
          : 'answer composed from the employee prompt',
      }],
    }
  }

  const evaluateNode = async (state: S): Promise<Partial<S>> => {
    const evaluation = evaluateObservations(state.observations)
    // Silent on the happy path — a trace line every run would be noise, and the
    // interesting case is precisely when the evidence was not good enough.
    if (evaluation.verdict === 'sufficient') return {}
    return { trace: [{ node: 'act', text: `evaluate — ${evaluation.verdict}: ${evaluation.reason}` }] }
  }

  const replanNode = async (state: S): Promise<Partial<S>> => {
    const { reason } = evaluateObservations(state.observations)
    const steps = brain.replan
      ? await brain.replan(state.input, state.observations, tools)
      : await brain.plan(replanPrompt(state.input, state.observations, reason), tools)
    const plan = steps.slice(0, employee.maxSteps ?? MAX_STEPS)
    return {
      plan,
      step: 0,
      replans: state.replans + 1,
      trace: [{
        node: 'plan',
        text: plan.length
          ? `replan ${state.replans + 1} — ${plan.map((p) => p.tool).join(' → ')}`
          : 'replan produced no new steps — answering with what we have',
      }],
    }
  }

  // ACT → EVALUATE → (REPLAN | RESPOND). A blocked capability short-circuits to
  // the responder: replanning cannot conjure a connection that is not there.
  const routeAfterEvaluate = (state: S): 'replanner' | 'responder' => {
    const { verdict } = evaluateObservations(state.observations)
    if (verdict === 'retry' && state.replans < MAX_REPLANS) return 'replanner'
    return 'responder'
  }

  return new StateGraph(AgentState)
    .addNode('planner', planNode)
    .addNode('actor', actNode)
    .addNode('evaluator', evaluateNode)
    .addNode('replanner', replanNode)
    .addNode('responder', respondNode)
    .addEdge(START, 'planner')
    .addConditionalEdges('planner', (s) => (s.plan.length ? 'actor' : 'responder'), { actor: 'actor', responder: 'responder' })
    .addConditionalEdges('actor', (s) => (s.step < s.plan.length ? 'actor' : 'evaluator'), { actor: 'actor', evaluator: 'evaluator' })
    .addConditionalEdges('evaluator', routeAfterEvaluate, { replanner: 'replanner', responder: 'responder' })
    .addConditionalEdges('replanner', (s) => (s.plan.length ? 'actor' : 'responder'), { actor: 'actor', responder: 'responder' })
    .addEdge('responder', END)
    .compile()
}

/** Run one employee turn through the graph, streaming trace lines as nodes fire. */
export async function runEmployee(
  brain: AgentBrain,
  employee: Employee,
  input: string,
  onTrace?: (line: TraceLine) => void,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
): Promise<RunResult> {
  const app = buildEmployeeGraph(brain, employee, configs)
  const stream = await app.stream({ input }, { streamMode: 'updates' })
  const trace: TraceLine[] = []
  const toolCalls: ToolCall[] = []
  let plan: PlanStep[] = []
  let answer = ''
  for await (const chunk of stream) {
    for (const update of Object.values(chunk) as Partial<S>[]) {
      if (update.trace) for (const line of update.trace) { trace.push(line); onTrace?.(line) }
      if (update.observations) toolCalls.push(...update.observations)
      if (update.plan) plan = update.plan
      if (update.answer) answer = update.answer
    }
  }
  return { answer, plan, toolCalls, trace }
}

// ── Brain 1: deterministic local simulation (keyless) ────────────────────────

// broad arithmetic span — calc() does the strict validation
const ARITH_RE = /[-\d(][\d\s+\-*/().%]*\d\)*/

// keyword → preferred tool ids, first available wins (one per category)
const CONNECTION_ROUTES: { re: RegExp; ids: string[] }[] = [
  { re: /\b(e-?mails?|inbox|mail)\b/i, ids: ['gmail', 'outlook'] },
  { re: /\b(calendar|meetings?|schedule|agenda|events?)\b/i, ids: ['gcal'] },
  { re: /\b(slack|channels?|mentions?)\b/i, ids: ['slack'] },
  { re: /\b(github|pull requests?|prs?|commits?|merge)\b/i, ids: ['github'] },
  { re: /\blinear\b/i, ids: ['linear'] },
  { re: /\bjira\b/i, ids: ['jira'] },
  { re: /\b(tickets?|queue)\b/i, ids: ['zendesk', 'jira'] },
  { re: /\b(deals?|crm|leads?|pipeline|contacts?)\b/i, ids: ['hubspot'] },
  { re: /\b(notion|wiki|pages?)\b/i, ids: ['notion'] },
  { re: /\b(drive|files?|folders?|spreadsheets?|docs?)\b/i, ids: ['gdrive', 'notion'] },
]

export function simulatedBrain(): AgentBrain {
  return {
    plan: async (input, tools) => {
      const user = stripWorkspacePrompt(input)
      if (user.length < 120 && /^(hi|hello|hey|yo|thanks|thank you|ok|okay)\b[!.?\s]*$/i.test(user.trim())) {
        return []
      }
      const has = (id: string) => tools.some((t) => t.id === id)
      const steps: PlanStep[] = []
      const push = (tool: string, toolInput: string) => {
        if (!steps.some((s) => s.tool === tool)) steps.push({ tool, input: toolInput })
      }
      const math = input.match(ARITH_RE)
      if (math && /[+\-*/%]/.test(math[0]) && has('calculator')) push('calculator', math[0].trim())
      if (/\b(code|bug|refactor|function|script|typescript|javascript|python|review this)\b/i.test(input) && has('code_review'))
        push('code_review', input)
      if (/\b(https?:\/\/[^\s]+)\b/i.test(input) && has('browse_url')) {
        const url = input.match(/https?:\/\/[^\s]+/i)?.[0] ?? input
        push('browse_url', url)
      }
      if (/\b(search the web|look up|latest|trends?|research|who is|what is happening)\b/i.test(input) && has('web_search'))
        push('web_search', input)
      if (/\b(run this|execute|sandbox|python -c)\b/i.test(input) && has('run_code'))
        push('run_code', input)
      const writeJson = user.match(/\{\s*"path"\s*:\s*"[\s\S]*"content"\s*:/) ? user.match(/\{[\s\S]*\}/)?.[0] : undefined
      if (has('github_write_file') && (/github_write_file|Coding space: GitHub/i.test(input) || /\b(commit|write files?)\b/i.test(user)))
        push('github_write_file', writeJson ?? user)
      if (has('github_create_branch') && /github_create_branch|feature branch from main/i.test(user))
        push('github_create_branch', user)
      if (has('github_open_pr') && /github_open_pr|\bopen a (pr|pull request)\b/i.test(user))
        push('github_open_pr', user)
      if (has('slack_post') && /slack_post|\b(slack|post to (the )?channel)\b/i.test(input))
        push('slack_post', input)
      if (has('gmail_send') && /gmail_send|\b(send (an? )?e-?mail|email .+@)\b/i.test(input))
        push('gmail_send', input)
      if (has('gmail_list') && /gmail_list|\b(inbox|unread|e-?mails?|triage (the )?mail)\b/i.test(input))
        push('gmail_list', input)
      if (has('gmail_read') && /gmail_read/.test(input))
        push('gmail_read', input)
      if (has('web_act') && /web_act|\b(click|fill (the |this )?form|hosted chrome|do this on the (web|site)|complete (this|the) (web )?task)\b/i.test(input))
        push('web_act', input)
      if (has('business_plan') && /business_plan|\b(structure (the |our )?business|business plan|offer and price)\b/i.test(input))
        push('business_plan', input)
      if (has('gdrive_list') && /gdrive_list|\b(google drive|list (my )?files)\b/i.test(input))
        push('gdrive_list', input)
      if (has('memory_save') && /\b(remember (that|this)|save this (note|fact)|don'?t forget)\b/i.test(input))
        push('memory_save', stripWorkspacePrompt(input))
      if (has('memory_search') && /\b(what do you (know|remember)|recall|you said)\b/i.test(input))
        push('memory_search', stripWorkspacePrompt(input))
      for (const { re, ids } of CONNECTION_ROUTES) {
        if (steps.length >= 3) break
        if (ids.includes('github') && steps.some((s) => s.tool.startsWith('github_'))) continue
        const hit = ids.find(has)
        if (hit && re.test(user)) push(hit, user)
      }
      if (/summar|tl;dr|shorten|condense|key points/i.test(input) && has('summarize'))
        push('summarize', input)
      if (/sentiment|feeling|feels|opinion|feedback|happy|angry|upset|satisfied/i.test(input) && has('sentiment'))
        push('sentiment', input)
      if (steps.length === 0 && has('search_docs') && /\?|widget|price|pricing|cost|key|embed|install|provider|refund|pro plan|capabilit/i.test(user))
        push('search_docs', user)
      return steps.slice(0, 3)
    },
    respond: async (input, observations, employee) => {
      const user = stripWorkspacePrompt(input)
      if (employee.role === 'Crew lead') {
        const board = input.includes('Crew notes') ? input.split('Crew notes')[1] ?? input : input
        const toolLines = observations.map((o) => `• ${toolName(o.tool)}: ${o.output}`)
        const names = [...board.matchAll(/### ([^\n(]+)/g)].map((m) => m[1].trim())
        const who = names.length ? names.join(', ') : 'the crew'
        return (
          `Merged answer from ${who}:\n\n${board.trim().slice(0, 2400)}\n\n` +
          (toolLines.length ? `${toolLines.join('\n')}\n\n` : '') +
          `(Simulated — add your model key for a polished single voice.)`
        )
      }
      if (observations.length === 0) {
        if (/^(hi|hello|hey|yo)\b/i.test(user.trim())) return 'Hi! How can I help you today?'
        if (/^(thanks|thank you)\b/i.test(user.trim())) return 'You’re welcome — anything else?'
        return user.slice(0, 2000)
      }
      const lines = observations.map((o) => `• ${toolName(o.tool)}: ${o.output}`)
      return `${lines.join('\n')}`
    },
  }
}

// ── Brain 2: browser-direct OpenAI-compatible provider ───────────────────────

export interface LiveProvider {
  baseUrl: string // e.g. https://api.moonshot.ai/v1
  model: string
  key: string
}

export interface LiveProviderSpec {
  id: string
  name: string
  baseUrl: string
  model: string
  /** true when the model pins sampling params (e.g. kimi-k3) — don't send temperature */
  fixedParams?: boolean
  /** false for keyless local providers (e.g. Ollama) */
  keyRequired?: boolean
  keyUrl: string
}

export const LIVE_PROVIDERS: readonly LiveProviderSpec[] = [
  { id: 'kimi', name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', fixedParams: true, keyUrl: 'platform.moonshot.ai → API Keys' },
  { id: 'kimi-cn', name: 'Kimi (Moonshot · CN)', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', fixedParams: true, keyUrl: 'platform.moonshot.cn → API Keys' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'platform.openai.com/api-keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2.5', keyUrl: 'openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', keyUrl: 'console.groq.com/keys' },
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyRequired: false, keyUrl: 'no key needed — local' },
]

export async function chatComplete(
  p: LiveProvider & { fixedParams?: boolean },
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // kimi-k3 pins temperature/top-p — only send sampling params when allowed
      ...(p.fixedParams ? {} : { temperature: 0.4 }),
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text().then((t) => t.slice(0, 140))}`)
  const data = await res.json()
  recordUsage(data?.usage)
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Token accounting ─────────────────────────────────────────────────────────
// OpenAI-compatible providers return a `usage` block. Collecting it here means
// budgets are charged against tokens the provider actually billed, instead of
// a character-count guess. Providers that omit usage leave the counter at zero
// and the caller falls back to estimating — which it can then say plainly.

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** False when no provider in this window reported usage. */
  measured: boolean
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, measured: false }
let usageAccumulator: TokenUsage = { ...ZERO_USAGE }

function recordUsage(usage: unknown): void {
  const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
  if (!u || typeof u !== 'object') return
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0
  const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0
  const total = typeof u.total_tokens === 'number' ? u.total_tokens : prompt + completion
  if (!prompt && !completion && !total) return
  usageAccumulator = {
    promptTokens: usageAccumulator.promptTokens + prompt,
    completionTokens: usageAccumulator.completionTokens + completion,
    totalTokens: usageAccumulator.totalTokens + total,
    measured: true,
  }
}

/** Read the tokens billed since the last reset, then start a fresh window. */
export function takeTokenUsage(): TokenUsage {
  const taken = usageAccumulator
  usageAccumulator = { ...ZERO_USAGE }
  return taken
}

export function resetTokenUsage(): void {
  usageAccumulator = { ...ZERO_USAGE }
}

export function liveBrain(provider: LiveProvider & { fixedParams?: boolean }): AgentBrain {
  return {
    plan: async (input, tools) => {
      if (tools.length === 0) return []
      const system =
        'You are the planning node of a LangGraph agent. Reply ONLY with up to 3 lines in the exact format ' +
        '"TOOL: <id> | <input to the tool>". If no tool is needed, reply "NONE".\nAvailable tools:\n' +
        tools.map((t) => `- ${t.id}: ${t.desc}`).join('\n')
      const raw = await chatComplete(provider, system, input)
      return parsePlan(raw, tools.map((t) => t.id))
    },
    respond: async (input, observations, employee) => {
      const system =
        `You are ${employee.name}, ${employee.role}. Follow these instructions from your owner exactly: "${employee.prompt}". ` +
        'Answer in character, concisely, using any tool observations provided.'
      const user = observations.length
        ? `Request: ${input}\n\nTool observations:\n${observations.map((o) => `- ${o.tool}: ${o.output}`).join('\n')}`
        : input
      return chatComplete(provider, system, user)
    },
  }
}
