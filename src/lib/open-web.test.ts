import { describe, expect, it } from 'vitest'
import {
  formatHits,
  htmlToText,
  isBlockedHostname,
  parseSearchHtml,
  parseSearxJson,
  unwrapDuckUrl,
} from './open-web'

describe('open-web parsers', () => {
  it('unwraps DuckDuckGo redirect links', () => {
    expect(unwrapDuckUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs')).toBe(
      'https://example.com/docs',
    )
  })

  it('parses DDG-style result HTML even when href comes first', () => {
    const html = `
      <a rel="nofollow" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fopenswarm.dev" class="result-link">OpenSwarm</a>
      <td class="result-snippet">Local-first multi-agent OS.</td>
      <a class="result__a" href="https://github.com/kortix-ai/suna">Suna</a>
      <a class="result__snippet">Open-source Genspark-style agent.</a>
    `
    const hits = parseSearchHtml(html)
    expect(hits[0]).toMatchObject({ title: 'OpenSwarm', url: 'https://openswarm.dev' })
    expect(hits[0].snippet).toMatch(/Local-first/)
    expect(hits[1].url).toBe('https://github.com/kortix-ai/suna')
  })

  it('parses SearXNG JSON', () => {
    const hits = parseSearxJson(JSON.stringify({
      results: [
        { title: 'SearXNG', url: 'https://docs.searxng.org', content: 'Metasearch' },
        { title: 'skip me' },
      ],
    }))
    expect(hits).toEqual([{ title: 'SearXNG', url: 'https://docs.searxng.org', snippet: 'Metasearch' }])
  })

  it('turns messy HTML into readable text', () => {
    const text = htmlToText('<html><script>alert(1)</script><h1>Hello</h1><p>World &amp; friends</p></html>')
    expect(text).toContain('Hello')
    expect(text).toContain('World & friends')
    expect(text).not.toContain('alert')
  })

  it('blocks private hosts', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true)
    expect(isBlockedHostname('192.168.0.9')).toBe(true)
    expect(isBlockedHostname('example.com')).toBe(false)
  })

  it('formats an empty hit list honestly', () => {
    expect(formatHits('duckduckgo', 'xyz', [])).toMatch(/No results/)
  })
})
