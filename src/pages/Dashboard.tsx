import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { capabilities } from '@/data/capabilities'
import { useAuth } from '@/hooks/useAuth'
import { usePlan } from '@/hooks/usePlan'
import { supabase } from '@/lib/supabase'
import type { Source } from '@/components/dashboard/types'
import ParticleField from '@/components/dash-fx/ParticleField'
import DataStudio from '@/components/dashboard/DataStudio'
import ServiceSettings from '@/components/dashboard/ServiceSettings'
import Inbox from '@/components/dashboard/Inbox'
import Popups from '@/components/dashboard/Popups'
import PromptStudio from '@/components/dashboard/PromptStudio'
import WidgetBuilder from '@/components/dashboard/WidgetBuilder'
import ServicesPanel from '@/components/dashboard/ServicesPanel'
import AnalyticsPanel from '@/components/dashboard/AnalyticsPanel'
import { Overview, ProvidersKeys } from '@/components/dashboard/Panels'
import WorkforceStudio from '@/components/workforce/WorkforceStudio'
import {
  LayoutDashboard, Database, KeyRound, ArrowLeft, Users, CreditCard,
  Inbox as InboxIcon, Megaphone, PenLine, Paintbrush, LogOut, Zap, Loader2,
  Boxes, BarChart3, Bot, Menu, X, AlertTriangle,
} from 'lucide-react'

const SEED_ROWS: Pick<Source, 'name' | 'type' | 'size' | 'attached'>[] = [
  { name: 'refund-policy.pdf', type: 'file', size: '1.2 MB', attached: ['chat'] },
  { name: 'https://docs.acme.com', type: 'url', size: '—', attached: ['chat'] },
  { name: 'FAQ (pasted)', type: 'text', size: '3.9 KB', attached: ['chat'] },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowToSource = (r: any): Source => ({
  id: r.id,
  name: r.name,
  type: r.type,
  size: r.size ?? '—',
  chunks: r.chunks ?? 0,
  status: ['stored', 'indexing', 'indexed', 'error'].includes(r.status) ? r.status : 'stored',
  progress: r.status === 'indexed' ? 100 : 0,
  attached: r.attached ?? [],
  addedAt: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'just now',
  sizeBytes: r.size_bytes ?? 0,
  filePath: r.file_path ?? undefined,
  sourceUrl: r.source_url ?? undefined,
  content: r.content ?? undefined,
})

type View = 'overview' | 'data' | 'providers' | string

const NAV_TOP = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'services', label: 'Services', icon: Boxes },
  { id: 'workforce', label: 'AI Employees', icon: Bot },
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

const navBtnCls = (active: boolean) =>
  `flex w-full items-center gap-3 px-4 py-2.5 text-left font-mono-spec text-[12px] uppercase tracking-[0.12em] transition-colors ${
    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
  }`

/** Nav sections — shared by the desktop sidebar and the mobile drawer. */
function NavSections({ view, onPick }: { view: View; onPick: (id: string) => void }) {
  return (
    <>
      <div className="px-4 pb-2 spec-label">Workspace</div>
      {NAV_TOP.map((n) => (
        <button key={n.id} data-active={view === n.id} onClick={() => onPick(n.id)} className={navBtnCls(view === n.id)}>
          <n.icon className={`h-4 w-4 ${view === n.id ? 'text-accent' : ''}`} /> {n.label}
        </button>
      ))}

      <div className="px-4 pb-2 pt-5 spec-label">Ops previews</div>
      {NAV_OPS.map((n) => (
        <button key={n.id} data-active={view === n.id} onClick={() => onPick(n.id)} className={navBtnCls(view === n.id)}>
          <n.icon className={`h-4 w-4 ${view === n.id ? 'text-accent' : ''}`} /> {n.label}
        </button>
      ))}

      <div className="px-4 pb-2 pt-5 spec-label">Services</div>
      {capabilities.map((c) => (
        <button key={c.id} data-active={view === c.id} onClick={() => onPick(c.id)} className={navBtnCls(view === c.id)}>
          <span className={`font-mono-spec text-[11px] ${view === c.id ? 'text-accent' : 'text-muted-foreground/60'}`}>
            {c.index}
          </span>
          {c.name}
        </button>
      ))}
    </>
  )
}

