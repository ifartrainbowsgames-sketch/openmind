// agent-tools — Supabase Edge Function (Deno)
// Defaults: DuckDuckGo / SearXNG search, Jina Reader + fetch/Readability browse.
// Optional upgrades: Tavily, Firecrawl. Code still uses E2B when a key is set.

// Pinned rather than floating: this runs unattended on a server, and a
// version published hours ago has had no time to be caught being bad.
import { Sandbox } from 'npm:e2b@2.39.0'
import {
  firstHttpUrl,
  formatHits,
  htmlToText,
  isBlockedHostname,
  parseSearchHtml,
  parseSearxJson,
} from './open-web.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

const UPSTREAM_TIMEOUT_MS = 22_000
const UA = 'OpenMind/1.0 (https://openmind.dev)'

type ToolKind =
  | 'web_search'
  | 'browse_url'
  | 'run_code'
  | 'web_act'
  | 'workspace_run'
  | 'workspace_write_file'
  | 'workspace_read_file'
  | 'workspace_ls'
  | 'git_clone'
  | 'run_checks'

const WORKSPACE_TOOLS: ToolKind[] = [
  'workspace_run', 'workspace_write_file', 'workspace_read_file', 'workspace_ls', 'git_clone', 'run_checks',
]

const ALL_TOOL_KINDS: ToolKind[] = ['web_search', 'browse_url', 'run_code', 'web_act', ...WORKSPACE_TOOLS]

/** Everything runs under one root so paths are stable between calls. */
const WORKDIR = '/home/user/project'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function mock(kind: ToolKind, input: string): string {
  const q = input.trim() || '(empty)'
  if (kind === 'web_search') {
    return `[MOCK · web_search] Simulated hits for "${q}". Deploy agent-tools for live DuckDuckGo / SearXNG search.`
  }
  if (kind === 'browse_url') {
    return `[MOCK · browse_url] Simulated extract for ${q.split(/\s+/)[0]}. Deploy agent-tools for Jina Reader / direct fetch.`
  }
  if (kind === 'web_act') {
    return `[MOCK · web_act] Hosted Chrome not configured. Set BROWSERLESS_API_KEY. Task: ${q.slice(0, 240)}`
  }
  if (kind === 'run_code') {
    return `[MOCK · run_code] Simulated sandbox for:\n${q.slice(0, 300)}\nAdd E2B_API_KEY for real execution.`
  }
  return `[MOCK · ${kind}] No sandbox configured — set E2B_API_KEY to give workers a real machine. Request: ${q.slice(0, 200)}`
}

async function tavilySearch(query: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: 'basic' }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`tavily ${res.status}: ${text.slice(0, 180)}`)
  const data = JSON.parse(text) as { results?: { title?: string; url?: string; content?: string }[]; answer?: string }
  const hits = (data.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? 'result',
    url: r.url ?? '',
    snippet: (r.content ?? '').slice(0, 280),
  }))
  const formatted = formatHits('tavily', query, hits.filter((h) => h.url))
  return data.answer ? `${formatted}\nAnswer: ${data.answer}` : formatted
}

async function searxSearch(query: string, base: string): Promise<string> {
  const endpoint = new URL('search', base.endsWith('/') ? base : `${base}/`)
  endpoint.searchParams.set('q', query)
  endpoint.searchParams.set('format', 'json')
  const res = await fetch(endpoint.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`searxng ${res.status}: ${text.slice(0, 180)}`)
  return formatHits('searxng', query, parseSearxJson(text))
}

