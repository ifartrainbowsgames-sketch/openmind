// Crew tools — search/browse/code for the multi-agent crew.
// Live search/browse/code go through `agent-tools` (DuckDuckGo / SearXNG / Jina / E2B).
// GitHub writes go through `nango-act` when the thread workspace is GitHub · main.
// Tavily, Firecrawl, and E2B are optional upgrades. No proxy → stamped mocks.

import { nangoLinked, customerConnectError } from './nango'
import { stripWorkspacePrompt, type WorkspaceSpace } from './workspace'
import { mockWebAct, parseWebActInput } from './web-act'
import { blockedMessage, isStrict } from './execution-mode'

export type CrewToolKind =
  | 'web_search'
  | 'browse_url'
  | 'web_act'
  | 'run_code'
  | 'github_write_file'
  | 'github_create_branch'
  | 'github_open_pr'
  | 'slack_post'
  | 'gmail_send'
  | 'gmail_list'
  | 'gmail_read'
  | 'gdrive_list'
  | 'workspace_run'
  | 'workspace_write_file'
  | 'workspace_read_file'
  | 'workspace_ls'
  | 'git_clone'
  | 'run_checks'

/** Tools that execute inside the project's sandbox — they share one machine. */
export type WorkspaceToolKind =
  | 'run_code'
  | 'workspace_run'
  | 'workspace_write_file'
  | 'workspace_read_file'
  | 'workspace_ls'
  | 'git_clone'
  | 'run_checks'

const WORKSPACE_TOOL_KINDS: WorkspaceToolKind[] = [
  'run_code', 'workspace_run', 'workspace_write_file', 'workspace_read_file', 'workspace_ls', 'git_clone', 'run_checks',
]

export function isWorkspaceTool(kind: CrewToolKind): kind is WorkspaceToolKind {
  return (WORKSPACE_TOOL_KINDS as CrewToolKind[]).includes(kind)
}

export type GithubCrewToolKind = 'github_write_file' | 'github_create_branch' | 'github_open_pr'
export type NangoAppToolKind = 'slack_post' | 'gmail_send' | 'gmail_list' | 'gmail_read' | 'gdrive_list'

export interface CrewToolKeys {
  tavily?: string
  firecrawl?: string
  e2b?: string
  browserless?: string
}

export interface CrewToolResponse {
  ok: boolean
  source: 'live' | 'mock'
  output: string
}

export interface GithubWriteFile {
  path: string
  message: string
  content: string
  branch?: string
}

export interface GithubPullRequest {
  title: string
  body: string
  head: string
  base: string
}

export interface GithubBranchSpec {
  name: string
  from: string
}

export interface NangoGithubAction {
  action: 'github.putFile' | 'github.createBranch' | 'github.openPr'
  body: Record<string, unknown>
}

let activeKeys: CrewToolKeys = {}
let activeWorkspace: WorkspaceSpace | undefined
let activeGuard: ((kind: CrewToolKind, summary: string) => Promise<boolean>) | undefined

/**
 * The sandbox every workspace tool in this run shares. Set once per project so
 * a clone survives into the install, and the install into the test run.
 */
let activeSandboxId: string | undefined

/**
 * Sandbox work (npm install, a test suite) outlasts a web search, and the
 * function itself allows up to 240s per command.
 */
const WORKSPACE_TIMEOUT_MS = 60_000

export interface WorkspaceToolInput {
  path?: string
  content?: string
  command?: string
  repo?: string
  branch?: string
}

/** Mirrors the edge function's parser: JSON when given, bare string otherwise. */
export function parseWorkspaceToolInput(input: string): WorkspaceToolInput {
  const trimmed = input.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as WorkspaceToolInput
    } catch {
      /* not JSON — treat as a bare command/path */
    }
  }
  return { command: trimmed, path: trimmed, repo: trimmed }
}

export function setActiveSandbox(id?: string): void {
  activeSandboxId = id?.trim() || undefined
}

export function getActiveSandbox(): string | undefined {
  return activeSandboxId
}

const RISKY_BROWSE = /checkout|payment|pay\.|cart|billing|wallet|bank|unsubscribe|delete[-_ ]?account/i

