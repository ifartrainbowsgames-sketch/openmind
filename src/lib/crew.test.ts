import { describe, expect, it } from 'vitest'
import { simulatedBrain } from './agent'
import {
  assembleCrew,
  conferPrompt,
  extractArtifacts,
  formatTeamBoard,
  runCrew,
  toolsForRole,
  withCrewTools,
  withGithubWorkspaceTools,
  type CrewMemberResult,
} from './crew'
import { mockCrewTool } from './crew-tools'

const lead = {
  id: 'openmind',
  name: 'OpenMind',
  role: 'General Assistant',
  prompt: 'Help.',
  tools: ['search_docs'],
  accent: '#ff4d00',
}

describe('toolsForRole', () => {
  it('adds research tools for researchers', () => {
    const tools = toolsForRole({ ...lead, role: 'Researcher', prompt: 'Find evidence' })
    expect(tools).toEqual(expect.arrayContaining(['web_search', 'browse_url', 'search_docs']))
  })

  it('adds run_code for copilots', () => {
    const tools = toolsForRole({ ...lead, role: 'Code Copilot', prompt: 'Review software' })
    expect(tools).toContain('run_code')
    expect(tools).toContain('code_review')
    expect(tools).toEqual(expect.arrayContaining(['github_write_file', 'github_open_pr']))
  })
})

describe('withGithubWorkspaceTools', () => {
  it('adds GitHub write tools when the thread is GitHub · main', () => {
    const tools = withGithubWorkspaceTools(lead, {
      kind: 'github',
      slug: 'app',
      branch: 'main',
      source: 'live',
      summary: 'repo',
      repoName: 'me/app',
    }).tools
    expect(tools).toEqual(expect.arrayContaining(['github_write_file', 'github_open_pr']))
  })
})

describe('assembleCrew', () => {
  it('keeps the lead when staffing a vague generalist brief', () => {
    const crew = assembleCrew(lead, 'someone to help out')
    expect(crew[0].id).toBe('openmind')
    expect(crew.map((e) => e.role)).toEqual(['Inbox', 'Business', 'Browser'])
    expect(crew[0].tools).toContain('web_search')
    expect(crew.some((e) => e.tools.includes('gmail_list'))).toBe(true)
    expect(crew.some((e) => e.tools.includes('web_act'))).toBe(true)
  })

  it('fans a research+code brief into specialists without duplicating the lead role', () => {
    const crew = assembleCrew(lead, 'a team of 2: a researcher and a coder')
    expect(crew.length).toBeGreaterThanOrEqual(2)
    expect(crew.length).toBeLessThanOrEqual(6)
    expect(crew.map((e) => e.role)).toEqual(expect.arrayContaining(['Researcher', 'Code Copilot']))
  })
})

describe('extractArtifacts', () => {
  const members: CrewMemberResult[] = [
    {
      employeeId: 'otto',
      name: 'Otto',
      role: 'Researcher',
      result: { answer: 'Found three sources.', plan: [], toolCalls: [], trace: [] },
    },
  ]

  it('always includes a markdown crew brief', () => {
    const artifacts = extractArtifacts('Research AI agents', 'Here is the brief.', members)
    expect(artifacts[0]).toMatchObject({ id: 'artifact-brief', kind: 'markdown', title: 'Crew brief' })
    expect(artifacts[0].body).toContain('# Research AI agents')
    expect(artifacts[0].body).toContain('Otto')
  })

  it('pulls fenced markdown/html and adds a deck when asked', () => {
    const answer = 'Intro\n```markdown\n# Notes\n```\n```html\n<h1>Hi</h1>\n```'
    const artifacts = extractArtifacts('Create a slide deck about agents', answer, members)
    expect(artifacts.some((a) => a.kind === 'markdown' && a.title === 'Markdown note')).toBe(true)
    expect(artifacts.some((a) => a.kind === 'html' && a.title === 'HTML deck')).toBe(true)
    expect(artifacts.some((a) => a.id === 'artifact-deck' && a.kind === 'html')).toBe(true)
  })
})

describe('team table', () => {
  it('lets teammates reply on a shared board after the first pass', () => {
    const otto = { employeeId: 'otto', name: 'Otto', role: 'Researcher', result: { answer: 'Use LangGraph.', plan: [], toolCalls: [], trace: [] } }
    const rex = { employeeId: 'rex', name: 'Rex', role: 'Code Copilot', result: { answer: 'I can commit that.', plan: [], toolCalls: [], trace: [] } }
    const board = formatTeamBoard([otto, rex])
    expect(board).toContain('Otto')
    expect(board).toContain('Rex')
    const prompt = conferPrompt('Ship it', board, { ...lead, name: 'Otto', role: 'Researcher' }, '')
    expect(prompt).toMatch(/talk to your teammates/i)
    expect(prompt).toContain('Rex')
  })
})

describe('runCrew', () => {
  it('staffs, dispatches in parallel, and synthesizes with artifacts', async () => {
    const crew = [
      withCrewTools({ ...lead, id: 'otto', name: 'Otto', role: 'Researcher', prompt: 'Find evidence on the web.' }),
      withCrewTools({
        ...lead,
        id: 'rex',
        name: 'Rex',
        role: 'Code Copilot',
        prompt: 'Review software and run snippets.',
        tools: ['code_review'],
      }),
    ]
    const run = await runCrew('Research the latest open-source AI agent trends', simulatedBrain(), {
      employees: crew,
    })
    expect(run.employeeIds).toEqual(['otto', 'rex'])
    expect(run.members).toHaveLength(2)
    expect(run.trace.map((t) => t.node)).toEqual(expect.arrayContaining(['plan', 'act', 'respond']))
    expect(run.trace.some((t) => t.text.includes('table'))).toBe(true)
    expect(run.trace[0].text).toMatch(/crew of 2/)
    expect(run.answer.length).toBeGreaterThan(20)
    expect(run.artifacts[0].kind).toBe('markdown')
    expect(run.members.some((m) => m.result.toolCalls.some((c) => c.tool === 'web_search'))).toBe(true)
  })

  it('hires from the task when no employees are passed', async () => {
    const run = await runCrew('a team of 2: a researcher and a coder', simulatedBrain())
    expect(run.employeeIds.length).toBe(2)
    expect(run.members).toHaveLength(2)
  })
})

describe('mockCrewTool', () => {
  it('stamps mock search, browse, and code', () => {
    expect(mockCrewTool('web_search', 'agents')).toMatch(/\[MOCK · web_search\]/)
    expect(mockCrewTool('browse_url', 'https://example.com')).toMatch(/example.com/)
    expect(mockCrewTool('run_code', 'print(1)')).toMatch(/\[MOCK · run_code\]/)
  })
})
