import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import {
  INITIAL_WIZARD_STATE,
  WIZARD_STEP_COUNT,
  clampStep,
  normalizeState,
  type ChatbotConfig,
  type WizardState,
} from '@/lib/onboarding'

const lsKeyFor = (userId?: string) => `om-onboarding-${userId ?? 'anon'}`

function loadLocal(key: string): WizardState | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? normalizeState(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/**
 * Setup-wizard state, persisted so it survives a refresh.
 *
 * Persistence order: Supabase (table `onboarding`) when configured, always
 * mirrored to localStorage as a backup. If Supabase is unconfigured or the
 * migration hasn't been applied (table missing), it degrades cleanly to
 * localStorage so the wizard never breaks. Writes are debounced.
 */
export function useOnboarding(userId?: string) {
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE)
  const [loading, setLoading] = useState(true)

  // Mirrors committed state so event handlers can read the latest value without
  // resubscribing. Synced in an effect (never written during render).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  // Flips false the moment Supabase rejects a call (e.g. table not there yet).
  const supaOk = useRef(isSupabaseConfigured)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lsKey = lsKeyFor(userId)

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      if (isSupabaseConfigured && supaOk.current && userId) {
        try {
          const { data, error } = await supabase
            .from('onboarding')
            .select('step, completed, config')
            .eq('user_id', userId)
            .maybeSingle()
          if (!error) {
            const resolved = data ? normalizeState(data) : loadLocal(lsKey) ?? INITIAL_WIZARD_STATE
            if (!cancelled) {
              setState(resolved)
              setLoading(false)
            }
            return
          }
          supaOk.current = false // table missing / RLS → fall through to local
        } catch {
          supaOk.current = false
        }
      }
      const local = loadLocal(lsKey) ?? INITIAL_WIZARD_STATE
      if (!cancelled) {
        setState(local)
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId, lsKey])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  // ── persist ───────────────────────────────────────────────────────────────
  // Push one state to Supabase now. Returns the write promise so callers that
  // must not race the write (completion → redirect) can await it.
  const writeRemote = useCallback(
    (next: WizardState): Promise<void> => {
      if (!(isSupabaseConfigured && supaOk.current && userId)) return Promise.resolve()
      return supabase
        .from('onboarding')
        .upsert({
          user_id: userId,
          step: next.step,
          completed: next.completed,
          config: next.config,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) supaOk.current = false
        })
    },
    [userId],
  )

  const persist = useCallback(
    (next: WizardState) => {
      try {
        localStorage.setItem(lsKey, JSON.stringify(next))
      } catch {
        /* storage unavailable — Supabase (if any) is still the source of truth */
      }
      if (isSupabaseConfigured && supaOk.current && userId) {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => void writeRemote(next), 400)
      }
    },
    [lsKey, userId, writeRemote],
  )

  const apply = useCallback(
    (updater: (s: WizardState) => WizardState) => {
      const next = updater(stateRef.current)
      stateRef.current = next
      setState(next)
      persist(next)
    },
    [persist],
  )

  const setStep = useCallback((step: number) => apply((s) => ({ ...s, step: clampStep(step) })), [apply])
  const next = useCallback(() => apply((s) => ({ ...s, step: clampStep(s.step + 1) })), [apply])
  const back = useCallback(() => apply((s) => ({ ...s, step: clampStep(s.step - 1) })), [apply])
  const patchConfig = useCallback(
    (patch: Partial<ChatbotConfig>) => apply((s) => ({ ...s, config: { ...s.config, ...patch } })),
    [apply],
  )
  // Completion must be durable before the caller redirects to the console, so it
  // flushes the write synchronously (bypassing the debounce) and resolves once
  // the row lands — otherwise the console's fresh load could read a stale
  // completed=false row and bounce the user back into setup.
  const complete = useCallback(async (): Promise<void> => {
    const next: WizardState = { ...stateRef.current, completed: true, step: WIZARD_STEP_COUNT - 1 }
    stateRef.current = next
    setState(next)
    try {
      localStorage.setItem(lsKey, JSON.stringify(next))
    } catch {
      /* storage unavailable — Supabase write below is still the source of truth */
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await writeRemote(next)
  }, [lsKey, writeRemote])
  const reset = useCallback(() => apply(() => ({ ...INITIAL_WIZARD_STATE })), [apply])

  return { state, loading, setStep, next, back, patchConfig, complete, reset }
}
