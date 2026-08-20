// ── Employee report cards — Zendesk-AutoQA-style per-run scoring ────────────
// After every run, the employee gets a categorical report card: a verdict
// (excellent / good / mixed / poor / unsure), per-axis reads, and a one-line
// note. With a usable provider key a second LLM call judges the run; without
// one, honest heuristic surface checks run instead and the card is stamped
// HEURISTIC · NO KEY. Verdicts are categorical ONLY — numeric confidence
// scores are discredited (false precision). When the evidence is thin, the
// card says "unsure" rather than guessing.

import { extractJson, resolveProvider } from './llm-staffing'
import type { Employee, LiveProviderSpec, TraceLine } from './agent'
import { blockedMessage, isStrict } from './execution-mode'

// ── Public types ─────────────────────────────────────────────────────────────

export type Verdict = 'excellent' | 'good' | 'mixed' | 'poor' | 'unsure'

export const VERDICTS: readonly Verdict[] = ['excellent', 'good', 'mixed', 'poor', 'unsure']

export interface ScoreAxis {
  label: string
  verdict: Verdict
}

export interface RunScore {
  verdict: Verdict
  axes: ScoreAxis[]
  /** One or two honest sentences — what earned the verdict. */
  note: string
  source: 'llm-judge' | 'heuristic' | 'unavailable'
  /** "Kimi (Moonshot) · kimi-k3" when an LLM judged; undefined for heuristic. */
  judge?: string
  /**
   * True when the judging model is the same one that produced the work. Not
   * an error, but the reader deserves to know a grade is a self-assessment.
   */
  selfJudged?: boolean
  at: number
}

export interface ScoredRun {
  employee: Employee
  input: string
  trace: TraceLine[]
  output: string
}

/** Same shape as llm-staffing's StaffingBrain — provider id + optional key. */
export type JudgeBrain = { providerId: string; apiKey?: string }

export const AXIS_LABELS = ['groundedness', 'tool use', 'instruction fit', 'tone'] as const

// ── Transport (mirrors llm-staffing's chatComplete conventions) ──────────────

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function chatComplete(spec: LiveProviderSpec, apiKey: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${spec.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: spec.model,
      messages,
      // kimi-k3 pins temperature/top-p — only send sampling params when allowed
      ...(spec.fixedParams ? {} : { temperature: 0.1 }),
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text().then((t) => t.slice(0, 140))}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Judge prompt ─────────────────────────────────────────────────────────────

function buildJudgeSystemPrompt(): string {
  return [
    'You are a quality-assurance judge scoring one run of an AI employee.',
    'Output ONLY a JSON object matching this exact schema — no markdown, no commentary:',
    '{',
    '  "verdict": "excellent" | "good" | "mixed" | "poor" | "unsure",',
    '  "axes": [',
    '    { "label": "groundedness",    "verdict": <same enum> },',
    '    { "label": "tool use",        "verdict": <same enum> },',
    '    { "label": "instruction fit", "verdict": <same enum> },',
    '    { "label": "tone",            "verdict": <same enum> }',
    '  ],',
    '  "note": string   // one or two honest sentences, max 280 chars',
    '}',
    '',
    'Rules:',
    '- Verdicts are categorical. NEVER output numbers, percentages or confidence scores.',
    '- "groundedness": did the answer rely on tool evidence / provided data instead of inventing facts?',
    '- "tool use": were the right tools chosen and did their outputs get used? If no tools were needed, judge whether that was correct.',
    '- "instruction fit": did the employee follow its owner\'s instructions and stay in role?',
    '- "tone": was the answer appropriately concise, professional and in-character?',
    '- If the evidence is too thin to judge confidently, use "unsure" — honesty beats false precision.',
    '- Respond with the JSON object and nothing else.',
  ].join('\n')
}

const JUDGE_REPAIR_PROMPT =
  'Your previous reply was not valid JSON. Return ONLY the JSON object matching the schema — ' +
  'no markdown fences, no explanation, no trailing text.'

function buildJudgeUserPrompt(run: ScoredRun): string {
  const traceText = run.trace.length
    ? run.trace.map((t) => `[${t.node}] ${t.text}`).join('\n')
    : '(no trace recorded)'
  return [
    `Employee: ${run.employee.name} — ${run.employee.role}`,
    `Owner instructions: "${run.employee.prompt}"`,
    `Task: "${run.input}"`,
    '',
    'Workflow trace:',
    traceText,
    '',
    'Final answer:',
    run.output.trim() || '(empty answer)',
  ].join('\n')
}

// ── Judge output validation ──────────────────────────────────────────────────

function asVerdict(v: unknown): Verdict | null {
  return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v) ? (v as Verdict) : null
}

