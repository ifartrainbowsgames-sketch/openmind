import { describe, expect, it } from 'vitest'
import { repoSlug, workspacePrompt, type WorkspaceSpace } from './workspace'

describe('workspace provisioning helpers', () => {
  it('slugs a first message into a github-safe repo name', () => {
    expect(repoSlug('Build a mobile weather app!!!')).toBe('build-a-mobile-weather-app')
    expect(repoSlug('https://example.com/x  Hello')).toBe('hello')
    expect(repoSlug('   ')).toBe('openmind-project')
  })

  it('tells the crew to use the GitHub repo on main', () => {
    const space: WorkspaceSpace = {
      kind: 'github',
      slug: 'weather-app',
      branch: 'main',
      source: 'live',
      repoName: 'me/weather-app',
      repoUrl: 'https://github.com/me/weather-app',
      summary: 'Created repo.',
    }
    const prompt = workspacePrompt(space, 'Add a home screen')
    expect(prompt).toMatch(/me\/weather-app/)
    expect(prompt).toMatch(/branch main/)
    expect(prompt).toContain('github_write_file')
    expect(prompt).toContain('Do not invent fake files only in chat')
    expect(prompt).toContain('Add a home screen')
  })
})
