import { afterEach, describe, expect, it, vi } from 'vitest'

// Live MCP calls lazily import './supabase', which builds an auth client that
// reaches for localStorage and rejects under the node environment. mcp.test.ts
// mocks it for the same reason.
vi.mock('./supabase', () => ({
  isSupabaseConfigured: false,
  SUPABASE_URL: null,
  SUPABASE_KEY: null,
  supabase: {},
  getRemember: () => false,
  setRemember: () => {},
}))
import {
  isMcpWriteTool,
  normalizeToolResult,
  resolveConnectionTools,
  resetTokenUsage,
  setMcpToolGuard,
  takeTokenUsage,
  TOOL_REGISTRY,
  type Employee,
  type LiveConnectionConfig,
} from './agent'
import type { McpToolInfo } from './mcp'
import { estimateRunSpend } from './task-runner'
import { createProject, handoffs, type ArtifactRecord, type TaskRecord } from './task-ledger'
import { loadMobileProvider, roleProvider, type MobileProviderConfig } from './mobile-provider'
import { setExecutionMode } from './execution-mode'

afterEach(() => {
  setMcpToolGuard(undefined)
  resetTokenUsage()
  setExecutionMode('demo')
})

const emp = (connections: string[]): Employee => ({
  id: 'e1', name: 'Ada', role: 'Assistant', prompt: 'help', tools: [], connections, accent: '#000',
})

// ── item 5: real checks, honest smell scan ───────────────────────────────────

describe('run_checks', () => {
  it('is registered and points at the project sandbox', () => {
    expect(TOOL_REGISTRY.run_checks).toBeDefined()
    expect(TOOL_REGISTRY.run_checks.desc).toMatch(/own/i)
  })

  it('stops describing the regex scan as real analysis', () => {
    expect(TOOL_REGISTRY.code_review.desc).toMatch(/regex|smell/i)
    expect(TOOL_REGISTRY.code_review.desc).toMatch(/not a substitute/i)
  })
})

// ── item 14b: MCP writes are confirmed ───────────────────────────────────────

describe('isMcpWriteTool', () => {
  const t = (name: string, description?: string): McpToolInfo => ({ name, description })

  it('treats read verbs as safe', () => {
    for (const name of ['get_issue', 'list_repos', 'search_code', 'read_file', 'fetch_page', 'describe_db']) {
      expect(isMcpWriteTool(t(name)), name).toBe(false)
    }
  })

  it('flags destructive and publishing tools', () => {
    for (const name of ['delete_repo', 'merge_pull_request', 'send_message', 'create_issue', 'update_page', 'transfer_ownership']) {
      expect(isMcpWriteTool(t(name)), name).toBe(true)
    }
  })

  it('flags on description when the name is opaque', () => {
    expect(isMcpWriteTool(t('gh_op_7', 'Delete a repository permanently'))).toBe(true)
    expect(isMcpWriteTool(t('gh_op_8', 'Returns repository metadata'))).toBe(false)
  })

  it('does not flag a read tool whose name merely contains a write word', () => {
    expect(isMcpWriteTool(t('get_deployment_status'))).toBe(false)
    expect(isMcpWriteTool(t('list_pending_updates'))).toBe(false)
  })
})

describe('live MCP write confirmation', () => {
  const cfg: LiveConnectionConfig = {
    connectionId: 'github', mode: 'mcp', status: 'live', serverUrl: 'https://example.test/mcp',
    tools: [{ name: 'delete_repo', description: 'Delete a repository', inputSchema: { properties: { q: { type: 'string' } } } }],
  }

  it('blocks the call when the guard declines', async () => {
    setMcpToolGuard(async () => false)
    const tool = resolveConnectionTools(emp(['github']), [cfg]).find((t) => t.id === 'github__delete_repo')!
    const out = normalizeToolResult(await tool.run('acme/app'))
    expect(out.error?.kind).toBe('declined')
    expect(out.content).toContain('BLOCKED')
  })

  it('passes the tool name and description to the guard', async () => {
    let seen = ''
    setMcpToolGuard(async (_id, summary) => { seen = summary; return false })
    const tool = resolveConnectionTools(emp(['github']), [cfg]).find((t) => t.id === 'github__delete_repo')!
    await tool.run('acme/app')
    expect(seen).toContain('delete_repo')
    expect(seen).toContain('Delete a repository')
  })

  it('leaves read tools ungated', async () => {
    let called = false
    setMcpToolGuard(async () => { called = true; return false })
    const readCfg: LiveConnectionConfig = {
      ...cfg,
      tools: [{ name: 'get_repo', description: 'Read repo metadata', inputSchema: { properties: { q: { type: 'string' } } } }],
    }
    const tool = resolveConnectionTools(emp(['github']), [readCfg]).find((t) => t.id === 'github__get_repo')!
    await tool.run('acme/app')
    expect(called).toBe(false)
  })
})

