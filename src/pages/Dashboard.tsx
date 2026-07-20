import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { capabilities } from '@/data/capabilities'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Source } from '@/components/dashboard/types'
import DataStudio from '@/components/dashboard/DataStudio'
import ServiceSettings from '@/components/dashboard/ServiceSettings'
import Inbox from '@/components/dashboard/Inbox'
import Popups from '@/components/dashboard/Popups'
import PromptStudio from '@/components/dashboard/PromptStudio'
import WidgetBuilder from '@/components/dashboard/WidgetBuilder'
import { Overview, ProvidersKeys } from '@/components/dashboard/Panels'
import {
  LayoutDashboard, Database, KeyRound, ArrowLeft, Users, CreditCard,
  Inbox as InboxIcon, Megaphone, PenLine, Paintbrush, LogOut, Zap, Loader2,
} from 'lucide-react'

const SEED_ROWS = [
  { name: 'refund-policy.pdf', type: 'file', size: '84.2 KB', chunks: 148, status: 'indexed', attached: ['chat', 'docqa'] },
  { name: 'https://docs.acme.com', type: 'url', size: '—', chunks: 1204, status: 'indexed', attached: ['chat', 'docqa'] },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowToSource = (r: any): Source => ({
  id: r.id,
  name: r.name,
  type: r.type,
  size: r.size ?? '—',
  chunks: r.chunks ?? 0,
  status: r.status === 'indexed' ? 'indexed' : 'indexing',
  progress: r.status === 'indexed' ? 100 : 40,
  attached: r.attached ?? [],
  addedAt: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'just now',
})

type View = 'overview' | 'data' | 'providers' | string

const NAV_TOP = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'data', label: 'Data Studio', icon: Database },
  { id: 'widget', label: 'Widget Builder', icon: Paintbrush },
  { id: 'providers', label: 'Providers & keys', icon: KeyRound },
]

const NAV_ENGAGE = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon, badge: 2 },
  { id: 'popups', label: 'Engage · popups', icon: Megaphone },
  { id: 'prompt', label: 'Prompt Studio', icon: PenLine },
]

