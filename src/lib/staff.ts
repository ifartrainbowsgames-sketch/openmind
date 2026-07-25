export type StaffRole = 'owner' | 'admin' | 'agent'
export type StaffStatus = 'invited' | 'active' | 'disabled'

export interface StaffMember {
  id: string
  ownerId: string
  memberUserId?: string
  name: string
  email: string
  role: StaffRole
  status: StaffStatus
  available: boolean
  acceptTexts: boolean
  acceptCalls: boolean
  notifyDashboard: boolean
  notifyTelegram: boolean
  notifyWhatsapp: boolean
  telegramChatId: string
  telegramLinkCode: string
  whatsappPhone: string
}

export function staffMemberFromRow(value: Record<string, unknown>): StaffMember {
  return {
    id: String(value.id ?? ''),
    ownerId: String(value.owner_id ?? ''),
    ...(typeof value.member_user_id === 'string' ? { memberUserId: value.member_user_id } : {}),
    name: typeof value.name === 'string' ? value.name : 'Team member',
    email: typeof value.email === 'string' ? value.email : '',
    role: value.role === 'owner' || value.role === 'admin' ? value.role : 'agent',
    status: value.status === 'invited' || value.status === 'disabled' ? value.status : 'active',
    available: value.available !== false,
    acceptTexts: value.accept_texts !== false,
    acceptCalls: value.accept_calls === true,
    notifyDashboard: value.notify_dashboard !== false,
    notifyTelegram: value.notify_telegram === true,
    notifyWhatsapp: value.notify_whatsapp === true,
    telegramChatId: typeof value.telegram_chat_id === 'string' ? value.telegram_chat_id : '',
    telegramLinkCode: typeof value.telegram_link_code === 'string' ? value.telegram_link_code : '',
    whatsappPhone: typeof value.whatsapp_phone === 'string' ? value.whatsapp_phone : '',
  }
}

export function staffMemberToRow(ownerId: string, member: Omit<StaffMember, 'ownerId'> | StaffMember) {
  return {
    owner_id: ownerId,
    name: member.name.trim(),
    email: member.email.trim().toLowerCase(),
    role: member.role,
    status: member.status,
    available: member.available,
    accept_texts: member.acceptTexts,
    accept_calls: member.acceptCalls,
    notify_dashboard: member.notifyDashboard,
    notify_telegram: member.notifyTelegram,
    notify_whatsapp: member.notifyWhatsapp,
    telegram_chat_id: member.telegramChatId.trim() || null,
    whatsapp_phone: member.whatsappPhone.trim() || null,
  }
}

export function newStaffMember(ownerId: string, name: string, email: string): StaffMember {
  return {
    id: `staff-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
    ownerId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role: 'agent',
    status: 'active',
    available: true,
    acceptTexts: true,
    acceptCalls: false,
    notifyDashboard: true,
    notifyTelegram: false,
    notifyWhatsapp: false,
    telegramChatId: '',
    telegramLinkCode: `staff_${globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? Date.now().toString(36)}`,
    whatsappPhone: '',
  }
}