/**
 * Shell that escapes the disposable sandbox: publishing (git push, npm publish,
 * deploys), destructive paths outside the workdir, or piping the network
 * straight into an interpreter.
 */
const DESTRUCTIVE_SHELL =
  /\b(git\s+push|npm\s+publish|yarn\s+publish|pnpm\s+publish|docker\s+push|terraform\s+apply|kubectl\s+(apply|delete)|aws\s|gcloud\s|heroku\s|vercel\s+deploy|railway\s+up)\b|rm\s+-rf\s+\/(?!home\/user\/project)|\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?)\b/i

export function setCrewToolGuard(
  guard?: (kind: CrewToolKind, summary: string) => Promise<boolean>,
): void {
  activeGuard = guard
}

export function needsCrewToolConfirm(kind: CrewToolKind, input: string): boolean {
  if (
    kind === 'gmail_send' ||
    kind === 'slack_post' ||
    kind === 'github_write_file' ||
    kind === 'github_create_branch' ||
    kind === 'github_open_pr'
  ) {
    return true
  }
  if (kind === 'web_act') return true
  if (kind === 'browse_url') return RISKY_BROWSE.test(input)
  // Sandbox writes are cheap to undo (the machine is disposable), but a command
  // that pushes, deletes outside the workdir, or pipes the network into a shell
  // reaches past it. Those get a confirm.
  if (kind === 'workspace_run') return DESTRUCTIVE_SHELL.test(input)
  return false
}

export function crewToolConfirmSummary(kind: CrewToolKind, input: string): string {
  if (kind === 'gmail_send') {
    const spec = parseGmailSendInput(input)
    return `Send email to ${spec.to} — ${spec.subject}`
  }
  if (kind === 'slack_post') {
    const spec = parseSlackPostInput(input)
    return `Post to Slack #${spec.channel}: ${spec.text.slice(0, 160)}`
  }
  if (kind === 'github_write_file') {
    const file = parseGithubWriteInput(input)
    return `Commit ${file.path} (${file.message})`
  }
  if (kind === 'github_create_branch') {
    const spec = parseGithubBranchInput(input, getActiveWorkspace()?.branch ?? 'main')
    return `Create branch ${spec.name} from ${spec.from}`
  }
  if (kind === 'github_open_pr') {
    const pr = parseGithubPrInput(input, getActiveWorkspace()?.branch ?? 'main')
    return `Open PR "${pr.title}" (${pr.head} → ${pr.base})`
  }
  if (kind === 'web_act') {
    const spec = parseWebActInput(input)
    return `Use hosted Chrome on ${spec.url} — ${spec.goal || 'complete the page task'}`
  }
  if (kind === 'browse_url') {
    return `Open a page that looks financial or destructive:\n${input.trim().slice(0, 240)}`
  }
  if (kind === 'workspace_run') {
    return `Run in the sandbox — this command reaches outside it:\n${parseWorkspaceToolInput(input).command?.slice(0, 240) ?? input.slice(0, 240)}`
  }
  return `${kind}: ${input.trim().slice(0, 200)}`
}

export function setActiveCrewToolKeys(keys: CrewToolKeys = {}): void {
  activeKeys = {
    tavily: keys.tavily?.trim() || undefined,
    firecrawl: keys.firecrawl?.trim() || undefined,
    e2b: keys.e2b?.trim() || undefined,
    browserless: keys.browserless?.trim() || undefined,
  }
}

export function getActiveCrewToolKeys(): CrewToolKeys {
  return { ...activeKeys }
}

/**
 * Whether this run may draw on the deployment's own tool credentials.
 *
 * Off unless a platform-billed run turns it on. `agent-tools` used to fall
 * back to its environment whenever a key was absent, so a customer funding
 * their own model silently billed every search, scrape and sandbox to us.
 */
let platformKeysAllowed = false

export function setPlatformKeysAllowed(allowed: boolean): void {
  platformKeysAllowed = allowed
}

export function platformKeysAreAllowed(): boolean {
  return platformKeysAllowed
}

export function setActiveWorkspace(space?: WorkspaceSpace): void {
  activeWorkspace = space
}

