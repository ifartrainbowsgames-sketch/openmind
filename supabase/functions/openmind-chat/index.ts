interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 20
const requests = new Map<string, { count: number; resetAt: number }>()

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get('ALLOWED_ORIGINS') ??
    'http://localhost:3000,http://127.0.0.1:3000'
  return new Set(configured.split(',').map((origin) => origin.trim()).filter(Boolean))
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    Vary: 'Origin',
  }
  if (origin && allowedOrigins().has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function rateLimited(req: Request): boolean {
  const key = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  const now = Date.now()
  const current = requests.get(key)
  if (!current || current.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  current.count++
  return current.count > MAX_REQUESTS_PER_WINDOW
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null
  const messages: ChatMessage[] = []
  let total = 0
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const { role, content } = item as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const clean = content.trim()
    if (!clean || clean.length > 2_000) return null
    total += clean.length
    messages.push({ role, content: clean })
  }
  return total <= 6_000 ? messages : null
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  if (origin && !allowedOrigins().has(origin)) return json(req, 403, { error: 'origin not allowed' })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' })
  if (rateLimited(req)) return json(req, 429, { error: 'rate limit exceeded; retry in one minute' })

  const apiKey = Deno.env.get('OPENMIND_CHAT_API_KEY')
  if (!apiKey) return json(req, 503, { error: 'chat gateway is not configured' })

  let body: { messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(req, 400, { error: 'body must be valid JSON' })
  }
  const messages = parseMessages(body.messages)
  if (!messages) return json(req, 400, { error: 'messages must contain 1–8 valid user/assistant messages' })

  const baseUrl = (Deno.env.get('OPENMIND_CHAT_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = Deno.env.get('OPENMIND_CHAT_MODEL') ?? 'gpt-4o-mini'
  const system = Deno.env.get('OPENMIND_CHAT_SYSTEM_PROMPT') ??
    'You are the OpenMind product assistant. Be concise and factual. Never claim a feature is live when it is a preview.'

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      console.error('chat provider failed', response.status, (await response.text()).slice(0, 300))
      return json(req, 502, { error: 'chat provider request failed' })
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return json(req, 502, { error: 'chat provider returned an empty response' })
    return json(req, 200, { text })
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    return json(req, timeout ? 504 : 502, { error: timeout ? 'chat provider timed out' : 'chat provider unavailable' })
  }
})
