import { describe, expect, it } from 'vitest'
import { newStaffMember, staffMemberFromRow, staffMemberToRow } from './staff'

describe('staff routing records', () => {
  it('normalizes database preference and channel fields', () => {
    expect(staffMemberFromRow({
      id: 'staff-1',
      owner_id: 'owner-1',
      name: 'Alex',
      email: 'alex@example.com',
      role: 'admin',
      status: 'active',
      available: false,
      accept_texts: true,
      accept_calls: true,
      notify_dashboard: true,
      notify_telegram: true,
      notify_whatsapp: false,
      telegram_chat_id: '12345',
    })).toMatchObject({
      id: 'staff-1',
      ownerId: 'owner-1',
      role: 'admin',
      available: false,
      acceptTexts: true,
      acceptCalls: true,
      notifyTelegram: true,
      telegramChatId: '12345',
    })
  })

  it('serializes customer-entered channel targets without client secrets', () => {
    const member = {
      ...newStaffMember('owner-1', ' Priya ', ' PRIYA@EXAMPLE.COM '),
      notifyTelegram: true,
      telegramChatId: ' 9988 ',
      notifyWhatsapp: true,
      whatsappPhone: ' +49 123 ',
    }
    const row = staffMemberToRow('owner-1', member)
    expect(row).toMatchObject({
      owner_id: 'owner-1',
      name: 'Priya',
      email: 'priya@example.com',
      telegram_chat_id: '9988',
      whatsapp_phone: '+49 123',
    })
    expect(row).not.toHaveProperty('telegram_token')
    expect(row).not.toHaveProperty('whatsapp_access_token')
  })
})
