interface TelegramUpdate {
  message?: {
    text?: string
    chat?: { id?: number | string }
    from?: { first_name?: string }
    reply_to_message?: { message_id?: number }
  }
}

function serviceHeaders(): Record<string, string> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

async function staffForCode(code: string): Promise<{ id: string; name: string } | null> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  if (!baseUrl) return null
  const params = new URLSearchParams({
    telegram_link_code: `eq.${code}`,
    select: 'id,name',
    limit: '1',
  })
  const response = await fetch(`${baseUrl}/rest/v1/staff_members?${params}`, { headers: serviceHeaders() })
  if (!response.ok) return null
  const rows = await response.json() as { id: string; name: string }[]
  return rows[0] ?? null
}

async function staffForChat(chatId: string): Promise<{
  id: string
  owner_id: string
  member_user_id?: string | null
  name: string
} | null> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  if (!baseUrl) return null
  const params = new URLSearchParams({
    telegram_chat_id: `eq.${chatId}`,
    status: 'eq.active',
    select: 'id,owner_id,member_user_id,name',
    limit: '1',
  })
  const response = await fetch(`${baseUrl}/rest/v1/staff_members?${params}`, { headers: serviceHeaders() })
  if (!response.ok) return null
  const rows = await response.json() as {
    id: string
    owner_id: string
    member_user_id?: string | null
    name: string
  }[]
  return rows[0] ?? null
}

async function sendStaffReply(
  staff: { id: string; owner_id: string; member_user_id?: string | null },
  conversationId: string,
  text: string,
): Promise<boolean> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  if (!baseUrl) return false
  const conversationParams = new URLSearchParams({
    id: `eq.${conversationId}`,
    assigned_staff_id: `eq.${staff.id}`,
    status: 'neq.resolved',
    select: 'id',
    limit: '1',
  })
  const conversationResponse = await fetch(`${baseUrl}/rest/v1/conversations?${conversationParams}`, {
    headers: serviceHeaders(),
  })
  if (!conversationResponse.ok) return false
  const conversations = await conversationResponse.json() as { id: string }[]
  const conversation = conversations[0]
  if (!conversation) return false

  const messageResponse = await fetch(`${baseUrl}/rest/v1/messages`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      conversation_id: conversation.id,
      user_id: staff.owner_id,
      staff_user_id: staff.member_user_id ?? null,
      sender: 'user',
      text: text.slice(0, 20_000),
    }),
  })
  if (!messageResponse.ok) return false
  const updateParams = new URLSearchParams({ id: `eq.${conversation.id}` })
  await fetch(`${baseUrl}/rest/v1/conversations?${updateParams}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({ status: 'human', unread: false, updated_at: new Date().toISOString() }),
  })
  return true
}

async function conversationForTelegramReply(chatId: string, messageId: number): Promise<string | null> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  if (!baseUrl) return null
  const params = new URLSearchParams({
    telegram_chat_id: `eq.${chatId}`,
    telegram_message_id: `eq.${messageId}`,
    select: 'conversation_id',
    limit: '1',
  })
  const response = await fetch(`${baseUrl}/rest/v1/telegram_delivery_threads?${params}`, {
    headers: serviceHeaders(),
  })
  if (!response.ok) return null
  const rows = await response.json() as { conversation_id: string }[]
  return rows[0]?.conversation_id ?? null
}

async function linkStaff(id: string, chatId: string): Promise<boolean> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  if (!baseUrl) return false
  const params = new URLSearchParams({ id: `eq.${id}` })
  const response = await fetch(`${baseUrl}/rest/v1/staff_members?${params}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({
      telegram_chat_id: chatId,
      telegram_link_code: `staff_${crypto.randomUUID().replace(/-/g, '')}`,
      notify_telegram: true,
    }),
  })
  return response.ok
}

async function reply(chatId: string, text: string): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  const actual = req.headers.get('x-telegram-bot-api-secret-token')
  if (!expected || actual !== expected) return new Response('unauthorized', { status: 401 })

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('invalid JSON', { status: 400 })
  }
  const chatId = update.message?.chat?.id
  const text = update.message?.text?.trim() ?? ''
  if (chatId === undefined) return new Response('ok')

  const code = text.match(/^\/start\s+([A-Za-z0-9_-]{8,100})$/)?.[1]
  if (!code) {
    const staff = await staffForChat(String(chatId))
    if (!staff) {
      await reply(String(chatId), 'Open your OpenMind Staff settings and use the Telegram connect link shown for your profile.')
      return new Response('ok')
    }
    if (!text || text.startsWith('/')) {
      await reply(String(chatId), 'Reply directly to an OpenMind customer alert to answer that conversation.')
      return new Response('ok')
    }
    const repliedTo = update.message?.reply_to_message?.message_id
    const conversationId = typeof repliedTo === 'number'
      ? await conversationForTelegramReply(String(chatId), repliedTo)
      : null
    if (!conversationId) {
      await reply(String(chatId), 'Reply directly to the specific OpenMind alert you want to answer.')
      return new Response('ok')
    }
    const sent = await sendStaffReply(staff, conversationId, text)
    await reply(
      String(chatId),
      sent ? 'Reply delivered to the customer.' : 'There is no active customer conversation assigned to you.',
    )
    return new Response('ok')
  }
  const staff = await staffForCode(code)
  if (!staff || !await linkStaff(staff.id, String(chatId))) {
    await reply(String(chatId), 'That OpenMind connection link is invalid or expired.')
    return new Response('ok')
  }
  await reply(String(chatId), `Connected. ${staff.name} will now receive OpenMind customer alerts in this chat.`)
  return new Response('ok')
})
