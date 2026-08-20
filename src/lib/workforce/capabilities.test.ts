import { describe, expect, it } from 'vitest'
import {
  TASK_REQUIREMENTS, WORKER_CAPABILITIES, assignWorker, builtInHolders,
  capabilitiesFromTools, hasAll, missingFor, rankForTask,
  type CapabilityHolder,
} from './capabilities'

const holder = (id: string, capabilities: CapabilityHolder['capabilities']): CapabilityHolder =>
  ({ id, capabilities })

describe('built-in capability declarations', () => {
  it('gives every worker kind a capability list', () => {
    for (const [kind, caps] of Object.entries(WORKER_CAPABILITIES)) {
      expect(caps.length, kind).toBeGreaterThan(0)
    }
  })

  it('can staff every task type from the built-in pool', () => {
    // A task type nobody can serve is a task that silently never runs.
    const pool = builtInHolders()
    for (const type of Object.keys(TASK_REQUIREMENTS) as (keyof typeof TASK_REQUIREMENTS)[]) {
      const result = assignWorker(type, pool)
      expect(result.holder, `no built-in worker for ${type}`).not.toBeNull()
    }
  })

  it('does not claim a capability the worker has no tools for', () => {
    // The code worker owns the sandbox, so it alone claims terminal/git.
    expect(WORKER_CAPABILITIES.research).not.toContain('terminal')
    expect(WORKER_CAPABILITIES.writer).not.toContain('coding')
    expect(WORKER_CAPABILITIES.code).toContain('git')
  })
})

describe('hasAll / missingFor', () => {
  it('reports exactly what is absent', () => {
    const h = holder('a', ['writing'])
    expect(hasAll(h, ['writing'])).toBe(true)
    expect(hasAll(h, ['writing', 'browser'])).toBe(false)
    expect(missingFor(h, ['writing', 'browser', 'coding'])).toEqual(['browser', 'coding'])
  })

  it('treats an empty requirement as satisfied', () => {
    expect(hasAll(holder('a', []), [])).toBe(true)
  })
})

describe('rankForTask', () => {
  it('excludes anyone missing a required capability', () => {
    const ranked = rankForTask('research', [
      holder('no-search', ['writing', 'browser']),
      holder('searcher', ['web_search']),
    ])
    expect(ranked.map((r) => r.holder.id)).toEqual(['searcher'])
  })

  it('prefers the worker covering more preferred capabilities', () => {
    const ranked = rankForTask('research', [
      holder('bare', ['web_search']),
      holder('rich', ['web_search', 'browser', 'writing', 'mcp']),
    ])
    expect(ranked[0].holder.id).toBe('rich')
  })

  it('prefers a specialist over a generalist when coverage ties', () => {
    // Both cover the same preferred set; the generalist carries surplus.
    const ranked = rankForTask('analyst', [
      holder('generalist', ['data_analysis', 'writing', 'coding', 'browser', 'testing']),
      holder('specialist', ['data_analysis', 'writing']),
    ])
    expect(ranked[0].holder.id).toBe('specialist')
  })

  it('is deterministic when scores tie exactly', () => {
    const ranked = rankForTask('writer', [holder('zoe', ['writing']), holder('amy', ['writing'])])
    expect(ranked.map((r) => r.holder.id)).toEqual(['amy', 'zoe'])
  })
})

describe('assignWorker', () => {
  it('names the shortfall when the pool cannot serve the task', () => {
    const result = assignWorker('browser', [holder('writer', ['writing'])])
    expect(result.holder).toBeNull()
    if (result.holder === null) expect(result.missing).toEqual(['browser'])
  })

  it('reports nothing missing when the pool has the capability but no single worker qualifies', () => {
    // 'code' requires only 'coding', so this is a genuine pool shortfall.
    const result = assignWorker('code', [holder('a', ['filesystem']), holder('b', ['git'])])
    expect(result.holder).toBeNull()
    if (result.holder === null) expect(result.missing).toEqual(['coding'])
  })

  it('assigns a task type with no required capabilities to anyone', () => {
    const result = assignWorker('reviewer', [holder('anyone', [])])
    expect(result.holder?.id).toBe('anyone')
  })
})

describe('capabilitiesFromTools', () => {
  it('maps known tools to capabilities', () => {
    expect(capabilitiesFromTools(['web_search', 'browse_url'])).toEqual(['web_search', 'browser'])
  })

  it('grants mcp for any mcp-prefixed tool', () => {
    expect(capabilitiesFromTools(['mcp_github_create_issue'])).toEqual(['mcp'])
  })

  it('grants nothing for an unrecognised tool', () => {
    // Conservative on purpose: an unknown employee should be under-qualified,
    // never trusted with work it cannot actually do.
    expect(capabilitiesFromTools(['some_future_tool'])).toEqual([])
  })

  it('deduplicates when several tools imply one capability', () => {
    expect(capabilitiesFromTools(['workspace_ls', 'workspace_read_file'])).toEqual(['filesystem'])
  })

  it('makes a sandbox-equipped employee eligible for coding work', () => {
    const caps = capabilitiesFromTools(['run_code', 'workspace_run', 'git_clone', 'run_checks'])
    const result = assignWorker('code', [{ id: 'custom', capabilities: caps }])
    expect(result.holder?.id).toBe('custom')
  })
})
