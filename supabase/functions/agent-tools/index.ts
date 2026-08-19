// agent-tools — Supabase Edge Function (Deno)
// Defaults: DuckDuckGo / SearXNG search, Jina Reader + fetch/Readability browse.
// Optional upgrades: Tavily, Firecrawl. Code still uses E2B when a key is set.

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

type ToolKind = 'web_search' | 'browse_url' | 'run_code'

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
  return `[MOCK · run_code] Simulated sandbox for:\n${q.slice(0, 300)}\nAdd E2B_API_KEY for real execution.`
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

async function e2bRun(code: string, apiKey: string): Promise<string> {
  const create = await fetch('https://api.e2b.dev/sandboxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ templateID: 'base' }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const createdText = await create.text()
  if (!create.ok) throw new Error(`e2b create ${create.status}: ${createdText.slice(0, 180)}`)
  const created = JSON.parse(createdText) as { sandboxID?: string; sandboxId?: string; id?: string }
  const sandboxId = created.sandboxID ?? created.sandboxId ?? created.id
  if (!sandboxId) throw new Error('e2b create: missing sandbox id')
  try {
    const run = await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ cmd: 'python', args: ['-c', code], timeout: 15 }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    const runText = await run.text()
    if (!run.ok) throw new Error(`e2b run ${run.status}: ${runText.slice(0, 180)}`)
    return `[LIVE · run_code]\n${runText.slice(0, 4000)}`
  } finally {
    await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    }).catch(() => undefined)
  }
}

async function liveSearch(query: string, keys: Record<string, unknown>): Promise<string> {
  const tavily = (typeof keys.tavily === 'string' && keys.tavily) || Deno.env.get('TAVILY_API_KEY') || ''
  const searx = (typeof keys.searxngUrl === 'string' && keys.searxngUrl) || Deno.env.get('SEARXNG_URL') || ''
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

async function liveBrowse(input: string, keys: Record<string, unknown>): Promise<string> {
  const target = firstHttpUrl(input)
  const firecrawl = (typeof keys.firecrawl === 'string' && keys.firecrawl) || Deno.env.get('FIRECRAWL_API_KEY') || ''
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only', ok: false, source: 'mock', output: '' })

  let body: { tool?: unknown; input?: unknown; keys?: unknown }
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(400, { error: 'body must be JSON', ok: false, source: 'mock', output: '' })
  }

  const tool = body.tool
  if (tool !== 'web_search' && tool !== 'browse_url' && tool !== 'run_code') {
    return json(400, { error: 'tool must be web_search | browse_url | run_code', ok: false, source: 'mock', output: '' })
  }
  const input = typeof body.input === 'string' ? body.input : ''
  const keys = (body.keys && typeof body.keys === 'object' ? body.keys : {}) as Record<string, unknown>
  const e2b = (typeof keys.e2b === 'string' && keys.e2b) || Deno.env.get('E2B_API_KEY') || ''

  try {
    if (tool === 'web_search') {
      return json(200, { ok: true, source: 'live', output: await liveSearch(input, keys) })
    }
    if (tool === 'browse_url') {
      return json(200, { ok: true, source: 'live', output: await liveBrowse(input, keys) })
    }
    if (tool === 'run_code' && e2b) {
      return json(200, { ok: true, source: 'live', output: await e2bRun(input, e2b) })
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