export default function Dashboard() {
  const [view, setView] = useState<View>('data')
  const [sources, setSources] = useState<Source[]>([])
  const [billingNote, setBillingNote] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  // dash-fx: mobile drawer — 'closing' plays the exit slide before unmount
  const [drawer, setDrawer] = useState<'closed' | 'open' | 'closing'>('closed')
  const drawerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // dash-fx: sliding accent indicator for the sidebar nav (layout-aware)
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<{ top: number; height: number; on: boolean }>({ top: 0, height: 0, on: false })
  const { session, loading, signOut } = useAuth()
  const { plan, services, toggleService, error: planError } = usePlan(session?.demo ? undefined : session?.user.id)
  const navigate = useNavigate()

  const closeDrawer = () => {
    setDrawer((d) => (d === 'open' ? 'closing' : d))
    if (drawerTimer.current) clearTimeout(drawerTimer.current)
    drawerTimer.current = setTimeout(() => setDrawer('closed'), 200)
  }
  const pick = (id: string) => {
    setView(id)
    if (drawer === 'open') closeDrawer()
  }
  useEffect(() => () => { if (drawerTimer.current) clearTimeout(drawerTimer.current) }, [])

  // measure the active nav button and slide the indicator to it
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const active = nav.querySelector<HTMLElement>('[data-active="true"]')
    if (active) {
      setIndicator({ top: active.offsetTop, height: active.offsetHeight, on: true })
    } else {
      setIndicator((i) => ({ ...i, on: false }))
    }
  }, [view])

  // auth guard — console requires an account
  useEffect(() => {
    if (!loading && !session) navigate('/login')
  }, [loading, session, navigate])

  // Load persisted sources. Demo auth gets clearly marked local sample rows.
  useEffect(() => {
    if (!session) return
    if (session.demo) {
      setSources(SEED_ROWS.map((source, index) => ({
        ...source,
        id: `demo-source-${index}`,
        chunks: 0,
        status: 'stored',
        progress: 0,
        addedAt: 'sample',
        sizeBytes: 0,
      })))
      return
    }
    const uid = session.user.id
    supabase.from('sources').select('*').eq('user_id', uid).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setWorkspaceError(`Could not load sources: ${error.message}`)
          return
        }
        setSources((data ?? []).map(rowToSource))
      })
  }, [session])

  const addSources = (items: Omit<Source, 'id' | 'addedAt' | 'status' | 'progress' | 'chunks'>[]) => {
    if (!session) return
    if (session.demo) {
      setSources((current) => [
        ...items.map((source, index) => ({
          ...source,
          id: `demo-${Date.now()}-${index}`,
          addedAt: 'just now',
          status: 'stored' as const,
          progress: 0,
          chunks: 0,
        })),
        ...current,
      ])
      return
    }
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
          source_url: s.sourceUrl ?? null,
          content: s.content ?? null,
          user_id: session.user.id,
          status: 'stored',
        })),
      )
      .select()
      .then(async ({ data, error }) => {
        if (error) {
          setWorkspaceError(`Could not save source: ${error.message}`)
          const uploaded = items.map((item) => item.filePath).filter((path): path is string => Boolean(path))
          if (uploaded.length) await supabase.storage.from('sources').remove(uploaded)
          return
        }
        setWorkspaceError(null)
        if (data) setSources((ss) => [...data.map(rowToSource), ...ss])
      })
  }

  const removeSource = (id: string) => {
    const victim = sources.find((s) => s.id === id)
    setSources((ss) => ss.filter((s) => s.id !== id))
    if (session?.demo) return
    void supabase.from('sources').delete().eq('id', id).then(async ({ error }) => {
      if (error) {
        if (victim) setSources((current) => [victim, ...current])
        setWorkspaceError(`Could not remove source: ${error.message}`)
        return
      }
      if (victim?.filePath) await supabase.storage.from('sources').remove([victim.filePath])
    })
  }

  const toggleAttach = (id: string, cap: string) => {
    const target = sources.find((s) => s.id === id)
    if (!target) return
    const next = target.attached.includes(cap)
      ? target.attached.filter((c) => c !== cap)
      : [...target.attached, cap]
    setSources((ss) => ss.map((s) => (s.id === id ? { ...s, attached: next } : s)))
    if (session?.demo) return
    void supabase.from('sources').update({ attached: next }).eq('id', id).then(({ error }) => {
      if (error) {
        setSources((current) => current.map((source) => source.id === id ? target : source))
        setWorkspaceError(`Could not update source: ${error.message}`)
      }
    })
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
    : view === 'workforce' ? 'AI Employees'
    : view === 'analytics' ? 'Analytics'
    : view === 'data' ? 'Data Studio'
    : view === 'providers' ? 'Providers & keys'
    : view === 'inbox' ? 'Inbox'
    : view === 'popups' ? 'Engage · popups'
    : view === 'prompt' ? 'Prompt Studio'
    : cap?.name ?? ''

  return (
    <div className="min-h-screen bg-secondary/30 vt-page">
      <div className="flex min-h-screen">
        {/* sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-primary bg-card md:flex">
          <Link to="/" className="flex items-center gap-2 border-b border-primary px-4 py-3.5 hover:bg-secondary">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <span className="font-serif-display text-xl font-bold">OpenMind<span className="text-accent">.</span></span>
            <span className="spec-label">console</span>
          </Link>
          <nav ref={navRef} data-lenis-prevent className="relative flex-1 overflow-y-auto py-3">
            {/* dash-fx: sliding active indicator */}
            <span
              aria-hidden="true"
              className="dash-nav-indicator absolute left-0 top-0 w-[3px] bg-accent"
              style={{
                transform: `translateY(${indicator.top}px)`,
                height: indicator.height,
                opacity: indicator.on ? 1 : 0,
              }}
            />
            <NavSections view={view} onPick={setView} />
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
        <div className="min-w-0 flex-1">
          <header className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden border-b border-primary bg-card px-4 py-4 md:px-8">
            {/* dash-fx: ambient particle network — decorative, lazy, pointer-events-none */}
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-64 sm:block" aria-hidden="true">
              <ParticleField className="h-full w-full opacity-70" />
            </div>
            <div className="relative z-10 flex items-center gap-3">
              <button
                onClick={() => setDrawer('open')}
                className="dash-press -ml-1 border border-border/60 p-2 text-muted-foreground hover:text-foreground md:hidden"
                aria-label="Open console navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div>
                <div className="spec-label">Console / {viewLabel}</div>
                <h1 key={view} className="dash-feed-in font-serif-display text-2xl font-semibold">{viewLabel}</h1>
              </div>
            </div>
            <div className="relative z-10 flex items-center gap-3">
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
                <span className="font-mono-spec text-[10px] uppercase tracking-[0.14em] text-emerald-700">
                  billing managed
                </span>
              )}
            </div>
          </header>

        {billingNote && (
          <div className="border-b border-primary bg-terminal px-8 py-3">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
              <Zap className="h-4 w-4 text-accent" />
              <p className="flex-1 font-mono-spec text-[11px] uppercase tracking-[0.12em] text-white/85">
                Pro will be $10/mo when billing launches. Plan changes are server-controlled so they cannot be forged in the browser.
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

        <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 md:px-8">
          {(workspaceError || planError) && (
            <div role="alert" className="mb-5 flex items-start gap-2 border border-red-600 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {workspaceError || planError}
            </div>
          )}
          {/* dash-fx: keyed pane — crossfade+rise whenever the view switches */}
          <div key={view} className="dash-view-enter">
          {view === 'overview' && <Overview sources={sources} />}
          {view === 'services' && (
            <ServicesPanel plan={plan} services={services} toggleService={toggleService} onUpgrade={() => setBillingNote(true)} />
          )}
          {view === 'workforce' && <WorkforceStudio embedded />}
          {view === 'analytics' && <AnalyticsPanel plan={plan} onUpgrade={() => setBillingNote(true)} />}
          {view === 'data' && (
            <DataStudio
              sources={sources}
              plan={plan}
              userId={session?.user.id}
              demo={session.demo}
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
          {cap && view !== 'widget' && <ServiceSettings cap={cap} sources={sources} />}
          </div>
        </main>

        <footer className="mx-auto flex max-w-6xl items-center gap-6 px-8 pb-8 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Users className="h-3 w-3" /> 1 seat</span>
          <span className="flex items-center gap-1.5"><CreditCard className="h-3 w-3" /> tokens billed by your provider</span>
          <span className="ml-auto">spec v2.0</span>
        </footer>
        </div>
      </div>

      {/* dash-fx: mobile drawer — slide-in nav + fading scrim (phones manage from here) */}
      {drawer !== 'closed' && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Console navigation">
          <button
            aria-label="Close navigation"
            onClick={closeDrawer}
            className={`dash-scrim absolute inset-0 h-full w-full cursor-default bg-[#171310]/50 ${drawer === 'closing' ? 'dash-closing' : ''}`}
          />
          <div className={`dash-drawer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-primary bg-card ${drawer === 'closing' ? 'dash-closing' : ''}`}>
            <div className="flex items-center justify-between border-b border-primary px-4 py-3.5">
              <span className="font-serif-display text-xl font-bold">OpenMind<span className="text-accent">.</span> <span className="spec-label">console</span></span>
              <button onClick={closeDrawer} className="dash-press p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav data-lenis-prevent className="flex-1 overflow-y-auto py-3">
              <NavSections view={view} onPick={pick} />
            </nav>
            <div className="border-t border-primary p-4">
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
        </div>
      )}
    </div>
  )
}
