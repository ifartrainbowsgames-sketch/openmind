interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatbotConfigRow {
  user_id: string
  public_key: string
  enabled: boolean
  system_prompt: string
  greeting: string
  agent_name: string
  offline_message: string
  selected_employee_id?: string | null
  selected_employee_name?: string | null
  selected_employee_prompt?: string | null
  allowed_origins?: string[]
  appearance?: Record<string, unknown>
  features?: Record<string, unknown>
}

interface ConversationRow {
  id: string
  user_id: string
  visitor: string
  visitor_token?: string | null
  assigned_staff_id?: string | null
  status?: 'ai' | 'human' | 'resolved'
}

interface StaffRow {
  id: string
  name: string
  notify_dashboard: boolean
  notify_telegram: boolean
  notify_whatsapp: boolean
  telegram_chat_id?: string | null
  whatsapp_phone?: string | null
}

const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 20
const requests = new Map<string, { count: number; resetAt: number }>()

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get('ALLOWED_ORIGINS') ??
    'http://localhost:3000,http://127.0.0.1:3000'
  return new Set(configured.split(',').map((origin) => origin.trim()).filter(Boolean))
}

function cors(req: Request, allowWidgetOrigin = false): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-openmind-widget-key',
    Vary: 'Origin',
  }
  if (origin && allowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  void allowWidgetOrigin
  return headers
}

function json(req: Request, status: number, body: unknown, allowWidgetOrigin = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req, allowWidgetOrigin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function rateLimited(req: Request, widgetKey?: string): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  const key = `${widgetKey ?? 'marketing'}:${ip}`
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

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

async function database<T>(
  table: string,
  query = '',
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!baseUrl || !serviceKey) throw new Error('database service credentials are unavailable')
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method: init.method ?? 'GET',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) {
    throw new Error(`database ${init.method ?? 'GET'} ${table} failed (${response.status})`)
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

const query = (values: Record<string, string>) => new URLSearchParams(values).toString()

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function consumeDistributedLimit(
  req: Request,
  ownerId: string,
  event: 'message' | 'call_request' | 'poll' | 'config',
  conversationId?: string,
): Promise<boolean> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  const fingerprint = await sha256(ip)
  const scope = event === 'poll' ? `poll:${conversationId ?? 'unknown'}` : event
  const limits = event === 'poll'
    ? [
        { bucket: `tenant:${ownerId}:poll`, request_limit: 1_200 },
        { bucket: `conversation:${ownerId}:${scope}`, request_limit: 20 },
      ]
    : [
        { bucket: `tenant:${ownerId}:${scope}`, request_limit: 120 },
        { bucket: `visitor:${ownerId}:${fingerprint}:${scope}`, request_limit: 20 },
      ]
  for (const limit of limits) {
    const allowed = await database<boolean>('rpc/consume_chatbot_rate_limit', '', {
      method: 'POST',
      body: limit,
    })
    if (!allowed) return false
  }
  return true
}

async function widgetConfig(widgetKey: string): Promise<ChatbotConfigRow | null> {
  const rows = await database<ChatbotConfigRow[]>(
    'chatbot_configs',
    query({ public_key: `eq.${widgetKey}`, select: '*' }),
  )
  return rows[0] ?? null
}

function siteOriginAllowed(siteOrigin: unknown, config: ChatbotConfigRow): boolean {
  if (typeof siteOrigin !== 'string') return !(config.allowed_origins ?? []).length
  let origin: string
  try {
    origin = new URL(siteOrigin).origin
  } catch {
    return false
  }
  const configured = config.allowed_origins ?? []
  return configured.length ? configured.includes(origin) : allowedOrigins().has(origin)
}

async function createConversation(
  config: ChatbotConfigRow,
  visitor: string,
  page: string,
): Promise<ConversationRow> {
  const visitorToken = crypto.randomUUID()
  const rows = await database<ConversationRow[]>(
    'conversations',
    '',
    {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: config.user_id,
        visitor,
        page,
        channel: 'widget',
        employee_id: config.selected_employee_id ?? null,
        visitor_token: visitorToken,
      },
    },
  )
  return rows[0]
}

async function loadConversation(
  config: ChatbotConfigRow,
  conversationId: string,
  visitorToken: string,
): Promise<ConversationRow | null> {
  const rows = await database<ConversationRow[]>(
    'conversations',
    query({
      id: `eq.${conversationId}`,
      user_id: `eq.${config.user_id}`,
      visitor_token: `eq.${visitorToken}`,
      select: '*',
    }),
  )
  return rows[0] ?? null
}

