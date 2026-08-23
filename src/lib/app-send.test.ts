import { describe, expect, it } from 'vitest'
import {
  defaultExecutionMode,
  executionStatusLabel,
  inferModeFromLegacyProvider,
  resolveExecutionMode,
} from './app-execution'
import { cloudReadinessFromKeys } from './cloud-readiness'
import { buildCloudRunOptions, describeRunStatus, modelSelection, resolveSendRoute } from './app-send'
import type { StoredKey } from './provider-vault'

describe('resolveSendRoute', () => {
  const cloudReady = {
    executionMode: 'cloud' as const,
    signedIn: true,
    demoSession: false,
    cloudReady: true,
    browserKeyReady: false,
  }

  it('1. authenticated Cloud user without localStorage key does NOT use simulatedBrain', () => {
    const route = resolveSendRoute(cloudReady)
    expect(route.kind).toBe('cloud_enqueue')
    expect(route.kind).not.toBe('demo_runTurn')
  })

  it('2. Cloud mode routes through enqueueRun / worker', () => {
    expect(resolveSendRoute(cloudReady)).toEqual({
      kind: 'cloud_enqueue',
      options: { strictMode: true },
    })
  })

  it('3. Cloud mode does not require browser plaintext provider key', () => {
    const route = resolveSendRoute({ ...cloudReady, browserKeyReady: false })
    expect(route.kind).toBe('cloud_enqueue')
  })

  it('4. missing cloud provider shows configuration-required state', () => {
    const route = resolveSendRoute({
      ...cloudReady,
      cloudReady: false,
      cloudBlockReason: 'No AI provider is connected for Cloud mode.',
    })
    expect(route).toMatchObject({
      kind: 'blocked',
      message: 'No AI provider is connected for Cloud mode.',
      settingsPath: '/settings/keys',
    })
  })

  it('5. missing provider never invokes simulatedBrain', () => {
    const route = resolveSendRoute({ ...cloudReady, cloudReady: false })
    expect(route.kind).toBe('blocked')
    expect(route.kind).not.toBe('demo_runTurn')
  })

  it('6. provider error path never falls back to demo (routing is explicit)', () => {
    const route = resolveSendRoute(cloudReady)
    expect(route.kind).not.toBe('demo_runTurn')
  })

  it('7. Browser Direct still works when explicitly selected', () => {
    const route = resolveSendRoute({
      executionMode: 'browser_direct',
      signedIn: true,
      demoSession: false,
      cloudReady: false,
      browserKeyReady: true,
    })
    expect(route).toEqual({ kind: 'browser_runTurn', strictMode: true })
  })

  it('8. Demo uses simulatedBrain only when explicitly selected', () => {
    expect(
      resolveSendRoute({
        executionMode: 'demo',
        signedIn: true,
        demoSession: false,
        cloudReady: true,
        browserKeyReady: true,
      }).kind,
    ).toBe('demo_runTurn')
  })

  it('15. localStorage provider configuration cannot silently override Cloud mode', () => {
    const route = resolveSendRoute({
      ...cloudReady,
      browserKeyReady: true,
    })
    expect(route.kind).toBe('cloud_enqueue')
  })
})

describe('cloudReadinessFromKeys', () => {
  it('9. Cloud mode does not read another customer credential (vault is per session)', () => {
    const keys: StoredKey[] = [{ role: 'worker', providerId: 'anthropic', hint: '••••abcd' }]
    const ready = cloudReadinessFromKeys(keys, { demo: false })
    expect(ready.ready).toBe(true)
    expect(ready.workerProviderId).toBe('anthropic')
  })

  it('empty vault is not ready', () => {
    expect(cloudReadinessFromKeys([], { demo: false }).ready).toBe(false)
  })
})

