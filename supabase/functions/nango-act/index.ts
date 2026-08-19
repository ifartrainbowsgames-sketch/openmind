// nango-act — Nango proxy actions: GitHub create repo / put file / branch / PR, Slack post.
// POST { action, providerId, connectionId?, userId?, ... }
// Env: NANGO_SECRET_KEY, optional NANGO_HOST

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function proxyHeaders(secret: string, providerId: string, connectionId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
    'Provider-Config-Key': providerId,
    'Connection-Id': connectionId,
    'Content-Type': 'application/json',
  }
}

type NangoConnectionRow = {
  connection_id?: unknown
  connectionId?: unknown
  provider?: unknown
  provider_config_key?: unknown
  created?: unknown
  created_at?: unknown
  updated_at?: unknown
  end_user?: { id?: unknown }
  tags?: { end_user_id?: unknown }
  metadata?: { end_user_id?: unknown }
}

function asId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function connectionTime(row: NangoConnectionRow): number {
  const raw = row.updated_at ?? row.created_at ?? row.created
  const t = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : NaN
  return Number.isFinite(t) ? t : 0
}

function matchesProvider(row: NangoConnectionRow, providerId: string): boolean {
  const key = asId(row.provider_config_key)
  const provider = asId(row.provider)
  return key === providerId || provider === providerId || key.startsWith(providerId) || provider.startsWith(providerId)
}

function matchesEndUser(row: NangoConnectionRow, userId: string): boolean {
  return asId(row.tags?.end_user_id) === userId
    || asId(row.end_user?.id) === userId
    || asId(row.metadata?.end_user_id) === userId
}

