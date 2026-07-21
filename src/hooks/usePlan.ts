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

  useEffect(() => {
    if (!userId) return
    supabase
      .from('profiles')
      .select('plan, services')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPlanState(data.plan === 'pro' ? 'pro' : 'free')
          if (Array.isArray(data.services)) setServices(data.services as string[])
        }
        setLoaded(true)
      })
  }, [userId])

  const setPlan = useCallback(
    (p: Plan) => {
      if (!userId) return
      setPlanState(p)
      // downgrading trims activations to the free allowance
      if (p === 'free') {
        setServices((s) => {
          const trimmed = s.slice(0, PLAN_LIMITS.free.services)
          supabase.from('profiles').update({ plan: p, services: trimmed }).eq('id', userId).then()
          return trimmed
        })
        return
      }
      supabase.from('profiles').update({ plan: p }).eq('id', userId).then()
    },
    [userId],
  )

  /** Returns false when the free-tier activation cap blocks the toggle. */
  const toggleService = useCallback(
    (id: string): boolean => {
      if (!userId) return false
      let blocked = false
      setServices((current) => {
        if (current.includes(id)) {
          const next = current.filter((s) => s !== id)
          supabase.from('profiles').update({ services: next }).eq('id', userId).then()
          return next
        }
        if (current.length >= PLAN_LIMITS[plan].services) {
          blocked = true
          return current
        }
        const next = [...current, id]
        supabase.from('profiles').update({ services: next }).eq('id', userId).then()
        return next
      })
      return !blocked
    },
    [userId, plan],
  )

  return { plan, setPlan, services, toggleService, loaded, limits: PLAN_LIMITS[plan] }
}
