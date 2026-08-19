import { LIVE_PROVIDERS, type LiveProviderSpec } from './agent'

export const MOBILE_PROVIDER_KEY = 'openmind-mobile-provider-v1'

export interface MobileProviderConfig {
  providerId: string
  apiKey: string
  tavilyKey?: string
  firecrawlKey?: string
  e2bKey?: string
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
