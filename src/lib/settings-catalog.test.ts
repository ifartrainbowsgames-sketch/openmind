import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SECTION_META, SETTINGS_SEARCH_ITEMS, SETTINGS_SECTIONS,
  isSettingsSection, searchSettings, sectionPath,
} from './settings-catalog'

describe('catalog integrity', () => {
  it('gives every section metadata', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SECTION_META[section]?.label, section).toBeTruthy()
      expect(SECTION_META[section]?.blurb, section).toBeTruthy()
    }
  })

  it('points every search item at a real section', () => {
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(SETTINGS_SECTIONS, item.id).toContain(item.section)
    }
  })

  it('keeps search item ids unique', () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every section with at least one findable row', () => {
    // A section with no searchable row is unreachable from the search box,
    // which is the only way to find a setting whose name you half-remember.
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_SEARCH_ITEMS.some((i) => i.section === section), section).toBe(true)
    }
  })
})

describe('searchSettings', () => {
  it('returns nothing for an empty query rather than everything', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
  })

  it('matches on the visible title', () => {
    const hits = searchSettings('strict')
    expect(hits.map((h) => h.id)).toContain('strict-mode')
  })

  it('matches on keywords that are not in the title', () => {
    // A customer looks for the provider by name, not for the card's title.
    // "grok" appears only in the keywords of the connected-providers row.
    const hits = searchSettings('grok')
    expect(hits.map((h) => h.id)).toContain('server-keys')
  })

  it('finds the key screen by any provider name', () => {
    // The whole point of connecting providers is that someone arrives wanting
    // to plug in one specific vendor.
    for (const provider of ['claude', 'gemini', 'deepseek', 'mistral', 'xai']) {
      expect(searchSettings(provider).map((h) => h.id), provider).toContain('server-keys')
    }
  })

  it('matches on the section label', () => {
    const hits = searchSettings('appearance')
    expect(hits.every((h) => h.section === 'appearance')).toBe(true)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('requires every term, so extra words narrow instead of widen', () => {
    const one = searchSettings('key')
    const two = searchSettings('key server')
    expect(two.length).toBeLessThan(one.length)
    expect(two.map((h) => h.id)).toContain('server-keys')
  })

  it('is case-insensitive', () => {
    expect(searchSettings('TAVILY').map((h) => h.id)).toEqual(searchSettings('tavily').map((h) => h.id))
  })

  it('returns nothing for a near-miss rather than guessing', () => {
    // Deliberately not fuzzy: a wrong hit reads as "this setting exists".
    expect(searchSettings('strictt')).toEqual([])
  })
})

describe('isSettingsSection', () => {
  it('accepts known sections and rejects anything else', () => {
    expect(isSettingsSection('keys')).toBe(true)
    expect(isSettingsSection('nope')).toBe(false)
    expect(isSettingsSection(undefined)).toBe(false)
    expect(isSettingsSection(7)).toBe(false)
  })
})

describe('sectionPath', () => {
  it('builds the route the router registers', () => {
    expect(sectionPath('keys')).toBe('/settings/keys')
  })
})

describe('every search result lands somewhere real', () => {
  // The file header calls the anchors in the panels "the other half of that
  // contract", but nothing enforced it — so renaming a card silently turned
  // its search result into a link that scrolls nowhere. That is invisible in
  // review and invisible in the type system; only reading the panels catches
  // it. Which is what this does.
  const PANELS = readFileSync('src/components/settings/panels.tsx', 'utf8')

  it('found the panels source, so the rest is not vacuous', () => {
    expect(PANELS.length).toBeGreaterThan(1000)
    expect(PANELS).toContain('anchorProps')
  })

  it('renders an anchor for every indexed item', () => {
    // Two sources, because there are exactly two ways an anchor reaches the
    // page. Most panels pass a literal to anchorProps(); ToolsPanel maps
    // capability -> anchor and passes the variable.
    //
    // A naive "every quoted string" sweep was tried and is wrong: apostrophes
    // in prose ("the customer's key") desynchronise the pairing and it then
    // reports rendered anchors as missing.
    //
    // Honest about the limit: this catches a renamed or deleted anchor, which
    // is the drift that actually happens. An anchor still in the source but
    // conditionally rendered — the dev-only browser key field — would pass,
    // which is why that row was removed from the catalog by hand.
    const rendered = new Set([
      ...[...PANELS.matchAll(/anchorProps\('([^']+)'\)/g)].map((m) => m[1]),
      ...[...PANELS.matchAll(/(?:search|browse|sandbox|chrome):\s*'([^']+)'/g)].map((m) => m[1]),
    ])

    const dangling = SETTINGS_SEARCH_ITEMS
      .filter((i) => !rendered.has(i.anchor))
      .map((i) => `${i.id} → #${i.anchor}`)

    expect(dangling, `search items with no anchor on the page: ${dangling.join(', ')}`).toEqual([])
  })
})
