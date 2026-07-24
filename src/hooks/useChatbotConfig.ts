import { useCallback, useEffect, useState } from 'react'
import {
  chatbotConfigFromRow,
  chatbotConfigToRow,
  DEFAULT_CHATBOT_CONFIG,
  type ChatbotConfig,
} from '@/lib/chatbot-config'
import { supabase } from '@/lib/supabase'

const DEMO_KEY = 'openmind-chatbot-config-v1'

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

function demoRow(config: ChatbotConfig): Record<string, unknown> {
  return {
    public_key: config.publicKey,
    ...chatbotConfigToRow('demo', config),
  }
}

export function useChatbotConfig(userId: string | undefined, demo: boolean) {
  const [config, setConfig] = useState<ChatbotConfig>(DEFAULT_CHATBOT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    if (demo) {
      const next = demoConfig()
      localStorage.setItem(DEMO_KEY, JSON.stringify(demoRow(next)))
      void Promise.resolve().then(() => {
        setConfig(next)
        setLoaded(true)
      })
      return
    }
    void supabase
      .from('chatbot_configs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (queryError) setError(`Could not load chatbot settings: ${queryError.message}`)
        else if (data) setConfig(chatbotConfigFromRow(data))
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

  return { config, update, replace, save, loaded, saving, saved, error }
}