export function getActiveWorkspace(): WorkspaceSpace | undefined {
  return activeWorkspace
}

export function isGithubCrewTool(kind: CrewToolKind): kind is GithubCrewToolKind {
  return kind === 'github_write_file' || kind === 'github_create_branch' || kind === 'github_open_pr'
}

export function isNangoAppTool(kind: CrewToolKind): kind is NangoAppToolKind {
  return kind === 'slack_post' || kind === 'gmail_send' || kind === 'gmail_list' || kind === 'gmail_read' || kind === 'gdrive_list'
}

function parseJsonRecord(input: string): Record<string, unknown> | null {
  const raw = input.trim()
  if (!raw.startsWith('{')) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function parseSlackPostInput(input: string): { text: string; channel: string } {
  const rec = parseJsonRecord(input)
  if (rec && typeof rec.text === 'string' && rec.text.trim()) {
    return {
      text: rec.text.trim().slice(0, 4000),
      channel: typeof rec.channel === 'string' && rec.channel.trim() ? rec.channel.trim() : 'general',
    }
  }
  return { text: input.trim().slice(0, 4000) || '(empty)', channel: 'general' }
}

export function parseGmailSendInput(input: string): { to: string; subject: string; body: string } {
  const rec = parseJsonRecord(input)
  if (rec && typeof rec.to === 'string' && rec.to.includes('@')) {
    return {
      to: rec.to.trim(),
      subject: typeof rec.subject === 'string' && rec.subject.trim() ? rec.subject.trim() : 'OpenMind',
      body: typeof rec.body === 'string' ? rec.body : typeof rec.text === 'string' ? rec.text : '',
    }
  }
  const m = input.match(/([^\s@]+@[^\s@]+)/)
  return {
    to: m?.[1] ?? 'you@example.com',
    subject: 'OpenMind',
    body: input.trim().slice(0, 8000),
  }
}

export function parseGdriveListInput(input: string): { query: string } {
  const rec = parseJsonRecord(input)
  if (rec && typeof rec.query === 'string') return { query: rec.query.trim().slice(0, 200) }
  return { query: input.trim().slice(0, 200) }
}

export function parseGmailListInput(input: string): { query: string } {
  const rec = parseJsonRecord(input)
  if (rec && typeof rec.query === 'string') return { query: rec.query.trim().slice(0, 200) }
  return { query: stripWorkspacePrompt(input).trim().slice(0, 200) }
}

export function parseGmailReadInput(input: string): { id: string } {
  const rec = parseJsonRecord(input)
  if (rec && typeof rec.id === 'string' && rec.id.trim()) return { id: rec.id.trim() }
  const token = stripWorkspacePrompt(input).trim().split(/\s+/)[0] ?? ''
  return { id: token.slice(0, 200) }
}

export function buildNangoAppAction(kind: NangoAppToolKind, input: string): { action: string; body: Record<string, unknown> } | null {
  if (kind === 'slack_post') {
    const linked = nangoLinked('slack')
    if (!linked) return null
    const spec = parseSlackPostInput(input)
    return {
      action: 'slack.post',
      body: { providerId: linked.providerId, connectionId: linked.connectionId, channel: spec.channel, text: spec.text },
    }
  }
  if (kind === 'gmail_send') {
    const linked = nangoLinked('gmail')
    if (!linked) return null
    const spec = parseGmailSendInput(input)
    return {
      action: 'gmail.send',
      body: { providerId: linked.providerId, connectionId: linked.connectionId, to: spec.to, subject: spec.subject, body: spec.body },
    }
  }
  if (kind === 'gmail_list') {
    const linked = nangoLinked('gmail')
    if (!linked) return null
    const spec = parseGmailListInput(input)
    return {
      action: 'gmail.list',
      body: { providerId: linked.providerId, connectionId: linked.connectionId, query: spec.query },
    }
  }
  if (kind === 'gmail_read') {
    const linked = nangoLinked('gmail')
    if (!linked) return null
    const spec = parseGmailReadInput(input)
    if (!spec.id) return null
    return {
      action: 'gmail.read',
      body: { providerId: linked.providerId, connectionId: linked.connectionId, id: spec.id },
    }
  }
  const linked = nangoLinked('gdrive')
  if (!linked) return null
  const spec = parseGdriveListInput(input)
  return {
    action: 'gdrive.list',
    body: { providerId: linked.providerId, connectionId: linked.connectionId, query: spec.query },
  }
}

export function sanitizeRepoPath(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '').trim()
  return clean.slice(0, 240) || 'openmind.md'
}

