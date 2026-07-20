import { useState } from 'react'
import { Megaphone, MousePointerClick, MessageSquare, Pause, Play, Plus, X } from 'lucide-react'

interface Popup {
  id: string
  name: string
  active: boolean
  url: string
  delay: number
  scroll: number
  exitIntent: boolean
  audience: 'everyone' | 'new' | 'returning'
  title: string
  body: string
  cta: string
  shown: number
  ctr: number
  chats: number
}

const SEED: Popup[] = [
  {
    id: 'p1', name: 'Pricing nudge', active: true, url: '/pricing', delay: 20, scroll: 50,
    exitIntent: true, audience: 'everyone', title: 'Questions about plans?',
    body: 'I can compare tiers for your exact use case — takes 20 seconds.', cta: 'Ask me',
    shown: 1240, ctr: 8.4, chats: 104,
  },
  {
    id: 'p2', name: 'Docs assist', active: true, url: '/docs', delay: 45, scroll: 70,
    exitIntent: false, audience: 'new', title: 'Stuck integrating?',
    body: 'Tell me your stack and I\'ll point you at the exact snippet.', cta: 'Get help',
    shown: 862, ctr: 11.2, chats: 97,
  },
  {
    id: 'p3', name: 'Exit save', active: false, url: '*', delay: 0, scroll: 0,
    exitIntent: true, audience: 'returning', title: 'Before you go —',
    body: 'Grab the self-host guide. One docker command, whole stack yours.', cta: 'Send it',
    shown: 410, ctr: 5.1, chats: 21,
  },
]

const blank: Popup = {
  id: '', name: 'New campaign', active: true, url: '/', delay: 15, scroll: 40,
  exitIntent: false, audience: 'everyone', title: 'Need a hand?',
  body: 'I can answer questions about anything on this page.', cta: 'Chat now',
  shown: 0, ctr: 0, chats: 0,
}

const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none'

