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
    // "localstorage" appears only in the keywords of the browser-keys row.
    const hits = searchSettings('localstorage')
    expect(hits.map((h) => h.id)).toContain('browser-keys')
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
