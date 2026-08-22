/**
 * Safe cloud execution readiness for /app — vault metadata only, never keys.
 */

import { getSession } from './auth'
import { listKeys, type StoredKey } from './provider-vault'
import { LIVE_PROVIDERS } from './agent'

export interface CloudReadiness {
  ready: boolean
  signedIn: boolean
  demoSession: boolean
  reason?: string
  workerProviderId?: string
  workerProviderName?: string
}

function providerName(id: string): string {
  return LIVE_PROVIDERS.find((p) => p.id === id)?.name ?? id
}

export function cloudReadinessFromKeys(
  keys: StoredKey[],
  session: { demo: boolean } | null,
): CloudReadiness {
  if (!session) {
    return {
      ready: false,
      signedIn: false,
      demoSession: false,
      reason: 'Sign in to use OpenMind Cloud.',
    }
  }
  if (session.demo) {
    return {
      ready: false,
      signedIn: true,
      demoSession: true,
      reason: 'Demo accounts cannot use Cloud mode — sign in with a real account or switch to Demo execution.',
    }
  }
  const worker = keys.find((k) => k.role === 'worker')
  if (!worker?.providerId) {
    return {
      ready: false,
      signedIn: true,
      demoSession: false,
      reason: 'No AI provider is connected for Cloud mode.',
    }
  }
  return {
    ready: true,
    signedIn: true,
    demoSession: false,
    workerProviderId: worker.providerId,
    workerProviderName: providerName(worker.providerId),
  }
}

/** Live check against the vault for the current session. */
export async function fetchCloudReadiness(): Promise<CloudReadiness> {
  const session = await getSession()
  if (!session) {
    return cloudReadinessFromKeys([], null)
  }
  try {
    const keys = await listKeys()
    return cloudReadinessFromKeys(keys, session)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reach the provider vault.'
    return {
      ready: false,
      signedIn: true,
      demoSession: session.demo,
      reason: message,
    }
  }
}
