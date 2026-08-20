import { useCallback, useEffect, useState } from 'react'
import {
  chatbotConfigFromRow,
  chatbotConfigToRow,
  DEFAULT_CHATBOT_CONFIG,
  widgetAppearanceToRow,
  widgetFeaturesToRow,
  type ChatbotConfig,
} from '@/lib/chatbot-config'
import { supabase } from '@/lib/supabase'

const DEMO_KEY = 'openmind-chatbot-config-v1'
const DEMO_VERSIONS_KEY = 'openmind-chatbot-versions-v1'

export interface ChatbotConfigVersion {
  id: string
  version: number
  snapshot: {
    appearance?: unknown
    features?: unknown
    greeting?: unknown
    agent_name?: unknown
  }
  createdAt: string
}

function demoConfig(): ChatbotConfig {
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    if (raw) return chatbotConfigFromRow(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    // Fall through to a fresh demo workspace.
  }
  return {
    ...DEFAULT_CHATBOT_CONFIG,
    publicKey: `om_demo_${globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? Date.now().toString(36)}`,
  }
}

function demoRow(config: ChatbotConfig, publish = false): Record<string, unknown> {
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(localStorage.getItem(DEMO_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    current = {}
  }
  return {
    ...current,
    public_key: config.publicKey,
    ...chatbotConfigToRow('demo', config),
    ...(publish || !current.appearance
      ? {
          appearance: widgetAppearanceToRow(config.widget),
          features: widgetFeaturesToRow(config.widget),
          greeting: config.greeting,
          agent_name: config.agentName,
        }
      : {}),
    appearance_version: config.appearanceVersion,
    published_at: config.publishedAt ?? null,
  }
}

export function useChatbotConfig(userId: string | undefined, demo: boolean) {
  const [config, setConfig] = useState<ChatbotConfig>(DEFAULT_CHATBOT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [versions, setVersions] = useState<ChatbotConfigVersion[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    if (demo) {
      const next = demoConfig()
      localStorage.setItem(DEMO_KEY, JSON.stringify(demoRow(next)))
      let storedVersions: ChatbotConfigVersion[] = []
      try {
        const parsed = JSON.parse(localStorage.getItem(DEMO_VERSIONS_KEY) ?? '[]') as unknown
        if (Array.isArray(parsed)) storedVersions = parsed as ChatbotConfigVersion[]
      } catch {
        storedVersions = []
      }
      void Promise.resolve().then(() => {
        setConfig(next)
        setVersions(storedVersions)
        setLoaded(true)
      })
      return
    }
    void supabase
      .from('chatbot_configs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(async ({ data, error: queryError }) => {
        if (queryError) setError(`Could not load chatbot settings: ${queryError.message}`)
        else if (data) setConfig(chatbotConfigFromRow(data))
        const { data: versionRows } = await supabase
          .from('chatbot_config_versions')
          .select('id, version, snapshot, created_at')
          .eq('user_id', userId)
          .order('version', { ascending: false })
          .limit(12)
        setVersions((versionRows ?? []).map((version) => ({
          id: version.id,
          version: version.version,
          snapshot: version.snapshot as ChatbotConfigVersion['snapshot'],
          createdAt: version.created_at,
        })))
        setLoaded(true)
      })
  }, [userId, demo])

  const persist = useCallback(async (next: ChatbotConfig): Promise<boolean> => {
    if (!userId) return false
    setSaving(true)
    setSaved(false)
    try {
      if (demo) {
        localStorage.setItem(DEMO_KEY, JSON.stringify(demoRow(next)))
        setConfig(next)
        setSaved(true)
        setError(null)
        return true
      }
      const { data, error: saveError } = await supabase
        .from('chatbot_configs')
        .upsert(chatbotConfigToRow(userId, next), { onConflict: 'user_id' })
        .select('*')
        .single()
      if (saveError) {
        setError(`Could not save chatbot settings: ${saveError.message}`)
        return false
      }
      setConfig(chatbotConfigFromRow(data))
      setSaved(true)
      setError(null)
      return true
    } finally {
      setSaving(false)
    }
  }, [userId, demo])

  const update = useCallback((patch: Partial<ChatbotConfig>, saveNow = false) => {
    setSaved(false)
    setConfig((current) => {
      const next = { ...current, ...patch }
      if (saveNow) void persist(next)
      return next
    })
  }, [persist])

  const replace = useCallback((next: ChatbotConfig) => {
    setSaved(false)
    setConfig(next)
  }, [])

  const save = useCallback(() => persist(config), [config, persist])

  const publish = useCallback(async (): Promise<boolean> => {
    if (!userId) return false
    setPublishing(true)
    try {
      const savedDraft = await persist(config)
      if (!savedDraft) return false
      if (demo) {
        const publishedAt = new Date().toISOString()
        const next = {
          ...config,
          appearanceVersion: config.appearanceVersion + 1,
          publishedAt,
        }
        const version: ChatbotConfigVersion = {
          id: `demo-version-${next.appearanceVersion}`,
          version: next.appearanceVersion,
          snapshot: {
            appearance: widgetAppearanceToRow(next.widget),
            features: widgetFeaturesToRow(next.widget),
            greeting: next.greeting,
            agent_name: next.agentName,
          },
          createdAt: publishedAt,
        }
        const nextVersions = [version, ...versions].slice(0, 12)
        localStorage.setItem(DEMO_KEY, JSON.stringify(demoRow(next, true)))
        localStorage.setItem(DEMO_VERSIONS_KEY, JSON.stringify(nextVersions))
        setConfig(next)
        setVersions(nextVersions)
        setSaved(true)
        return true
      }
      const { data, error: publishError } = await supabase.rpc('publish_chatbot_config').single()
      if (publishError || !data) {
        setError(`Could not publish chatbot: ${publishError?.message ?? 'unknown error'}`)
        return false
      }
      const next = chatbotConfigFromRow(data)
      setConfig(next)
      const { data: versionRows } = await supabase
        .from('chatbot_config_versions')
        .select('id, version, snapshot, created_at')
        .eq('user_id', userId)
        .order('version', { ascending: false })
        .limit(12)
      setVersions((versionRows ?? []).map((version) => ({
        id: version.id,
        version: version.version,
        snapshot: version.snapshot as ChatbotConfigVersion['snapshot'],
        createdAt: version.created_at,
      })))
      setError(null)
      return true
    } finally {
      setPublishing(false)
    }
  }, [userId, demo, persist, config, versions])

  const restoreVersion = useCallback(async (version: ChatbotConfigVersion): Promise<boolean> => {
    const restored = chatbotConfigFromRow({
      public_key: config.publicKey,
      enabled: config.enabled,
      system_prompt: config.systemPrompt,
      offline_message: config.offlineMessage,
      selected_employee_id: config.selectedEmployeeId,
      selected_employee_name: config.selectedEmployeeName,
      selected_employee_prompt: config.selectedEmployeePrompt,
      allowed_origins: config.allowedOrigins,
      appearance_version: config.appearanceVersion,
      published_at: config.publishedAt,
      draft_appearance: version.snapshot.appearance,
      draft_features: version.snapshot.features,
      draft_greeting: version.snapshot.greeting,
      draft_agent_name: version.snapshot.agent_name,
    })
    setConfig(restored)
    return persist(restored)
  }, [config, persist])

  return {
    config,
    update,
    replace,
    save,
    publish,
    restoreVersion,
    versions,
    loaded,
    saving,
    publishing,
    saved,
    error,
  }
}
