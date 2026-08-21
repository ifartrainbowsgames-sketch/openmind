import { describe, expect, it } from 'vitest'
import {
  ALL_CAPABILITIES, LEGACY_CAPABILITY, TASK_REQUIREMENTS, WORKER_CAPABILITIES,
  assignWorker, builtInHolders, capabilitiesFromTools, eligibleRuntimes,
  expandCapability, hasAll, isWorkerCapability, missingFor, rankForTask,
  runtimeCan, runtimeCapabilities, runtimeShortfall, toCapability,
  type CapabilityHolder, type RuntimeTraits,
} from './capabilities'

const holder = (id: string, capabilities: CapabilityHolder['capabilities']): CapabilityHolder =>
  ({ id, capabilities })

const TRAITS: RuntimeTraits = {
  resumable: true, checkpointable: false, inspectable: true, persistentWorkspace: true,
}

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
    expect(WORKER_CAPABILITIES.research).not.toContain('terminal.exec')
    expect(WORKER_CAPABILITIES.writer).not.toContain('code.write')
    expect(WORKER_CAPABILITIES.code).toContain('git.write')
  })

  it('separates read from write, which the old vocabulary could not', () => {
    // The reason for the migration: "filesystem" cannot describe a read-only
    // runtime, and a read-only runtime is a real thing.
    expect(ALL_CAPABILITIES).toContain('filesystem.read')
    expect(ALL_CAPABILITIES).toContain('filesystem.write')
    expect(WORKER_CAPABILITIES.tester).toContain('filesystem.read')
    expect(WORKER_CAPABILITIES.tester).not.toContain('filesystem.write')
  })
})

describe('legacy capability names', () => {
  it('still resolve, because they are in prompts and on disk', () => {
    // A worker asking for "filesystem" must not look like a worker asking for
    // something that does not exist.
    expect(toCapability('filesystem')).toBe('filesystem.read')
    expect(toCapability('data_analysis')).toBe('data.analyze')
    expect(toCapability('web_search')).toBe('web.search')
  })

  it('expand to everything the coarse name implied', () => {
    expect(expandCapability('git')).toEqual(['git.read', 'git.write'])
    expect(expandCapability('browser')).toHaveLength(3)
  })

  it('reject genuine nonsense', () => {
    expect(toCapability('teleportation')).toBeUndefined()
    expect(isWorkerCapability('filesystem')).toBe(false)
    expect(isWorkerCapability('filesystem.write')).toBe(true)
  })

  it('every legacy name maps to capabilities that exist', () => {
    for (const [name, caps] of Object.entries(LEGACY_CAPABILITY)) {
      expect(caps.length, name).toBeGreaterThan(0)
      for (const c of caps) expect(ALL_CAPABILITIES, `${name} → ${c}`).toContain(c)
    }
  })
})

describe('hasAll / missingFor', () => {
  it('reports exactly what is absent', () => {
    const h = holder('a', ['writing.compose'])
    expect(hasAll(h, ['writing.compose'])).toBe(true)
    expect(hasAll(h, ['writing.compose', 'browser.navigate'])).toBe(false)
    expect(missingFor(h, ['writing.compose', 'browser.navigate', 'code.write']))
      .toEqual(['browser.navigate', 'code.write'])
  })

  it('treats an empty requirement as satisfied', () => {
    expect(hasAll(holder('a', []), [])).toBe(true)
  })
})

describe('rankForTask', () => {
  it('excludes anyone missing a required capability', () => {
    const ranked = rankForTask('research', [
      holder('no-search', ['writing.compose', 'browser.navigate']),
      holder('searcher', ['web.search']),
    ])
    expect(ranked.map((r) => r.holder.id)).toEqual(['searcher'])
  })

  it('prefers the worker covering more preferred capabilities', () => {
    const ranked = rankForTask('research', [
      holder('bare', ['web.search']),
      holder('rich', ['web.search', 'browser.navigate', 'writing.compose', 'mcp.call']),
    ])
    expect(ranked[0].holder.id).toBe('rich')
  })

  it('prefers a specialist over a generalist when coverage ties', () => {
    // Both cover the same preferred set; the generalist carries surplus.
    const ranked = rankForTask('analyst', [
      holder('generalist', ['data.analyze', 'writing.compose', 'code.write', 'browser.navigate', 'testing.run']),
      holder('specialist', ['data.analyze', 'writing.compose']),
    ])
    expect(ranked[0].holder.id).toBe('specialist')
  })

  it('is deterministic when scores tie exactly', () => {
    const ranked = rankForTask('writer', [
      holder('zoe', ['writing.compose']),
      holder('amy', ['writing.compose']),
    ])
    expect(ranked.map((r) => r.holder.id)).toEqual(['amy', 'zoe'])
  })
})