function recordToGithubWrite(parsed: Record<string, unknown>): GithubWriteFile | null {
  if (typeof parsed.path !== 'string' || typeof parsed.content !== 'string') return null
  const path = sanitizeRepoPath(parsed.path)
  return {
    path,
    content: parsed.content,
    message: typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : `Update ${path}`,
    branch: typeof parsed.branch === 'string' && parsed.branch.trim() ? parsed.branch.trim() : undefined,
  }
}

function extractBalancedObject(raw: string, start: number): string | null {
  if (start < 0 || raw[start] !== '{') return null
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

function tryParseGithubWriteJson(raw: string): GithubWriteFile | null {
  const rec = parseJsonRecord(raw)
  if (rec) return recordToGithubWrite(rec)
  const start = raw.search(/\{\s*"path"/)
  const blob = extractBalancedObject(raw, start)
  if (!blob) return null
  const nested = parseJsonRecord(blob)
  return nested ? recordToGithubWrite(nested) : null
}

function parseGithubWriteLegacy(raw: string): GithubWriteFile | null {
  const header = raw.match(/^FILE\s+(\S+)(?:\nMSG\s+(.+))?(?:\nBRANCH\s+(\S+))?\n---\n([\s\S]*)$/i)
  if (header) {
    const path = sanitizeRepoPath(header[1])
    return {
      path,
      message: header[2]?.trim() || `Update ${path}`,
      branch: header[3]?.trim() || undefined,
      content: header[4],
    }
  }
  const fence = raw.match(/```(?:[\w.+-]*)\s+(\S+)\n([\s\S]*?)```/)
  if (fence) {
    const path = sanitizeRepoPath(fence[1])
    return { path, content: fence[2].replace(/\n$/, ''), message: `Add ${path}` }
  }
  return null
}

export function parseGithubWriteInput(input: string): GithubWriteFile {
  const raw = input.trim()
  const user = stripWorkspacePrompt(raw)
  for (const candidate of [raw, user]) {
    const fromJson = tryParseGithubWriteJson(candidate)
    if (fromJson) return fromJson
    const legacy = parseGithubWriteLegacy(candidate)
    if (legacy) return legacy
  }

  const body = user || raw
  const looksWorkspace = /^(Coding space:|Delivery space:)/i.test(raw)
  if (looksWorkspace) {
    return {
      path: 'README.md',
      message: (body.split('\n')[0]?.replace(/\s+/g, ' ').trim().slice(0, 72) || 'OpenMind update'),
      content: `# OpenMind\n\n${body.slice(0, 8000)}\n`,
    }
  }

  return {
    path: 'openmind.md',
    message: (body.slice(0, 72).replace(/\s+/g, ' ') || 'OpenMind update').trim(),
    content: `# OpenMind\n\n${body.slice(0, 8000)}\n`,
  }
}

function plausibleBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(name) && /[-_/]/.test(name)
}

export function parseGithubPrInput(input: string, defaultBase: string): GithubPullRequest {
  const raw = stripWorkspacePrompt(input)
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      if (title) {
        return {
          title,
          body: typeof parsed.body === 'string' ? parsed.body : '',
          head: typeof parsed.head === 'string' && parsed.head.trim() ? parsed.head.trim() : 'openmind',
          base: typeof parsed.base === 'string' && parsed.base.trim() ? parsed.base.trim() : defaultBase,
        }
      }
    } catch {
      /* fall through */
    }
  }
  const first = raw.split('\n')[0]?.trim() || 'OpenMind changes'
  return {
    title: first.slice(0, 80),
    body: raw.slice(0, 4000),
    head: 'openmind',
    base: defaultBase,
  }
}

