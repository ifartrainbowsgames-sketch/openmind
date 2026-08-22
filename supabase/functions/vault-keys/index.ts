// vault-keys — store customer provider keys server-side, encrypted.
//
// The browser POSTs a key here once; from then on the background worker can run
// without a tab open. The key is never returned — `list` yields provider ids and
// a masked hint only. Writes go through the service role because the table's
// column grants deliberately deny `authenticated` any access to the ciphertext.
//
// Every request is authenticated by forwarding the caller's JWT to auth.getUser.
// The service role is used ONLY after that check resolves to a real user id, so
// a caller can never touch another account's row.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sealKey } from './crypto.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

// What a credential can be stored *as*.
//
// A provider CONNECTION stores role = provider id, which is what lets one
// customer connect Anthropic and Grok and OpenAI at the same time rather than
// filling three fixed model slots. Legacy model roles and tool roles stay
// valid so existing rows keep working.
//
// This list is duplicated from LIVE_PROVIDERS in src/lib/agent/brains.ts and
// cannot import it: the Edge Function is deployed standalone by the Supabase
// CLI and cannot reach outside its own directory — the same reason
// worker/crypto.ts mirrors ./crypto.ts. If you add a provider there, add it
// here, or connecting it returns 400.
const PROVIDER_IDS = [
  'kimi', 'kimi-cn', 'openai', 'anthropic', 'openrouter', 'groq',
  'xai', 'google', 'deepseek', 'mistral', 'together', 'perplexity',
  'cohere', 'cerebras', 'ollama',
]

const LEGACY_ROLES = [
  // Model slots, still read by the worker as a fallback.
  'worker', 'planner', 'judge',
  // Tool credentials, so a queued run is funded by the customer who started it
  // rather than by this deployment's own environment variables.
  'tavily', 'firecrawl', 'e2b', 'browserless',
  // An older provider-credential slot, kept so rows written before provider
  // connections existed still resolve.
  'openai_runtime',
]

const ROLES: string[] = [...PROVIDER_IDS, ...LEGACY_ROLES]

// Mirrors the check constraint in migration 20260822120000. Belt and braces:
// the database is the enforcement point, this is the good error message.
const ROLE_SHAPE = /^[a-z][a-z0-9_-]{0,39}$/

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SECRET = Deno.env.get('KEY_ENCRYPTION_SECRET') ?? ''

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { error: 'function is missing Supabase config' })
  if (!SECRET) return json(500, { error: 'KEY_ENCRYPTION_SECRET is not set — refusing to store keys unencrypted' })

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'sign in required' })

  // Resolve the caller from their own token before touching anything.
  const asCaller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  const userId = userData?.user?.id
  if (userErr || !userId) return json(401, { error: 'invalid session' })

  let body: { action?: unknown; role?: unknown; providerId?: unknown; apiKey?: unknown }
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(400, { error: 'body must be JSON' })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const action = body.action

  if (action === 'list') {
    const { data, error } = await admin
      .from('provider_keys')
      .select('role, provider_id, hint, updated_at')
      .eq('user_id', userId)
    if (error) return json(500, { error: error.message })
    return json(200, { keys: data ?? [] })
  }

  const role = typeof body.role === 'string' ? body.role.trim() : ''
  if (!ROLE_SHAPE.test(role) || !ROLES.includes(role)) {
    return json(400, { error: `unknown credential slot "${role}" — expected a provider id or a legacy role` })
  }

  if (action === 'delete') {
    const { error } = await admin.from('provider_keys').delete().eq('user_id', userId).eq('role', role)
    if (error) return json(500, { error: error.message })
    return json(200, { ok: true, role })
  }

  if (action === 'set') {
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!providerId) return json(400, { error: 'providerId required' })
    if (!apiKey) return json(400, { error: 'apiKey required' })

    // A provider id this deployment does not know must be refused HERE, not
    // discovered at run time. The worker cannot present a credential to a
    // provider it has no endpoint for, so it blocks the run — and the customer
    // sees a run fail rather than a key fail to save. Reject at the door.
    if (!PROVIDER_IDS.includes(providerId)) {
      return json(400, { error: `unknown provider "${providerId}"` })
    }

    const sealed = await sealKey(apiKey, SECRET)
    const { error } = await admin.from('provider_keys').upsert({
      user_id: userId,
      role,
      provider_id: providerId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      hint: sealed.hint,
      updated_at: new Date().toISOString(),
    })
    if (error) return json(500, { error: error.message })
    // The key itself is never echoed back, not even to the account that set it.
    return json(200, { ok: true, role, providerId, hint: sealed.hint })
  }

  return json(400, { error: "action must be 'set' | 'list' | 'delete'" })
})
