import { afterEach, describe, expect, it } from 'vitest'
import {
  extractHttpUrls,
  formatResearchDossier,
  needsDeepResearch,
  researchQueries,
} from './deep-research'
import { invokeCrewTool, needsCrewToolConfirm, setCrewToolGuard } from './crew-tools'
import { saveMemory, searchMemory, setMemoryOwner } from './memory'

describe('deep research', () => {
  it('skips staffing-only briefs and catches research tasks', () => {
    expect(needsDeepResearch('a team of 2: a researcher and a coder')).toBe(false)
    expect(needsDeepResearch('Research the latest open-source AI agent trends')).toBe(true)
  })

  it('fans a question into a few search legs', () => {
    const qs = researchQueries('Compare LangGraph and CrewAI for production agents')
    expect(qs.length).toBeGreaterThanOrEqual(2)
    expect(qs[0]).toMatch(/LangGraph/i)
  })

  it('extracts citeable http urls', () => {
    expect(extractHttpUrls('see https://example.com/a and https://docs.langchain.com/x')).toEqual([
      'https://example.com/a',
      'https://docs.langchain.com/x',
    ])
  })

  it('formats a dossier with a cite list', () => {
    const text = formatResearchDossier(
      'Research agents',
      [{ query: 'agents', hits: '• Paper — https://arxiv.org/abs/1\n  notes' }],
      [],
    )
    expect(text).toContain('[1] https://arxiv.org/abs/1')
    expect(text).toContain('Do not invent URLs')
  })
})

describe('crew tool confirm', () => {
  afterEach(() => setCrewToolGuard(undefined))

  it('flags send and write tools, and checkout-like browse', () => {
    expect(needsCrewToolConfirm('gmail_send', '{}')).toBe(true)
    expect(needsCrewToolConfirm('web_search', 'hi')).toBe(false)
    expect(needsCrewToolConfirm('browse_url', 'https://shop.example/checkout')).toBe(true)
    expect(needsCrewToolConfirm('browse_url', 'https://docs.example.com/guide')).toBe(false)
  })

  it('returns BLOCKED when the user declines', async () => {
    setCrewToolGuard(async () => false)
    await expect(invokeCrewTool('slack_post', '{"text":"hi"}')).resolves.toMatch(/\[BLOCKED · slack_post\]/)
  })
})

describe('memory', () => {
  it('saves and finds a local note', async () => {
    setMemoryOwner('test-user-1')
    await saveMemory('Remember that the launch city is Lisbon')
    const hit = await searchMemory('Lisbon')
    expect(hit).toMatch(/Lisbon/)
  })
})
