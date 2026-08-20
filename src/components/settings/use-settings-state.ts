import { useEffect, useState } from 'react'
import { getSession } from '@/lib/auth'
import {
  loadMobileProvider, saveMobileProvider, type MobileProviderConfig,
} from '@/lib/mobile-provider'
import { listKeys, type StoredKey } from '@/lib/provider-vault'

/** Shared state for every panel: one config object, saved on change. */
export function useProviderConfig(): [MobileProviderConfig, (next: MobileProviderConfig) => void] {
  const [config, setConfig] = useState<MobileProviderConfig>(() => loadMobileProvider())
  const update = (next: MobileProviderConfig) => {
    setConfig(next)
    saveMobileProvider(next)
  }
  return [config, update]
}

/** Vault contents. Never holds a key, only which roles have one. */
export function useVault(): {
  keys: StoredKey[]
  error: string | null
  signedIn: boolean | null
  refresh: () => void
} {
  const [keys, setKeys] = useState<StoredKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const refresh = () => {
    void getSession().then((session) => {
      const ok = Boolean(session?.user.id)
      setSignedIn(ok)
      if (!ok) { setKeys([]); return }
      listKeys()
        .then((rows) => { setKeys(rows); setError(null) })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    })
  }
  useEffect(refresh, [])
  return { keys, error, signedIn, refresh }
}

