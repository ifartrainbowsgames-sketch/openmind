import { analyzeSentiment, retrievePassages, summarize } from '../demo'
import type { AgentTool } from './types'

export const KNOWLEDGE = `
OpenMind is the open-source integration layer for AI. Its chatbot ships as an embeddable widget and one unified API.
The chatbot runs on the customer's own provider keys — OpenMind never marks up tokens. You pay your provider directly.
The chatbot widget embeds on any site with two lines of code: a script tag with a data-service attribute.
Key modes: Browser-direct keeps the visitor's key in their browser with zero servers. Server-managed provider keys are planned but are not available in the current console.
The playground tries the configured server-side demo gateway and clearly labels a local simulated fallback.
The console includes Data Studio for storing company data, a Widget Builder with live preview, and clearly labeled preview panels for Inbox, analytics and Prompt Studio.
Pro is ten dollars per month when billing launches. The free plan includes the chatbot and one hundred thousand tokens.
Refunds are processed within five business days — email billing@openmind.dev to request one.
The stack is React 19, TypeScript, Vite, Tailwind CSS, Supabase and LangGraph.
AI Employees are LangGraph agents that plan, call tools and respond — create your own with a custom system prompt.
`

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
  code_review: {
    id: 'code_review',
    name: 'Code review',
    desc: 'Static analysis of pasted code — bugs, smells, risks',
    run: reviewCode,
  },
}

export const TOOL_IDS = Object.keys(TOOL_REGISTRY)
