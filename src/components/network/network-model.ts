// ── Public /employees — network graph model ─────────────────────────────────
// Pure helpers for the animated employee network: the curated demo team, the
// responsive layout math, edge choreography, packet captions and the ambient
// "working" status lines. No DOM access — everything here is unit-testable.

import { CONNECTIONS, type Employee } from '@/lib/agent'

// Node card footprint (px). The layout keeps cards inside the panel using these.
export const NODE_W = 168
export const NODE_H = 118

export interface NetPoint {
  x: number
  y: number
}

export interface NetEdge {
  from: number
  to: number
}

export interface SatelliteSpec {
  angle: number
  dx: number
  dy: number
}

/** Deterministic pseudo-random in [0, 1) — stable layout, stable tests. */
export function seeded(index: number, salt = 0): number {
  const v = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return v - Math.floor(v)
}

// ── Demo team ────────────────────────────────────────────────────────────────
// What visitors see before they prompt: four employees at work, each wired to
// the services their role touches. Mirrors the dashboard preset roster's shape.

export const DEMO_TEAM: Employee[] = [
  {
    id: 'demo-mara',
    name: 'Mara',
    role: 'Support Lead',
    prompt:
      'You are Mara, the support lead. Triage the Zendesk queue, answer strictly from the knowledge base and cite what the docs say. Escalate refunds and churn signals to a human. Keep every reply warm, short and honest about what you do not know.',
    tools: ['search_docs', 'summarize'],
    connections: ['zendesk', 'gmail'],
    accent: '#ff4d00',
    tagline: 'Deflects tickets with cited answers',
  },
  {
    id: 'demo-rex',
    name: 'Rex',
    role: 'Code Copilot',
    prompt:
      'You are Rex, the resident code copilot. Watch GitHub for new PRs, review them for bugs, smells and security risks, and file precise Linear issues for anything that needs a human. Explain trade-offs, never guess at intent.',
    tools: ['code_review', 'calculator'],
    connections: ['github', 'linear'],
    accent: '#15803d',
    tagline: 'Ships reviewed, safe code',
  },
  {
    id: 'demo-theo',
    name: 'Theo',
    role: 'Data Analyst',
    prompt:
      'You are Theo, a precise data analyst. Pull the numbers from Drive, do the math, show your work and skip the fluff. File every finding as a dated Notion page so the team can audit how you got there.',
    tools: ['calculator', 'summarize'],
    connections: ['gdrive', 'notion'],
    accent: '#17140f',
    tagline: 'Crunches numbers on demand',
  },
  {
    id: 'demo-june',
    name: 'June',
    role: 'VoC Analyst',
    prompt:
      'You are June, a voice-of-customer analyst. Read the Slack channels and the Zendesk queue, gauge tone and urgency in feedback, and flag what needs escalation before it boils over. Summarize the week every Friday.',
    tools: ['sentiment', 'summarize'],
    connections: ['slack', 'zendesk'],
    accent: '#0e7490',
    tagline: 'Reads the room at scale',
  },
]

// ── Layout math ──────────────────────────────────────────────────────────────

/**
 * Node center positions for `count` employee cards inside a `width`×`height`
 * panel. Phones (<640px) get a loose 2-column grid; larger panels get a radial
 * arrangement. `padTop` reserves clearance above each card for the service
 * satellites that fan out over it. Deterministic — same inputs, same layout.
 */
export function computeLayout(
  width: number,
  height: number,
  count: number,
  nodeW = NODE_W,
  nodeH = NODE_H,
  padTop = 0,
): NetPoint[] {
  if (count <= 0 || width <= 0 || height <= 0) return []
  const minX = nodeW / 2 + 6
  const maxX = Math.max(minX, width - nodeW / 2 - 6)
  const minY = nodeH / 2 + 6 + padTop
  const maxY = Math.max(minY, height - nodeH / 2 - 6)
  const clamp = (p: NetPoint): NetPoint => ({
    x: Math.min(Math.max(p.x, minX), maxX),
    y: Math.min(Math.max(p.y, minY), maxY),
  })

  if (count === 1) return [clamp({ x: width / 2, y: (minY + maxY) / 2 })]

  if (width < 640) {
    const cols = 2
    const rows = Math.ceil(count / cols)
    const pts: NetPoint[] = []
    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = width * (col === 0 ? 0.27 : 0.73)
      const y =
        rows === 1
          ? (minY + maxY) / 2
          : minY + 16 + (row * Math.max(0, maxY - minY - 32)) / (rows - 1)
      pts.push(
        clamp({
          x: x + (seeded(i, 1) - 0.5) * 14,
          y: y + (seeded(i, 2) - 0.5) * 18,
        }),
      )
    }
    return pts
  }

  const cx = width / 2
  const cy = height / 2 + padTop / 2
  const rx = Math.min(width * 0.36, width / 2 - nodeW / 2 - 24)
  const ry = Math.min(height * 0.32, (maxY - minY) / 2)
  const pts: NetPoint[] = []
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count + (seeded(i, 3) - 0.5) * 0.35
    pts.push(clamp({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry }))
  }
  return pts
}