export function parseGithubBranchInput(input: string, defaultFrom: string): GithubBranchSpec {
  const raw = stripWorkspacePrompt(input)
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
      if (name) {
        return {
          name: name.replace(/^refs\/heads\//, ''),
          from: typeof parsed.from === 'string' && parsed.from.trim() ? parsed.from.trim() : defaultFrom,
        }
      }
    } catch {
      /* fall through */
    }
  }
  const token = (raw.split(/\s+/)[0] || '').replace(/^refs\/heads\//, '')
  if (plausibleBranchName(token)) return { name: token, from: defaultFrom }
  return { name: 'openmind', from: defaultFrom }
}

export function buildNangoGithubAction(
  kind: GithubCrewToolKind,
  input: string,
  space?: WorkspaceSpace,
): NangoGithubAction | null {
  if (space?.kind !== 'github') return null
  const linked = nangoLinked('github')
  const repo = space.repoName ?? space.slug
  const providerId = space.providerId ?? linked?.providerId ?? 'github'
  const connectionId = space.connectionId ?? linked?.connectionId
  const base = {
    providerId,
    connectionId,
    repo,
  }

  if (kind === 'github_write_file') {
    const file = parseGithubWriteInput(input)
    return {
      action: 'github.putFile',
      body: {
        ...base,
        path: file.path,
        message: file.message,
        content: file.content,
        branch: file.branch ?? space.branch,
      },
    }
  }

  if (kind === 'github_create_branch') {
    const spec = parseGithubBranchInput(input, space.branch)
    return {
      action: 'github.createBranch',
      body: { ...base, name: spec.name, from: spec.from },
    }
  }

  const pr = parseGithubPrInput(input, space.branch)
  return {
    action: 'github.openPr',
    body: {
      ...base,
      title: pr.title,
      body: pr.body,
      head: pr.head,
      base: pr.base,
    },
  }
}

export function mockCrewTool(kind: CrewToolKind, input: string, space = getActiveWorkspace()): string {
  const q = input.trim() || '(empty)'
  if (isWorkspaceTool(kind) && kind !== 'run_code') {
    const spec = parseWorkspaceToolInput(input)
    const detail =
      kind === 'git_clone' ? spec.repo : kind === 'workspace_run' ? spec.command : spec.path
    return `[MOCK · ${kind}] No sandbox configured — add an E2B key in Settings to give workers a real machine. Requested: ${(detail ?? q).slice(0, 200)}`
  }
  if (kind === 'web_search') {
    return `[MOCK · web_search] Top hits for "${q}":
• Open-source agent stacks in 2026 cluster around role-based crews, sandboxed code, and web research.
• Production setups keep LLM keys and sandbox keys off the browser and fan work to specialists.
• Cite this as a simulated result — deploy agent-tools for live DuckDuckGo / SearXNG search.`
  }
  if (kind === 'browse_url') {
    const url = q.split(/\s+/)[0]
    return `[MOCK · browse_url] Extract from ${url}:
The page describes a multi-agent workspace: a supervisor plans, specialists research/code/write, then a synthesizer returns artifacts (markdown briefs, HTML decks). Live scrape uses Jina Reader or a direct fetch once agent-tools is deployed.`
  }
  if (kind === 'web_act') {
    return mockWebAct(parseWebActInput(q))
  }
  if (kind === 'github_write_file') {
    const file = parseGithubWriteInput(q)
    const repo = space?.kind === 'github' ? (space.repoName ?? space.slug) : '(no GitHub workspace)'
    const branch = file.branch ?? space?.branch ?? 'main'
    return `[MOCK · github_write_file] Would commit \`${file.path}\` to ${repo}@${branch} — ${file.message}`
  }
  if (kind === 'github_create_branch') {
    const spec = parseGithubBranchInput(q, space?.branch ?? 'main')
    return `[MOCK · github_create_branch] Would create \`${spec.name}\` from ${spec.from}`
  }
  if (kind === 'github_open_pr') {
    const pr = parseGithubPrInput(q, space?.branch ?? 'main')
    const repo = space?.kind === 'github' ? (space.repoName ?? space.slug) : '(no GitHub workspace)'
    return `[MOCK · github_open_pr] Would open "${pr.title}" on ${repo}: ${pr.head} → ${pr.base}`
  }
  if (kind === 'slack_post') {
    const spec = parseSlackPostInput(q)
    return `[MOCK · slack_post] Would post to Slack #${spec.channel}: ${spec.text.slice(0, 200)}`
  }
  if (kind === 'gmail_send') {
    const spec = parseGmailSendInput(q)
    return `[MOCK · gmail_send] Would send to ${spec.to} — ${spec.subject}`
  }
  if (kind === 'gmail_list') {
    const spec = parseGmailListInput(q)
    return `[MOCK · gmail_list] Would list inbox${spec.query ? ` q="${spec.query}"` : ''}. Connect Gmail for live mail.`
  }
  if (kind === 'gmail_read') {
    const spec = parseGmailReadInput(q)
    return `[MOCK · gmail_read] Would open message ${spec.id || '(missing id)'}. Connect Gmail for live mail.`
  }
  if (kind === 'gdrive_list') {
    const spec = parseGdriveListInput(q)
    return `[MOCK · gdrive_list] Would list Drive files${spec.query ? ` matching "${spec.query}"` : ''}. Connect Drive for live results.`
  }
  return `[MOCK · run_code] Sandbox preview for:
${q.slice(0, 400)}

stdout:
(simulated) ran in a throwaway VM — no side effects. Deploy agent-tools with E2B_API_KEY for real execution. Edge Functions cannot run Docker.`
}