describe('assignWorker', () => {
  it('names the shortfall when the pool cannot serve the task', () => {
    const result = assignWorker('browser', [holder('writer', ['writing.compose'])])
    expect(result.holder).toBeNull()
    if (result.holder === null) expect(result.missing).toEqual(['browser.navigate'])
  })

  it('reports the pool shortfall, not the per-worker one', () => {
    const result = assignWorker('code', [
      holder('a', ['filesystem.write']),
      holder('b', ['git.write']),
    ])
    expect(result.holder).toBeNull()
    // Between them the pool has filesystem.write; nobody has code.write.
    if (result.holder === null) expect(result.missing).toEqual(['code.write'])
  })

  it('assigns a task type with no required capabilities to anyone', () => {
    const result = assignWorker('reviewer', [holder('anyone', [])])
    expect(result.holder?.id).toBe('anyone')
  })
})

describe('capabilitiesFromTools', () => {
  it('maps known tools to capabilities', () => {
    expect(capabilitiesFromTools(['web_search', 'browse_url']))
      .toEqual(['web.search', 'browser.navigate', 'browser.extract'])
  })

  it('grants mcp for any mcp-prefixed tool', () => {
    expect(capabilitiesFromTools(['mcp_github_create_issue'])).toEqual(['mcp.call'])
  })

  it('grants nothing for an unrecognised tool', () => {
    // Conservative on purpose: an unknown employee should be under-qualified,
    // never trusted with work it cannot actually do.
    expect(capabilitiesFromTools(['some_future_tool'])).toEqual([])
  })

  it('deduplicates when several tools imply one capability', () => {
    expect(capabilitiesFromTools(['workspace_ls', 'workspace_read_file'])).toEqual(['filesystem.read'])
  })

  it('makes a sandbox-equipped employee eligible for coding work', () => {
    const caps = capabilitiesFromTools([
      'run_code', 'workspace_run', 'workspace_write_file', 'git_clone', 'run_checks',
    ])
    const result = assignWorker('code', [{ id: 'custom', capabilities: caps }])
    expect(result.holder?.id).toBe('custom')
  })
})

/**
 * The half that did not exist. Capabilities described workers; runtimes
 * described themselves with four unrelated booleans, so the scheduler could
 * rank a worker and then hand it to a runtime that could not run it.
 */
describe('runtimes speak the same vocabulary', () => {
  it('names what a runtime cannot do for a task type', () => {
    const readOnly = runtimeCapabilities(['filesystem.read', 'terminal.exec'], TRAITS)
    expect(runtimeShortfall('code', readOnly)).toEqual(['code.write', 'filesystem.write'])
    expect(runtimeShortfall('reviewer', readOnly)).toEqual([])
  })

  it('says yes only when every required capability is present', () => {
    const web = runtimeCapabilities(['web.search'], TRAITS)
    expect(runtimeCan(web, ['web.search'])).toBe(true)
    expect(runtimeCan(web, ['web.search', 'filesystem.write'])).toBe(false)
  })

  it('ranks eligible runtimes by preferred coverage', () => {
    const bare = { id: 'bare', capabilities: runtimeCapabilities(['web.search'], TRAITS) }
    const rich = {
      id: 'rich',
      capabilities: runtimeCapabilities(
        ['web.search', 'browser.navigate', 'browser.extract', 'writing.compose'],
        TRAITS,
      ),
    }
    expect(eligibleRuntimes('research', [bare, rich]).map((r) => r.id)).toEqual(['rich', 'bare'])
  })

  it('excludes a runtime that cannot do the required work at all', () => {
    const web = { id: 'web', capabilities: runtimeCapabilities(['web.search'], TRAITS) }
    expect(eligibleRuntimes('code', [web])).toEqual([])
  })

  it('keeps mechanics out of routing', () => {
    // A task needs filesystem.write. It never needs "checkpointable" — mixing
    // the two is what made the first capability model useless for routing.
    const caps = runtimeCapabilities(['code.write', 'filesystem.write'], {
      resumable: false, checkpointable: false, inspectable: false, persistentWorkspace: false,
    })
    expect(runtimeShortfall('code', caps)).toEqual([])
    expect(caps.traits.checkpointable).toBe(false)
  })
})