export default function Dashboard() {
  const [view, setView] = useState<View>('data')
  const [sources, setSources] = useState<Source[]>([])
  const [plan, setPlan] = useState<string>('free')
  const [billingNote, setBillingNote] = useState(false)
  const { session, loading, signOut } = useAuth()
  const navigate = useNavigate()

  // auth guard — console requires an account
  useEffect(() => {
    if (!loading && !session) navigate('/login')
  }, [loading, session, navigate])

  // load plan + sources from Supabase; seed demo data on first login
  useEffect(() => {
    if (!session) return
    const uid = session.user.id
    supabase.from('subscriptions').select('plan').eq('user_id', uid).maybeSingle()
      .then(({ data }) => { if (data?.plan) setPlan(data.plan) })
    supabase.from('sources').select('*').order('created_at', { ascending: false })
      .then(async ({ data }) => {
        if (data && data.length === 0) {
          await supabase.from('sources').insert(SEED_ROWS.map((s) => ({ ...s, user_id: uid })))
          const { data: seeded } = await supabase.from('sources').select('*').order('created_at', { ascending: false })
          setSources((seeded ?? []).map(rowToSource))
        } else if (data) {
          setSources(data.map(rowToSource))
        }
      })
  }, [session])

  // indexing simulation — progress creeps to 100, flips to indexed, syncs to cloud
  useEffect(() => {
    const t = setInterval(() => {
      setSources((ss) =>
        ss.map((s) => {
          if (s.status !== 'indexing') return s
          const p = Math.min(100, s.progress + 5 + Math.floor(Math.random() * 11))
          if (p >= 100) {
            const chunks = 24 + ((s.name.length * 37) % 420)
            supabase.from('sources').update({ status: 'indexed', chunks }).eq('id', s.id).then()
            return { ...s, progress: 100, status: 'indexed' as const, chunks }
          }
          return { ...s, progress: p }
        }),
      )
    }, 320)
    return () => clearInterval(t)
  }, [])

  const addSources = (items: Omit<Source, 'id' | 'addedAt' | 'status' | 'progress' | 'chunks'>[]) => {
    if (!session) return
    supabase
      .from('sources')
      .insert(items.map((s) => ({ ...s, user_id: session.user.id, status: 'indexing' })))
      .select()
      .then(({ data }) => {
        if (data) setSources((ss) => [...data.map(rowToSource), ...ss])
      })
  }

  const removeSource = (id: string) => {
    setSources((ss) => ss.filter((s) => s.id !== id))
    supabase.from('sources').delete().eq('id', id).then()
  }

  const toggleAttach = (id: string, cap: string) => {
    setSources((ss) =>
      ss.map((s) => {
        if (s.id !== id) return s
        const attached = s.attached.includes(cap) ? s.attached.filter((c) => c !== cap) : [...s.attached, cap]
        supabase.from('sources').update({ attached }).eq('id', id).then()
        return { ...s, attached }
      }),
    )
  }

  const cap = capabilities.find((c) => c.id === view)
  const viewLabel =
    view === 'overview' ? 'Overview'
    : view === 'data' ? 'Data Studio'
    : view === 'providers' ? 'Providers & keys'
    : view === 'inbox' ? 'Inbox'
    : view === 'popups' ? 'Engage · popups'
    : view === 'prompt' ? 'Prompt Studio'
    : cap?.name ?? ''

  const navBtn = (active: boolean) =>
    `flex w-full items-center gap-3 px-4 py-2.5 text-left font-mono-spec text-[12px] uppercase tracking-[0.12em] transition-colors ${
      active ? 'bg-accent text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
    }`

  const sidebar = (
    <>
      <div className="border-b border-white/15 px-5 py-5">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-serif-display text-xl font-bold text-white">
            OpenMind<span className="text-accent">.</span>
          </span>
          <span className="font-mono-spec text-[10px] uppercase tracking-[0.16em] text-white/40">console</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-4 pb-2 font-mono-spec text-[10px] uppercase tracking-[0.18em] text-white/35">Workspace</div>
        {NAV_TOP.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} className={navBtn(view === n.id)}>
            <n.icon className="h-4 w-4" /> {n.label}
          </button>
        ))}

        <div className="px-4 pb-2 pt-6 font-mono-spec text-[10px] uppercase tracking-[0.18em] text-white/35">
          Live operations
        </div>
        {NAV_ENGAGE.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} className={navBtn(view === n.id)}>
            <n.icon className="h-4 w-4" /> {n.label}
            {n.badge ? (
              <span className="ml-auto bg-accent px-1.5 py-0.5 font-mono-spec text-[9px] text-white">{n.badge}</span>
            ) : null}
          </button>
        ))}

        <div className="px-4 pb-2 pt-6 font-mono-spec text-[10px] uppercase tracking-[0.18em] text-white/35">
          Capabilities
        </div>
        {capabilities.map((c) => (
          <button key={c.id} onClick={() => setView(c.id)} className={navBtn(view === c.id)}>
            <span className={`font-mono-spec text-[10px] ${view === c.id ? 'text-white' : 'text-accent'}`}>{c.index}</span>
            {c.name}
            <span className="ml-auto font-mono-spec text-[10px] text-white/30">
              {sources.filter((s) => s.attached.includes(c.id)).length || ''}
            </span>
          </button>
        ))}

        <div className="px-4 pb-2 pt-6 font-mono-spec text-[10px] uppercase tracking-[0.18em] text-white/35">Account</div>
        {[{ label: 'Team', icon: Users }, { label: 'Billing', icon: CreditCard }].map((n) => (
          <div key={n.label} className="flex w-full items-center gap-3 px-4 py-2.5 font-mono-spec text-[12px] uppercase tracking-[0.12em] text-white/30">
            <n.icon className="h-4 w-4" /> {n.label}
            <span className="ml-auto border border-white/20 px-1 text-[9px]">soon</span>
          </div>
        ))}
      </div>

      <div className="border-t border-white/15 p-4">
        <Link
          to="/"
          className="flex items-center gap-2 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-white/50 hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to site
        </Link>
      </div>
    </>
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="flex items-center gap-3 font-mono-spec text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading console…
        </span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[264px_1fr]">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col bg-primary lg:flex">
        {sidebar}
      </aside>

      {/* mobile top strip */}
      <div className="sticky top-0 z-40 flex items-center gap-2 overflow-x-auto bg-primary px-4 py-3 lg:hidden">
        <Link to="/" className="mr-2 font-serif-display text-lg font-bold text-white">
          OpenMind<span className="text-accent">.</span>
        </Link>
        {[...NAV_TOP.map((n) => ({ id: n.id, label: n.label })), ...NAV_ENGAGE.map((n) => ({ id: n.id, label: n.label })), ...capabilities.map((c) => ({ id: c.id, label: c.name }))].map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={`whitespace-nowrap border px-3 py-1.5 font-mono-spec text-[11px] uppercase tracking-wider ${
              view === n.id ? 'border-accent bg-accent text-white' : 'border-white/25 text-white/60'
            }`}
          >
            {n.label}
          </button>
        ))}
      </div>

      {/* main */}
      <div className="lg:col-start-2">
        {/* topbar */}
        <div className="sticky top-0 z-30 hidden items-center justify-between border-b border-primary bg-background/95 px-8 py-3 backdrop-blur-sm lg:flex">
          <span className="font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            console / <span className="text-foreground">{viewLabel}</span>
          </span>
          <div className="flex items-center gap-3">
            <span className={`border px-2.5 py-1 font-mono-spec text-[10px] uppercase tracking-[0.14em] ${
              plan === 'free'
                ? 'border-border/60 text-muted-foreground'
                : 'border-accent bg-accent/10 text-accent'
            }`}>
              {plan} plan
            </span>
            {plan === 'free' && (
              <button
                onClick={() => setBillingNote((b) => !b)}
                className="flex items-center gap-1.5 border border-accent bg-accent px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white hover:bg-accent/85"
              >
                <Zap className="h-3 w-3" /> Upgrade to Pro
              </button>
            )}
            <span
              className="flex h-8 w-8 items-center justify-center border border-primary bg-primary font-mono-spec text-xs uppercase text-primary-foreground"
              title={session?.user.email ?? ''}
            >
              {(session?.user.email ?? '??').slice(0, 2)}
            </span>
            <button
              onClick={() => signOut().then(() => navigate('/login'))}
              className="flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {billingNote && (
          <div className="border-b border-primary bg-terminal px-8 py-3">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
              <Zap className="h-4 w-4 text-accent" />
              <p className="flex-1 font-mono-spec text-[11px] uppercase tracking-[0.12em] text-white/85">
                Pro billing launches soon — you're on the early-access list. No card needed today.
              </p>
              <button
                onClick={() => setBillingNote(false)}
                className="font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white/50 hover:text-accent"
              >
                dismiss
              </button>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
          {view === 'overview' && <Overview sources={sources} />}
          {view === 'data' && (
            <DataStudio sources={sources} addSources={addSources} removeSource={removeSource} toggleAttach={toggleAttach} />
          )}
          {view === 'widget' && <WidgetBuilder />}
          {view === 'providers' && <ProvidersKeys />}
          {view === 'inbox' && <Inbox />}
          {view === 'popups' && <Popups />}
          {view === 'prompt' && <PromptStudio />}
          {cap && <ServiceSettings cap={cap} sources={sources} />}
        </main>
      </div>
    </div>
  )
}