/** Coerce parsed judge JSON into a RunScore. Returns null when unusable. */
export function normalizeJudgeScore(parsed: unknown, judge: string): RunScore | null {
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  const verdict = asVerdict(raw.verdict)
  if (!verdict) return null
  const axes: ScoreAxis[] = []
  if (Array.isArray(raw.axes)) {
    for (const a of raw.axes) {
      if (!a || typeof a !== 'object') continue
      const label = typeof (a as ScoreAxis).label === 'string' ? (a as ScoreAxis).label.trim().toLowerCase() : ''
      const av = asVerdict((a as ScoreAxis).verdict)
      if ((AXIS_LABELS as readonly string[]).includes(label) && av && !axes.some((x) => x.label === label)) {
        axes.push({ label, verdict: av })
      }
    }
  }
  if (axes.length === 0) return null
  const note =
    typeof raw.note === 'string' && raw.note.trim()
      ? raw.note.trim().slice(0, 280)
      : 'Judge returned no note.'
  return { verdict, axes, note, source: 'llm-judge', judge, at: Date.now() }
}

// ── Heuristic fallback ───────────────────────────────────────────────────────

/** Surface checks only: did it answer, did tools run clean, is the answer substantive. */
export function heuristicScore(run: ScoredRun): RunScore {
  const acts = run.trace.filter((t) => t.node === 'act')
  const failed = acts.filter((t) => /→\s*error:|\berror:/i.test(t.text))
  const output = run.output.trim()
  const allFailed = acts.length > 0 && failed.length === acts.length
  const someFailed = failed.length > 0 && failed.length < acts.length

  let verdict: Verdict
  let note: string
  if (!output) {
    verdict = 'poor'
    note = 'No answer was produced — nothing to grade.'
  } else if (allFailed) {
    verdict = output.length >= 120 ? 'mixed' : 'poor'
    note = `Every tool call errored (${failed.length}/${acts.length}); the answer was written without working evidence.`
  } else if (someFailed) {
    verdict = 'mixed'
    note = `${failed.length} of ${acts.length} tool calls errored; the answer leaned on partial evidence.`
  } else if (output.length < 60) {
    verdict = 'unsure'
    note = 'Answer too thin to score confidently — surface checks only, no judge key.'
  } else {
    verdict = 'good'
    note = acts.length
      ? `Answered in ${output.length} chars with ${acts.length} clean tool call${acts.length > 1 ? 's' : ''} — surface checks only, no judge key.`
      : `Answered in ${output.length} chars, no tools needed — surface checks only, no judge key.`
  }

  const axes: ScoreAxis[] = [
    { label: 'groundedness', verdict: acts.length > failed.length ? 'good' : 'unsure' },
    {
      label: 'tool use',
      verdict: acts.length === 0 ? 'unsure' : allFailed ? 'poor' : someFailed ? 'mixed' : 'good',
    },
    { label: 'instruction fit', verdict },
    { label: 'tone', verdict: output.length >= 60 ? 'good' : 'unsure' },
  ]
  return { verdict, axes, note, source: 'heuristic', at: Date.now() }
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Score one run. With a usable brain (key present, or a keyless provider) a
 * second LLM call judges the run and must return strict JSON (one repair
 * retry); any failure falls back to the heuristic scorer. Never throws.
 */
export async function scoreRun(
  run: ScoredRun,
  brain?: JudgeBrain | null,
  options: { selfJudged?: boolean } = {},
): Promise<RunScore> {
  const mark = (score: RunScore): RunScore =>
    score.source === 'llm-judge' && options.selfJudged ? { ...score, selfJudged: true } : score
  // In strict mode a broken evaluation pipeline must not look like a healthy
  // one. Heuristic surface checks are a different measurement, not a cheaper
  // version of the same one — reporting them as a card hides the outage.
  const degrade = (reason: string): RunScore =>
    isStrict() ? unavailableScore(reason) : heuristicScore(run)

  const spec = brain ? resolveProvider(brain.providerId) : null
  const apiKey = brain?.apiKey?.trim() ?? ''
  const usable = !!spec && (spec.keyRequired === false || apiKey.length > 0)
  if (!spec || !usable) return degrade('no judge provider configured')

  const judge = `${spec.name} · ${spec.model}`
  const messages: ChatMessage[] = [
    { role: 'system', content: buildJudgeSystemPrompt() },
    { role: 'user', content: buildJudgeUserPrompt(run) },
  ]

  let raw: string
  try {
    raw = await chatComplete(spec, apiKey, messages)
  } catch (err) {
    return degrade(`judge unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }

  let parsed: unknown | null = null
  try {
    parsed = extractJson(raw)
  } catch {
    // ONE repair retry: show the judge its bad reply and ask for bare JSON.
    try {
      const repaired = await chatComplete(spec, apiKey, [
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: JUDGE_REPAIR_PROMPT },
      ])
      parsed = extractJson(repaired)
    } catch {
      return degrade('judge returned unparseable JSON twice')
    }
  }

  const score = normalizeJudgeScore(parsed, judge)
  return score ? mark(score) : degrade('judge returned no usable verdict')
}

/** No card, and honest about why — strict mode's answer to a dead judge. */
export function unavailableScore(reason: string): RunScore {
  return {
    verdict: 'unsure',
    axes: [],
    note: blockedMessage('judge_unavailable', 'llm-judge', reason),
    source: 'unavailable',
    at: Date.now(),
  }
}

// ── Persistence — last N cards per employee (localStorage) ──────────────────

export const REPORT_CARDS_KEY = 'om-report-cards'
export const MAX_SCORES_PER_EMPLOYEE = 20

type ScoreStore = Record<string, RunScore[]>

function loadStore(): ScoreStore {
  try {
    const raw = localStorage.getItem(REPORT_CARDS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ScoreStore = {}
    for (const [k, v] of Object.entries(parsed as ScoreStore)) {
      if (Array.isArray(v)) out[k] = v.filter((s): s is RunScore => !!s && typeof s === 'object' && asVerdict((s as RunScore).verdict) !== null)
    }
    return out
  } catch {
    return {}
  }
}

function saveStore(store: ScoreStore): void {
  try {
    localStorage.setItem(REPORT_CARDS_KEY, JSON.stringify(store))
  } catch {
    /* storage unavailable (private mode, quota) — cards stay in memory */
  }
}

/** Newest-first list of stored cards for one employee. */
export function loadScorecards(employeeId: string): RunScore[] {
  return loadStore()[employeeId] ?? []
}

/** Prepend a score, cap at MAX_SCORES_PER_EMPLOYEE, persist, return the updated list. */
export function recordScore(employeeId: string, score: RunScore): RunScore[] {
  const store = loadStore()
  const next = [score, ...(store[employeeId] ?? [])].slice(0, MAX_SCORES_PER_EMPLOYEE)
  store[employeeId] = next
  saveStore(store)
  return next
}

/** Counts per verdict (zero-filled) — the roster's trend readout. */
export function trendSummary(scores: RunScore[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { excellent: 0, good: 0, mixed: 0, poor: 0, unsure: 0 }
  for (const s of scores) {
    const v = asVerdict(s.verdict)
    if (v) counts[v]++
  }
  return counts
}
