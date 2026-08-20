import {
  DEFAULT_WIDGET_COLORS,
  DEFAULT_WIDGET_LAUNCHER,
  DEFAULT_WIDGET_PANEL,
  DEFAULT_WIDGET_STYLE,
  WIDGET_PRESETS,
  type WidgetColors,
  type WidgetConfig,
  type WidgetFont,
  type WidgetLauncher,
  type WidgetPanel,
  type WidgetPreset,
  type WidgetStyle,
} from '@/components/widget/ChatWidget'

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
  appearanceVersion: number
  publishedAt?: string
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
    colors: DEFAULT_WIDGET_COLORS,
    style: DEFAULT_WIDGET_STYLE,
    launcher: DEFAULT_WIDGET_LAUNCHER,
    panel: DEFAULT_WIDGET_PANEL,
  },
  appearanceVersion: 0,
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
  draft_appearance?: unknown
  draft_features?: unknown
  draft_greeting?: unknown
  draft_agent_name?: unknown
  appearance_version?: unknown
  published_at?: unknown
  allowed_origins?: unknown
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback

const numberIn = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

function colorsFromAppearance(appearance: Record<string, unknown>, preset: WidgetPreset): WidgetColors {
  const stored = asRecord(appearance.colors)
  const base = { ...WIDGET_PRESETS[preset].colors }
  const accent = typeof appearance.accent === 'string' ? appearance.accent : base.accent
  if (!Object.keys(stored).length) {
    base.accent = accent
    if (preset === 'openmind') {
      Object.assign(base, {
        headerBackground: accent,
        visitorBubble: accent,
        launcherBackground: accent,
      })
    }
  }
  for (const key of Object.keys(base) as (keyof WidgetColors)[]) {
    if (typeof stored[key] === 'string') base[key] = stored[key] as string
  }
  return base
}

function styleFromAppearance(appearance: Record<string, unknown>): WidgetStyle {
  const stored = asRecord(appearance.style)
  const legacyRadius = oneOf(appearance.radius, ['sharp', 'soft', 'round'] as const, 'soft')
  const legacyPanelRadius = legacyRadius === 'sharp' ? 0 : legacyRadius === 'round' ? 24 : 16
  return {
    panelRadius: numberIn(stored.panelRadius, legacyPanelRadius, 0, 32),
    bubbleRadius: numberIn(stored.bubbleRadius, DEFAULT_WIDGET_STYLE.bubbleRadius, 0, 28),
    controlRadius: numberIn(stored.controlRadius, DEFAULT_WIDGET_STYLE.controlRadius, 0, 24),
    fontSize: numberIn(stored.fontSize, DEFAULT_WIDGET_STYLE.fontSize, 12, 18),
    shadow: oneOf(stored.shadow, ['none', 'soft', 'strong'] as const, DEFAULT_WIDGET_STYLE.shadow),
  }
}

function launcherFromAppearance(appearance: Record<string, unknown>): WidgetLauncher {
  const stored = asRecord(appearance.launcher)
  return {
    position: oneOf(stored.position, ['bottom-right', 'bottom-left'] as const, DEFAULT_WIDGET_LAUNCHER.position),
    label: typeof stored.label === 'string' ? stored.label.slice(0, 32) : DEFAULT_WIDGET_LAUNCHER.label,
    size: numberIn(stored.size, DEFAULT_WIDGET_LAUNCHER.size, 44, 72),
    offsetX: numberIn(stored.offsetX, DEFAULT_WIDGET_LAUNCHER.offsetX, 8, 80),
    offsetY: numberIn(stored.offsetY, DEFAULT_WIDGET_LAUNCHER.offsetY, 8, 80),
  }
}

function panelFromAppearance(appearance: Record<string, unknown>): WidgetPanel {
  const stored = asRecord(appearance.panel)
  return {
    width: numberIn(stored.width, DEFAULT_WIDGET_PANEL.width, 320, 520),
    height: numberIn(stored.height, DEFAULT_WIDGET_PANEL.height, 480, 760),
  }
}

export function chatbotConfigFromRow(row: ChatbotConfigRow | null | undefined): ChatbotConfig {
  if (!row) return DEFAULT_CHATBOT_CONFIG
  const appearance = asRecord(row.draft_appearance ?? row.appearance)
  const features = asRecord(row.draft_features ?? row.features)
  const preset = oneOf<WidgetPreset>(appearance.preset, ['openmind', 'discord', 'telegram', 'instagram'], 'openmind')
  const colors = colorsFromAppearance(appearance, preset)
  const greeting =
    typeof row.draft_greeting === 'string'
      ? row.draft_greeting
      : typeof row.greeting === 'string' ? row.greeting : DEFAULT_CHATBOT_CONFIG.greeting
  const agentName =
    typeof row.draft_agent_name === 'string'
      ? row.draft_agent_name
      : typeof row.agent_name === 'string' ? row.agent_name : DEFAULT_CHATBOT_CONFIG.agentName
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
      accent: colors.accent,
      theme: oneOf(appearance.theme, ['light', 'dark'] as const, 'light'),
      radius: oneOf(appearance.radius, ['sharp', 'soft', 'round'] as const, 'soft'),
      preset,
      font: oneOf<WidgetFont>(appearance.font, ['system', 'serif', 'mono'], 'system'),
      agentName,
      greeting,
      voice: typeof features.voice === 'boolean' ? features.voice : true,
      video: typeof features.video === 'boolean' ? features.video : false,
      images: typeof features.images === 'boolean' ? features.images : false,
      aiFix: typeof features.aiFix === 'boolean' ? features.aiFix : false,
      colors,
      style: styleFromAppearance(appearance),
      launcher: launcherFromAppearance(appearance),
      panel: panelFromAppearance(appearance),
    },
    appearanceVersion:
      typeof row.appearance_version === 'number' ? row.appearance_version : 0,
    ...(typeof row.published_at === 'string' ? { publishedAt: row.published_at } : {}),
  }
}

export function widgetAppearanceToRow(widget: WidgetConfig) {
  return {
    accent: widget.colors?.accent ?? widget.accent,
    theme: widget.theme,
    radius: widget.radius,
    preset: widget.preset ?? 'openmind',
    font: widget.font ?? 'system',
    colors: { ...(widget.colors ?? DEFAULT_WIDGET_COLORS) },
    style: { ...(widget.style ?? DEFAULT_WIDGET_STYLE) },
    launcher: { ...(widget.launcher ?? DEFAULT_WIDGET_LAUNCHER) },
    panel: { ...(widget.panel ?? DEFAULT_WIDGET_PANEL) },
  }
}

export function widgetFeaturesToRow(widget: WidgetConfig) {
  return {
    voice: widget.voice,
    video: widget.video,
    images: widget.images,
    aiFix: widget.aiFix,
  }
}

export function chatbotConfigToRow(userId: string, config: ChatbotConfig) {
  return {
    user_id: userId,
    enabled: config.enabled,
    system_prompt: config.systemPrompt.trim(),
    offline_message: config.offlineMessage.trim(),
    selected_employee_id: config.selectedEmployeeId ?? null,
    selected_employee_name: config.selectedEmployeeName ?? null,
    selected_employee_prompt: config.selectedEmployeePrompt ?? null,
    allowed_origins: config.allowedOrigins,
    draft_greeting: config.greeting.trim(),
    draft_agent_name: config.agentName.trim(),
    draft_appearance: widgetAppearanceToRow(config.widget),
    draft_features: widgetFeaturesToRow(config.widget),
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
