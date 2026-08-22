/**
 * Nothing secret leaves this process as telemetry.
 *
 * `ProviderCredential.toJSON()` protects one shape from one path. Telemetry
 * arrives from everywhere — tool inputs, child-process environments, provider
 * error bodies, run options, arbitrary metrics objects — and most of it was
 * never designed with a wire in mind. So redaction happens once, at the
 * boundary, over whatever it is handed.
 *
 * Three rules, in order of how they actually catch things:
 *
 *   1. **Key names.** `apiKey`, `authorization`, `ciphertext`… redacted
 *      whatever the value looks like.
 *   2. **Value shapes.** `sk-ant-…`, a JWT, a long base64 blob. Catches the
 *      case that matters most: a secret pasted into a field nobody named
 *      `apiKey`, such as a shell command or a provider's error message.
 *   3. **Size.** Nothing enormous. A 4 MB stdout in a span attribute is a
 *      denial-of-service against your own tracing backend.
 *
 * Rule 2 exists because rule 1 is not enough and this codebase has the
 * receipts: provider errors sometimes echo the submitted key, and a `Bash`
 * tool input is a plain string that may contain anything.
 */

export const REDACTED = '[redacted]'

/** Field names whose VALUE is a secret regardless of what it looks like. */
const SECRET_KEYS = [
  'apikey', 'api_key', 'authorization', 'auth', 'token', 'access_token',
  'refresh_token', 'id_token', 'secret', 'password', 'passwd', 'credential',
  'credentials', 'ciphertext', 'iv', 'service_role', 'servicerole',
  'private_key', 'privatekey', 'session_token', 'cookie', 'set-cookie',
  'anthropic_api_key', 'openai_api_key', 'supabase_service_role_key',
  'key_encryption_secret', 'browserless', 'tavily', 'firecrawl', 'e2b',
  'providersessionid', 'provider_session_id',
]

/**
 * Values that are secrets whatever they are called.
 *
 * Deliberately a little eager. A redacted trace attribute costs a debugging
 * session; a leaked key costs a customer's account.
 */
const SECRET_VALUES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,               // OpenAI / Anthropic style
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,          // GitHub
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,        // Slack
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\bAKIA[0-9A-Z]{16}\b/g,                  // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
]

/** Longest string kept on a span. Beyond this, truncated with a marker. */
export const MAX_STRING = 4_000
/** Deepest object walked. Cycles and absurd nesting both stop here. */
const MAX_DEPTH = 8
/** Most array entries kept. */
const MAX_ARRAY = 50

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[^a-z_]/g, '')
  return SECRET_KEYS.some((secret) => lower.includes(secret.replace(/[^a-z_]/g, '')))
}

/** Redact secret-shaped substrings inside free text. */
export function scrubText(value: string): string {
  let out = value
  for (const pattern of SECRET_VALUES) out = out.replace(pattern, REDACTED)
  return out
}

export function truncate(value: string, max = MAX_STRING): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}… [+${value.length - max} chars]`
}

/**
 * Make any value safe to emit.
 *
 * Returns a structure, not a string, so a caller can still flatten it into
 * span attributes. Unknown shapes degrade to a description rather than
 * throwing — telemetry must never be the thing that breaks a run.
 */
export function sanitizeTelemetry(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return Number(value)

  if (typeof value === 'string') return truncate(scrubText(value))

  if (depth >= MAX_DEPTH) return '[depth limit]'

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY).map((entry) => sanitizeTelemetry(entry, depth + 1))
    return value.length > MAX_ARRAY ? [...kept, `[+${value.length - MAX_ARRAY} more]`] : kept
  }

  if (value instanceof Error) {
    // Provider errors are one of the likeliest places a key reappears: some
    // APIs echo the credential prefix back in the message.
    return { name: value.name, message: truncate(scrubText(value.message)) }
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? REDACTED : sanitizeTelemetry(entry, depth + 1)
    }
    return out
  }

  // Functions, symbols. Nothing useful and possibly a closure over a secret.
  return `[${typeof value}]`
}

/**
 * Flatten to OpenTelemetry attribute values.
 *
 * OTel accepts strings, numbers, booleans and arrays of those. Everything else
 * is JSON-encoded AFTER sanitising, never before — encoding first would put a
 * secret inside a string that the key-name rule can no longer see.
 */
export type SafeAttributes = Record<string, string | number | boolean>

export function safeAttributes(
  input: Record<string, unknown>,
  prefix = '',
): SafeAttributes {
  const out: SafeAttributes = {}

  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue
    const name = prefix ? `${prefix}.${key}` : key

    if (isSecretKey(key)) {
      out[name] = REDACTED
      continue
    }

    const clean = sanitizeTelemetry(raw)
    if (typeof clean === 'string' || typeof clean === 'number' || typeof clean === 'boolean') {
      out[name] = clean
      continue
    }
    // Objects and arrays become one JSON attribute rather than an exploded
    // tree: Phoenix renders them fine and span cardinality stays sane.
    out[name] = truncate(JSON.stringify(clean) ?? '')
  }

  return out
}

/**
 * A process environment, reduced to something safe to record.
 *
 * Never the environment itself. The worker holds the service-role key, the
 * encryption secret and the platform's tool credentials, and "we only logged
 * the keys, not the values" is one refactor away from being false.
 */
export function safeEnvSummary(env: Record<string, string | undefined>): SafeAttributes {
  const names = Object.keys(env).filter((k) => env[k] !== undefined)
  return {
    'env.count': names.length,
    'env.secret_names': names.filter(isSecretKey).length,
  }
}