export default function Popups() {
  const [popups, setPopups] = useState(SEED)
  const [selId, setSelId] = useState('p1')
  const [draft, setDraft] = useState<Popup>(SEED[0])

  const select = (id: string) => {
    setSelId(id)
    setDraft(popups.find((p) => p.id === id)!)
  }

  const save = () => {
    setPopups((ps) => ps.map((p) => (p.id === selId ? { ...draft, id: selId } : p)))
  }

  const toggleActive = (id: string) => {
    setPopups((ps) => ps.map((p) => (p.id === id ? { ...p, active: !p.active } : p)))
    if (id === selId) setDraft((d) => ({ ...d, active: !d.active }))
  }

  const create = () => {
    const id = `p${Date.now()}`
    setPopups((ps) => [...ps, { ...blank, id }])
    setSelId(id)
    setDraft({ ...blank, id })
  }

  const remove = () => {
    setPopups((ps) => ps.filter((p) => p.id !== selId))
    setSelId(popups[0]?.id ?? '')
    if (popups.length > 1) setDraft(popups.find((p) => p.id !== selId)!)
  }

  const set = <K extends keyof Popup>(k: K, v: Popup[K]) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Engage — popup messages</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Proactive messages your widget fires on your site, based on what the visitor is doing.
            Every popup opens a conversation — that's the funnel.
          </p>
        </div>
        <button
          onClick={create}
          className="flex items-center gap-2 border border-primary bg-primary px-4 py-2.5 font-mono-spec text-xs uppercase tracking-wider text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent"
        >
          <Plus className="h-3.5 w-3.5" /> New campaign
        </button>
      </div>

      {/* campaign cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {popups.map((p) => (
          <button
            key={p.id}
            onClick={() => select(p.id)}
            className={`border bg-card p-4 text-left transition-colors ${
              selId === p.id ? 'border-accent hard-shadow-sm' : 'border-primary hover:border-accent/60'
            }`}
          >
            <div className="flex items-center gap-2">
              <Megaphone className={`h-4 w-4 ${p.active ? 'text-accent' : 'text-muted-foreground/50'}`} />
              <span className="font-medium">{p.name}</span>
              <span
                onClick={(e) => { e.stopPropagation(); toggleActive(p.id) }}
                className={`ml-auto flex items-center gap-1 border px-2 py-0.5 font-mono-spec text-[9px] uppercase tracking-wider ${
                  p.active ? 'border-emerald-600/50 text-emerald-700' : 'border-border/60 text-muted-foreground'
                }`}
              >
                {p.active ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
                {p.active ? 'live' : 'paused'}
              </span>
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground">“{p.title}”</p>
            <div className="mt-3 flex gap-4 border-t border-border/40 pt-3 font-mono-spec text-[10px] text-muted-foreground">
              <span>{p.shown.toLocaleString()} shown</span>
              <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3" />{p.ctr}%</span>
              <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{p.chats}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* editor */}
        <div className="space-y-5 border border-primary bg-card p-5">
          <span className="spec-label block">Trigger rules — when it fires</span>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="spec-label mb-1.5 block">On pages containing</span>
              <input className={inputCls} value={draft.url} onChange={(e) => set('url', e.target.value)} />
            </label>
            <label className="block">
              <span className="spec-label mb-1.5 block">Audience</span>
              <select className={inputCls} value={draft.audience} onChange={(e) => set('audience', e.target.value as Popup['audience'])}>
                <option value="everyone">Everyone</option>
                <option value="new">New visitors</option>
                <option value="returning">Returning visitors</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="spec-label mb-1.5 block">After {draft.delay}s on page</span>
            <input type="range" min={0} max={120} step={5} value={draft.delay} onChange={(e) => set('delay', Number(e.target.value))} className="w-full accent-[#ff4d00]" />
          </label>
          <label className="block">
            <span className="spec-label mb-1.5 block">Or scrolled {draft.scroll}% of the page</span>
            <input type="range" min={0} max={100} step={5} value={draft.scroll} onChange={(e) => set('scroll', Number(e.target.value))} className="w-full accent-[#ff4d00]" />
          </label>
          <button
            onClick={() => set('exitIntent', !draft.exitIntent)}
            className={`flex w-full items-center justify-between border px-4 py-3 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
              draft.exitIntent ? 'border-accent bg-accent/10 text-accent' : 'border-border/60 text-muted-foreground'
            }`}
          >
            Exit-intent trigger
            <span className={`h-2.5 w-2.5 rounded-full ${draft.exitIntent ? 'bg-accent' : 'bg-border'}`} />
          </button>

          <span className="spec-label block border-t border-border/40 pt-5">Message</span>
          <label className="block">
            <span className="spec-label mb-1.5 block">Title</span>
            <input className={inputCls} value={draft.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label className="block">
            <span className="spec-label mb-1.5 block">Body</span>
            <textarea className={`${inputCls} min-h-20 resize-y`} value={draft.body} onChange={(e) => set('body', e.target.value)} />
          </label>
          <label className="block">
            <span className="spec-label mb-1.5 block">Button label</span>
            <input className={inputCls} value={draft.cta} onChange={(e) => set('cta', e.target.value)} />
          </label>

          <div className="flex gap-3">
            <button
              onClick={save}
              className="flex-1 border border-primary bg-primary px-4 py-3 font-mono-spec text-xs uppercase tracking-[0.14em] text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent"
            >
              Save campaign
            </button>
            <button
              onClick={remove}
              className="flex items-center gap-1.5 border border-border/60 px-4 font-mono-spec text-xs uppercase tracking-wider text-muted-foreground hover:border-accent hover:text-accent"
            >
              <X className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>

        {/* live preview */}
        <div className="flex flex-col border border-primary bg-card hard-shadow">
          <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
            <span className="spec-label">Preview — as your visitors see it</span>
            <span className="font-mono-spec text-[10px] text-muted-foreground">
              {draft.url === '*' ? 'any page' : draft.url} · after {draft.delay}s / {draft.scroll}%{draft.exitIntent ? ' · exit' : ''}
            </span>
          </div>
          {/* fake website */}
          <div className="relative flex-1 overflow-hidden bg-secondary/40 p-5" style={{ minHeight: 380 }}>
            <div className="mx-auto max-w-sm space-y-3 opacity-60">
              <div className="h-5 w-2/3 bg-primary/20" />
              <div className="h-3 w-full bg-primary/10" />
              <div className="h-3 w-5/6 bg-primary/10" />
              <div className="h-24 w-full border border-primary/15 bg-card" />
              <div className="h-3 w-4/6 bg-primary/10" />
              <div className="h-3 w-full bg-primary/10" />
              <div className="h-3 w-3/6 bg-primary/10" />
            </div>
            {/* the popup */}
            {draft.active && (
              <div className="absolute bottom-5 right-5 w-64 border border-primary bg-card hard-shadow">
                <div className="flex items-center justify-between bg-primary px-3 py-2">
                  <span className="font-mono-spec text-[10px] uppercase tracking-wider text-primary-foreground">
                    {draft.title}
                  </span>
                  <X className="h-3 w-3 text-primary-foreground/70" />
                </div>
                <div className="p-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">{draft.body}</p>
                  <button className="mt-3 w-full border border-accent bg-accent px-3 py-2 font-mono-spec text-[11px] uppercase tracking-wider text-white">
                    {draft.cta}
                  </button>
                </div>
              </div>
            )}
            {!draft.active && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="border border-border/60 bg-card px-4 py-2 font-mono-spec text-[11px] uppercase tracking-wider text-muted-foreground">
                  campaign paused — nothing fires
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
