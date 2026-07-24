import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type Plan = 'free' | 'pro'

export const PLAN_LIMITS: Record<Plan, { services: number; storageGB: number; analyticsDays: number }> = {
  free: { services: 2, storageGB: 1, analyticsDays: 7 },
  pro: { services: 99, storageGB: 5, analyticsDays: 90 },
}

/**
 * The user's plan + activated services, synced to public.profiles.
 * During early access the plan is freely switchable in the console —
 * once Stripe billing goes live, upgrades flow through checkout instead.
 */
export function usePlan(userId: string | undefined) {
  const [plan, setPlanState] = useState<Plan>('free')
  const [services, setServices] = useState<string[]>(['chat'])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    supabase
      .from('profiles')
      .select('plan, services')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (queryError) {
          setError(`Could not load your plan: ${queryError.message}`)
          setLoaded(true)
          return
        }
        if (data) {
          setPlanState(data.plan === 'pro' ? 'pro' : 'free')
          if (Array.isArray(data.services)) setServices(data.services as string[])
        }
        setLoaded(true)
      })
  }, [userId])

  /** Returns false when the free-tier activation cap blocks the toggle. */
  const toggleService = useCallback(
    (id: string): boolean => {
      if (!userId) return false
      let blocked = false
      setServices((current) => {
        const previous = current
        if (current.includes(id)) {
          const next = current.filter((s) => s !== id)
          void supabase.from('profiles').update({ services: next }).eq('id', userId).then(({ error: updateError }) => {
            if (updateError) {
              setServices(previous)
              setError(`Could not update services: ${updateError.message}`)
            } else {
              setError(null)
            }
          })
          return next
        }
        if (current.length >= PLAN_LIMITS[plan].services) {
          blocked = true
          return current
        }
        const next = [...current, id]
        void supabase.from('profiles').update({ services: next }).eq('id', userId).then(({ error: updateError }) => {
          if (updateError) {
            setServices(previous)
            setError(`Could not update services: ${updateError.message}`)
          } else {
            setError(null)
          }
        })
        return next
      })
      return !blocked
    },
    [userId, plan],
  )

  return { plan, services, toggleService, loaded, error, limits: PLAN_LIMITS[plan] }
}