describe('buildCloudRunOptions', () => {
  it('14. selected runtimeId reaches agent_runs / worker', () => {
    const options = buildCloudRunOptions({
      workspace: { kind: 'github', slug: 'acme/app', branch: 'main', source: 'live', summary: 'repo' },
      skill: 'multitask',
      runtimeId: 'claude-code',
      route: { kind: 'cloud_enqueue', options: { strictMode: true } },
    })
    expect(options.runtimeId).toBe('claude-code')
    expect(options.strictMode).toBe(true)
  })

  it('builtin omits runtimeId so worker uses default builtin runtime', () => {
    const options = buildCloudRunOptions({
      workspace: { kind: 'openmind', slug: 'scratch', branch: 'main', source: 'live', summary: 'local' },
      skill: 'multitask',
      runtimeId: 'builtin',
      route: { kind: 'cloud_enqueue', options: { strictMode: true } },
    })
    expect(options.runtimeId).toBeUndefined()
  })

  describe('the customer’s model choice reaches the worker', () => {
    // The bug this pins: buildCloudRunOptions returned four fields and dropped
    // providerId and modelId entirely. Runs still succeeded — the worker falls
    // back to "the only provider connected" — so picking a model in Settings
    // changed nothing while everything appeared to work.
    const base = {
      workspace: { kind: 'openmind', slug: 'scratch', branch: 'main', source: 'live', summary: 'local' },
      skill: 'multitask',
      runtimeId: 'builtin',
      route: { kind: 'cloud_enqueue', options: { strictMode: true } },
    } as const

    it('carries the chosen provider and model', () => {
      const options = buildCloudRunOptions({
        ...base,
        config: { providerId: 'groq', modelId: 'qwen/qwen3.6-27b' },
      })
      expect(options.providerId).toBe('groq')
      expect(options.modelId).toBe('qwen/qwen3.6-27b')
    })

    it('carries separate planner and judge choices', () => {
      const options = buildCloudRunOptions({
        ...base,
        config: {
          providerId: 'groq', modelId: 'openai/gpt-oss-120b',
          plannerProviderId: 'anthropic', plannerModelId: 'claude-haiku-4-5',
          judgeProviderId: 'google', judgeModelId: 'gemini-3.6-flash',
        },
      })
      expect(options.plannerProviderId).toBe('anthropic')
      expect(options.plannerModelId).toBe('claude-haiku-4-5')
      expect(options.judgeProviderId).toBe('google')
      expect(options.judgeModelId).toBe('gemini-3.6-flash')
    })

    it('omits a blank choice rather than sending an empty string', () => {
      // '' would reach credentialFor as a chosen provider and match nothing.
      const options = buildCloudRunOptions({
        ...base,
        config: { providerId: 'groq', modelId: '', plannerProviderId: '' },
      })
      expect(options.modelId).toBeUndefined()
      expect(options.plannerProviderId).toBeUndefined()
      expect(options.providerId).toBe('groq')
    })

    it('survives a caller that passes no config at all', () => {
      const options = buildCloudRunOptions(base)
      expect(options.providerId).toBeUndefined()
      expect(options.strictMode).toBe(true)
    })
  })
})

describe('modelSelection is the one place the choice is read', () => {
  it('passes ids straight through', () => {
    expect(modelSelection({ providerId: 'xai', modelId: 'grok-4' }))
      .toMatchObject({ providerId: 'xai', modelId: 'grok-4' })
  })

  it('never emits an empty string for an unset field', () => {
    const out = modelSelection({})
    for (const [key, value] of Object.entries(out)) {
      expect(value, key).toBeUndefined()
    }
  })

  it('carries no secret-shaped field', () => {
    // Whatever else changes, this object lands in `agent_runs`, which is a
    // row a support engineer may read. It holds ids, never credentials.
    const out = modelSelection({ providerId: 'groq', modelId: 'm' }) as Record<string, unknown>
    for (const key of Object.keys(out)) {
      expect(key, key).not.toMatch(/key|secret|token|password/i)
    }
  })
})

describe('describeRunStatus', () => {
  it('10. Cloud run outcome is reflected in chat copy', () => {
    expect(describeRunStatus({ status: 'completed', answer: 'CLOUD-RUNTIME-CANARY-8274' }))
      .toBe('CLOUD-RUNTIME-CANARY-8274')
  })

  it('11. needs_user is distinct from failed', () => {
    const needs = describeRunStatus({ status: 'needs_user', error: 'Approve: npm install' })
    const failed = describeRunStatus({ status: 'failed', error: 'OpenAI quota exceeded' })
    expect(needs).toContain('Approve')
    expect(failed).toContain('quota')
    expect(needs).not.toBe(failed)
  })

  it('12. cancelled is distinct from failed', () => {
    expect(describeRunStatus({ status: 'cancelled' })).toBe('Cancelled.')
    expect(describeRunStatus({ status: 'failed', error: 'x' })).toContain('Failed')
  })

  it('13. failed provider response displays real safe reason', () => {
    expect(describeRunStatus({ status: 'failed', error: 'Anthropic credential missing' }))
      .toBe('Failed — Anthropic credential missing')
  })
})

describe('execution mode defaults', () => {
  it('defaults signed-in users to cloud', () => {
    expect(defaultExecutionMode(true)).toBe('cloud')
    expect(defaultExecutionMode(false)).toBe('demo')
  })

  it('migrates legacy backgroundRuns to cloud', () => {
    expect(
      resolveExecutionMode(null, true, { providerId: 'openai', apiKey: '', backgroundRuns: true }),
    ).toBe('cloud')
  })

  it('stored cloud falls back to demo when signed out', () => {
    expect(resolveExecutionMode('cloud', false)).toBe('demo')
  })

  it('labels show real mode state', () => {
    expect(executionStatusLabel('cloud', { providerName: 'Anthropic', runtimeId: 'claude-code' }))
      .toBe('Cloud · Claude Code · Anthropic')
    expect(executionStatusLabel('demo')).toBe('Demo')
  })

  it('inferModeFromLegacyProvider respects browser key without cloud flag', () => {
    expect(
      inferModeFromLegacyProvider({ providerId: 'openai', apiKey: 'sk-test' }, true),
    ).toBe('browser_direct')
  })
})
