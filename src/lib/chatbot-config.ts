import type { WidgetConfig, WidgetFont, WidgetPreset } from '@/components/widget/ChatWidget'

export interface ChatbotConfig {
  enabled: boolean
  publicKey: string
  systemPrompt: string
  greeting: string
  offlineMessage: string
  agentName: string
  selectedEmployeeId?: string
  selectedEmployeeName?: string
  selectedEmployeePrompt?: string
  allowedOrigins: string[]
  widget: WidgetConfig
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = {
  enabled: true,
  publicKey: '',
  systemPrompt:
    'You are a helpful customer support assistant. Be concise, factual, and escalate when a human is needed.',
  greeting: 'Hi! How can I help?',
  offlineMessage: 'We are offline right now. Leave a message and our team will follow up.',
  agentName: 'Support Assistant',
  allowedOrigins: [],
  widget: {
    accent: '#ff4d00',
    theme: 'light',
    radius: 'soft',
    agentName: 'Support Assistant',
    greeting: 'Hi! How can I help?',
    voice: true,
    video: false,
    images: false,
    aiFix: false,
    preset: 'openmind',
    font: 'system',
  },
}

interface ChatbotConfigRow {
  public_key?: unknown
  enabled?: unknown
  system_prompt?: unknown
  greeting?: unknown
  offline_message?: unknown
  agent_name?: unknown
  selected_employee_id?: unknown
  selected_employee_name?: unknown
  selected_employee_prompt?: unknown
  appearance?: unknown
  features?: unknown
  allowed_origins?: unknown
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback

export function chatbotConfigFromRow(row: ChatbotConfigRow | null | undefined): ChatbotConfig {
  if (!row) return DEFAULT_CHATBOT_CONFIG
  const appearance = asRecord(row.appearance)
  const features = asRecord(row.features)
  const greeting = typeof row.greeting === 'string' ? row.greeting : DEFAULT_CHATBOT_CONFIG.greeting
  const agentName = typeof row.agent_name === 'string' ? row.agent_name : DEFAULT_CHATBOT_CONFIG.agentName
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
    publicKey: typeof row.public_key === 'string' ? row.public_key : '',
    systemPrompt:
      typeof row.system_prompt === 'string' ? row.system_prompt : DEFAULT_CHATBOT_CONFIG.systemPrompt,
    greeting,
    offlineMessage:
      typeof row.offline_message === 'string' ? row.offline_message : DEFAULT_CHATBOT_CONFIG.offlineMessage,
    agentName,
    ...(typeof row.selected_employee_id === 'string' ? { selectedEmployeeId: row.selected_employee_id } : {}),
    ...(typeof row.selected_employee_name === 'string' ? { selectedEmployeeName: row.selected_employee_name } : {}),
    ...(typeof row.selected_employee_prompt === 'string' ? { selectedEmployeePrompt: row.selected_employee_prompt } : {}),
    allowedOrigins: Array.isArray(row.allowed_origins)
      ? row.allowed_origins.filter((origin): origin is string => typeof origin === 'string')
      : [],
    widget: {
      accent: typeof appearance.accent === 'string' ? appearance.accent : DEFAULT_CHATBOT_CONFIG.widget.accent,
      theme: oneOf(appearance.theme, ['light', 'dark'] as const, 'light'),
      radius: oneOf(appearance.radius, ['sharp', 'soft', 'round'] as const, 'soft'),
      preset: oneOf<WidgetPreset>(appearance.preset, ['openmind', 'discord', 'telegram', 'instagram'], 'openmind'),
      font: oneOf<WidgetFont>(appearance.font, ['system', 'serif', 'mono'], 'system'),
      agentName,
      greeting,
      voice: typeof features.voice === 'boolean' ? features.voice : true,
      video: typeof features.video === 'boolean' ? features.video : false,
      images: typeof features.images === 'boolean' ? features.images : false,
      aiFix: typeof features.aiFix === 'boolean' ? features.aiFix : false,
    },
  }
}

export function chatbotConfigToRow(userId: string, config: ChatbotConfig) {
  return {
    user_id: userId,
    enabled: config.enabled,
    system_prompt: config.systemPrompt.trim(),
    greeting: config.greeting.trim(),
    offline_message: config.offlineMessage.trim(),
    agent_name: config.agentName.trim(),
    selected_employee_id: config.selectedEmployeeId ?? null,
    selected_employee_name: config.selectedEmployeeName ?? null,
    selected_employee_prompt: config.selectedEmployeePrompt ?? null,
    allowed_origins: config.allowedOrigins,
    appearance: {
      accent: config.widget.accent,
      theme: config.widget.theme,
      radius: config.widget.radius,
      preset: config.widget.preset ?? 'openmind',
      font: config.widget.font ?? 'system',
    },
    features: {
      voice: config.widget.voice,
      video: config.widget.video,
      images: config.widget.images,
      aiFix: config.widget.aiFix,
    },
  }
}

export function withWidgetConfig(config: ChatbotConfig, widget: WidgetConfig): ChatbotConfig {
  return {
    ...config,
    agentName: widget.agentName,
    greeting: widget.greeting,
    widget,
  }
}
