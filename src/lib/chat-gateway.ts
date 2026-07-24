export interface GatewayMessage {
  role: 'user' | 'assistant'
  content: string
}

export class ChatGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatGatewayError'
  }
}

export async function requestChat(messages: GatewayMessage[]): Promise<string> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!baseUrl) throw new ChatGatewayError('The chat gateway is not configured.')
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/functions/v1/openmind-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.slice(-8) }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new ChatGatewayError(body.error ?? `Chat gateway returned ${response.status}.`)
  }
  const data = await response.json() as { text?: unknown }
  const text = typeof data.text === 'string' ? data.text.trim() : ''
  if (!text) throw new ChatGatewayError('The chat gateway returned an empty response.')
  return text
}
