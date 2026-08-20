import { describe, expect, it } from 'vitest'
import { mockGithubWorkspace, repoSlug, stripWorkspacePrompt, workspacePrompt, type WorkspaceSpace } from './workspace'

describe('workspace provisioning helpers', () => {
  it('slugs a first message into a github-safe repo name', () => {
    expect(repoSlug('Build a mobile weather app!!!')).toBe('build-a-mobile-weather-app')
    expect(repoSlug('https://example.com/x  Hello')).toBe('hello')
    expect(repoSlug('   ')).toBe('openmind-project')
  })

  it('strips the workspace prefix before User request', () => {
    const space: WorkspaceSpace = {
      kind: 'github',
      slug: 'weather-app',
      branch: 'main',
      source: 'live',
      repoName: 'me/weather-app',
      summary: 'Created repo.',
    }
    const prompt = workspacePrompt(space, 'Add a home screen')
    expect(stripWorkspacePrompt(prompt)).toBe('Add a home screen')
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

  it('does not invent github.com/openmind owner URLs', () => {
    const space = mockGithubWorkspace('hi', 'Could not create the GitHub repo yet.')
    expect(space.source).toBe('mock')
    expect(space.repoName).toBe('hi')
    expect(space.repoUrl).toBeUndefined()
    expect(JSON.stringify(space)).not.toMatch(/github\.com\/openmind/)
  })
})
