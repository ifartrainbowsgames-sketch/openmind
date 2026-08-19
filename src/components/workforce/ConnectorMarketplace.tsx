import { useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Plug, Search, Unplug } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { createNangoSession, openNangoConnectUi } from '@/lib/nango-connect'
import {
  loadNangoConnections,
  nangoCatalog,
  nangoLogoUrl,
  NANGO_TO_OPENMIND,
  removeNangoConnection,
  searchNangoProviders,
  upsertNangoConnection,
} from '@/lib/nango'
import { upsertLiveConnection, type LiveConnectionConfig } from '@/lib/agent'
import { inputCls } from '@/components/demos/shared'

const PAGE = 60

interface Props {
  onLinked?: (configs: LiveConnectionConfig[]) => void
}

export default function ConnectorMarketplace({ onLinked }: Props) {
  const catalog = nangoCatalog()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linked, setLinked] = useState(() => loadNangoConnections())

  const matches = useMemo(() => searchNangoProviders(query, category), [query, category])
  const visible = matches.slice(0, limit)
  const connected = new Set(linked.map((c) => c.providerId))

  const connect = async (providerId: string) => {
    setError(null)
    setBusyId(providerId)
    try {
      const session = await getSession()
      const token = await createNangoSession(providerId, {
        id: session?.user.id ?? 'openmind-local',
        email: session?.user.email ?? 'openmind@local',
      })
      openNangoConnectUi(token, (event) => {
        if (event.type === 'connect') {
          const next = upsertNangoConnection({
            providerId,
            connectionId: event.connectionId,
            connectedAt: Date.now(),
          })
          setLinked(next)
          const omId = NANGO_TO_OPENMIND[providerId]
          if (omId) {
            onLinked?.(upsertLiveConnection({
              connectionId: omId,
              mode: 'mcp',
              serverUrl: `nango://${providerId}`,
              status: 'live',
              toolNames: [omId],
            }))
          }
        }
        setBusyId(null)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusyId(null)
    }
  }

  const disconnect = (providerId: string) => {
    setLinked(removeNangoConnection(providerId))
  }

  return (
    <div className="border border-border/60 bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="spec-label">Connector marketplace — Nango · {catalog.count} APIs</span>
        <span className="font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {linked.length} connected · {matches.length} shown
        </span>
      </div>
      <p className="mb-4 max-w-2xl font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
        Search the full Nango catalog and connect with a browser OAuth flow (same idea as Claude / ChatGPT).
        Tokens stay in Nango. Deploy <span className="text-foreground">nango-session</span> with
        {' '}<span className="text-foreground">NANGO_SECRET_KEY</span> to enable Connect.
      </p>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className={`${inputCls} pl-9`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }}
          placeholder="Search 900+ connectors — Gmail, Slack, HubSpot, GitHub…"
          aria-label="Search connectors"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => { setCategory('all'); setLimit(PAGE) }}
          className={`border px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${
            category === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 text-muted-foreground hover:text-accent'
          }`}
        >
          all
        </button>
        {catalog.categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => { setCategory(cat); setLimit(PAGE) }}
            className={`border px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${
              category === cat ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 text-muted-foreground hover:text-accent'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 font-mono-spec text-[11px] leading-relaxed text-red-600">{error}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((p) => {
          const on = connected.has(p.id)
          return (
            <div key={p.id} className="flex items-center gap-3 border border-border/60 bg-card/60 p-3">
              <img
                src={nangoLogoUrl(p.id)}
                alt=""
                className="h-8 w-8 shrink-0 object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif-display text-sm font-semibold leading-tight">{p.name}</div>
                <div className="truncate font-mono-spec text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  {p.categories[0] ?? 'other'} · {p.auth || 'auth'}
                </div>
              </div>
              {on ? (
                <button
                  type="button"
                  onClick={() => disconnect(p.id)}
                  className="inline-flex items-center gap-1 border border-emerald-700/50 px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-emerald-800"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  <Unplug className="h-3 w-3" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect(p.id)}
                  disabled={busyId === p.id}
                  className="inline-flex items-center gap-1 border border-primary bg-primary px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-primary-foreground disabled:opacity-40"
                >
                  {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                  Connect
                </button>
              )}
            </div>
          )
        })}
      </div>

      {visible.length < matches.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE)}
          className="mt-4 w-full border border-border/60 py-2 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-accent"
        >
          Show more · {matches.length - visible.length} remaining
        </button>
      )}
    </div>
  )
}
