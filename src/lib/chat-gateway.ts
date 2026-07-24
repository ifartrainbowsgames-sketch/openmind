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

export interface ChatGatewayOptions {
  widgetKey?: string
  conversationId?: string
  visitorToken?: string
  visitor?: string
  page?: string
  siteOrigin?: string
  staffAfter?: string
}

export interface ChatGatewayReply {
  text: string
  conversationId?: string
  visitorToken?: string
  employee?: string | null
  routedTo?: string | null
  offline?: boolean
  staffMessages?: { id: string; text: string; createdAt: string }[]
  widgetConfig?: PublishedWidgetConfig
}

export interface PublishedWidgetConfig {
  enabled: boolean
  greeting: string
  agentName: string
  employeeName?: string | null
  appearance: Record<string, unknown>
  features: Record<string, unknown>
}

async function gatewayRequest(
  messages: GatewayMessage[],
  options: ChatGatewayOptions = {},
  event: 'message' | 'call_request' | 'poll' | 'config' = 'message',
): Promise<ChatGatewayReply> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!baseUrl) throw new ChatGatewayError('The chat gateway is not configured.')
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/functions/v1/openmind-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.widgetKey ? { 'X-OpenMind-Widget-Key': options.widgetKey } : {}),
    },
    body: JSON.stringify({
      messages: messages.slice(-8),
      event,
      ...options,
    }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new ChatGatewayError(body.error ?? `Chat gateway returned ${response.status}.`)
  }
  const data = await response.json() as Record<string, unknown>
  const text = typeof data.text === 'string' ? data.text.trim() : ''
  if (!text && event !== 'poll') throw new ChatGatewayError('The chat gateway returned an empty response.')
  const staffMessages = Array.isArray(data.staffMessages)
    ? data.staffMessages.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const row = value as Record<string, unknown>
        return typeof row.id === 'string' && typeof row.text === 'string'
          ? [{ id: row.id, text: row.text, createdAt: typeof row.created_at === 'string' ? row.created_at : '' }]
          : []
      })
    : undefined
  const widgetConfig = data.widgetConfig && typeof data.widgetConfig === 'object'
    ? data.widgetConfig as PublishedWidgetConfig
    : undefined
  return {
    text,
    ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
    ...(typeof data.visitorToken === 'string' ? { visitorToken: data.visitorToken } : {}),
    ...(typeof data.employee === 'string' || data.employee === null ? { employee: data.employee as string | null } : {}),
    ...(typeof data.routedTo === 'string' || data.routedTo === null ? { routedTo: data.routedTo as string | null } : {}),
    ...(typeof data.offline === 'boolean' ? { offline: data.offline } : {}),
    ...(staffMessages ? { staffMessages } : {}),
    ...(widgetConfig ? { widgetConfig } : {}),
  }
}

export async function requestChat(
  messages: GatewayMessage[],
  options: ChatGatewayOptions = {},
): Promise<string> {
  return (await gatewayRequest(messages, options)).text
}

export async function requestChatSession(
  messages: GatewayMessage[],
  options: ChatGatewayOptions,
): Promise<ChatGatewayReply> {
  return gatewayRequest(messages, options)
}

export async function requestStaffCallback(options: ChatGatewayOptions): Promise<ChatGatewayReply> {
  return gatewayRequest([], options, 'call_request')
}

export async function pollStaffReplies(options: ChatGatewayOptions): Promise<ChatGatewayReply> {
  return gatewayRequest([], options, 'poll')
}

export async function requestPublishedWidgetConfig(options: ChatGatewayOptions): Promise<ChatGatewayReply> {
  return gatewayRequest([], options, 'config')
}