function supabaseFnUrl(name: string): string | null {
  // Read Vite env directly — do not import `./supabase` here. That module
  // constructs a client (localStorage) and would break Node test runs.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (url && key) return `${url.replace(/\/$/, '')}/functions/v1/${name}`
  return null
}

function anonKey(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
  return env.VITE_SUPABASE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? null
}

async function invokeNangoCrewTool(kind: GithubCrewToolKind | NangoAppToolKind, input: string): Promise<string> {
  const planned = isGithubCrewTool(kind)
    ? buildNangoGithubAction(kind, input, getActiveWorkspace())
    : buildNangoAppAction(kind, input)
  if (!planned) {
    const why = isGithubCrewTool(kind)
      ? 'no GitHub workspace on this thread — pick GitHub · main first'
      : 'app not connected — Connect GitHub / Slack / Gmail first'
    if (isStrict()) return blockedMessage('capability_unavailable', kind, why)
    if (isGithubCrewTool(kind)) return `[MOCK · ${kind}] ${why}.`
    return `[MOCK · ${kind}] ${why}.\n\n${mockCrewTool(kind, input)}`
  }

  const url = supabaseFnUrl('nango-act')
  if (!url) {
    if (isStrict()) return blockedMessage('capability_unavailable', kind, 'nango-act backend not configured')
    return mockCrewTool(kind, input)
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const key = anonKey()
    if (key) headers.Authorization = `Bearer ${key}`
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...planned.body, action: planned.action }),
      signal: AbortSignal.timeout(25_000),
    })
    const data = (await res.json()) as Record<string, unknown> & { error?: string }
    if (!res.ok) {
      const err = customerConnectError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
      if (isStrict()) return blockedMessage('tool_error', kind, err)
      return `[LIVE FAILED → MOCK] ${err}\n\n${mockCrewTool(kind, input)}`
    }
    if (kind === 'github_write_file') {
      const path = typeof data.path === 'string' ? data.path : parseGithubWriteInput(input).path
      const html = typeof data.html_url === 'string' ? ` — ${data.html_url}` : ''
      return `[LIVE · github_write_file] Committed \`${path}\`${html}`
    }
    if (kind === 'github_create_branch') {
      const name = typeof data.ref === 'string' ? data.ref : parseGithubBranchInput(input, 'main').name
      return `[LIVE · github_create_branch] ${name}`
    }
    if (kind === 'github_open_pr') {
      const html = typeof data.html_url === 'string' ? data.html_url : ''
      const number = typeof data.number === 'number' ? `#${data.number}` : 'PR'
      return `[LIVE · github_open_pr] Opened ${number}${html ? ` — ${html}` : ''}`
    }
    if (kind === 'slack_post') {
      const channel = typeof data.channel === 'string' ? data.channel : parseSlackPostInput(input).channel
      return `[LIVE · slack_post] Posted to Slack #${channel}`
    }
    if (kind === 'gmail_send') {
      const id = typeof data.id === 'string' ? data.id : ''
      return `[LIVE · gmail_send] Sent${id ? ` (${id})` : ''}`
    }
    if (kind === 'gmail_list') {
      const summary = typeof data.summary === 'string' ? data.summary : JSON.stringify(data.messages ?? data)
      return `[LIVE · gmail_list] ${summary}`
    }
    if (kind === 'gmail_read') {
      const summary = typeof data.summary === 'string' ? data.summary : JSON.stringify(data)
      return `[LIVE · gmail_read] ${summary}`
    }
    const count = typeof data.count === 'number' ? data.count : 0
    const names = typeof data.names === 'string' ? data.names : JSON.stringify(data.files ?? [])
    return `[LIVE · gdrive_list] ${count} file(s): ${names}`
  } catch (err) {
    const msg = customerConnectError(err)
    if (isStrict()) return blockedMessage('tool_error', kind, msg)
    return `[LIVE FAILED → MOCK] ${msg}\n\n${mockCrewTool(kind, input)}`
  }
}

