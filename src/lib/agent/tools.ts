import { invokeCrewTool } from '../crew-tools'
import { draftBusinessPlan } from '../business-plan'
import { analyzeSentiment, retrievePassages, summarize } from '../demo'
import type { AgentTool, ToolResult } from './types'

export const KNOWLEDGE = `
OpenMind is the open-source integration layer for AI. Its chatbot ships as an embeddable widget and one unified API.
The chatbot runs on the customer's own provider keys — OpenMind never marks up tokens. You pay your provider directly.
The target chatbot embed API uses a two-line script tag; the published CDN package is still roadmap work.
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

// ── Crew-backed tools ────────────────────────────────────────────────────────
// Registered by mutation rather than in the literal above because each one
// delegates to the crew-tools transport, which imports from here — declaring
// them inline would make the cycle a load-order problem instead of a runtime
// lookup.  is deliberately re-declared: its description used to
// call a regex scan "analysis", which is not what it is.
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
  run: (q, _args, ctx) => invokeCrewTool('run_checks', q, undefined, ctx),
}

TOOL_REGISTRY.web_search = {
  id: 'web_search',
  name: 'Web search',
  desc: 'Search the public web (DuckDuckGo / SearXNG; Tavily optional)',
  run: (q, _args, ctx) => invokeCrewTool('web_search', q, undefined, ctx),
}

TOOL_REGISTRY.browse_url = {
  id: 'browse_url',
  name: 'Browse URL',
  desc: 'Read a URL to text (Jina Reader / fetch; Firecrawl optional)',
  run: (q, _args, ctx) => invokeCrewTool('browse_url', q, undefined, ctx),
}

TOOL_REGISTRY.run_code = {
  id: 'run_code',
  name: 'Run code',
  desc: 'Execute Python in the project sandbox (mock if no E2B key)',
  run: (q, _args, ctx) => invokeCrewTool('run_code', q, undefined, ctx),
}

// ── Workspace tools — one persistent sandbox per project ─────────────────────
// These share a machine, so a clone survives into the install and the install
// into the test run. That sequence is what a coding worker actually needs.

TOOL_REGISTRY.workspace_run = {
  id: 'workspace_run',
  name: 'Run shell command',
  desc: 'Run any shell command in the project sandbox — npm install, pytest, build. Input: the command, or {"command":"..."}',
  run: (q, _args, ctx) => invokeCrewTool('workspace_run', q, undefined, ctx),
}

TOOL_REGISTRY.workspace_write_file = {
  id: 'workspace_write_file',
  name: 'Write file',
  desc: 'Write a file in the project sandbox. Input: {"path":"src/x.ts","content":"..."}',
  run: (q, _args, ctx) => invokeCrewTool('workspace_write_file', q, undefined, ctx),
}

TOOL_REGISTRY.workspace_read_file = {
  id: 'workspace_read_file',
  name: 'Read file',
  desc: 'Read a file from the project sandbox. Input: the path, or {"path":"..."}',
  run: (q, _args, ctx) => invokeCrewTool('workspace_read_file', q, undefined, ctx),
}

TOOL_REGISTRY.workspace_ls = {
  id: 'workspace_ls',
  name: 'List files',
  desc: 'List the project sandbox tree. Input: a path, or {"path":"."}',
  run: (q, _args, ctx) => invokeCrewTool('workspace_ls', q, undefined, ctx),
}

TOOL_REGISTRY.git_clone = {
  id: 'git_clone',
  name: 'Clone repo',
  desc: 'Clone an https git repo into the project sandbox. Input: the URL, or {"repo":"...","branch":"main"}',
  run: (q, _args, ctx) => invokeCrewTool('git_clone', q, undefined, ctx),
}

TOOL_REGISTRY.github_write_file = {
  id: 'github_write_file',
  name: 'GitHub write file',
  desc: 'Commit a file to the GitHub · main workspace. Required one-line JSON only: {"path","content"} with optional "message" and "branch". Do not pass the workspace prompt.',
  run: (q, _args, ctx) => invokeCrewTool('github_write_file', q, undefined, ctx),
}

TOOL_REGISTRY.github_create_branch = {
  id: 'github_create_branch',
  name: 'GitHub create branch',
  desc: 'Create a branch from main on the GitHub workspace. One-line JSON: {"name","from?"}.',
  run: (q, _args, ctx) => invokeCrewTool('github_create_branch', q, undefined, ctx),
}

TOOL_REGISTRY.github_open_pr = {
  id: 'github_open_pr',
  name: 'GitHub open PR',
  desc: 'Open a pull request into main. One-line JSON: {"title","body?","head","base?"}.',
  run: (q, _args, ctx) => invokeCrewTool('github_open_pr', q, undefined, ctx),
}

TOOL_REGISTRY.slack_post = {
  id: 'slack_post',
  name: 'Slack post',
  desc: 'Post to Slack. One-line JSON: {"text","channel?"}. Connect Slack first.',
  run: (q, _args, ctx) => invokeCrewTool('slack_post', q, undefined, ctx),
}

TOOL_REGISTRY.gmail_send = {
  id: 'gmail_send',
  name: 'Gmail send',
  desc: 'Send mail from Gmail. One-line JSON: {"to","subject","body"}. Connect Gmail first.',
  run: (q, _args, ctx) => invokeCrewTool('gmail_send', q, undefined, ctx),
}

TOOL_REGISTRY.gmail_list = {
  id: 'gmail_list',
  name: 'Gmail list',
  desc: 'List inbox threads. Optional JSON {"query"} e.g. is:unread. Connect Gmail first.',
  run: (q, _args, ctx) => invokeCrewTool('gmail_list', q, undefined, ctx),
}

TOOL_REGISTRY.gmail_read = {
  id: 'gmail_read',
  name: 'Gmail read',
  desc: 'Read one message. JSON {"id"} from gmail_list. Connect Gmail first.',
  run: (q, _args, ctx) => invokeCrewTool('gmail_read', q, undefined, ctx),
}

// ── The browser, through its provider ────────────────────────────────────────
// This tool is the only production path to a browser, so it is where the
// invariant is enforced: a browser task cannot complete without going through
// a BrowserProvider. It used to call the transport directly and return prose —
// unusable downstream, because the judge cannot count sources in a sentence
// and nobody could tell a loaded page from a described one.

TOOL_REGISTRY.web_act = {
  id: 'web_act',
  name: 'Web act',
  desc: 'Hosted Chrome: JSON {"url","goal","steps":[{"click":"css"},{"type":{"selector","text"}}]}. Confirm first.',
  run: async (q, _args, ctx): Promise<ToolResult> => {
    const { parseWebActInput } = await import('../web-act')
    const { actionsFromWebAct, webActProvider } = await import('../workforce/browser-provider')
    const { runBrowserPlan } = await import('../workforce/browser-worker')
    const { isStrict } = await import('../execution-mode')

    const spec = parseWebActInput(q)
    const { result, artifacts } = await runBrowserPlan(
      webActProvider(ctx),
      actionsFromWebAct(spec),
    )

    if (result.blocked) {
      // A simulated page is not a visit, so the session reports blocked either
      // way — but only strict mode turns that into a failed capability. Demo
      // mode still shows the mock, and produces no artifacts from it, because
      // an artifact from a page nobody loaded is a fabricated source.
      return isStrict()
        ? { content: result.blocked, error: { kind: 'blocked', message: result.blocked }, source: 'mock' }
        : { content: result.blocked, source: 'mock' }
    }

    const visited = result.visits.map((v) => v.url).join(', ')
    const first = result.data[0] as { text?: string; fields?: Record<string, string> } | undefined
    return {
      content: [
        `[LIVE · web_act] ${visited}`,
        first?.fields && Object.keys(first.fields).length
          ? `Extracted: ${JSON.stringify(first.fields)}`
          : '',
        (first?.text ?? '').slice(0, 4000),
      ].filter(Boolean).join('\n'),
      data: { visits: result.visits, items: result.data },
      artifacts,
      source: 'live',
    }
  },
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
  run: (q, _args, ctx) => invokeCrewTool('gdrive_list', q, undefined, ctx),
}

// ── Explicit memory access ───────────────────────────────────────────────────
// Reclassified rather than removed. The kernel's memory service already puts
// this project's established facts in the prompt before the task starts and
// records the outcome afterwards, for every runtime — so remembering the basic
// state of the work is no longer the worker's responsibility. What is left is
// genuinely useful: an agent that wants to look further than the recall budget.

TOOL_REGISTRY.memory_search = {
  id: 'memory_search',
  name: 'Memory search',
  desc: 'Search deeper into what this project established, beyond the context you were already given.',
  run: async (q, _args, ctx) => {
    if (ctx?.memory) {
      const hits = await ctx.memory.search(q)
      return hits.length
        ? `[memory_search] ${hits.join('\n')}`
        : '[memory_search] Nothing further recorded for that.'
    }
    // No session — the chat surfaces still reach the account's saved notes.
    const memory = await import('../memory')
    return memory.searchMemory(q)
  },
}

TOOL_REGISTRY.memory_save = {
  id: 'memory_save',
  name: 'Memory save',
  desc: 'Save a note for this user across projects. Plain text, or JSON {"content","scope?"}.',
  run: (q) => import('../memory').then((m) => m.saveMemory(q)),
}
