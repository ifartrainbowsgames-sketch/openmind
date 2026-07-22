// ── Setup-wizard provider registry + real key test / preview chat ────────────
// The wizard promises "we test it" — so this actually tests it. Validation hits
// the provider's own `models` list endpoint (cheap, spends no tokens) with the
// key the user just pasted; the preview step then runs a real chat turn. The
// raw key is passed in from session memory on every call and is NEVER stored
// here or persisted — same session-only contract as the rest of this branch.

import type { ChatbotConfig, Tone } from './onboarding'

/** Wire dialect — OpenAI-compatible (the majority) or Anthropic's messages API. */
export type ProviderDialect = 'openai' | 'anthropic'

export interface SetupProvider {
  id: string
  name: string
  /** OpenAI-compatible base (…/v1) or the Anthropic base. Empty when the user supplies it. */
  baseUrl: string
  /** Sensible default model for the preview chat. */
  defaultModel: string
  dialect: ProviderDialect
  /** false only for local providers (Ollama) that need no key. */
  keyRequired: boolean
  /** true when the user must supply their own base URL (self-host / gateways). */
  custom?: boolean
  /** Where to get a key — shown as a hint under the field. */
  keyHint: string
}

// Only providers we can genuinely reach browser-direct are listed, so the
// "Test connection" button never lies. Azure / vLLM / LiteLLM and other
// gateways go through the "OpenAI-compatible" custom entry with a base URL.
export const SETUP_PROVIDERS: SetupProvider[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', dialect: 'openai', keyRequired: true, keyHint: 'platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-haiku-4-5-20251001', dialect: 'anthropic', keyRequired: true, keyHint: 'console.anthropic.com → API keys' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', dialect: 'openai', keyRequired: true, keyHint: 'aistudio.google.com/apikey' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', dialect: 'openai', keyRequired: true, keyHint: 'console.mistral.ai → API keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.1-8b-instant', dialect: 'openai', keyRequired: true, keyHint: 'console.groq.com/keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', dialect: 'openai', keyRequired: true, keyHint: 'openrouter.ai/keys' },
  { id: 'together', name: 'Together', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', dialect: 'openai', keyRequired: true, keyHint: 'api.together.ai → API keys' },
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1', dialect: 'openai', keyRequired: false, keyHint: 'runs on your machine — no key needed' },
  { id: 'custom', name: 'OpenAI-compatible (custom)', baseUrl: '', defaultModel: '', dialect: 'openai', keyRequired: true, custom: true, keyHint: 'your gateway or self-host base URL — Azure, vLLM, LiteLLM…' },
]

export const DEFAULT_PROVIDER = SETUP_PROVIDERS[0]

export function providerById(id: string): SetupProvider | undefined {
  return SETUP_PROVIDERS.find((p) => p.id === id)
}

/** Overrides the user can supply for custom / self-host targets. */
export interface ProviderOverrides {
  baseUrl?: string
  model?: string
}

function resolveBase(p: SetupProvider, over?: ProviderOverrides): string {
  return (over?.baseUrl?.trim() || p.baseUrl).replace(/\/+$/, '')
}

function resolveModel(p: SetupProvider, over?: ProviderOverrides): string {
  return over?.model?.trim() || p.defaultModel
}

function anthropicHeaders(key: string): Record<string, string> {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Anthropic blocks browser calls unless this opt-in is present. It fits this
    // branch's model exactly: the user's own key, held in their own browser.
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  }
}

/** Trim a provider error body to something a person can read. */
async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  try {
    const j = JSON.parse(body)
    const msg = j?.error?.message ?? j?.error ?? j?.message
    if (typeof msg === 'string' && msg) return msg.slice(0, 200)
  } catch {
    /* not JSON — fall through to the raw body */
  }
  return body.slice(0, 200) || `HTTP ${res.status} ${res.statusText}`
}

export interface ProviderTestResult {
  ok: boolean
  /** Model ids the key can see — used to confirm the default model is available. */
  models?: string[]
  error?: string
}

/**
 * Validate a key by listing the provider's models. A successful GET means the
 * key authenticates; it costs no tokens. Network/CORS failures (e.g. a stopped
 * Ollama) surface as a friendly message rather than an unhandled throw.
 */
export async function testProvider(
  p: SetupProvider,
  key: string,
  over?: ProviderOverrides,
): Promise<ProviderTestResult> {
  const base = resolveBase(p, over)
  if (p.custom && !base) return { ok: false, error: 'Enter your base URL first.' }
  if (p.keyRequired && !key.trim()) return { ok: false, error: 'Enter your API key first.' }

  try {
    const res =
      p.dialect === 'anthropic'
        ? await fetch(`${base}/v1/models`, { headers: anthropicHeaders(key) })
        : await fetch(`${base}/models`, { headers: key.trim() ? { Authorization: `Bearer ${key}` } : {} })

    if (!res.ok) return { ok: false, error: await readError(res) }
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const models = (data.data ?? []).map((m) => m.id).filter((m): m is string => Boolean(m))
    return { ok: true, models }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `Couldn't reach ${base || 'the provider'} — ${detail}. Check the URL, your network, or CORS.`,
    }
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Run one real chat turn against the provider and return the assistant reply. */
export async function providerChat(
  p: SetupProvider,
  key: string,
  system: string,
  history: ChatTurn[],
  over?: ProviderOverrides,
): Promise<string> {
  const base = resolveBase(p, over)
  const model = resolveModel(p, over)

  if (p.dialect === 'anthropic') {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: anthropicHeaders(key),
      body: JSON.stringify({ model, max_tokens: 1024, system, messages: history }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const data = (await res.json()) as { content?: Array<{ text?: string }> }
    return data.content?.map((c) => c.text ?? '').join('') ?? ''
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key.trim() ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...history],
      temperature: 0.4,
    }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

const TONE_GUIDANCE: Record<Tone, string> = {
  friendly: 'Warm and approachable. Use plain language and a welcoming tone.',
  professional: 'Polished and businesslike. Precise, courteous, no slang.',
  concise: 'Brief and direct. Answer in as few words as the question allows.',
  playful: 'Light and upbeat. A little personality and the occasional emoji is fine.',
}

/** System prompt for the preview chat, assembled from the wizard config. */
export function buildSystemPrompt(config: ChatbotConfig): string {
  const name = config.name?.trim() || 'the assistant'
  const tone = config.tone ?? 'friendly'
  const lines = [
    `You are ${name}, an AI assistant embedded on a company's website to help its visitors.`,
    `Tone: ${TONE_GUIDANCE[tone]}`,
    'Answer questions helpfully. If you do not know something, say so plainly rather than inventing an answer.',
  ]
  if (config.greeting?.trim()) lines.push(`Your opening greeting is: "${config.greeting.trim()}".`)
  if (config.knowledgeSkipped) {
    lines.push('You have no custom knowledge base yet, so answer from general knowledge and be upfront about that limit.')
  }
  return lines.join('\n')
}
