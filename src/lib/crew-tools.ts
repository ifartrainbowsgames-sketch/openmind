// Crew tools — search/browse/code for the multi-agent crew.
// Live search/browse/code go through `agent-tools` (DuckDuckGo / SearXNG / Jina / E2B).
// GitHub writes go through `nango-act` when the thread workspace is GitHub · main.
// Tavily, Firecrawl, and E2B are optional upgrades. No proxy → stamped mocks.

import { nangoLinked, customerConnectError } from './nango'
import { stripWorkspacePrompt, type WorkspaceSpace } from './workspace'

export type CrewToolKind =
  | 'web_search'
  | 'browse_url'
  | 'run_code'
  | 'github_write_file'
  | 'github_create_branch'
  | 'github_open_pr'
  | 'slack_post'
  | 'gmail_send'
  | 'gdrive_list'

export type GithubCrewToolKind = 'github_write_file' | 'github_create_branch' | 'github_open_pr'
export type NangoAppToolKind = 'slack_post' | 'gmail_send' | 'gdrive_list'

export interface CrewToolKeys {
  tavily?: string
  firecrawl?: string
  e2b?: string
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

export function setActiveCrewToolKeys(keys: CrewToolKeys = {}): void {
  activeKeys = {
    tavily: keys.tavily?.trim() || undefined,
    firecrawl: keys.firecrawl?.trim() || undefined,
    e2b: keys.e2b?.trim() || undefined,
  }
}

export function getActiveCrewToolKeys(): CrewToolKeys {
  return { ...activeKeys }
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
  return kind === 'slack_post' || kind === 'gmail_send' || kind === 'gdrive_list'
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
    if (isGithubCrewTool(kind)) {
      return `[MOCK · ${kind}] No GitHub workspace on this thread. Pick GitHub · main so the crew can write to a repo.`
    }
    return `[MOCK · ${kind}] Connect this app first (Connect GitHub / Slack / Gmail), then try again.\n\n${mockCrewTool(kind, input)}`
  }

  const url = supabaseFnUrl('nango-act')
  if (!url) return mockCrewTool(kind, input)

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
    const count = typeof data.count === 'number' ? data.count : 0
    const names = typeof data.names === 'string' ? data.names : JSON.stringify(data.files ?? [])
    return `[LIVE · gdrive_list] ${count} file(s): ${names}`
  } catch (err) {
    const msg = customerConnectError(err)
    return `[LIVE FAILED → MOCK] ${msg}\n\n${mockCrewTool(kind, input)}`
  }
}

export async function invokeCrewTool(kind: CrewToolKind, input: string, keys = getActiveCrewToolKeys()): Promise<string> {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {}
  if (env.MODE === 'test' || env.VITEST) return mockCrewTool(kind, input)

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
        body: JSON.stringify({ tool: kind, input, keys }),
        signal: AbortSignal.timeout(28_000),
      })
      const data = (await res.json()) as Partial<CrewToolResponse> & { error?: string }
      if (res.ok && typeof data.output === 'string') return data.output
      if (typeof data.output === 'string') return data.output
    } catch {
      /* fall through to mock */
    }
  }
  return mockCrewTool(kind, input)
}
