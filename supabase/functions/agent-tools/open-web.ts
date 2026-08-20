// Keep in sync with src/lib/open-web.ts

export interface WebHit {
  title: string
  url: string
  snippet: string
}

export function firstHttpUrl(input: string): string {
  return input.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? input.trim()
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/gi, ' ')
}

export function unwrapDuckUrl(href: string): string {
  try {
    const u = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return uddg
    return u.toString()
  } catch {
    return href
  }
}

export function parseSearchHtml(html: string): WebHit[] {
  const hits: WebHit[] = []
  const seen = new Set<string>()
  const linkRe = /<a\b([^>]*class="[^"]*(?:result-link|result__a)[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html))) {
    const href = m[1].match(/href="([^"]+)"/i)?.[1]
    if (!href) continue
    const url = unwrapDuckUrl(decodeEntities(href))
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    const after = html.slice(m.index, m.index + 900)
    const snip = after.match(/class="[^"]*(?:result-snippet|result__snippet)[^"]*"[^>]*>([\s\S]*?)<\//i)
    const snippet = decodeEntities((snip?.[1] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    hits.push({ title, url, snippet })
    if (hits.length >= 5) break
  }
  return hits
}

export function parseSearxJson(raw: string): WebHit[] {
  const data = JSON.parse(raw) as { results?: { title?: string; url?: string; content?: string }[] }
  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, 5)
    .map((r) => ({
      title: String(r.title),
      url: String(r.url),
      snippet: String(r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 280),
    }))
}

export function formatHits(source: string, query: string, hits: WebHit[]): string {
  if (!hits.length) return `[LIVE · web_search · ${source}] No results for "${query}".`
  const lines = hits.map((h) => `• ${h.title} — ${h.url}${h.snippet ? `\n  ${h.snippet.slice(0, 280)}` : ''}`)
  return `[LIVE · web_search · ${source}] "${query}"\n${lines.join('\n')}`
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, 4000)
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') return true
  if (h.startsWith('[fe80:') || h.startsWith('[::')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}
