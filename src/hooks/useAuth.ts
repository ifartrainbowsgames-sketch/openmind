import { useEffect, useState } from 'react'
import {
  authMode, getSession, signOut as authSignOut, subscribe,
  type AuthSession,
} from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const refresh = () =>
      getSession().then((s) => {
        if (mounted) setSession(s)
      })

    refresh().finally(() => mounted && setLoading(false))

    // demo mode: explicit subscribe. live mode: supabase's own state stream.
    const unsubDemo = subscribe(refresh)
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh())

    return () => {
      mounted = false
      unsubDemo()
      sub.subscription.unsubscribe()
    }
  }, [])

  return {
    session,
    loading,
    mode: authMode,
    signOut: () => authSignOut(),
  }
}
