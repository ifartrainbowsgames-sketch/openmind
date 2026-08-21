import { afterEach, describe, expect, it } from 'vitest'
import {
  buildNangoGithubAction,
  invokeCrewTool,
  mockCrewTool,
  parseGmailSendInput,
  parseGithubBranchInput,
  parseGithubPrInput,
  parseGithubWriteInput,
  parseSlackPostInput,
  setActiveWorkspace,
} from './crew-tools'
import type { WorkspaceSpace } from './workspace'

const githubSpace: WorkspaceSpace = {
  kind: 'github',
  slug: 'weather-app',
  branch: 'main',
  source: 'live',
  repoName: 'me/weather-app',
  repoUrl: 'https://github.com/me/weather-app',
  connectionId: 'conn-github-1',
  providerId: 'github',
  summary: 'Created repo.',
}

describe('crew tools', () => {
  afterEach(() => setActiveWorkspace(undefined))

  it('falls back to a stamped mock when the proxy is unavailable', async () => {
    await expect(invokeCrewTool('web_search', 'open source agents')).resolves.toMatch(/\[MOCK · web_search\]/)
    await expect(invokeCrewTool('browse_url', 'https://example.com/docs')).resolves.toMatch(/\[MOCK · browse_url\]/)
  })

  it('refuses a machine tool with no machine, before it can reach a mock', async () => {
    // run_code needs a sandbox. Falling back to a mock would be the friendlier
    // answer and the wrong one: the caller asked to execute code and nothing
    // executed it, so "no workspace in scope" is the truthful reply.
    await expect(invokeCrewTool('run_code', 'print(2)')).resolves.toContain('no workspace in scope')
  })

  it('mock output includes the query', () => {
    expect(mockCrewTool('web_search', 'Genspark')).toContain('Genspark')
  })

  it('keeps GitHub write/PR on the mock path in vitest', async () => {
    setActiveWorkspace(githubSpace)
    await expect(invokeCrewTool('github_write_file', '{"path":"src/App.tsx","message":"add","content":"export {}"}'))
      .resolves.toMatch(/\[MOCK · github_write_file\].*src\/App\.tsx/)
    await expect(invokeCrewTool('github_open_pr', '{"title":"Add home","head":"feat"}'))
      .resolves.toMatch(/\[MOCK · github_open_pr\].*Add home/)
  })
})

describe('GitHub write/PR routing', () => {
  it('parses one-line JSON for github_write_file', () => {
    const file = parseGithubWriteInput('{"path":"src/Home.tsx","message":"home","content":"export const Home = () => null"}')
    expect(file).toEqual({
      path: 'src/Home.tsx',
      message: 'home',
      content: 'export const Home = () => null',
      branch: undefined,
    })
  })

  it('builds nango-act putFile / openPr when workspace.kind is github', () => {
    const write = buildNangoGithubAction(
      'github_write_file',
      '{"path":"README.md","message":"docs","content":"# hi"}',
      githubSpace,
    )
    expect(write).toMatchObject({
      action: 'github.putFile',
      body: {
        providerId: 'github',
        connectionId: 'conn-github-1',
        repo: 'me/weather-app',
        path: 'README.md',
        message: 'docs',
        content: '# hi',
        branch: 'main',
      },
    })

    const pr = buildNangoGithubAction(
      'github_open_pr',
      '{"title":"Ship home","head":"feat-home","body":"adds home"}',
      githubSpace,
    )
    expect(pr).toMatchObject({
      action: 'github.openPr',
      body: {
        repo: 'me/weather-app',
        title: 'Ship home',
        head: 'feat-home',
        base: 'main',
        connectionId: 'conn-github-1',
      },
    })
  })

  it('does not plan a Nango write when the thread is chat-only', () => {
    expect(buildNangoGithubAction('github_write_file', '{"path":"a.ts","content":"x"}', {
      kind: 'openmind',
      slug: 'x',
      branch: 'main',
      source: 'mock',
      summary: 'chat',
    })).toBeNull()
  })

  it('parses a PR title from free text', () => {
    expect(parseGithubPrInput('Add home screen\nmore', 'main').title).toBe('Add home screen')
  })

  it('does not treat a GitHub workspace prompt blob as a file or branch', () => {
    const blob =
      'Coding space: GitHub repo me/hi (default branch main) — https://github.com/openmind/hi. ' +
      'Commit real files with github_write_file. Required one-line JSON: {"path","content"}.\n' +
      'Created GitHub repo.\n\nUser request:\nAdd a home screen'
    const file = parseGithubWriteInput(blob)
    expect(file.path).toBe('README.md')
    expect(file.message).not.toMatch(/Coding space/i)
    expect(file.content).toContain('Add a home screen')
    expect(file.content).not.toMatch(/Coding space: GitHub/)
    expect(parseGithubBranchInput(blob, 'main').name).toBe('openmind')
    expect(parseGithubBranchInput(blob, 'main').name).not.toBe('Coding')
  })

  it('still prefers required JSON {"path","content"} even after a workspace prefix', () => {
    const blob =
      'Coding space: GitHub repo me/hi (default branch main).\n\nUser request:\n' +
      '{"path":"src/Home.tsx","message":"home","content":"export const Home = () => null"}'
    expect(parseGithubWriteInput(blob)).toMatchObject({
      path: 'src/Home.tsx',
      message: 'home',
      content: 'export const Home = () => null',
    })
  })
})

describe('Nango app tools (Slack / Gmail / Drive)', () => {
  it('parses slack and gmail JSON', () => {
    expect(parseSlackPostInput('{"text":"hi","channel":"eng"}')).toEqual({ text: 'hi', channel: 'eng' })
    expect(parseGmailSendInput('{"to":"a@b.com","subject":"Hi","body":"yo"}')).toEqual({
      to: 'a@b.com',
      subject: 'Hi',
      body: 'yo',
    })
  })

  it('mocks slack / gmail / drive when not connected', async () => {
    await expect(invokeCrewTool('slack_post', '{"text":"shipped"}')).resolves.toMatch(/\[MOCK · slack_post\]/)
    await expect(invokeCrewTool('gmail_send', '{"to":"a@b.com","subject":"x","body":"y"}')).resolves.toMatch(/\[MOCK · gmail_send\]/)
    await expect(invokeCrewTool('gdrive_list', '{"query":"brief"}')).resolves.toMatch(/\[MOCK · gdrive_list\]/)
  })
})
