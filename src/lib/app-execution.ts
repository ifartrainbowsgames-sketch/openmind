/**
 * How /app executes agent work — explicit modes, never silent fallback.
 */

import { MOBILE_PROVIDER_KEY, loadMobileProvider, type MobileProviderConfig } from './mobile-provider'

export type AppExecutionMode = 'cloud' | 'browser_direct' | 'demo'

export type AppRuntimeId = 'builtin' | 'claude-code'

export const APP_EXECUTION_MODE_KEY = 'openmind-app-execution-mode-v1'
export const APP_RUNTIME_KEY = 'openmind-app-runtime-v1'

const MODES: AppExecutionMode[] = ['cloud', 'browser_direct', 'demo']
const RUNTIMES: AppRuntimeId[] = ['builtin', 'claude-code']

export function isAppExecutionMode(value: string): value is AppExecutionMode {
  return (MODES as string[]).includes(value)
}

export function isAppRuntimeId(value: string): value is AppRuntimeId {
  return (RUNTIMES as string[]).includes(value)
}

export function loadStoredExecutionMode(): AppExecutionMode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(APP_EXECUTION_MODE_KEY)
    return raw && isAppExecutionMode(raw) ? raw : null
  } catch {
    return null
  }
}

export function saveExecutionMode(mode: AppExecutionMode): void {
  localStorage.setItem(APP_EXECUTION_MODE_KEY, mode)
}

export function loadStoredRuntimeId(): AppRuntimeId {
  if (typeof window === 'undefined') return 'builtin'
  try {
    const raw = localStorage.getItem(APP_RUNTIME_KEY)
    return raw && isAppRuntimeId(raw) ? raw : 'builtin'
  } catch {
    return 'builtin'
  }
}

export function saveRuntimeId(runtimeId: AppRuntimeId): void {
  localStorage.setItem(APP_RUNTIME_KEY, runtimeId)
}

/** Default when the user has never chosen a mode. */
export function defaultExecutionMode(signedIn: boolean): AppExecutionMode {
  return signedIn ? 'cloud' : 'demo'
}

/**
 * One-time migration: users who already enabled backgroundRuns intended cloud
 * execution. Do not read their apiKey — only the flag.
 */
export function inferModeFromLegacyProvider(
  provider: MobileProviderConfig,
  signedIn: boolean,
): AppExecutionMode | null {
  if (!signedIn) return null
  if (provider.backgroundRuns === true) return 'cloud'
  if (provider.apiKey.trim()) return 'browser_direct'
  return null
}

export function resolveExecutionMode(
  stored: AppExecutionMode | null,
  signedIn: boolean,
  legacy?: MobileProviderConfig,
): AppExecutionMode {
  if (stored) {
    if (stored === 'cloud' && !signedIn) return 'demo'
    return stored
  }
  const migrated = legacy ? inferModeFromLegacyProvider(legacy, signedIn) : null
  if (migrated) return migrated
  return defaultExecutionMode(signedIn)
}

export function loadAppExecutionMode(signedIn: boolean): AppExecutionMode {
  return resolveExecutionMode(loadStoredExecutionMode(), signedIn, loadMobileProvider())
}

export function executionStatusLabel(
  mode: AppExecutionMode,
  detail?: { providerName?: string; runtimeId?: AppRuntimeId },
): string {
  const runtime =
    detail?.runtimeId === 'claude-code' ? 'Claude Code' : detail?.runtimeId === 'builtin' ? 'OpenMind Native' : undefined
  switch (mode) {
    case 'cloud':
      if (detail?.providerName && runtime) return `Cloud · ${runtime} · ${detail.providerName}`
      if (detail?.providerName) return `Cloud · ${detail.providerName}`
      return 'Cloud'
    case 'browser_direct':
      return detail?.providerName ? `Browser Direct · ${detail.providerName}` : 'Browser Direct'
    case 'demo':
      return 'Demo'
  }
}

/** Settings link for missing cloud credentials. */
export const CLOUD_PROVIDER_SETTINGS_PATH = '/settings/keys'

/** Documented for tests — localStorage must not override cloud routing. */
export { MOBILE_PROVIDER_KEY }
