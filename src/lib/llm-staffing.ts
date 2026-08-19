// ── LLM staffing office — one prompt in, a real team designed by a model ────
// Replaces the regex heuristics with a real planner call to any OpenAI-compatible
// provider (default: Moonshot Kimi K3). The heuristic generator in staffing.ts
// stays as the rock-solid offline fallback: API failures NEVER throw — only a
// missing key for a key-required provider throws (StaffingError 'NO_KEY') so the
// UI can catch it and route the user to Settings.

import {
  ALL_TOOLS,
  CONNECTIONS,
  LIVE_PROVIDERS,
  TOOL_REGISTRY,
  type Employee,
  type LiveProviderSpec,
} from './agent'
import { generateStaff, MAX_HIRES } from './staffing'
import { blockedMessage, isStrict } from './execution-mode'

// ── Public types ─────────────────────────────────────────────────────────────

export interface StaffingStage {
  key: string
  label: string
  detail?: string
  status: 'active' | 'done' | 'error'
}

export type StaffingBrain = { providerId: string; apiKey?: string }

export interface StaffingResult {
  employees: Employee[]
  source: 'llm' | 'fallback'
  note?: string
  rationale?: string
}

export type StaffingErrorCode = 'NO_KEY' | 'PLANNER_UNREACHABLE'

/** The only thrown error from this module — UI-catchable, means "send user to Settings". */
export class StaffingError extends Error {
  readonly code: StaffingErrorCode
  constructor(code: StaffingErrorCode, message: string) {
    super(message)
    this.name = 'StaffingError'
    this.code = code
  }
}

// Same accent cycle as staffing.ts (kept local — staffing.ts doesn't export it).
const ACCENT_POOL = ['#ff4d00', '#0e7490', '#7c3aed', '#15803d', '#17140f', '#b91c1c']

const DEFAULT_PROVIDER_ID = 'kimi'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// ── Provider resolution + transport ──────────────────────────────────────────

export function resolveProvider(providerId?: string): LiveProviderSpec {
  return LIVE_PROVIDERS.find((p) => p.id === providerId) ?? LIVE_PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID)!
}

/** Minimal OpenAI-compatible chat call — mirrors agent.ts conventions (fixedParams, error shape). */
async function chatComplete(spec: LiveProviderSpec, apiKey: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${spec.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: spec.model,
      messages,
      // kimi-k3 pins temperature/top-p — only send sampling params when allowed
      ...(spec.fixedParams ? {} : { temperature: 0.2 }),
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text().then((t) => t.slice(0, 140))}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Prompt construction ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const toolLines = Object.values(TOOL_REGISTRY)
    .map((t) => `- ${t.id} — ${t.desc}`)
    .join('\n')
  const connLines = Object.values(CONNECTIONS)
    .map((c) => `- ${c.id} — ${c.desc} (${c.category})`)
    .join('\n')
  return [
    'You are a staffing director designing a team of AI employees from an employer\'s request.',
    'Output ONLY a JSON object matching this exact schema — no markdown, no commentary:',
    '{',
    '  "rationale": string,',
    '  "employees": [',
    '    {',
    '      "name": string,        // realistic human first name',
    '      "role": string,        // distinct job title',
    '      "tagline": string,     // one short line, what they own',
    '      "prompt": string,      // see rules below',
    '      "tools": string[],     // ONLY ids from the tool list below',
    '      "connections": string[]// ONLY ids from the connection list below',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- If the employer states an explicit headcount ("hire 3 support agents"), return EXACTLY that many employees.',
    '- Otherwise choose 1–4 employees based on the scope of the request. Never more than 6.',
    '- Each "prompt" is that employee\'s system prompt: a rich first-person brief of at least 3 sentences covering',
    '  (1) their persona, (2) their responsibilities, (3) how and when to use their tools, and',
    '  (4) when to admit "I\'m not sure" instead of guessing.',
    '- "tools" may contain ONLY ids from this list (pick by genuine job relevance, can be empty):',
    toolLines,
    '- "connections" may contain ONLY ids from this list (pick by genuine job relevance, can be empty):',
    connLines,
    '- Use realistic, varied human names. Every employee gets a distinct role.',
    '- Respond with the JSON object and nothing else.',
  ].join('\n')
}

const REPAIR_PROMPT =
  'Your previous reply was not valid JSON. Return ONLY the JSON object matching the schema — ' +
  'no markdown fences, no explanation, no trailing text.'

// ── JSON extraction ──────────────────────────────────────────────────────────

/** Strip markdown fences, take first { … last }, JSON.parse. Throws on failure. */
export function extractJson(text: string): unknown {
  let t = text.trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object found in planner reply')
  return JSON.parse(t.slice(start, end + 1))
}

