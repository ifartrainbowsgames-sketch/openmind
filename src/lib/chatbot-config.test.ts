import { describe, expect, it } from 'vitest'
import {
  chatbotConfigFromRow,
  chatbotConfigToRow,
  DEFAULT_CHATBOT_CONFIG,
  withWidgetConfig,
} from './chatbot-config'

describe('chatbot configuration', () => {
  it('maps persisted employee, availability, appearance, and features', () => {
    const config = chatbotConfigFromRow({
      public_key: 'om_pk_test',
      enabled: false,
      system_prompt: 'Default behavior',
      greeting: 'Hello',
      offline_message: 'Back tomorrow',
      agent_name: 'Mara',
      selected_employee_id: 'mara',
      selected_employee_name: 'Mara',
      selected_employee_prompt: 'You are Mara.',
      allowed_origins: ['https://example.com'],
      appearance: { accent: '#123456', theme: 'dark', radius: 'round', preset: 'telegram', font: 'mono' },
      features: { voice: true, video: false, images: false, aiFix: true },
      appearance_version: 4,
      published_at: '2026-07-25T00:00:00.000Z',
    })

    expect(config).toMatchObject({
      enabled: false,
      publicKey: 'om_pk_test',
      selectedEmployeeId: 'mara',
      selectedEmployeePrompt: 'You are Mara.',
      allowedOrigins: ['https://example.com'],
      widget: {
        accent: '#123456',
        theme: 'dark',
        radius: 'round',
        preset: 'telegram',
        font: 'mono',
        voice: true,
        video: false,
        images: false,
        colors: {
          accent: '#123456',
          headerBackground: '#3b82a0',
        },
      },
      appearanceVersion: 4,
    })
  })

  it('serializes only server-owned chatbot fields', () => {
    const row = chatbotConfigToRow('user-1', {
      ...DEFAULT_CHATBOT_CONFIG,
      publicKey: 'om_pk_public',
      selectedEmployeeId: 'rex',
      selectedEmployeeName: 'Rex',
      selectedEmployeePrompt: 'Review code safely.',
    })
    expect(row).toMatchObject({
      user_id: 'user-1',
      selected_employee_id: 'rex',
      selected_employee_name: 'Rex',
      selected_employee_prompt: 'Review code safely.',
    })
    expect(row).not.toHaveProperty('public_key')
    expect(row).not.toHaveProperty('appearance')
    expect(row).toHaveProperty('draft_appearance')
  })

  it('keeps top-level greeting and agent name synchronized with the widget', () => {
    const next = withWidgetConfig(DEFAULT_CHATBOT_CONFIG, {
      ...DEFAULT_CHATBOT_CONFIG.widget,
      greeting: 'Welcome!',
      agentName: 'June',
    })
    expect(next.greeting).toBe('Welcome!')
    expect(next.agentName).toBe('June')
  })

  it('prefers the visual draft without changing the published snapshot', () => {
    const config = chatbotConfigFromRow({
      greeting: 'Published greeting',
      agent_name: 'Published name',
      appearance: { accent: '#111111', preset: 'openmind' },
      features: { voice: false },
      draft_greeting: 'Draft greeting',
      draft_agent_name: 'Draft name',
      draft_appearance: {
        preset: 'openmind',
        colors: {
          ...DEFAULT_CHATBOT_CONFIG.widget.colors,
          headerBackground: '#123456',
        },
        style: { panelRadius: 27, bubbleRadius: 8, controlRadius: 4, fontSize: 16, shadow: 'soft' },
      },
      draft_features: { voice: true },
    })
    expect(config.greeting).toBe('Draft greeting')
    expect(config.agentName).toBe('Draft name')
    expect(config.widget.colors?.headerBackground).toBe('#123456')
    expect(config.widget.style?.panelRadius).toBe(27)
    expect(config.widget.voice).toBe(true)
  })
})