/** Whether a real backend is reachable for this tool right now. */
export function isCrewToolLive(kind: CrewToolKind): boolean {
  if (isGithubCrewTool(kind) || isNangoAppTool(kind)) return !!supabaseFnUrl('nango-act')
  return !!supabaseFnUrl('agent-tools')
}

export async function invokeCrewTool(kind: CrewToolKind, input: string, keys = getActiveCrewToolKeys()): Promise<string> {
  if (needsCrewToolConfirm(kind, input)) {
    const allowed = await (activeGuard?.(kind, crewToolConfirmSummary(kind, input)) ?? Promise.resolve(true))
    if (!allowed) return `[BLOCKED · ${kind}] You declined this action.`
  }

  // Strict mode refuses canned data outright — a task that needed GitHub and
  // got a plausible-looking mock is a failure wearing a success costume.
  if (isStrict() && !isCrewToolLive(kind)) {
    return blockedMessage('capability_unavailable', kind, 'no live backend configured for this tool')
  }

  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {}
  if (env.MODE === 'test' || env.VITEST) {
    // The test environment has no live backend, so strict mode blocks here too
    // rather than letting the harness hand back canned data.
    if (isStrict()) return blockedMessage('capability_unavailable', kind, 'no live backend in the test environment')
    return mockCrewTool(kind, input)
  }

  if (isGithubCrewTool(kind) || isNangoAppTool(kind)) return invokeNangoCrewTool(kind, input)

  const url = supabaseFnUrl('agent-tools')
  if (url) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const key = anonKey()
      if (key) headers.Authorization = `Bearer ${key}`
      const res = await fetch(url, {
        method: 'POST',
        headers,
        // sandboxId keeps successive workspace calls on the same machine.
        body: JSON.stringify({
          tool: kind, input, keys,
          sandboxId: activeSandboxId,
          platformKeys: platformKeysAllowed,
        }),
        signal: AbortSignal.timeout(WORKSPACE_TIMEOUT_MS),
      })
      const data = (await res.json()) as Partial<CrewToolResponse> & { error?: string; sandboxId?: string }
      // Adopt the sandbox the function used — it may have created or replaced one.
      if (typeof data.sandboxId === 'string' && data.sandboxId) activeSandboxId = data.sandboxId
      if (res.ok && typeof data.output === 'string') return data.output
      if (typeof data.output === 'string') return data.output
    } catch (err) {
      if (isStrict()) {
        return blockedMessage('tool_error', kind, err instanceof Error ? err.message : String(err))
      }
      /* fall through to mock */
    }
  }
  if (isStrict()) return blockedMessage('capability_unavailable', kind, 'agent-tools backend returned no usable output')
  return mockCrewTool(kind, input)
}