function tryExtract(text: string): unknown | null {
  try {
    return extractJson(text)
  } catch {
    return null
  }
}

// ── Headcount ────────────────────────────────────────────────────────────────

/** Explicit counts only ("3 support agents", "team of 4", "two agents") — null when unspecified. */
export function explicitHeadcount(prompt: string): number | null {
  const clamp = (n: number) => Math.min(Math.max(n, 1), MAX_HIRES)
  const num =
    prompt.match(/(\d+)\s*(?:\w+\s){0,2}?(?:people|employees|staff|agents|roles|of them|new hires)/i) ??
    prompt.match(/team of (\d+)/i)
  if (num) return clamp(parseInt(num[1], 10))
  const wordNum = prompt.match(/\b(a couple|two|three|four|five|six)\s*(?:people|employees|staff|agents|roles|new hires)?/i)
  if (wordNum) {
    const map: Record<string, number> = { 'a couple': 2, two: 2, three: 3, four: 4, five: 5, six: 6 }
    const n = map[wordNum[1].toLowerCase()]
    if (n && (wordNum[2] || /\b(couple|two|three|four|five|six)\s+\w/i.test(prompt))) return clamp(n)
  }
  return null
}

// ── Validation / normalization ───────────────────────────────────────────────

function newEmployeeId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return `emp-${c.randomUUID()}`
  const buf = new Uint8Array(8)
  c?.getRandomValues?.(buf)
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  return `emp-${hex || `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`}`
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Coerce raw planner output into valid Employees:
 * - drop entries with empty name/role
 * - tools/connections filtered to valid ids, deduped; a connection id misplaced
 *   in "tools" is moved to connections
 * - enforce explicit headcount (trim / top up from the heuristic generator), cap MAX_HIRES
 * - assign crypto-safe ids and cycle the accent palette
 */
export function normalizeEmployees(parsed: unknown, employerPrompt: string): Employee[] {
  const list = (parsed as { employees?: unknown } | null)?.employees
  const out: Employee[] = []
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      const role = typeof raw.role === 'string' ? raw.role.trim() : ''
      if (!name || !role) continue
      const tools = new Set<string>()
      const connections = new Set<string>()
      for (const id of asStringList(raw.tools)) {
        const k = id.trim().toLowerCase()
        if (TOOL_REGISTRY[k]) tools.add(k)
        else if (CONNECTIONS[k]) connections.add(k)
      }
      for (const id of asStringList(raw.connections)) {
        const k = id.trim().toLowerCase()
        if (CONNECTIONS[k]) connections.add(k)
      }
      let prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
      if (!prompt) {
        prompt =
          `You are ${name}, the company's ${role.toLowerCase()}. Own your area end to end and use your tools ` +
          `(${[...tools, ...connections].join(', ') || 'your own judgment'}) whenever they help you answer from evidence. ` +
          `When you don't know, say "I'm not sure" instead of guessing.`
      }
      out.push({
        id: newEmployeeId(),
        name,
        role,
        prompt,
        tools: [...tools],
        connections: [...connections],
        accent: '',
        tagline: typeof raw.tagline === 'string' && raw.tagline.trim() ? raw.tagline.trim() : undefined,
      })
    }
  }

  // Headcount enforcement: explicit counts are honored exactly; cap everything at MAX_HIRES.
  const wanted = explicitHeadcount(employerPrompt)
  let target = wanted ?? out.length
  target = Math.min(target, MAX_HIRES)
  if (out.length > target) out.length = target
  if (out.length < target) {
    const usedNames = new Set(out.map((e) => e.name.toLowerCase()))
    for (const h of generateStaff(employerPrompt)) {
      if (out.length >= target) break
      if (usedNames.has(h.name.toLowerCase())) continue
      usedNames.add(h.name.toLowerCase())
      out.push({ ...h, id: newEmployeeId(), preset: undefined })
    }
  }

  out.forEach((e, i) => {
    e.accent = ACCENT_POOL[i % ACCENT_POOL.length]
    e.preset = undefined
  })
  return out
}

// ── Stage helpers ────────────────────────────────────────────────────────────

function emitHires(employees: Employee[], onStage?: (s: StaffingStage) => void): void {
  employees.forEach((e, i) => {
    onStage?.({ key: `hired-${i}`, label: `Hired ${e.name} — ${e.role}`, status: 'done' })
  })
}

function emitDone(count: number, source: 'llm' | 'fallback', note: string | undefined, onStage?: (s: StaffingStage) => void): void {
  onStage?.({
    key: 'done',
    label: `Team ready — ${count} hire${count === 1 ? '' : 's'}${source === 'fallback' ? ' (offline planner)' : ''}`,
    detail: note,
    status: 'done',
  })
}

