/**
 * Provider, credential, runtime — three things, kept apart.
 *
 *   Provider    Anthropic, OpenAI, Gemini. A company with an API.
 *   Credential  THIS customer's key for that provider, encrypted at rest.
 *   Runtime     Claude Code, Codex, the builtin one. Something that executes.
 *
 * Conflating them is how a product ends up asking a customer for "the Claude
 * Code key" — which is not a thing. A runtime *requires* a provider
 * credential; the customer configures the provider once and every runtime that
 * needs it resolves the same row.
 *
 * ## The rule this file exists to enforce
 *
 * A decrypted key is resolved in the worker process, immediately before
 * launching a runtime, and never travels anywhere else. Not into the browser,
 * not into a queued run row, not into the ledger, not into an event, not into
 * a log line. `provider_keys` already denies `authenticated` any access to
 * `ciphertext` and `iv` at the column-grant level, and `vault-keys` returns
 * only a masked hint. This is the in-process half of the same rule.
 */

/** Metadata a browser may see. Never the secret. */
export interface CredentialSummary {
  provider: string
  connected: boolean
  /** Last few characters, so a customer can tell which key is stored. */
  hint?: string
  updatedAt?: number
}

/**
 * A resolved credential, live only for the duration of one run.
 *
 * `apiKey` is the one field in this codebase that must never be serialised.
 * `toJSON` is defined to make that structural rather than a rule someone has
 * to remember: `JSON.stringify` of a run's options, an event, or an error
 * payload cannot leak it by accident.
 */
export interface ProviderCredential {
  provider: string
  apiKey: string
  toJSON(): CredentialSummary
}

export function providerCredential(provider: string, apiKey: string): ProviderCredential {
  return {
    provider,
    apiKey,
    toJSON: () => ({ provider, connected: true, hint: last4(apiKey) }),
  }
}

export function last4(key: string): string {
  return key.length <= 4 ? '••••' : key.slice(-4)
}

/**
 * What a runtime needs before it can run.
 *
 * Declared by the runtime, resolved by the worker. A customer who selects
 * Claude Code without an Anthropic credential gets a blocked run naming what
 * to connect, rather than a provider failure they cannot interpret.
 */
export interface RuntimeCredentialRequirement {
  provider: string
  required: boolean
  /** Shown to the customer. "Claude Code runs on your Anthropic account." */
  reason?: string
}

export interface CredentialQuery {
  userId: string
  provider: string
}

/**
 * Where credentials come from. Implemented in the worker against the vault;
 * a test supplies its own. Deliberately an interface so nothing in the
 * browser bundle can accidentally depend on a real one.
 */
export interface CredentialVault {
  resolve(query: CredentialQuery): Promise<ProviderCredential | null>
}

/** A vault with nothing in it. The honest default for a process with no user. */
export const EMPTY_VAULT: CredentialVault = { resolve: async () => null }

/**
 * The message a customer sees when a runtime cannot run for want of a key.
 *
 * Names the provider and the runtime, because "authentication failed" sends
 * someone to the wrong settings page.
 */
export function missingCredentialReason(
  runtimeId: string,
  requirement: RuntimeCredentialRequirement,
): string {
  const why = requirement.reason ? ` ${requirement.reason}` : ''
  return `${runtimeId} requires a ${requirement.provider} credential.${why} Connect one in Settings → AI Providers.`
}
