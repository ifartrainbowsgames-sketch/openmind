import { useEffect, useState } from 'react'
import { Bell, PhoneCall, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface DashboardNotification {
  id: string
  event_kind: 'message' | 'call_request' | 'assignment'
  title: string
  body: string
  conversation_id?: string | null
  dashboard_enabled?: boolean
}

export default function DashboardNotifications({
  ownerId,
  demo,
  onOpenInbox,
}: {
  ownerId: string
  demo: boolean
  onOpenInbox: () => void
}) {
  const [notification, setNotification] = useState<DashboardNotification | null>(null)

  useEffect(() => {
    if (demo) return
    const channel = supabase
      .channel(`dashboard-notifications:${ownerId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `owner_id=eq.${ownerId}` },
        (payload) => {
          const next = payload.new as DashboardNotification
          if (next.dashboard_enabled !== false) setNotification(next)
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [ownerId, demo])

  if (!notification) return null

  const open = () => {
    void supabase.from('notifications').update({ read: true }).eq('id', notification.id)
    setNotification(null)
    onOpenInbox()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[70] w-[min(24rem,calc(100vw-2rem))] border border-primary bg-card p-4 hard-shadow"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-primary text-primary-foreground">
          {notification.event_kind === 'call_request' ? <PhoneCall className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </span>
        <button onClick={open} className="min-w-0 flex-1 text-left">
          <span className="block font-serif-display text-lg font-semibold">{notification.title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{notification.body}</span>
          <span className="mt-2 block font-mono-spec text-[9px] uppercase tracking-[0.13em] text-accent">
            Open conversation
          </span>
        </button>
        <button
          onClick={() => setNotification(null)}
          className="p-1 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
