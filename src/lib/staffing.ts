// ── Staffing office — one prompt in, a whole team out ───────────────────────
// Deterministic, keyless generator: parses a natural-language hiring request
// into N fully-formed Employees (name, role, prompt, tools, connections).

import type { Employee } from './agent'

export interface ProvisionStage {
  stage: 'parsing' | 'headcount' | 'role' | 'prompt' | 'tools' | 'connections' | 'hired'
  detail: string
  employeeId?: string
}

interface RoleSpec {
  keys: RegExp
  role: string
  promptBase: string
  tools: string[]
  connections: string[]
}

const ROLE_SPECS: RoleSpec[] = [
  {
    keys: /support|help ?desk|customer (care|service)|ticket/i,
    role: 'Support Agent',
    promptBase: 'Answer strictly from the knowledge base, cite what the docs say, and escalate when urgency is high.',
    tools: ['search_docs', 'summarize'],
    connections: ['zendesk', 'gmail'],
  },
  {
    keys: /cod(e|ing)|develop|engineer|programm|software|bug ?fix|review/i,
    role: 'Code Copilot',
    promptBase: 'Review code for bugs, smells and security risks. When the workspace is GitHub, commit with github_write_file instead of dumping fake files in chat.',
    tools: ['code_review', 'calculator', 'run_code', 'github_write_file', 'github_create_branch', 'github_open_pr'],
    connections: ['github', 'linear'],
  },
  {
    keys: /data|analyst|analytics|metrics|numbers|finance|account/i,
    role: 'Data Analyst',
    promptBase: 'Do the math, show your work, and turn numbers into decisions without fluff.',
    tools: ['calculator', 'summarize'],
    connections: ['gdrive'],
  },
  {
    keys: /research|librarian|knowledge|wiki/i,
    role: 'Researcher',
    promptBase: 'Find evidence, cite sources, and compress findings into tight briefs. Prefer the research dossier URLs over invented links.',
    tools: ['search_docs', 'summarize', 'web_search', 'browse_url', 'memory_search'],
    connections: ['notion', 'gdrive'],
  },
  {
    keys: /writ|content|copy|marketing|social|blog|newsletter/i,
    role: 'Content Writer',
    promptBase: 'Write on-brand copy — short, vivid, no filler. Repurpose long material into posts.',
    tools: ['summarize', 'web_search'],
    connections: ['notion'],
  },
  {
    keys: /sales|crm|deal|lead|pipeline|outreach/i,
    role: 'Sales Assistant',
    promptBase: 'Track deals, draft follow-ups, and keep the pipeline moving. Never let a lead go cold.',
    tools: ['summarize'],
    connections: ['hubspot', 'gmail'],
  },
  {
    keys: /voc|feedback|sentiment|review|churn/i,
    role: 'VoC Specialist',
    promptBase: 'Gauge tone and urgency in customer feedback and flag whatever needs escalation.',
    tools: ['sentiment', 'summarize'],
    connections: ['zendesk', 'slack'],
  },
  {
    keys: /hr|onboard|recruit|people ops|hiring/i,
    role: 'People Ops',
    promptBase: 'Guide new hires through week one, answer policy questions, and keep check-ins on the calendar.',
    tools: ['search_docs', 'summarize'],
    connections: ['gcal', 'gmail'],
  },
  {
    keys: /assistant|secretary|admin|schedul|inbox|calendar|email/i,
    role: 'Executive Assistant',
    promptBase: 'Triage the inbox, watch the calendar, and draft crisp replies for sign-off.',
    tools: ['summarize', 'search_docs', 'gmail_list', 'gmail_read', 'gmail_send'],
    connections: ['gmail', 'gcal', 'slack'],
  },
  {
    keys: /translat|locali[sz]|i18n|multilingual/i,
    role: 'Translator',
    promptBase: 'Translate faithfully and keep the tone of the original — no flattening.',
    tools: ['summarize'],
    connections: [],
  },
]

const GENERALIST: RoleSpec = {
  keys: /.*/,
  role: 'Generalist',
  promptBase: 'Help with whatever the owner asks, using the tools on your desk.',
  tools: ['search_docs', 'summarize', 'web_search'],
  connections: ['gmail'],
}

const NAME_POOL = [
  'Priya', 'Kofi', 'Rex', 'Nadia', 'Sven', 'Mika', 'June', 'Theo',
  'Ada', 'Omar', 'Lena', 'Ravi', 'Zoe', 'Felix', 'Ines', 'Dmitri',
]

const ACCENT_POOL = ['#ff4d00', '#0e7490', '#7c3aed', '#15803d', '#17140f', '#b91c1c']

