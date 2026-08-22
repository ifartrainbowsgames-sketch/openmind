/**
 * Whether a customer holds a working credential — metadata only.
 *
 * Deliberately separate from `credential-vault.ts`, which decrypts. Eligibility
 * runs in the orchestrator and must be able to ask "does this customer have
 * Anthropic?" without anything in that call path being able to answer with a
 * key. Two functions against the same table, and only one of them can decrypt.
 *
 * The distinction this exists to preserve:
 *
 *   no row                   → missing_provider_credential
 *   row, verified_at null    → unknown; policy decides
 *   row, verification_error  → failed; ineligible regardless of policy
 *   row, verified_at set     → verified
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CredentialDirectory, CredentialStatus } from '../src/lib/workforce/eligibility'

/** How long a successful verification is trusted before it means nothing. */
export const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createCredentialDirectory(
  db: SupabaseClient,
  now: () => number = Date.now,
): CredentialDirectory {
  return {
    async status(userId: string, providerId: string): Promise<CredentialStatus> {
      const { data, error } = await db
        .from('provider_keys')
        // No ciphertext, no iv. This query could run with a customer's own JWT
        // and return exactly the same columns.
        .select('provider_id, hint, verified_at, verification_error')
        .eq('user_id', userId)
        .eq('provider_id', providerId)

      if (error || !data?.length) return { configured: false, verification: 'unknown' }

      // Several rows can name one provider — a model role and a runtime slot.
      // The best of them decides: a customer who has one working Anthropic key
      // has Anthropic, whichever slot it sits in.
      let best: CredentialStatus = { configured: true, verification: 'unknown' }
      for (const row of data) {
        const failedAt = row.verification_error ? String(row.verification_error) : ''
        const verifiedAt = row.verified_at ? Date.parse(String(row.verified_at)) : 0

        if (verifiedAt && now() - verifiedAt < VERIFICATION_TTL_MS) {
          return { configured: true, verification: 'verified' }
        }
        if (failedAt && best.verification === 'unknown') {
          best = { configured: true, verification: 'failed', detail: failedAt.slice(0, 200) }
        }
        if (verifiedAt && best.verification === 'unknown') {
          // Verified once, but too long ago to promise anything now.
          best = {
            configured: true,
            verification: 'unknown',
            detail: 'last verified more than a week ago',
          }
        }
      }
      return best
    },
  }
}