// ── item 11: measured tokens beat estimated ones ─────────────────────────────

describe('token accounting', () => {
  const result = { answer: 'x'.repeat(400), plan: [], toolCalls: [], trace: [] }

  it('estimates from characters when the provider reported nothing', () => {
    const spend = estimateRunSpend('prompt', result, takeTokenUsage())
    expect(spend.measured).toBe(false)
    expect(spend.tokens).toBeGreaterThan(0)
  })

  it('uses the billed total when usage was reported', () => {
    const spend = estimateRunSpend('prompt', result, {
      promptTokens: 1000, completionTokens: 500, totalTokens: 1500, measured: true,
    })
    expect(spend.measured).toBe(true)
    expect(spend.tokens).toBe(1500)
  })

  it('falls back when usage is measured but empty', () => {
    const spend = estimateRunSpend('prompt', result, {
      promptTokens: 0, completionTokens: 0, totalTokens: 0, measured: true,
    })
    expect(spend.measured).toBe(false)
  })

  it('resets the window when taken', () => {
    expect(takeTokenUsage().measured).toBe(false)
    expect(takeTokenUsage().totalTokens).toBe(0)
  })
})

// ── item 12: planner/judge provider separation ───────────────────────────────

describe('roleProvider', () => {
  const base: MobileProviderConfig = { providerId: 'openai', apiKey: 'worker-key' }

  it('falls back to the worker provider and says so', () => {
    expect(roleProvider(base, 'planner')).toEqual({ providerId: 'openai', apiKey: 'worker-key', dedicated: false })
  })

  it('uses a dedicated provider when both id and key are set', () => {
    const cfg = { ...base, plannerProviderId: 'kimi', plannerApiKey: 'planner-key' }
    expect(roleProvider(cfg, 'planner')).toEqual({ providerId: 'kimi', apiKey: 'planner-key', dedicated: true })
  })

  it('does not treat an id without a key as dedicated', () => {
    const cfg = { ...base, judgeProviderId: 'kimi' }
    expect(roleProvider(cfg, 'judge').dedicated).toBe(false)
  })

  it('round-trips the new fields through persistence defaults', () => {
    expect(loadMobileProvider().plannerProviderId).toBeUndefined()
  })
})

// ── item 13: network events come from the ledger ─────────────────────────────

describe('handoffs', () => {
  const task = (id: string, worker: TaskRecord['worker'], dependsOn: string[]): TaskRecord => ({
    id, type: worker, goal: id, inputs: {}, outputs: [], dependsOn, status: 'completed', worker,
    limits: { maxSteps: 15, maxRetries: 3, maxDelegations: 2, maxCostUsd: 0.5 },
    retries: 0, stepsUsed: 1, costUsd: 0, artifactIds: [],
  })
  const artifact = (id: string, taskId: string, path: string): ArtifactRecord => ({
    id, path, kind: 'json', title: path, body: '{}', taskId, worker: 'research', createdAt: 42,
  })

  it('is empty when nothing has been produced', () => {
    expect(handoffs(createProject('goal'))).toEqual([])
  })

  it('reports a handoff only where a dependency produced an artifact', () => {
    const project = {
      ...createProject('goal'),
      tasks: [task('T1', 'research', []), task('T2', 'analyst', ['T1'])],
      artifacts: [artifact('a1', 'T1', 'research/competitors.json')],
    }
    expect(handoffs(project)).toEqual([
      { from: 'research', to: 'analyst', fromTaskId: 'T1', toTaskId: 'T2', label: 'research/competitors.json', at: 42 },
    ])
  })

  it('reports nothing when the dependency produced no artifact', () => {
    const project = {
      ...createProject('goal'),
      tasks: [task('T1', 'research', []), task('T2', 'analyst', ['T1'])],
      artifacts: [],
    }
    expect(handoffs(project)).toEqual([])
  })

  it('ignores dependencies on tasks that do not exist', () => {
    const project = {
      ...createProject('goal'),
      tasks: [task('T2', 'analyst', ['ghost'])],
      artifacts: [artifact('a1', 'ghost', 'x.json')],
    }
    expect(handoffs(project)).toEqual([])
  })
})