// prompt-mentioned extras get unioned into every hire's connections
const CONNECTION_HINTS: { re: RegExp; id: string }[] = [
  { re: /\b(gmail|e-?mails?|inbox)\b/i, id: 'gmail' },
  { re: /\boutlook\b/i, id: 'outlook' },
  { re: /\b(calendar|gcal|meetings?)\b/i, id: 'gcal' },
  { re: /\b(drive|gdrive|google docs?)\b/i, id: 'gdrive' },
  { re: /\bnotion\b/i, id: 'notion' },
  { re: /\bslack\b/i, id: 'slack' },
  { re: /\b(github|git)\b/i, id: 'github' },
  { re: /\blinear\b/i, id: 'linear' },
  { re: /\bjira\b/i, id: 'jira' },
  { re: /\bzendesk\b/i, id: 'zendesk' },
  { re: /\b(hubspot|crm|salesforce)\b/i, id: 'hubspot' },
]

export const MAX_HIRES = 6

/** "a team of 3", "two support agents", "a few people", "a coder" → headcount */
export function detectHeadcount(prompt: string): number {
  const num = prompt.match(/(\d+)\s*(?:\w+\s){0,2}?(?:people|employees|staff|agents|roles|of them|new hires)/i)
    ?? prompt.match(/team of (\d+)/i)
  if (num) return Math.min(Math.max(parseInt(num[1], 10), 1), MAX_HIRES)
  const wordNum = prompt.match(/\b(a couple|two|three|four|five|six)\s*(?:people|employees|staff|agents|roles|new hires)?/i)
  if (wordNum) {
    const map: Record<string, number> = { 'a couple': 2, two: 2, three: 3, four: 4, five: 5, six: 6 }
    const n = map[wordNum[1].toLowerCase()]
    if (n && (wordNum[2] || /\b(couple|two|three|four|five|six)\s+\w/i.test(prompt))) return Math.min(n, MAX_HIRES)
  }
  if (/\ba few\b/i.test(prompt)) return 3
  if (/\bseveral\b/i.test(prompt)) return 4
  if (/\b(team|staff|department|workforce|crew)\b/i.test(prompt)) return 3
  return 1
}

/** Which roles the prompt asks for, in order of first mention. */
export function detectRoles(prompt: string): RoleSpec[] {
  const hits = ROLE_SPECS
    .map((spec) => ({ spec, at: prompt.search(spec.keys) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at)
  return hits.map((h) => h.spec)
}

export function detectConnections(prompt: string): string[] {
  return CONNECTION_HINTS.filter((h) => h.re.test(prompt)).map((h) => h.id)
}

/** Generate the full team from one hiring prompt. Deterministic for a given prompt. */
export function generateStaff(prompt: string, seedOffset = 0): Employee[] {
  const headcount = detectHeadcount(prompt)
  const roles = detectRoles(prompt)
  const extras = detectConnections(prompt)
  const hires: Employee[] = []

  for (let i = 0; i < headcount; i++) {
    const spec = roles[i] ?? (roles.length === 0 && i === 0 ? GENERALIST : roles[i % Math.max(roles.length, 1)] ?? GENERALIST)
    const name = NAME_POOL[(seedOffset + i) % NAME_POOL.length]
    const connections = [...new Set([...spec.connections, ...extras])].slice(0, 4)
    hires.push({
      id: `staff-${Date.now()}-${i}`,
      name,
      role: spec.role,
      prompt:
        `You are ${name}, the company's ${spec.role.toLowerCase()}. ${spec.promptBase} ` +
        `The owner hired you with these words: "${prompt.trim()}" — honor them.`,
      tools: [...new Set(spec.tools)],
      connections,
      accent: ACCENT_POOL[(seedOffset + i) % ACCENT_POOL.length],
      tagline: `Hired via one prompt`,
    })
  }
  return hires
}

/** The staged provisioning script the UI plays back so people watch the team form. */
export function provisionPlan(prompt: string, hires: Employee[]): ProvisionStage[] {
  const stages: ProvisionStage[] = [
    { stage: 'parsing', detail: `reading the brief — "${prompt.trim().slice(0, 80)}${prompt.trim().length > 80 ? '…' : ''}"` },
    { stage: 'headcount', detail: `${hires.length} hire${hires.length > 1 ? 's' : ''} planned` },
  ]
  for (const e of hires) {
    stages.push(
      { stage: 'role', detail: `${e.name} — ${e.role}`, employeeId: e.id },
      { stage: 'prompt', detail: 'job description written', employeeId: e.id },
      { stage: 'tools', detail: e.tools.join(' · ') || 'no desk tools', employeeId: e.id },
      { stage: 'connections', detail: e.connections?.join(' · ') || 'no app connections', employeeId: e.id },
      { stage: 'hired', detail: `${e.name} signed ✓`, employeeId: e.id },
    )
  }
  return stages
}
