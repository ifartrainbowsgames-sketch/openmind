import { LIVE_PROVIDERS, type LiveProviderSpec } from './agent'

export const MOBILE_PROVIDER_KEY = 'openmind-mobile-provider-v1'

export interface MobileProviderConfig {
  providerId: string
  apiKey: string
  tavilyKey?: string
  firecrawlKey?: string
  e2bKey?: string
  browserlessKey?: string
  /**
   * Strict runs refuse mock data, offline planners and heuristic judges — a
   * missing capability becomes a blocked task instead of a plausible answer.
   * Off by default so the keyless demo still works.
   */
  strictMode?: boolean
  /**
   * Queue runs on the worker instead of executing in the tab. Requires a
   * server-held key, because a worker has no browser to ask for one.
   */
  backgroundRuns?: boolean
  /**
   * Optional distinct models for planning and judging. One model that designs
   * the plan, executes every task in it, and then grades the result approves
   * its own work — correlated failure, not independent review. Blank means
   * 'reuse the worker provider', which is honest but weaker.
   */
  plannerProviderId?: string
  plannerApiKey?: string
  judgeProviderId?: string
  judgeApiKey?: string
}

export function loadMobileProvider(): MobileProviderConfig {
  if (typeof window === 'undefined') return { providerId: 'openai', apiKey: '' }
  try {
    const raw = localStorage.getItem(MOBILE_PROVIDER_KEY)
    if (!raw) return { providerId: 'openai', apiKey: '' }
    const parsed = JSON.parse(raw) as Partial<MobileProviderConfig>
    const providerId = LIVE_PROVIDERS.some((p) => p.id === parsed.providerId)
      ? (parsed.providerId as string)
      : 'openai'
    return {
      providerId,
      apiKey: parsed.apiKey?.trim() ?? '',
      tavilyKey: parsed.tavilyKey?.trim() || undefined,
      firecrawlKey: parsed.firecrawlKey?.trim() || undefined,
      e2bKey: parsed.e2bKey?.trim() || undefined,
      browserlessKey: parsed.browserlessKey?.trim() || undefined,
      strictMode: parsed.strictMode === true,
      backgroundRuns: parsed.backgroundRuns === true,
      plannerProviderId: parsed.plannerProviderId?.trim() || undefined,
      plannerApiKey: parsed.plannerApiKey?.trim() || undefined,
      judgeProviderId: parsed.judgeProviderId?.trim() || undefined,
      judgeApiKey: parsed.judgeApiKey?.trim() || undefined,
    }
  } catch {
    return { providerId: 'openai', apiKey: '' }
  }
}

export function saveMobileProvider(config: MobileProviderConfig): void {
  localStorage.setItem(MOBILE_PROVIDER_KEY, JSON.stringify(config))
}

export function resolveMobileProviderSpec(config: MobileProviderConfig): LiveProviderSpec {
  return LIVE_PROVIDERS.find((p) => p.id === config.providerId) ?? LIVE_PROVIDERS[2]
}

export function mobileLiveReady(config: MobileProviderConfig): boolean {
  const spec = resolveMobileProviderSpec(config)
  return spec.keyRequired === false || config.apiKey.length > 0
}

/**
 * Provider for a specific role, falling back to the worker provider when no
 * dedicated one is configured. Callers get told which happened via `dedicated`
 * so the UI can say plainly that the judge is grading its own work.
 */
export function roleProvider(
  config: MobileProviderConfig,
  role: 'planner' | 'judge',
): { providerId: string; apiKey: string; dedicated: boolean } {
  const id = role === 'planner' ? config.plannerProviderId : config.judgeProviderId
  const key = role === 'planner' ? config.plannerApiKey : config.judgeApiKey
  if (id && key) return { providerId: id, apiKey: key, dedicated: true }
  return { providerId: config.providerId, apiKey: config.apiKey, dedicated: false }
}
