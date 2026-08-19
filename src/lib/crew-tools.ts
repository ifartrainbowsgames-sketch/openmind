// Crew tools — search/browse/code for the multi-agent crew.
// Live search/browse/code go through `agent-tools` (DuckDuckGo / SearXNG / Jina / E2B).
// GitHub writes go through `nango-act` when the thread workspace is GitHub · main.
// Tavily, Firecrawl, and E2B are optional upgrades. No proxy → stamped mocks.

import { nangoLinked } from './nango'
import type { WorkspaceSpace } from './workspace'

export type CrewToolKind =
  | 'web_search'
  | 'browse_url'
  | 'run_code'
  | 'github_write_file'
  | 'github_create_branch'
  | 'github_open_pr'

export type GithubCrewToolKind = 'github_write_file' | 'github_create_branch' | 'github_open_pr'

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

export function sanitizeRepoPath(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '').trim()
  return clean.slice(0, 240) || 'openmind.md'
}

export function parseGithubWriteInput(input: string): GithubWriteFile {
  const raw = input.trim()
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.path === 'string' && typeof parsed.content === 'string') {
        const path = sanitizeRepoPath(parsed.path)
        return {
          path,
          content: parsed.content,
          message: typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : `Update ${path}`,
          branch: typeof parsed.branch === 'string' && parsed.branch.trim() ? parsed.branch.trim() : undefined,
        }
      }
    } catch {
      /* fall through */
    }
  }

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

  return {
    path: 'openmind.md',
    message: (raw.slice(0, 72).replace(/\s+/g, ' ') || 'OpenMind update').trim(),
    content: `# OpenMind\n\n${raw.slice(0, 8000)}\n`,
  }
}

export function parseGithubPrInput(input: string, defaultBase: string): GithubPullRequest {
  const raw = input.trim()
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
  const raw = input.trim()
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
      if (name) {
        return {
          name,
          from: typeof parsed.from === 'string' && parsed.from.trim() ? parsed.from.trim() : defaultFrom,
        }
      }
    } catch {
      /* fall through */
    }
  }
  const token = raw.split(/\s+/)[0] || 'openmind'
  return { name: token.replace(/^refs\/heads\//, ''), from: defaultFrom }
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

async function invokeGithubCrewTool(kind: GithubCrewToolKind, input: string): Promise<string> {
  const planned = buildNangoGithubAction(kind, input, getActiveWorkspace())
  if (!planned) {
    return `[MOCK · ${kind}] No GitHub workspace on this thread. Pick GitHub · main so the crew can write to a repo.`
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
      const err = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
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
    const html = typeof data.html_url === 'string' ? data.html_url : ''
    const number = typeof data.number === 'number' ? `#${data.number}` : 'PR'
    return `[LIVE · github_open_pr] Opened ${number}${html ? ` — ${html}` : ''}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `[LIVE FAILED → MOCK] ${msg}\n\n${mockCrewTool(kind, input)}`
  }
}

export async function invokeCrewTool(kind: CrewToolKind, input: string, keys = getActiveCrewToolKeys()): Promise<string> {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {}
  if (env.MODE === 'test' || env.VITEST) return mockCrewTool(kind, input)

  if (isGithubCrewTool(kind)) return invokeGithubCrewTool(kind, input)

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