async function resolveConnectionId(
  host: string,
  secret: string,
  providerId: string,
  requested: string,
  userId: string,
): Promise<string> {
  if (requested) return requested
  if (!userId) {
    throw new Error('Sign in and Connect your own apps — we will not use another customer\'s account')
  }

  const res = await fetch(`${host}/connections`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let parsed: { connections?: NangoConnectionRow[]; data?: NangoConnectionRow[] }
  try {
    parsed = JSON.parse(text) as { connections?: NangoConnectionRow[]; data?: NangoConnectionRow[] }
  } catch {
    throw new Error('Could not list Nango connections')
  }
  if (!res.ok) throw new Error(`Nango connections HTTP ${res.status}`)

  const rows = Array.isArray(parsed.connections) ? parsed.connections
    : Array.isArray(parsed.data) ? parsed.data : []
  const matches = rows.filter((row) => matchesProvider(row, providerId))
  const tagged = matches.filter((row) => matchesEndUser(row, userId))
  const pool = tagged.slice().sort((a, b) => connectionTime(b) - connectionTime(a))
  const id = asId(pool[0]?.connection_id) || asId(pool[0]?.connectionId)
  if (!id) {
    throw new Error('No connection for this customer — Connect your own GitHub, Slack, or Gmail in the app')
  }
  return id
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const secret = Deno.env.get('NANGO_SECRET_KEY') ?? ''
  const host = (Deno.env.get('NANGO_HOST') ?? 'https://api.nango.dev').replace(/\/$/, '')
  if (!secret) return json(501, { error: 'Connect is not configured yet' })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(400, { error: 'JSON body required' })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const providerId = typeof body.providerId === 'string' ? body.providerId : ''
  const requestedId = asId(body.connectionId)
  const userId = asId(body.userId)
  if (!providerId) return json(400, { error: 'providerId required' })

  let connectionId: string
  try {
    connectionId = await resolveConnectionId(host, secret, providerId, requestedId, userId)
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : String(err) })
  }

  const headers = proxyHeaders(secret, providerId, connectionId)

  try {
    if (action === 'github.putFile' || action === 'github.createBranch' || action === 'github.openPr') {
      const parsedRepo = parseRepo(body)
      if (!parsedRepo) return json(400, { error: 'repo must be owner/name' })
      if (action === 'github.putFile') return await githubPutFile(host, headers, parsedRepo, body)
      if (action === 'github.createBranch') return await githubCreateBranch(host, headers, parsedRepo, body)
      return await githubOpenPr(host, headers, parsedRepo, body)
    }

    if (action === 'github.createRepo') {
      const name = typeof body.name === 'string' ? body.name : ''
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return json(400, { error: 'invalid repo name' })
      const res = await fetch(`${host}/proxy/user/repos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          description: typeof body.description === 'string' ? body.description : '',
          private: false,
          auto_init: true,
        }),
        signal: AbortSignal.timeout(20_000),
      })
      const text = await res.text()
      let parsed: { html_url?: string; full_name?: string; message?: string }
      try {
        parsed = JSON.parse(text) as { html_url?: string; full_name?: string; message?: string }
      } catch {
        return json(res.ok ? 200 : res.status, { error: text.slice(0, 240) })
      }
      if (!res.ok) return json(res.status, { error: parsed.message ?? text.slice(0, 240) })
      return json(200, { html_url: parsed.html_url, full_name: parsed.full_name })
    }

    if (action === 'slack.post') {
      const text = typeof body.text === 'string' ? body.text : ''
      const channel = typeof body.channel === 'string' ? body.channel : 'general'
      const res = await fetch(`${host}/proxy/chat.postMessage`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel, text }),
        signal: AbortSignal.timeout(20_000),
      })
      const raw = await res.text()
      let parsed: { ok?: boolean; error?: string }
      try {
        parsed = JSON.parse(raw) as { ok?: boolean; error?: string }
      } catch {
        return json(res.status >= 400 ? res.status : 502, { error: raw.slice(0, 240) })
      }
      if (!res.ok || parsed.ok === false) return json(res.status >= 400 ? res.status : 502, { error: parsed.error ?? raw.slice(0, 240) })
      return json(200, { ok: true, channel })
    }

    if (action === 'gmail.send') {
      const to = typeof body.to === 'string' ? body.to.trim() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json(400, { error: 'to must be an email' })
      const subject = typeof body.subject === 'string' ? body.subject.slice(0, 200) : 'OpenMind'
      const bodyText = typeof body.body === 'string' ? body.body.slice(0, 20_000) : ''
      const raw = rfc822Base64Url(to, subject, bodyText)
      const sent = await githubJson(host, headers, 'POST', '/gmail/v1/users/me/messages/send', { raw })
      if (!sent.ok) {
        const err = typeof sent.data.message === 'string' ? sent.data.message : sent.text.slice(0, 240)
        return json(sent.status, { error: err })
      }
      return json(200, { id: sent.data.id, threadId: sent.data.threadId })
    }

    if (action === 'gmail.list') {
      const query = typeof body.query === 'string' ? body.query.replace(/["\\]/g, '').slice(0, 120) : ''
      const q = query ? `&q=${encodeURIComponent(query)}` : ''
      const listed = await githubJson(host, headers, 'GET', `/gmail/v1/users/me/messages?maxResults=5${q}`)
      if (!listed.ok) {
        const err = typeof listed.data.message === 'string' ? listed.data.message : listed.text.slice(0, 240)
        return json(listed.status, { error: err })
      }
      const rows = Array.isArray(listed.data.messages) ? listed.data.messages as { id?: string }[] : []
      const lines: string[] = []
      for (const row of rows.slice(0, 5)) {
        const id = typeof row.id === 'string' ? row.id : ''
        if (!id) continue
        const got = await githubJson(
          host,
          headers,
          'GET',
          `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        )
        const headersList = Array.isArray((got.data.payload as { headers?: { name?: string; value?: string }[] } | undefined)?.headers)
          ? (got.data.payload as { headers: { name?: string; value?: string }[] }).headers
          : []
        const from = headersList.find((h) => h.name === 'From')?.value ?? ''
        const subject = headersList.find((h) => h.name === 'Subject')?.value ?? ''
        const snippet = typeof got.data.snippet === 'string' ? got.data.snippet : ''
        lines.push(`${id} | ${from} | ${subject} | ${snippet}`)
      }
      return json(200, { summary: lines.join('\n') || '(empty inbox)', count: lines.length })
    }

    if (action === 'gmail.read') {
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) return json(400, { error: 'id required' })
      const got = await githubJson(
        host,
        headers,
        'GET',
        `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      )
      if (!got.ok) {
        const err = typeof got.data.message === 'string' ? got.data.message : got.text.slice(0, 240)
        return json(got.status, { error: err })
      }
      const snippet = typeof got.data.snippet === 'string' ? got.data.snippet : ''
      const payload = got.data.payload as { headers?: { name?: string; value?: string }[]; body?: { data?: string }; parts?: { mimeType?: string; body?: { data?: string } }[] } | undefined
      const headersList = Array.isArray(payload?.headers) ? payload.headers : []
      const from = headersList.find((h) => h.name === 'From')?.value ?? ''
      const subject = headersList.find((h) => h.name === 'Subject')?.value ?? ''
      let text = snippet
      const parts = payload?.parts ?? []
      const plain = parts.find((p) => p.mimeType === 'text/plain')?.body?.data ?? payload?.body?.data
      if (typeof plain === 'string' && plain) {
        try {
          const pad = plain.replace(/-/g, '+').replace(/_/g, '/')
          text = atob(pad).slice(0, 4000)
        } catch {
          text = snippet
        }
      }
      return json(200, { summary: `From: ${from}\nSubject: ${subject}\n\n${text}`, id })
    }

    if (action === 'gdrive.list') {
      const query = typeof body.query === 'string' ? body.query.replace(/['\\]/g, '').slice(0, 120) : ''
      const q = query ? `&q=${encodeURIComponent(`name contains '${query}'`)}` : ''
      const listed = await githubJson(
        host,
        headers,
        'GET',
        `/drive/v3/files?pageSize=8&fields=files(id,name,mimeType,webViewLink)${q}`,
      )
      if (!listed.ok) {
        const err = typeof listed.data.message === 'string' ? listed.data.message : listed.text.slice(0, 240)
        return json(listed.status, { error: err })
      }
      const files = Array.isArray(listed.data.files) ? listed.data.files as { name?: string; webViewLink?: string }[] : []
      return json(200, {
        count: files.length,
        names: files.map((f) => f.name).filter(Boolean).join(', '),
        files,
      })
    }
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : String(err) })
  }

  return json(400, { error: 'unknown action' })
})

function parseRepo(body: Record<string, unknown>): { owner: string; repo: string } | null {
  const full = typeof body.repo === 'string' ? body.repo.trim() : ''
  const m = full.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (m) return { owner: m[1], repo: m[2] }
  const owner = typeof body.owner === 'string' ? body.owner.trim() : ''
  const repo = typeof body.name === 'string' ? body.name.trim() : ''
  if (owner && repo) return { owner, repo }
  return null
}

function encodeContentPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function rfc822Base64Url(to: string, subject: string, body: string): string {
  const msg = `To: ${to}\r\nSubject: ${subject.replace(/[\r\n]+/g, ' ')}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  return utf8ToBase64(msg).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function githubJson(
  host: string,
  headers: Record<string, string>,
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; text: string }> {
  const res = await fetch(`${host}/proxy${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = { message: text.slice(0, 240) }
  }
  return { ok: res.ok, status: res.status, data, text }
}

async function githubPutFile(
  host: string,
  headers: Record<string, string>,
  repo: { owner: string; repo: string },
  body: Record<string, unknown>,
): Promise<Response> {
  const path = typeof body.path === 'string' ? body.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '') : ''
  if (!path || path.length > 240) return json(400, { error: 'path required' })
  const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : `Update ${path}`
  const content = typeof body.content === 'string' ? body.content : ''
  const branch = typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : 'main'
  const encoded = encodeContentPath(path)
  const existing = await githubJson(
    host,
    headers,
    'GET',
    `/repos/${repo.owner}/${repo.repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
  )
  const sha = typeof existing.data.sha === 'string' ? existing.data.sha : undefined
  const put = await githubJson(host, headers, 'PUT', `/repos/${repo.owner}/${repo.repo}/contents/${encoded}`, {
    message,
    content: utf8ToBase64(content),
    branch,
    ...(sha ? { sha } : {}),
  })
  if (!put.ok) {
    const err = typeof put.data.message === 'string' ? put.data.message : put.text.slice(0, 240)
    return json(put.status, { error: err })
  }
  const contentObj = put.data.content as { html_url?: string; path?: string } | undefined
  return json(200, {
    path: contentObj?.path ?? path,
    html_url: contentObj?.html_url,
    sha: typeof (put.data.content as { sha?: string } | undefined)?.sha === 'string'
      ? (put.data.content as { sha: string }).sha
      : undefined,
  })
}

async function githubCreateBranch(
  host: string,
  headers: Record<string, string>,
  repo: { owner: string; repo: string },
  body: Record<string, unknown>,
): Promise<Response> {
  const name = typeof body.name === 'string' ? body.name.replace(/^refs\/heads\//, '').trim() : ''
  if (!/^[A-Za-z0-9._\/-]{1,80}$/.test(name)) return json(400, { error: 'invalid branch name' })
  const from = typeof body.from === 'string' && body.from.trim() ? body.from.trim() : 'main'
  const ref = await githubJson(host, headers, 'GET', `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(from)}`)
  const obj = ref.data.object as { sha?: string } | undefined
  const sha = typeof obj?.sha === 'string' ? obj.sha : typeof ref.data.sha === 'string' ? ref.data.sha : ''
  if (!ref.ok || !sha) {
    const err = typeof ref.data.message === 'string' ? ref.data.message : `could not read ${from}`
    return json(ref.ok ? 502 : ref.status, { error: err })
  }
  const created = await githubJson(host, headers, 'POST', `/repos/${repo.owner}/${repo.repo}/git/refs`, {
    ref: `refs/heads/${name}`,
    sha,
  })
  if (!created.ok) {
    const msg = typeof created.data.message === 'string' ? created.data.message : created.text.slice(0, 240)
    if (created.status === 422 && /already exists/i.test(msg)) return json(200, { ref: `refs/heads/${name}`, existed: true })
    return json(created.status, { error: msg })
  }
  return json(200, { ref: typeof created.data.ref === 'string' ? created.data.ref : `refs/heads/${name}` })
}

async function githubOpenPr(
  host: string,
  headers: Record<string, string>,
  repo: { owner: string; repo: string },
  body: Record<string, unknown>,
): Promise<Response> {
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : ''
  if (!title) return json(400, { error: 'title required' })
  const head = typeof body.head === 'string' && body.head.trim() ? body.head.trim() : ''
  if (!head) return json(400, { error: 'head branch required' })
  const base = typeof body.base === 'string' && body.base.trim() ? body.base.trim() : 'main'
  const prBody = typeof body.body === 'string' ? body.body : ''
  const created = await githubJson(host, headers, 'POST', `/repos/${repo.owner}/${repo.repo}/pulls`, {
    title,
    head,
    base,
    body: prBody,
  })
  if (!created.ok) {
    const err = typeof created.data.message === 'string' ? created.data.message : created.text.slice(0, 240)
    return json(created.status, { error: err })
  }
  return json(200, {
    html_url: created.data.html_url,
    number: created.data.number,
    title: created.data.title,
  })
}
