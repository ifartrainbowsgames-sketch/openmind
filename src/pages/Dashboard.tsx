import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { capabilities } from '@/data/capabilities'
import { useAuth } from '@/hooks/useAuth'
import { usePlan } from '@/hooks/usePlan'
import { supabase } from '@/lib/supabase'
import type { Source } from '@/components/dashboard/types'
import DataStudio from '@/components/dashboard/DataStudio'
import ServiceSettings from '@/components/dashboard/ServiceSettings'
import Inbox from '@/components/dashboard/Inbox'
import Popups from '@/components/dashboard/Popups'
import PromptStudio from '@/components/dashboard/PromptStudio'
import WidgetBuilder from '@/components/dashboard/WidgetBuilder'
import ServicesPanel from '@/components/dashboard/ServicesPanel'
import AnalyticsPanel from '@/components/dashboard/AnalyticsPanel'
import { Overview, ProvidersKeys } from '@/components/dashboard/Panels'
import {
  LayoutDashboard, Database, KeyRound, ArrowLeft, Users, CreditCard,
  Inbox as InboxIcon, Megaphone, PenLine, Paintbrush, LogOut, Zap, Loader2,
  Boxes, BarChart3,
} from 'lucide-react'

const SEED_ROWS = [
  { name: 'refund-policy.pdf', type: 'file', size: '1.2 MB', attached: ['chat', 'docqa'] },
  { name: 'https://docs.acme.com', type: 'url', size: '—', attached: ['chat', 'docqa', 'summarize'] },
  { name: 'FAQ (pasted)', type: 'text', size: '3.9 KB', attached: ['chat'] },
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
  sizeBytes: r.size_bytes ?? 0,
  filePath: r.file_path ?? undefined,
})

type View = 'overview' | 'data' | 'providers' | string

const NAV_TOP = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'services', label: 'Services', icon: Boxes },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'data', label: 'Data Studio', icon: Database },
  { id: 'widget', label: 'Widget Builder', icon: Paintbrush },
  { id: 'providers', label: 'Providers & keys', icon: KeyRound },
]

const NAV_OPS = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'popups', label: 'Engage · popups', icon: Megaphone },
  { id: 'prompt', label: 'Prompt Studio', icon: PenLine },
]