function fallbackResult(employerPrompt: string, note: string, onStage?: (s: StaffingStage) => void): StaffingResult {
  // Strict mode will not let the offline planner stand in for a live one that
  // failed: a team designed by regex is not the team the planner would design,
  // and downstream nothing can tell the two apart.
  if (isStrict()) {
    onStage?.({ key: 'offline-planner', label: 'Planner unavailable', detail: note, status: 'error' })
    throw new StaffingError('PLANNER_UNREACHABLE', blockedMessage('planner_unreachable', 'llm-planner', note))
  }
  const employees = generateStaff(employerPrompt)
  onStage?.({ key: 'offline-planner', label: 'Offline planner', detail: note, status: 'active' })
  emitHires(employees, onStage)
  emitDone(employees.length, 'fallback', note, onStage)
  return { employees, source: 'fallback', note }
}

// ── Main entry points ────────────────────────────────────────────────────────

/**
 * Design a team with a real LLM planner. Throws StaffingError('NO_KEY') only when
 * the provider needs a key and none was given; every API/parse failure falls back
 * to the offline heuristic planner and returns source:'fallback' with a note.
 */
export async function generateStaffLLM(
  employerPrompt: string,
  brain: StaffingBrain,
  onStage?: (s: StaffingStage) => void,
): Promise<StaffingResult> {
  const spec = resolveProvider(brain.providerId)
  const apiKey = brain.apiKey?.trim() ?? ''
  if (spec.keyRequired !== false && !apiKey) {
    throw new StaffingError('NO_KEY', `${spec.name} needs an API key — add one in Settings (${spec.keyUrl}).`)
  }

  onStage?.({ key: 'contacting-planner', label: `Contacting ${spec.name} · ${spec.model}`, status: 'active' })

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: `Employer request: "${employerPrompt.trim()}"` },
  ]

  let raw: string
  try {
    raw = await chatComplete(spec, apiKey, messages)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onStage?.({ key: 'contacting-planner', label: `Contacting ${spec.name} · ${spec.model}`, detail: msg, status: 'error' })
    return fallbackResult(employerPrompt, `planner unreachable (${msg}) — used offline planner`, onStage)
  }

  onStage?.({ key: 'designing-team', label: 'Designing the team', detail: 'parsing the planner\'s roster', status: 'active' })

  let parsed = tryExtract(raw)
  if (!parsed) {
    // ONE repair retry: show the model its bad reply and ask for bare JSON.
    try {
      const repaired = await chatComplete(spec, apiKey, [
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: REPAIR_PROMPT },
      ])
      parsed = tryExtract(repaired)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onStage?.({ key: 'designing-team', label: 'Designing the team', detail: msg, status: 'error' })
      return fallbackResult(employerPrompt, `planner unreachable (${msg}) — used offline planner`, onStage)
    }
  }

  if (!parsed) {
    onStage?.({ key: 'designing-team', label: 'Designing the team', detail: 'unparseable JSON', status: 'error' })
    return fallbackResult(employerPrompt, 'planner returned unparseable JSON — used offline planner', onStage)
  }

  const employees = normalizeEmployees(parsed, employerPrompt)
  if (employees.length === 0) {
    onStage?.({ key: 'designing-team', label: 'Designing the team', detail: 'no usable employees in reply', status: 'error' })
    return fallbackResult(employerPrompt, 'planner returned no usable employees — used offline planner', onStage)
  }

  const rationale = (parsed as { rationale?: unknown }).rationale
  emitHires(employees, onStage)
  emitDone(employees.length, 'llm', undefined, onStage)
  return {
    employees,
    source: 'llm',
    rationale: typeof rationale === 'string' ? rationale : undefined,
  }
}

/**
 * Entry point for the UI: uses the LLM path when the brain is usable (key present,
 * or a keyless provider like Ollama), otherwise the offline heuristic planner.
 */
export async function planWorkforce(
  employerPrompt: string,
  brain: StaffingBrain | null,
  onStage?: (s: StaffingStage) => void,
): Promise<StaffingResult> {
  if (brain) {
    const spec = resolveProvider(brain.providerId)
    const usable = spec.keyRequired === false || !!brain.apiKey?.trim()
    if (usable) return generateStaffLLM(employerPrompt, brain, onStage)
  }
  return fallbackResult(employerPrompt, 'offline planner (no API key)', onStage)
}

// Re-exported so the UI can validate ids without importing agent.ts internals.
export const VALID_TOOL_IDS = Object.keys(ALL_TOOLS)
export const VALID_CONNECTION_IDS = Object.keys(CONNECTIONS)
