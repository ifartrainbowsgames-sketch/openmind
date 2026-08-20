// Client for the server-held key vault.
//
// Keys used to live only in localStorage, which meant a background worker could
// never run without a tab open. They are now stored server-side, encrypted, and
// this module is deliberately write-only: `list` returns provider ids and a
// masked hint, never a key. Nothing here can read a key back, including for the
// account that set it — the column grants in the migration enforce that even if
// this file were wrong.

/**
 * Model roles plus tool credentials. Tool keys live here too because a queued
 * run has no browser to read them from — without this, background runs fell
 * back to the deployment's own tool keys and billed them to us.
 */
export type VaultRole =
  | 'worker' | 'planner' | 'judge'
  | 'tavily' | 'firecrawl' | 'e2b' | 'browserless'

export const MODEL_ROLES = ['worker', 'planner', 'judge'] as const
export const TOOL_ROLES = ['tavily', 'firecrawl', 'e2b', 'browserless'] as const

export function isToolRole(role: VaultRole): boolean {
  return (TOOL_ROLES as readonly string[]).includes(role)
}

export interface StoredKey {
  role: VaultRole
  providerId: string
  /** "••••7f2a" — enough to recognise, useless to steal. */
  hint: string
  updatedAt?: number
}

async function callVault(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { supabase, SUPABASE_URL, isSupabaseConfigured } = await import('./supabase')
  if (!isSupabaseConfigured || !SUPABASE_URL) {
    throw new Error('Supabase is not configured — server-held keys need a project.')
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sign in to store keys on the server.')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/vault-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(String(json.error ?? `vault ${res.status}`))
  return json
}

/** Store a key for a role. The plaintext leaves the browser exactly once. */
export async function storeKey(role: VaultRole, providerId: string, apiKey: string): Promise<StoredKey> {
  const out = await callVault({ action: 'set', role, providerId, apiKey })
  return { role, providerId, hint: String(out.hint ?? '••••') }
}

export async function listKeys(): Promise<StoredKey[]> {
  const out = await callVault({ action: 'list' })
  const rows = Array.isArray(out.keys) ? (out.keys as Record<string, unknown>[]) : []
  return rows.map((r) => ({
    role: r.role as VaultRole,
    providerId: String(r.provider_id ?? ''),
    hint: String(r.hint ?? '••••'),
    updatedAt: r.updated_at ? Date.parse(String(r.updated_at)) : undefined,
  }))
}

export async function deleteKey(role: VaultRole): Promise<void> {
  await callVault({ action: 'delete', role })
}
