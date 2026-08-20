import { describe, expect, it } from 'vitest'
import { detectConnections, detectHeadcount, detectRoles, generateStaff, provisionPlan, MAX_HIRES } from './staffing'
import { CONNECTION_IDS } from './agent'

describe('detectHeadcount', () => {
  it('reads explicit numbers', () => {
    expect(detectHeadcount('a team of 3')).toBe(3)
    expect(detectHeadcount('hire 2 support agents')).toBe(2)
    expect(detectHeadcount('I need 5 people')).toBe(5)
  })
  it('reads word numbers and vague quantities', () => {
    expect(detectHeadcount('two agents')).toBe(2)
    expect(detectHeadcount('a few staffers')).toBe(3)
    expect(detectHeadcount('build me a team')).toBe(3)
  })
  it('defaults to 1 and caps the maximum', () => {
    expect(detectHeadcount('a coder')).toBe(1)
    expect(detectHeadcount('hire 99 people')).toBe(MAX_HIRES)
  })
})

describe('detectRoles', () => {
  it('infers roles in order of mention', () => {
    const roles = detectRoles('a code copilot and a support agent')
    expect(roles.map((r) => r.role)).toEqual(['Code Copilot', 'Support Agent'])
  })
  it('returns empty for unrecognized prompts', () => {
    expect(detectRoles('someone nice')).toEqual([])
  })
})

describe('detectConnections', () => {
  it('picks up named apps only', () => {
    const conns = detectConnections('an assistant on gmail and slack with github access')
    expect(conns).toEqual(expect.arrayContaining(['gmail', 'slack', 'github']))
    expect(conns.every((c) => CONNECTION_IDS.includes(c))).toBe(true)
  })

  it('recognizes n8n and OpenClaw marketplace plugins', () => {
    expect(detectConnections('an automation employee using n8n and OpenClaw')).toEqual(['n8n', 'openclaw'])
  })
})

describe('generateStaff', () => {
  it('creates the requested headcount with complete employees', () => {
    const staff = generateStaff('a team of 3: support, a coder and an analyst')
    expect(staff).toHaveLength(3)
    for (const e of staff) {
      expect(e.name.length).toBeGreaterThan(1)
      expect(e.role.length).toBeGreaterThan(1)
      expect(e.prompt).toContain('a team of 3')
      expect(e.tools.length).toBeGreaterThan(0)
    }
    expect(staff.map((e) => e.role)).toEqual(['Support Agent', 'Code Copilot', 'Data Analyst'])
  })

  it('falls back to a generalist for vague briefs', () => {
    const staff = generateStaff('someone to help out')
    expect(staff).toHaveLength(1)
    expect(staff[0].role).toBe('Generalist')
  })

  it('unions prompt-mentioned apps into connections', () => {
    const staff = generateStaff('a coder who watches github and slack')
    expect(staff[0].connections).toEqual(expect.arrayContaining(['github', 'slack']))
  })

  it('coding employees get the code review tool', () => {
    const staff = generateStaff('a code copilot')
    expect(staff[0].tools).toContain('code_review')
  })
})

describe('provisionPlan', () => {
  it('emits parsing, headcount and five stages per hire, ending each in hired', () => {
    const hires = generateStaff('two support agents')
    const script = provisionPlan('two support agents', hires)
    expect(script[0].stage).toBe('parsing')
    expect(script[1].stage).toBe('headcount')
    expect(script.filter((s) => s.stage === 'hired')).toHaveLength(2)
    expect(script).toHaveLength(2 + hires.length * 5)
  })
})
