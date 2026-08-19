import { describe, expect, it } from 'vitest'
import { filterSkills, toolsForSkill, wrapSkillPrompt } from './skills'

describe('skills', () => {
  it('filters the command palette', () => {
    expect(filterSkills('debug').map((s) => s.id)).toEqual(['debug'])
    expect(filterSkills('').length).toBe(4)
  })

  it('blocks send/commit/click in ask and plan', () => {
    const tools = ['gmail_list', 'gmail_send', 'web_act', 'web_search']
    expect(toolsForSkill(tools, 'ask')).toEqual(['gmail_list', 'web_search'])
    expect(toolsForSkill(tools, 'plan')).toEqual(['gmail_list', 'web_search'])
    expect(toolsForSkill(tools, 'multitask')).toContain('web_act')
  })

  it('wraps the task so the crew knows the mode', () => {
    expect(wrapSkillPrompt('plan', 'ship inbox')).toMatch(/SKILL: PLAN/)
    expect(wrapSkillPrompt('ask', 'what is unread')).toMatch(/Read-only/)
  })
})