async function duckDuckGoSearch(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const html = await res.text()
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`)
  const hits = parseSearchHtml(html)
  if (!hits.length) throw new Error('duckduckgo: no parseable results')
  return formatHits('duckduckgo', query, hits)
}

async function firecrawlScrape(target: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url: target, formats: ['markdown'] }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`firecrawl ${res.status}: ${text.slice(0, 180)}`)
  const data = JSON.parse(text) as { success?: boolean; data?: { markdown?: string } }
  const md = data.data?.markdown ?? text
  return `[LIVE · browse_url · firecrawl] ${target}\n${md.slice(0, 4000)}`
}

async function jinaRead(target: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${target}`, {
    headers: { Accept: 'text/plain', 'User-Agent': UA, 'X-Return-Format': 'markdown' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`jina ${res.status}: ${text.slice(0, 180)}`)
  if (!text.trim() || /failed to|blocked|403/i.test(text.slice(0, 80))) throw new Error('jina: empty or blocked')
  return `[LIVE · browse_url · jina] ${target}\n${text.slice(0, 4000)}`
}

async function fetchReadable(target: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    throw new Error('invalid url')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('http(s) only')
  if (isBlockedHostname(parsed.hostname)) throw new Error('host not allowed')
  const res = await fetch(parsed.toString(), {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    redirect: 'follow',
  })
  const html = await res.text()
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const text = htmlToText(html)
  if (text.length < 40) throw new Error('page had too little text')
  return `[LIVE · browse_url · fetch] ${target}\n${text}`
}

// ── Sandbox session ──────────────────────────────────────────────────────────
// A sandbox used to be created, given one `python -c`, and destroyed inside a
// `finally`. That makes clone → install → edit → test → fix impossible: every
// call started from an empty machine. The sandbox is now a session keyed to the
// project, created on first use and reused until the project ends.

const E2B_TEMPLATE = Deno.env.get('E2B_TEMPLATE') || 'base'
/** Sandboxes idle longer than this are reaped by E2B; we recreate transparently. */
const SANDBOX_TTL_SECONDS = 900

interface SandboxCommand {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Sandbox transport.
 *
 * This used to POST to `api.e2b.dev/sandboxes/{id}/commands`, which does not
 * exist — that route 404s, every call raised SandboxGoneError, and the tool
 * silently degraded to mock output. Commands actually run on the sandbox's own
 * envd daemon, reachable at `49983-{sandboxID}-{clientID}.e2b.app` over
 * Connect-RPC with streaming framing. Rather than hand-roll that envelope
 * format, use the official SDK, which also survives E2B changing it.
 */

/** Raised when the sandbox is gone (expired or reaped) so callers can recreate. */
class SandboxGoneError extends Error {}

async function openSandbox(apiKey: string, sandboxId?: string): Promise<Sandbox> {
  if (sandboxId) {
    try {
      return await Sandbox.connect(sandboxId, { apiKey })
    } catch {
      // Expired or reaped between calls; the caller decides whether to start over.
      throw new SandboxGoneError(`sandbox ${sandboxId} no longer exists`)
    }
  }
  return await Sandbox.create(E2B_TEMPLATE, { apiKey, timeoutMs: SANDBOX_TTL_SECONDS * 1000 })
}

/**
 * Run one shell line. The SDK throws on a non-zero exit, but a failing build is
 * a result the agent must see and react to, not an exception — so the exit code
 * and both streams are returned either way.
 */
async function execIn(sandbox: Sandbox, script: string, timeoutSeconds: number): Promise<SandboxCommand> {
  try {
    const out = await sandbox.commands.run(script, { timeoutMs: timeoutSeconds * 1000 })
    return { exitCode: out.exitCode ?? 0, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }
  } catch (err) {
    const e = err as { exitCode?: number; stdout?: string; stderr?: string; message?: string }
    if (typeof e.exitCode === 'number') {
      return { exitCode: e.exitCode, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
    }
    throw err
  }
}

/** Run a shell line, reusing `sandboxId` when it is still alive. */
async function sandboxShell(
  sandboxId: string | undefined,
  script: string,
  apiKey: string,
  timeoutSeconds = 120,
): Promise<{ result: SandboxCommand; sandboxId: string; recreated: boolean }> {
  try {
    const sandbox = await openSandbox(apiKey, sandboxId)
    return {
      result: await execIn(sandbox, script, timeoutSeconds),
      sandboxId: sandbox.sandboxId,
      recreated: !sandboxId,
    }
  } catch (err) {
    if (!(err instanceof SandboxGoneError)) throw err
    // Expired between calls — start a fresh one so the run can continue.
    const sandbox = await openSandbox(apiKey)
    return {
      result: await execIn(sandbox, script, timeoutSeconds),
      sandboxId: sandbox.sandboxId,
      recreated: true,
    }
  }
}

/** Base64 so arbitrary file content survives the shell without quoting games. */
function writeFileScript(path: string, content: string): string {
  const b64 = btoa(unescape(encodeURIComponent(content)))
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
  return `mkdir -p ${shellQuote(dir)} && printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(path)} && echo "wrote ${path} ($(wc -c < ${shellQuote(path)}) bytes)"`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function formatCommand(label: string, result: SandboxCommand): string {
  const parts = [`[LIVE · ${label}] exit=${result.exitCode}`]
  if (result.stdout.trim()) parts.push(result.stdout.trim().slice(0, 6000))
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim().slice(0, 2000)}`)
  return parts.join('\n')
}

async function liveSearch(query: string, keys: Record<string, unknown>, allowPlatform = false): Promise<string> {
  const tavily = (typeof keys.tavily === 'string' && keys.tavily) || (allowPlatform ? Deno.env.get('TAVILY_API_KEY') || '' : '')
  const searx = (typeof keys.searxngUrl === 'string' && keys.searxngUrl) || (allowPlatform ? Deno.env.get('SEARXNG_URL') || '' : '')
  const errors: string[] = []
  if (tavily) {
    try {
      return await tavilySearch(query, tavily)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (searx) {
    try {
      return await searxSearch(query, searx)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  try {
    return await duckDuckGoSearch(query)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  throw new Error(errors.join(' · ') || 'search failed')
}

async function liveBrowse(input: string, keys: Record<string, unknown>, allowPlatform = false): Promise<string> {
  const target = firstHttpUrl(input)
  const firecrawl = (typeof keys.firecrawl === 'string' && keys.firecrawl) || (allowPlatform ? Deno.env.get('FIRECRAWL_API_KEY') || '' : '')
  const errors: string[] = []
  // No Playwright/Browserless farm here — Jina + fetch cover browse_url.
  if (firecrawl) {
    try {
      return await firecrawlScrape(target, firecrawl)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  try {
    return await jinaRead(target)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  try {
    return await fetchReadable(target)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  throw new Error(errors.join(' · ') || 'browse failed')
}

function parseWebAct(input: string): { url: string; goal: string; steps: { click?: string; type?: { selector: string; text: string }; waitMs?: number }[] } {
  const raw = input.trim()
  if (raw.startsWith('{')) {
    try {
      const rec = JSON.parse(raw) as Record<string, unknown>
      const url = typeof rec.url === 'string' ? rec.url.trim() : ''
      const goal = typeof rec.goal === 'string' ? rec.goal : typeof rec.task === 'string' ? rec.task : ''
      const steps = Array.isArray(rec.steps) ? rec.steps.slice(0, 8) : []
      const parsed = steps.map((s) => {
        if (!s || typeof s !== 'object') return null
        const row = s as Record<string, unknown>
        if (typeof row.click === 'string') return { click: row.click.slice(0, 200) }
        if (row.type && typeof row.type === 'object') {
          const t = row.type as Record<string, unknown>
          if (typeof t.selector === 'string' && typeof t.text === 'string') {
            return { type: { selector: t.selector.slice(0, 200), text: t.text.slice(0, 500) } }
          }
        }
        if (typeof row.waitMs === 'number') return { waitMs: Math.min(row.waitMs, 8000) }
        return null
      }).filter(Boolean) as { click?: string; type?: { selector: string; text: string }; waitMs?: number }[]
      if (/^https?:\/\//i.test(url)) return { url, goal: String(goal).slice(0, 500), steps: parsed }
    } catch {
      /* fall through */
    }
  }
  const url = firstHttpUrl(input)
  return { url, goal: input.replace(url, '').trim().slice(0, 500), steps: [] }
}

async function liveWebAct(input: string, keys: Record<string, unknown>, allowPlatform = false): Promise<string> {
  const spec = parseWebAct(input)
  const token = (typeof keys.browserless === 'string' && keys.browserless) || (allowPlatform ? Deno.env.get('BROWSERLESS_API_KEY') || '' : '')
  const base = (Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io').replace(/\/$/, '')
  if (!token) throw new Error('no Browserless key — hosted Chrome is off')
  if (!spec.steps.length) {
    const res = await fetch(`${base}/content?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: spec.url }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    const html = await res.text()
    if (!res.ok) throw new Error(`browserless content ${res.status}: ${html.slice(0, 180)}`)
    return `[LIVE · web_act · chrome] ${spec.url}\n${htmlToText(html).slice(0, 4000)}`
  }
  const code = `module.exports = async ({ page, context }) => {
    const { url, steps } = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    for (const step of steps) {
      if (step.click) await page.click(step.click, { timeout: 8000 });
      if (step.type) await page.type(step.type.selector, step.type.text, { delay: 20 });
      if (step.waitMs) await page.waitForTimeout(step.waitMs);
    }
    const text = await page.evaluate(() => (document.body && document.body.innerText) ? document.body.innerText.slice(0, 8000) : '');
    return text;
  }`
  const res = await fetch(`${base}/function?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, context: { url: spec.url, steps: spec.steps } }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`browserless function ${res.status}: ${text.slice(0, 180)}`)
  return `[LIVE · web_act · chrome] ${spec.url}\nGoal: ${spec.goal}\n${text.slice(0, 4000)}`
}

/**
 * Run whatever checks the project actually defines, instead of guessing at
 * quality from source text. Detects the ecosystem, installs if needed, and
 * reports each check with its real exit code. POSIX sh only — no PIPESTATUS,
 * no bashisms — because the sandbox shell is not guaranteed to be bash.
 */
const CHECKS_SCRIPT = `
cd ${'${WORKDIR_PLACEHOLDER}'} 2>/dev/null || { echo "no workspace — clone or write files first"; exit 1; }
FOUND=0
FAILED=0
run_check() {
  label="$1"; shift
  "$@" > /tmp/check.log 2>&1
  code=$?
  echo "--- $label (exit $code) ---"
  tail -60 /tmp/check.log
  # Record the failure but keep going: the agent needs every failing check in
  # one pass, not just the first. The overall exit code is set at the end.
  [ $code -ne 0 ] && FAILED=1
  return 0
}
has_script() { node -e "var s=require('./package.json').scripts||{};process.exit(s['$1']?0:1)" 2>/dev/null; }

if [ -f package.json ]; then
  FOUND=1
  echo "== node project =="
  if [ ! -d node_modules ]; then
    echo "installing dependencies..."
    npm ci > /tmp/install.log 2>&1 || npm install > /tmp/install.log 2>&1 || { echo "dependency install FAILED"; tail -30 /tmp/install.log; }
  fi
  has_script typecheck && run_check "npm run typecheck" npm run --silent typecheck
  has_script lint && run_check "npm run lint" npm run --silent lint
  has_script test && run_check "npm test" npm test --silent
  has_script build && run_check "npm run build" npm run --silent build
fi

if [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then
  FOUND=1
  echo "== python project =="
  [ -f requirements.txt ] && (pip install -q -r requirements.txt > /tmp/pipinstall.log 2>&1 || echo "pip install failed")
  command -v ruff >/dev/null 2>&1 && run_check "ruff" ruff check .
  command -v pytest >/dev/null 2>&1 && run_check "pytest" pytest -q
fi

if [ -f go.mod ]; then
  FOUND=1
  echo "== go project =="
  run_check "go vet" go vet ./...
  run_check "go test" go test ./...
fi

if [ -f Cargo.toml ]; then
  FOUND=1
  echo "== rust project =="
  run_check "cargo test" cargo test
fi

if [ "$FOUND" = "0" ] && [ -f Makefile ]; then
  FOUND=1
  echo "== makefile =="
  run_check "make test" make test
fi

if [ "$FOUND" = "0" ]; then
  echo "no recognised project manifest (package.json, pyproject.toml, go.mod, Cargo.toml, Makefile)"
  echo "files present:"
  ls -1 | head -30
fi

# Propagate failure. Every run_check returned 0 so the suite would finish, which
# left the script exiting 0 with failing tests in its output — a task could be
# judged "checks passed" on a red build.
if [ "$FAILED" = "1" ]; then
  echo "CHECKS FAILED"
  exit 1
fi
[ "$FOUND" = "1" ] && echo "ALL CHECKS PASSED"
exit 0
`.replace('${WORKDIR_PLACEHOLDER}', WORKDIR)

interface WorkspaceInput {
  path?: string
  content?: string
  command?: string
  repo?: string
  branch?: string
}

/** Tools accept either JSON or a bare string, matching the rest of the toolset. */
function parseWorkspaceInput(raw: string): WorkspaceInput {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as WorkspaceInput
    } catch {
      /* not JSON after all — fall through */
    }
  }
  return { command: trimmed, path: trimmed, repo: trimmed }
}

async function runWorkspaceTool(
  tool: ToolKind,
  raw: string,
  apiKey: string,
  priorSandbox?: string,
): Promise<{ output: string; sandboxId: string }> {
  const spec = parseWorkspaceInput(raw)
  const cd = `mkdir -p ${WORKDIR} && cd ${WORKDIR}`

  if (tool === 'workspace_write_file') {
    const path = spec.path?.trim()
    if (!path) return { output: '[error] workspace_write_file needs {"path","content"}', sandboxId: priorSandbox ?? '' }
    const script = `${cd} && ${writeFileScript(path, spec.content ?? '')}`
    const { result, sandboxId } = await sandboxShell(priorSandbox, script, apiKey)
    return { output: formatCommand('workspace_write_file', result), sandboxId }
  }

  if (tool === 'workspace_read_file') {
    const path = spec.path?.trim()
    if (!path) return { output: '[error] workspace_read_file needs {"path"}', sandboxId: priorSandbox ?? '' }
    const { result, sandboxId } = await sandboxShell(priorSandbox, `${cd} && cat ${shellQuote(path)}`, apiKey)
    return { output: formatCommand('workspace_read_file', result), sandboxId }
  }

  if (tool === 'workspace_ls') {
    const path = spec.path?.trim() || '.'
    const script = `${cd} && ls -la ${shellQuote(path)} 2>/dev/null || find ${shellQuote(path)} -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -200`
    const { result, sandboxId } = await sandboxShell(priorSandbox, script, apiKey)
    return { output: formatCommand('workspace_ls', result), sandboxId }
  }

  if (tool === 'git_clone') {
    const repo = spec.repo?.trim()
    if (!repo) return { output: '[error] git_clone needs {"repo"}', sandboxId: priorSandbox ?? '' }
    if (!/^https:\/\/[\w.-]+\/[\w./-]+$/.test(repo)) {
      return { output: `[error] git_clone only accepts https repo URLs, got "${repo.slice(0, 80)}"`, sandboxId: priorSandbox ?? '' }
    }
    const branch = spec.branch?.trim()
    // GIT_TERMINAL_PROMPT=0: a private or misspelled repo returns 404, which
    // makes git ask for a username. With no terminal that either hangs until
    // the timeout or dies with a confusing "No such device" — both read as a
    // sandbox fault rather than "that repo is not reachable".
    const script =
      `mkdir -p ${WORKDIR} && cd ${WORKDIR} && ` +
      `GIT_TERMINAL_PROMPT=0 git clone --depth 1 ${branch ? `--branch ${shellQuote(branch)} ` : ''}${shellQuote(repo)} . 2>&1 && ` +
      `git log --oneline -1`
    const { result, sandboxId } = await sandboxShell(priorSandbox, script, apiKey, 180)
    return { output: formatCommand('git_clone', result), sandboxId }
  }

  if (tool === 'run_checks') {
    const { result, sandboxId } = await sandboxShell(priorSandbox, CHECKS_SCRIPT, apiKey, 600)
    return { output: formatCommand('run_checks', result), sandboxId }
  }

  // workspace_run and legacy run_code
  const command =
    tool === 'run_code'
      ? `python3 -c ${shellQuote(raw)}`
      : (spec.command ?? raw).trim()
  if (!command) return { output: '[error] no command given', sandboxId: priorSandbox ?? '' }

  const { result, sandboxId } = await sandboxShell(priorSandbox, `${cd} && ${command}`, apiKey, 240)
  return { output: formatCommand(tool, result), sandboxId }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only', ok: false, source: 'mock', output: '' })

  let body: {
    tool?: unknown; input?: unknown; keys?: unknown; sandboxId?: unknown
    platformKeys?: unknown
  }
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(400, { error: 'body must be JSON', ok: false, source: 'mock', output: '' })
  }

  const tool = body.tool as ToolKind
  if (!ALL_TOOL_KINDS.includes(tool)) {
    return json(400, { error: `tool must be one of ${ALL_TOOL_KINDS.join(' | ')}`, ok: false, source: 'mock', output: '' })
  }
  const input = typeof body.input === 'string' ? body.input : ''
  const keys = (body.keys && typeof body.keys === 'object' ? body.keys : {}) as Record<string, unknown>
  // Opt-in, not a fallback. A caller funding its own run must never draw on
  // this deployment's credentials just because it forgot to send a key — that
  // silently billed every customer's tool calls to the operator. Absent means
  // "my keys only"; the caller says so explicitly when it wants platform ones.
  const allowPlatform = body.platformKeys === true
  const e2b = (typeof keys.e2b === 'string' && keys.e2b) || (allowPlatform ? Deno.env.get('E2B_API_KEY') || '' : '')
  // Sent by the client so successive calls land in the same machine.
  const priorSandbox = typeof body.sandboxId === 'string' && body.sandboxId ? body.sandboxId : undefined

  try {
    if (tool === 'web_search') {
      return json(200, { ok: true, source: 'live', output: await liveSearch(input, keys, allowPlatform) })
    }
    if (tool === 'browse_url') {
      return json(200, { ok: true, source: 'live', output: await liveBrowse(input, keys, allowPlatform) })
    }
    if (tool === 'web_act') {
      return json(200, { ok: true, source: 'live', output: await liveWebAct(input, keys, allowPlatform) })
    }
    if ((tool === 'run_code' || WORKSPACE_TOOLS.includes(tool)) && e2b) {
      const { output, sandboxId } = await runWorkspaceTool(tool, input, e2b, priorSandbox)
      return json(200, { ok: true, source: 'live', output, sandboxId })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json(200, {
      ok: false,
      source: 'mock',
      output: `[LIVE FAILED → MOCK] ${msg}\n\n${mock(tool, input)}`,
    })
  }

  return json(200, { ok: true, source: 'mock', output: mock(tool, input) })
})