/**
 * Offsets for an employee's service satellites, fanned out above the card.
 * Points sit on an ellipse of (`radiusX`, `radiusY`) around the node center.
 */
export function satelliteOffsets(
  count: number,
  radiusX: number,
  radiusY: number,
  seedIndex = 0,
): SatelliteSpec[] {
  if (count <= 0) return []
  const spread = Math.PI / 3.2 // ≈56° between neighbors
  const center = -Math.PI / 2 + (seeded(seedIndex, 7) - 0.5) * 0.7
  const out: SatelliteSpec[] = []
  for (let i = 0; i < count; i++) {
    const angle = center + (i - (count - 1) / 2) * spread
    out.push({ angle, dx: Math.cos(angle) * radiusX, dy: Math.sin(angle) * radiusY })
  }
  return out
}

/**
 * Inter-employee edges: the ring (0-1-2-…-0) plus short chords for teams of
 * 4+. No self-loops, no duplicates, order-stable.
 */
export function buildEdges(count: number): NetEdge[] {
  const edges: NetEdge[] = []
  const seen = new Set<string>()
  const push = (a: number, b: number) => {
    if (a === b) return
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from: a, to: b })
  }
  if (count < 2) return edges
  for (let i = 0; i < count; i++) push(i, (i + 1) % count)
  if (count >= 4) for (let i = 0; i < count; i++) push(i, (i + 2) % count)
  return edges
}

// ── Ambient life ─────────────────────────────────────────────────────────────

const PACKET_SNIPPETS = [
  'ticket #421',
  'weekly report',
  'standup notes',
  'PR #88 review',
  'inbox digest',
  'escalation summary',
  'metrics pull',
  'handoff notes',
]

/** Caption riding with a message packet, e.g. "Mara → Rex: ticket #421". */
export function packetCaption(a: Employee, b: Employee, seedIndex: number): string {
  const snippet = PACKET_SNIPPETS[Math.floor(seeded(seedIndex, 11) * PACKET_SNIPPETS.length)]
  return `${a.name} → ${b.name}: ${snippet}`
}

const CONNECTION_TASKS: Record<string, string> = {
  zendesk: 'triaging the ticket queue…',
  gmail: 'clearing the inbox…',
  outlook: 'clearing the inbox…',
  gcal: 'scheduling follow-ups…',
  gdrive: 'filing reports in Drive…',
  notion: 'tidying the wiki…',
  slack: 'catching up on channels…',
  github: 'reviewing pull requests…',
  linear: 'updating the cycle…',
  jira: 'moving tickets along…',
  hubspot: 'updating the pipeline…',
}

const GENERIC_TASKS = ['drafting a reply…', 'writing the summary…', 'cross-checking the docs…']

/** 2–3 subtle status lines an employee node cycles through while "working". */
export function taskLinesFor(employee: Employee): string[] {
  const lines: string[] = []
  for (const id of employee.connections ?? []) {
    const t = CONNECTION_TASKS[id]
    if (t && !lines.includes(t)) lines.push(t)
  }
  for (const g of GENERIC_TASKS) {
    if (lines.length >= 3) break
    lines.push(g)
  }
  return lines.slice(0, 3)
}

/** "Zendesk · Gmail" — the modal's works-with line. */
export function worksWithLine(employee: Employee): string {
  const labels = (employee.connections ?? []).map((id) => CONNECTIONS[id]?.name ?? id)
  return labels.length ? labels.join(' · ') : 'their desk tools'
}
