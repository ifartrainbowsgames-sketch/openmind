/**
 * The customer's provider credentials, resolved inside the worker.
 *
 * This is the only place in the system that turns ciphertext back into a key,
 * and it exists in a process the browser cannot reach. `provider_keys` denies
 * `authenticated` the `ciphertext` and `iv` columns at the grant level, and
 * `vault-keys` returns a masked hint; those stop a key coming *out* through
 * the API. This file is the other half: the key goes from storage into one
 * child process and nowhere else.
 *
 * Resolution is by PROVIDER, not by role. A customer connects Anthropic once;
 * whether the row was stored as their worker model or specifically for a
 * runtime, any runtime that needs Anthropic finds it. That is what makes
 * "Used by: Claude Sonnet, Claude Code" true rather than a label.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  providerCredential,
  type CredentialQuery, type CredentialVault, type ProviderCredential,
} from '../src/lib/workforce/credentials'
import { openKey } from './crypto'

interface KeyRow {
  role: string
  provider_id: string
  ciphertext: string
  iv: string
}

/**
 * Roles preferred when several rows name the same provider.
 *
 * A dedicated runtime credential wins over a model role: a customer who stored
 * a separate key for agent runtimes meant it to be used for them.
 */
const PREFERENCE = ['anthropic', 'worker', 'planner', 'judge']

function rank(role: string): number {
  const index = PREFERENCE.indexOf(role)
  return index === -1 ? PREFERENCE.length : index
}

export function createCredentialVault(db: SupabaseClient, secret: string): CredentialVault {
  return {
    async resolve(query: CredentialQuery): Promise<ProviderCredential | null> {
      const { data, error } = await db
        .from('provider_keys')
        .select('role, provider_id, ciphertext, iv')
        .eq('user_id', query.userId)
        .eq('provider_id', query.provider)

      if (error || !data?.length) return null

      const rows = (data as KeyRow[]).sort((a, b) => rank(a.role) - rank(b.role))
      for (const row of rows) {
        try {
          const apiKey = await openKey({ ciphertext: row.ciphertext, iv: row.iv }, secret)
          if (apiKey) return providerCredential(query.provider, apiKey)
        } catch {
          // A row encrypted under a rotated secret is unreadable, not fatal —
          // try the next one rather than failing the whole run on it.
        }
      }
      return null
    },
  }
}