export default function Dashboard() {
  const [view, setView] = useState<View>('data')
  const [sources, setSources] = useState<Source[]>([])
  const [billingNote, setBillingNote] = useState(false)
  const { session, loading, signOut } = useAuth()
  const { plan, setPlan, services, toggleService } = usePlan(session?.user.id)
  const navigate = useNavigate()

  // auth guard — console requires an account
  useEffect(() => {
    if (!loading && !session) navigate('/login')
  }, [loading, session, navigate])

  // load sources from Supabase; seed demo data on first login
  useEffect(() => {
    if (!session) return
    const uid = session.user.id
    supabase.from('sources').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSources(data.map(rowToSource))
        } else if (data) {
          supabase.from('sources')
            .insert(SEED_ROWS.map((s) => ({ ...s, user_id: uid, status: 'indexed', chunks: 40 })))
            .select()
            .then(({ data: seeded }) => { if (seeded) setSources(seeded.map(rowToSource)) })
        }
      })
  }, [session])

  // simulate indexing finishing, and persist the flip
  useEffect(() => {
    const t = setInterval(() => {
      setSources((ss) =>
        ss.map((s) => {
          if (s.status !== 'indexing') return s
          const p = Math.min(100, s.progress + 8)
          const done = p >= 100
          if (done) {
            supabase.from('sources').update({ status: 'indexed', chunks: 40 + Math.floor(Math.random() * 20) }).eq('id', s.id).then()
          }
          return {
            ...s,
            progress: p,
            status: done ? 'indexed' : 'indexing',
            chunks: done ? s.chunks || 42 : s.chunks,
          }
        }),
      )
    }, 700)
    return () => clearInterval(t)
  }, [])

  const addSources = (items: Omit<Source, 'id' | 'addedAt' | 'status' | 'progress' | 'chunks'>[]) => {
    if (!session) return
    supabase
      .from('sources')
      .insert(
        items.map((s) => ({
          name: s.name,
          type: s.type,
          size: s.size,
          attached: s.attached,
          size_bytes: s.sizeBytes ?? 0,
          file_path: s.filePath ?? null,
          user_id: session.user.id,
          status: 'indexing',
        })),
      )
      .select()
      .then(({ data }) => {
        if (data) setSources((ss) => [...data.map(rowToSource), ...ss])
      })
  }

  const removeSource = (id: string) => {
    const victim = sources.find((s) => s.id === id)
    setSources((ss) => ss.filter((s) => s.id !== id))
    supabase.from('sources').delete().eq('id', id).then()
    if (victim?.filePath) supabase.storage.from('sources').remove([victim.filePath]).then()
  }

  const toggleAttach = (id: string, cap: string) => {
    const target = sources.find((s) => s.id === id)
    if (!target) return
    const next = target.attached.includes(cap)
      ? target.attached.filter((c) => c !== cap)
      : [...target.attached, cap]
    setSources((ss) => ss.map((s) => (s.id === id ? { ...s, attached: next } : s)))
    supabase.from('sources').update({ attached: next }).eq('id', id).then()
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    )
  }
  if (!session) return null

  const cap = capabilities.find((c) => c.id === view)
  const viewLabel =
    view === 'overview' ? 'Overview'
    : view === 'services' ? 'Services'
    : view === 'analytics' ? 'Analytics'
    : view === 'data' ? 'Data Studio'
    : view === 'providers' ? 'Providers & keys'
    : view === 'inbox' ? 'Inbox'
    : view === 'popups' ? 'Engage · popups'
    : view === 'prompt' ? 'Prompt Studio'
    : cap?.name ?? ''

  const navBtn = (active: boolean) =>
    `flex w-full items-center gap-3 px-4 py-2.5 text-left font-mono-spec text-[12px] uppercase tracking-[0.12em] transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
    }`

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="flex min-h-screen">
        {/* sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-primary bg-card md:flex">
          <Link to="/" className="flex items-center gap-2 border-b border-primary px-4 py-3.5 hover:bg-secondary">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <span className="font-serif-display text-xl font-bold">OpenMind<span className="text-accent">.</span></span>
            <span className="spec-label">console</span>
          </Link>
          <nav className="flex-1 overflow-y-auto py-3">
            <div className="px-4 pb-2 spec-label">Workspace</div>
            {NAV_TOP.map((n) => (
              <button key={n.id} onClick={() => setView(n.id)} className={navBtn(view === n.id)}>
                <n.icon className={`h-4 w-4 ${view === n.id ? 'text-accent' : ''}`} /> {n.label}
              </button>
            ))}

            <div className="px-4 pb-2 pt-5 spec-label">Live ops</div>
            {NAV_OPS.map((n) => (
              <button key={n.id} onClick={() => setView(n.id)} className={navBtn(view === n.id)}>
                <n.icon className={`h-4 w-4 ${view === n.id ? 'text-accent' : ''}`} /> {n.label}
              </button>
            ))}

            <div className="px-4 pb-2 pt-5 spec-label">Services</div>
            {capabilities.map((c) => (
              <button key={c.id} onClick={() => setView(c.id)} className={navBtn(view === c.id)}>
                <span className={`font-mono-spec text-[11px] ${view === c.id ? 'text-accent' : 'text-muted-foreground/60'}`}>
                  {c.index}
                </span>
                {c.name}
              </button>
            ))}
          </nav>
          <div className="border-t border-primary p-4">
            <div className="border border-border/60 bg-secondary/50 p-3">
              <div className="spec-label mb-1">Signed in as</div>
              <div className="truncate text-sm font-medium">{session.user.email}</div>
              <button
                onClick={signOut}
                className="mt-2 flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
              >
                <LogOut className="h-3 w-3" /> Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* main */}
        <div className="flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary bg-card px-8 py-4">
            <div>
              <div className="spec-label">Console / {viewLabel}</div>
              <h1 className="font-serif-display text-2xl font-semibold">{viewLabel}</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="border border-border/60 px-3 py-1.5 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {plan} plan
              </span>
              {plan === 'free' ? (
                <button
                  onClick={() => setBillingNote((b) => !b)}
                  className="flex items-center gap-1.5 border border-accent bg-accent px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white hover:bg-accent/85"
                >
                  <Zap className="h-3 w-3" /> Upgrade to Pro
                </button>
              ) : (
                <button
                  onClick={() => setPlan('free')}
                  className="font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
                  title="Early access — switch back anytime"
                >
                  early access · switch to free
                </button>
              )}
            </div>
          </header>

        {billingNote && (
          <div className="border-b border-primary bg-terminal px-8 py-3">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
              <Zap className="h-4 w-4 text-accent" />
              <p className="flex-1 font-mono-spec text-[11px] uppercase tracking-[0.12em] text-white/85">
                Pro will be $10/mo when billing launches — during early access it's free to activate.
              </p>
              <button
                onClick={() => { setPlan('pro'); setBillingNote(false) }}
                className="border border-accent bg-accent px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white hover:bg-accent/85"
              >
                Activate Pro free
              </button>
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
          {view === 'services' && (
            <ServicesPanel plan={plan} services={services} toggleService={toggleService} onUpgrade={() => setBillingNote(true)} />
          )}
          {view === 'analytics' && <AnalyticsPanel plan={plan} onUpgrade={() => setBillingNote(true)} />}
          {view === 'data' && (
            <DataStudio
              sources={sources}
              plan={plan}
              userId={session?.user.id}
              onUpgrade={() => setBillingNote(true)}
              addSources={addSources}
              removeSource={removeSource}
              toggleAttach={toggleAttach}
            />
          )}
          {view === 'providers' && <ProvidersKeys />}
          {view === 'widget' && <WidgetBuilder />}
          {view === 'inbox' && <Inbox />}
          {view === 'popups' && <Popups />}
          {view === 'prompt' && <PromptStudio />}
          {cap && view !== 'widget' && <ServiceSettings cap={cap} />}
        </main>

        <footer className="mx-auto flex max-w-6xl items-center gap-6 px-8 pb-8 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Users className="h-3 w-3" /> 1 seat</span>
          <span className="flex items-center gap-1.5"><CreditCard className="h-3 w-3" /> tokens billed by your provider</span>
          <span className="ml-auto">spec v2.0</span>
        </footer>
        </div>
      </div>
    </div>
  )
}