async function insertMessage(
  conversation: ConversationRow,
  sender: 'visitor' | 'ai',
  text: string,
): Promise<void> {
  await database(
    'messages',
    '',
    {
      method: 'POST',
      body: {
        conversation_id: conversation.id,
        user_id: conversation.user_id,
        sender,
        text,
      },
    },
  )
  await database(
    'conversations',
    query({ id: `eq.${conversation.id}` }),
    { method: 'PATCH', body: { updated_at: new Date().toISOString(), unread: true } },
  )
}

async function staffReplies(
  conversationId: string,
  after?: string,
): Promise<{ id: string; text: string; created_at: string }[]> {
  const filters: Record<string, string> = {
    conversation_id: `eq.${conversationId}`,
    sender: 'eq.user',
    select: 'id,text,created_at',
    order: 'created_at.asc',
    limit: '50',
  }
  if (after) filters.created_at = `gt.${after}`
  return database<{ id: string; text: string; created_at: string }[]>(
    'messages',
    query(filters),
  )
}

async function knowledgeContext(ownerId: string): Promise<string> {
  const rows = await database<{ name?: string; content?: string }[]>(
    'sources',
    query({
      user_id: `eq.${ownerId}`,
      attached: 'cs.{chat}',
      content: 'not.is.null',
      select: 'name,content',
      limit: '5',
    }),
  )
  const context = rows
    .map((source) => `SOURCE: ${source.name ?? 'Untitled'}\n${(source.content ?? '').slice(0, 3_000)}`)
    .join('\n\n')
  return context.slice(0, 10_000)
}

