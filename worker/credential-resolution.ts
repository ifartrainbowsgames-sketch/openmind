/**
 * Which stored credential plays which part in a run.
 *
 * A pure function in its own module so it can be tested. worker/index.ts
 * creates a Supabase client, installs signal handlers and calls main() at
 * import time, so anything a test needs to reach cannot live there.
 */

export interface Credential {
  providerId: string
  apiKey: string
}

/**
 * Which stored credential should play a part in this run.
 *
 * Ordered, and the order is the compatibility story:
 *
 *   1. The provider the customer chose in their model settings, if they have
 *      it connected. With several providers connected at once this is the only
 *      thing that actually says which one to use.
 *   2. The legacy slot — a row literally named `worker`. Keeps every account
 *      that predates provider connections working with no migration.
 *   3. The only connection there is. Someone with exactly one provider
 *      connected and no explicit choice meant that one; blocking them to ask
 *      would be pedantry, not safety.
 *
 * Returns undefined rather than guessing between several, because picking one
 * of three connected providers on the customer's behalf spends their money at
 * a rate they did not choose.
 */
export function credentialFor(
  keys: Map<string, Credential>,
  chosen: unknown,
  legacySlot: string,
): Credential | undefined {
  if (typeof chosen === 'string' && chosen) {
    const picked = keys.get(chosen)
    if (picked?.providerId === chosen) return picked
  }
  const legacy = keys.get(legacySlot)
  if (legacy) return legacy

  const connections = new Map<string, Credential>()
  for (const entry of keys.values()) connections.set(entry.providerId, entry)
  return connections.size === 1 ? [...connections.values()][0] : undefined
}
