// Open Deep Research–shaped workflow in the existing SPA:
// split the question → parallel web_search → browse a few sources → cite.
import { stripWorkspacePrompt } from './workspace'
import { invokeCrewTool } from './crew-tools'

const MAX_QUERIES = 4
const MAX_BROWSE = 2

export function needsDeepResearch(task: string): boolean {
  const user = stripWorkspacePrompt(task)
  if (user.length < 90 && /\b(a team of|hire|staff a)\b/i.test(user)) return false
  return /\b(research|latest|trends?|compare|sources?|cite|what is|who is|investigate|look up|brief on)\b/i.test(user)
}

export function researchQueries(task: string): string[] {
  const user = stripWorkspacePrompt(task).replace(/\s+/g, ' ').trim()
  const core = user.slice(0, 220)
  const extra: string[] = []
  extra.push(core)
  extra.push(`${core} 2026`)
  extra.push(`${core} open source`)
  const parts = user.split(/\s+and\s+/i).map((p) => p.trim()).filter((p) => p.length > 12)
  if (parts.length > 1) extra.push(parts[0].slice(0, 180), parts[1].slice(0, 180))
  const seen = new Set<string>()
  const out: string[] = []
  for (const q of extra) {
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= MAX_QUERIES) break
  }
  return out
}

export function extractHttpUrls(text: string, limit = 6): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /https?:\/\/[^\s)\]>'"]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const url = m[0].replace(/[.,;]+$/, '')
    if (/duckduckgo\.com|google\.com\/search/i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= limit) break
  }
  return out
}

export function formatResearchDossier(
  task: string,
  legs: { query: string; hits: string }[],
  pages: { url: string; extract: string }[],
): string {
  const cites = extractHttpUrls(legs.map((l) => l.hits).join('\n'))
  const citeBlock = cites.length
    ? cites.map((u, i) => `[${i + 1}] ${u}`).join('\n')
    : '(no live URLs yet — search was mocked or blocked)'
  const legsBlock = legs
    .map((l) => `### Query: ${l.query}\n${l.hits.slice(0, 1800)}`)
    .join('\n\n')
  const pagesBlock = pages
    .map((p) => `### Page ${p.url}\n${p.extract.slice(0, 1600)}`)
    .join('\n\n')
  return [
    `# Research dossier`,
    `Question: ${stripWorkspacePrompt(task).slice(0, 400)}`,
    '',
    '## Sources to cite',
    citeBlock,
    '',
    '## Search legs',
    legsBlock,
    pagesBlock ? `\n## Page extracts\n${pagesBlock}` : '',
    '',
    'Use these sources. Do not invent URLs.',
  ].join('\n')
}

export interface DeepResearchRun {
  dossier: string
  queries: string[]
  urls: string[]
}

export async function runDeepResearch(task: string): Promise<DeepResearchRun> {
  const queries = researchQueries(task)
  const legs = await Promise.all(
    queries.map(async (query) => ({
      query,
      hits: await invokeCrewTool('web_search', query),
    })),
  )
  const urls = extractHttpUrls(legs.map((l) => l.hits).join('\n')).slice(0, MAX_BROWSE)
  const pages: { url: string; extract: string }[] = []
  for (const url of urls) {
    pages.push({ url, extract: await invokeCrewTool('browse_url', url) })
  }
  return {
    dossier: formatResearchDossier(task, legs, pages),
    queries,
    urls: extractHttpUrls(legs.map((l) => l.hits).join('\n')),
  }
}
