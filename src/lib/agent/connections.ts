import type { AgentTool } from './types'
import { TOOL_REGISTRY } from './tools'

export interface Connection {
  id: string
  name: string
  desc: string
  category: 'email' | 'calendar' | 'docs' | 'chat' | 'code' | 'tickets' | 'crm' | 'notes' | 'automation' | 'agents'
  /** Transports this marketplace plugin can use. */
  transports: ('mcp' | 'rest' | 'webhook')[]
  featured?: boolean
  badge?: string
  docsUrl?: string
}

/**
 * Versioned plugin manifests for the connection marketplace. A manifest is
 * public metadata only; tenant URLs and credentials live in LiveConnectionConfig.
 */
export const PLUGIN_CATALOG: Record<string, Connection> = {
  n8n: {
    id: 'n8n',
    name: 'n8n',
    desc: 'Run and manage automations through MCP or a workflow webhook',
    category: 'automation',
    transports: ['mcp', 'webhook'],
    featured: true,
    badge: 'First-class',
    docsUrl: 'https://docs.n8n.io/connect/connect-to-n8n-mcp-server',
  },
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    desc: 'Delegate work to an OpenClaw agent through its secure webhook gateway',
    category: 'agents',
    transports: ['webhook'],
    featured: true,
    badge: 'First-class',
    docsUrl: 'https://github.com/openclaw/openclaw/blob/main/docs/automation/webhook.md',
  },
  gmail: { id: 'gmail', name: 'Gmail', desc: 'Read and triage the inbox', category: 'email', transports: ['mcp'] },
  outlook: { id: 'outlook', name: 'Outlook', desc: 'Read and triage the inbox', category: 'email', transports: ['mcp'] },
  gcal: { id: 'gcal', name: 'Google Calendar', desc: 'Check schedule and meetings', category: 'calendar', transports: ['mcp'] },
  gdrive: { id: 'gdrive', name: 'Google Drive', desc: 'Find files and documents', category: 'docs', transports: ['mcp'] },
  notion: { id: 'notion', name: 'Notion', desc: 'Search workspace pages', category: 'notes', transports: ['mcp'] },
  slack: { id: 'slack', name: 'Slack', desc: 'Read channels and mentions', category: 'chat', transports: ['mcp'] },
  github: { id: 'github', name: 'GitHub', desc: 'Issues, PRs and reviews', category: 'code', transports: ['mcp'] },
  linear: { id: 'linear', name: 'Linear', desc: 'Track issues and cycles', category: 'tickets', transports: ['mcp'] },
  jira: { id: 'jira', name: 'Jira', desc: 'Track tickets and sprints', category: 'tickets', transports: ['mcp'] },
  zendesk: { id: 'zendesk', name: 'Zendesk', desc: 'Support ticket queue', category: 'tickets', transports: ['rest'] },
  hubspot: { id: 'hubspot', name: 'HubSpot', desc: 'Deals, contacts and CRM', category: 'crm', transports: ['mcp'] },
}

/** Backwards-compatible name consumed by staffing and the graph runtime. */
export const CONNECTIONS = PLUGIN_CATALOG

export const CONNECTION_IDS = Object.keys(CONNECTIONS)

// Canned-but-plausible datasets used only when a connection is visibly MOCK.
export const MOCK: Record<string, string[]> = {
  n8n: [
    'Workflow "Qualify inbound lead" — active, last run succeeded 8 minutes ago.',
    'Workflow "Daily support digest" — active, scheduled for 17:00 UTC.',
    'Workflow "Sync CRM contacts" — paused after an authentication error.',
  ],
  openclaw: [
    'Agent "operations" — ready to accept delegated tasks.',
    'Agent "research" — last run completed with 4 cited sources.',
    'Agent "release-manager" — waiting for deployment approval.',
  ],
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

export const ALL_TOOLS: Record<string, AgentTool> = { ...TOOL_REGISTRY, ...CONNECTION_TOOLS }

export function toolName(id: string): string {
  return ALL_TOOLS[id]?.name ?? id
}
