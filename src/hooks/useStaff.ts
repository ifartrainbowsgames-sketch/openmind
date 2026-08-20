import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  newStaffMember,
  staffMemberFromRow,
  staffMemberToRow,
  type StaffMember,
} from '@/lib/staff'

const DEMO_KEY = 'openmind-staff-v1'

export function useStaff(ownerId: string | undefined, ownerEmail: string | undefined, demo: boolean) {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const persistDemo = (next: StaffMember[]) => {
    localStorage.setItem(DEMO_KEY, JSON.stringify(next))
    setMembers(next)
  }

  useEffect(() => {
    if (!ownerId) return
    if (demo) {
      try {
        const raw = localStorage.getItem(DEMO_KEY)
        const parsed = raw ? JSON.parse(raw) as unknown : null
        if (Array.isArray(parsed)) {
          const restored = parsed.map((item) => staffMemberFromRow({
            ...(item as Record<string, unknown>),
            owner_id: (item as Record<string, unknown>).ownerId ?? ownerId,
            member_user_id: (item as Record<string, unknown>).memberUserId,
            accept_texts: (item as Record<string, unknown>).acceptTexts,
            accept_calls: (item as Record<string, unknown>).acceptCalls,
            notify_dashboard: (item as Record<string, unknown>).notifyDashboard,
            notify_telegram: (item as Record<string, unknown>).notifyTelegram,
            notify_whatsapp: (item as Record<string, unknown>).notifyWhatsapp,
            telegram_chat_id: (item as Record<string, unknown>).telegramChatId,
            telegram_link_code: (item as Record<string, unknown>).telegramLinkCode,
            whatsapp_phone: (item as Record<string, unknown>).whatsappPhone,
          }))
          void Promise.resolve().then(() => {
            setMembers(restored)
            setLoaded(true)
          })
          return
        }
      } catch {
        // Seed a clean demo team below.
      }
      const owner = {
        ...newStaffMember(ownerId, ownerEmail?.split('@')[0] || 'Owner', ownerEmail || 'owner@example.com'),
        role: 'owner' as const,
        memberUserId: ownerId,
        acceptCalls: true,
      }
      localStorage.setItem(DEMO_KEY, JSON.stringify([owner]))
      void Promise.resolve().then(() => {
        setMembers([owner])
        setLoaded(true)
      })
      return
    }
    let active = true
    const load = async () => {
      const { data, error: queryError } = await supabase
        .from('staff_members')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at')
      if (!active) return
      if (queryError) setError(`Could not load staff: ${queryError.message}`)
      else {
        setMembers((data ?? []).map((row) => staffMemberFromRow(row)))
        setError(null)
      }
      setLoaded(true)
    }
    void load()
    const channel = supabase
      .channel(`staff:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_members', filter: `owner_id=eq.${ownerId}` }, load)
      .subscribe()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [ownerId, ownerEmail, demo])

  const addMember = useCallback(async (name: string, email: string): Promise<boolean> => {
    if (!ownerId || !name.trim() || !email.trim()) return false
    const member = newStaffMember(ownerId, name, email)
    if (demo) {
      persistDemo([...members, member])
      return true
    }
    const { data, error: insertError } = await supabase
      .from('staff_members')
      .insert(staffMemberToRow(ownerId, member))
      .select('*')
      .single()
    if (insertError) {
      setError(`Could not add staff member: ${insertError.message}`)
      return false
    }
    setMembers((current) => [...current, staffMemberFromRow(data)])
    setError(null)
    return true
  }, [ownerId, demo, members])

  const updateMember = useCallback(async (member: StaffMember): Promise<boolean> => {
    if (!ownerId) return false
    const previous = members
    const next = members.map((item) => item.id === member.id ? member : item)
    setMembers(next)
    if (demo) {
      localStorage.setItem(DEMO_KEY, JSON.stringify(next))
      return true
    }
    const { error: updateError } = await supabase
      .from('staff_members')
      .update(staffMemberToRow(ownerId, member))
      .eq('id', member.id)
      .eq('owner_id', ownerId)
    if (updateError) {
      setMembers(previous)
      setError(`Could not update staff member: ${updateError.message}`)
      return false
    }
    setError(null)
    return true
  }, [ownerId, demo, members])

  const removeMember = useCallback(async (member: StaffMember): Promise<boolean> => {
    if (!ownerId || member.role === 'owner') return false
    const previous = members
    const next = members.filter((item) => item.id !== member.id)
    setMembers(next)
    if (demo) {
      localStorage.setItem(DEMO_KEY, JSON.stringify(next))
      return true
    }
    const { error: deleteError } = await supabase
      .from('staff_members')
      .delete()
      .eq('id', member.id)
      .eq('owner_id', ownerId)
    if (deleteError) {
      setMembers(previous)
      setError(`Could not remove staff member: ${deleteError.message}`)
      return false
    }
    setError(null)
    return true
  }, [ownerId, demo, members])

  return { members, loaded, error, addMember, updateMember, removeMember }
}