async function sendTelegram(chatId: string, title: string, body: string): Promise<number> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) throw new Error('Telegram bot is not configured')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `${title}\n\n${body}\n\nReply to this bot to answer the assigned customer conversation.`.slice(0, 4_000),
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Telegram delivery failed (${response.status})`)
  const data = await response.json() as { result?: { message_id?: number } }
  const messageId = data.result?.message_id
  if (typeof messageId !== 'number') throw new Error('Telegram did not return a message id')
  return messageId
}

async function sendWhatsApp(phone: string, title: string, body: string): Promise<void> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const templateName = Deno.env.get('WHATSAPP_NOTIFICATION_TEMPLATE')
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v23.0'
  if (!accessToken || !phoneNumberId || !templateName) {
    throw new Error('WhatsApp Cloud API template delivery is not configured')
  }
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/[^\d]/g, ''),
      type: 'template',
      template: {
        name: templateName,
        language: { code: Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en_US' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: title.slice(0, 200) },
            { type: 'text', text: body.slice(0, 900) },
          ],
        }],
      },
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`WhatsApp delivery failed (${response.status})`)
}

async function routeStaff(
  conversation: ConversationRow,
  kind: 'message' | 'call_request',
  body: string,
): Promise<StaffRow | null> {
  const eligibility = kind === 'call_request' ? 'accept_calls' : 'accept_texts'
  const filters: Record<string, string> = {
    owner_id: `eq.${conversation.user_id}`,
    status: 'eq.active',
    available: 'eq.true',
    [eligibility]: 'eq.true',
    select: '*',
    limit: '1',
  }
  if (conversation.assigned_staff_id) filters.id = `eq.${conversation.assigned_staff_id}`
  else filters.order = 'last_assigned_at.asc.nullsfirst'
  let rows = await database<StaffRow[]>('staff_members', query(filters))
  if (!rows.length && conversation.assigned_staff_id) {
    delete filters.id
    filters.order = 'last_assigned_at.asc.nullsfirst'
    rows = await database<StaffRow[]>('staff_members', query(filters))
  }
  const staff = rows[0]
  if (!staff) {
    await database('notifications', '', {
      method: 'POST',
      body: {
        owner_id: conversation.user_id,
        staff_id: null,
        conversation_id: conversation.id,
        event_kind: kind,
        title: kind === 'call_request'
          ? `Unassigned callback request from ${conversation.visitor}`
          : `Unassigned customer message from ${conversation.visitor}`,
        body: body.slice(0, 2_000),
        dashboard_enabled: true,
      },
    })
    return null
  }
  const now = new Date().toISOString()
  await database('staff_members', query({ id: `eq.${staff.id}` }), {
    method: 'PATCH',
    body: { last_assigned_at: now },
  })
  await database('conversations', query({ id: `eq.${conversation.id}` }), {
    method: 'PATCH',
    body: { assigned_staff_id: staff.id, updated_at: now },
  })

  const title = kind === 'call_request'
    ? `Callback request from ${conversation.visitor}`
    : `New customer message for ${staff.name}`
  const telegramRequested = staff.notify_telegram && Boolean(staff.telegram_chat_id)
  const whatsappRequested = staff.notify_whatsapp && Boolean(staff.whatsapp_phone)
  const notificationRows = await database<{ id: string }[]>(
    'notifications',
    '',
    {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        owner_id: conversation.user_id,
        staff_id: staff.id,
        conversation_id: conversation.id,
        event_kind: kind,
        title,
        body: body.slice(0, 2_000),
        dashboard_enabled: staff.notify_dashboard,
        telegram_status: telegramRequested ? 'pending' : 'not_requested',
        whatsapp_status: whatsappRequested ? 'pending' : 'not_requested',
      },
    },
  )
  const notificationId = notificationRows[0]?.id
  const status: Record<string, string | null> = {}
  const errors: string[] = []
  if (telegramRequested && staff.telegram_chat_id) {
    try {
      const messageId = await sendTelegram(staff.telegram_chat_id, title, body)
      if (notificationId) {
        await database('telegram_delivery_threads', '', {
          method: 'POST',
          body: {
            notification_id: notificationId,
            staff_id: staff.id,
            conversation_id: conversation.id,
            telegram_chat_id: staff.telegram_chat_id,
            telegram_message_id: messageId,
          },
        })
      }
      status.telegram_status = 'sent'
    } catch (error) {
      status.telegram_status = Deno.env.get('TELEGRAM_BOT_TOKEN') ? 'failed' : 'not_configured'
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (whatsappRequested && staff.whatsapp_phone) {
    try {
      await sendWhatsApp(staff.whatsapp_phone, title, body)
      status.whatsapp_status = 'sent'
    } catch (error) {
      status.whatsapp_status = Deno.env.get('WHATSAPP_ACCESS_TOKEN') ? 'failed' : 'not_configured'
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (notificationId && (Object.keys(status).length || errors.length)) {
    await database('notifications', query({ id: `eq.${notificationId}` }), {
      method: 'PATCH',
      body: { ...status, delivery_error: errors.join(' · ') || null },
    })
  }
  return staff
}

Deno.serve(async (req: Request): Promise<Response> => {
  const headerWidgetKey = req.headers.get('x-openmind-widget-key')?.trim()
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(req, Boolean(headerWidgetKey)) })
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' })

  let body: {
    messages?: unknown
    widgetKey?: unknown
    conversationId?: unknown
    visitorToken?: unknown
    visitor?: unknown
    page?: unknown
    siteOrigin?: unknown
    staffAfter?: unknown
    event?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json(req, 400, { error: 'body must be valid JSON' })
  }

  const widgetKey = headerWidgetKey ??
    (typeof body.widgetKey === 'string' ? body.widgetKey.trim() : undefined)
  const event = body.event === 'call_request'
    ? 'call_request'
    : body.event === 'poll'
    ? 'poll'
    : body.event === 'config'
    ? 'config'
    : 'message'
  const rateBucket = event === 'poll'
    ? `poll:${typeof body.conversationId === 'string' ? body.conversationId : 'unknown'}:${widgetKey ?? 'unknown'}`
    : widgetKey
  if (rateLimited(req, rateBucket)) {
    return json(req, 429, { error: 'rate limit exceeded; retry in one minute' }, Boolean(widgetKey))
  }

  const messages = parseMessages(body.messages)
  if (!messages && event === 'message') {
    return json(req, 400, { error: 'messages must contain 1–8 valid user/assistant messages' }, Boolean(widgetKey))
  }

  let config: ChatbotConfigRow | null = null
  if (widgetKey) {
    try {
      config = await widgetConfig(widgetKey)
    } catch {
      return json(req, 503, { error: 'chatbot configuration is unavailable' }, true)
    }
    if (!config) return json(req, 404, { error: 'unknown widget key' }, true)
    const requestOrigin = req.headers.get('origin')
    if (requestOrigin && !allowedOrigins().has(requestOrigin)) {
      return json(req, 403, { error: 'widget app origin not allowed' })
    }
    if (!siteOriginAllowed(body.siteOrigin, config)) {
      return json(req, 403, { error: 'embedding site origin not allowed' }, true)
    }
    try {
      const distributedAllowed = await consumeDistributedLimit(
        req,
        config.user_id,
        event,
        typeof body.conversationId === 'string' ? body.conversationId : undefined,
      )
      if (!distributedAllowed) {
        return json(req, 429, { error: 'workspace rate limit exceeded; retry in one minute' }, true)
      }
    } catch {
      return json(req, 503, { error: 'rate limit service unavailable' }, true)
    }
  } else {
    const origin = req.headers.get('origin')
    if (!origin || !allowedOrigins().has(origin)) return json(req, 403, { error: 'origin not allowed' })
    try {
      const distributedAllowed = await consumeDistributedLimit(req, 'marketing', event)
      if (!distributedAllowed) {
        return json(req, 429, { error: 'marketing chat rate limit exceeded; retry in one minute' })
      }
    } catch {
      return json(req, 503, { error: 'rate limit service unavailable' })
    }
  }

  if (event === 'config') {
    if (!config) return json(req, 400, { error: 'widget key required for configuration' })
    return json(req, 200, {
      text: 'configuration',
      widgetConfig: {
        enabled: config.enabled,
        greeting: config.greeting,
        agentName: config.agent_name,
        employeeName: config.selected_employee_name ?? null,
        appearance: config.appearance ?? {},
        features: config.features ?? {},
      },
    }, true)
  }

  let conversation: ConversationRow | null = null
  if (config) {
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
    const visitorToken = typeof body.visitorToken === 'string' ? body.visitorToken : ''
    if (event === 'poll' && (!conversationId || !visitorToken)) {
      return json(req, 400, { error: 'poll requires conversation credentials' }, true)
    }
    try {
      conversation = conversationId && visitorToken
        ? await loadConversation(config, conversationId, visitorToken)
        : await createConversation(
            config,
            typeof body.visitor === 'string' ? body.visitor.slice(0, 120) : 'Website visitor',
            typeof body.page === 'string' ? body.page.slice(0, 500) : '',
          )
      if (!conversation) return json(req, 403, { error: 'conversation could not be resumed' }, true)
      if (event === 'poll') {
        return json(req, 200, {
          text: '',
          conversationId: conversation.id,
          visitorToken: conversation.visitor_token,
          staffMessages: await staffReplies(
            conversation.id,
            typeof body.staffAfter === 'string' ? body.staffAfter : undefined,
          ),
        }, true)
      }
      const visitorText = event === 'call_request'
        ? 'Visitor requested a callback.'
        : messages![messages!.length - 1].content
      await insertMessage(conversation, 'visitor', visitorText)
      const staff = await routeStaff(conversation, event, visitorText).catch((error) => {
        console.error('staff routing failed', error instanceof Error ? error.message : String(error))
        return null
      })
      if (event === 'call_request') {
        return json(req, 200, {
          text: staff
            ? `${staff.name} was notified about your callback request.`
            : 'No staff member is available for calls right now. Your request was saved.',
          conversationId: conversation.id,
          visitorToken: conversation.visitor_token,
          routedTo: staff?.name ?? null,
          event,
        }, true)
      }
      if (conversation.status === 'human') {
        return json(req, 200, {
          text: 'Thanks — your message is with the support team.',
          conversationId: conversation.id,
          visitorToken: conversation.visitor_token,
          human: true,
        }, true)
      }
      if (!config.enabled) {
        await insertMessage(conversation, 'ai', config.offline_message)
        return json(req, 200, {
          text: config.offline_message,
          conversationId: conversation.id,
          visitorToken: conversation.visitor_token,
          offline: true,
        }, true)
      }
    } catch (error) {
      console.error('conversation persistence failed', error instanceof Error ? error.message : String(error))
      return json(req, 503, { error: 'conversation could not be saved' }, true)
    }
  }

  const apiKey = Deno.env.get('OPENMIND_CHAT_API_KEY')
  if (!apiKey) return json(req, 503, { error: 'chat gateway is not configured' }, Boolean(widgetKey))
  const baseUrl = (Deno.env.get('OPENMIND_CHAT_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = Deno.env.get('OPENMIND_CHAT_MODEL') ?? 'gpt-4o-mini'
  let system = config?.selected_employee_prompt || config?.system_prompt ||
    Deno.env.get('OPENMIND_CHAT_SYSTEM_PROMPT') ||
    'You are the OpenMind product assistant. Be concise and factual. Never claim a feature is live when it is a preview.'
  if (config) {
    const context = await knowledgeContext(config.user_id).catch(() => '')
    if (context) {
      system += `\n\nUse the following workspace sources when relevant. If they do not contain the answer, say so.\n\n${context}`
    }
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...(messages ?? [])],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      console.error('chat provider failed', response.status, (await response.text()).slice(0, 300))
      return json(req, 502, { error: 'chat provider request failed' }, Boolean(config))
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return json(req, 502, { error: 'chat provider returned an empty response' }, Boolean(config))
    if (conversation) await insertMessage(conversation, 'ai', text)
    return json(req, 200, {
      text,
      ...(conversation ? {
        conversationId: conversation.id,
        visitorToken: conversation.visitor_token,
        employee: config?.selected_employee_name ?? null,
      } : {}),
    }, Boolean(config))
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    return json(
      req,
      timeout ? 504 : 502,
      { error: timeout ? 'chat provider timed out' : 'chat provider unavailable' },
      Boolean(config),
    )
  }
})
