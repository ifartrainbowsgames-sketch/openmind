import type { Source } from './types'
import { KeyRound, Lock } from 'lucide-react'

// ── Overview ─────────────────────────────────────────────────────────────────

const REQUESTS = [42, 18, 9, 12, 7, 15, 22, 6, 11, 8]
const REQUEST_HOURS = ['00', '03', '06', '09', '12', '15', '18', '21', '22', '23']
const ACTIVITY = [
  ['09:41', 'chat', '2,104 requests · openai/gpt-4o-mini', '✓'],
  ['09:38', 'chat', 'knowledge base re-indexed · 412 chunks', '✓'],
  ['09:12', 'chat', 'widget published to acme.com · anthropic/claude-4', '✓'],
  ['08:57', 'chat', 'rate limit 80% — gateway queue enabled', '!'],
  ['08:30', 'chat', 'greeting updated · “Hi! How can I help?”', '✓'],
]

export function Overview({ sources }: { sources: Source[] }) {
  const stats = [
    ['Requests today', '12,481', '+18% vs yesterday'],
    ['Active keys', '4', '2 browser · 2 vault'],
    ['Sources indexed', String(sources.filter((s) => s.status === 'indexed').length), `${sources.length} total`],
    ['Error rate', '0.4%', 'all providers'],
  ]
  const max = Math.max(...REQUESTS)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif-display text-3xl font-semibold">Overview</h2>
        <span className="border border-amber-600 px-2 py-1 font-mono-spec text-[9px] uppercase tracking-wider text-amber-700">
          preview · sample metrics
        </span>
      </div>

      <div className="grid grid-cols-2 border-l border-t border-primary lg:grid-cols-4">
        {stats.map(([k, v, note]) => (
          <div key={k} className="border-b border-r border-primary bg-card p-5">
            <div className="spec-label">{k}</div>
            <div className="mt-2 font-serif-display text-4xl font-semibold">{v}</div>
            <div className="mt-1 font-mono-spec text-[11px] text-muted-foreground">{note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        {/* chatbot requests by hour */}
        <div className="border border-primary bg-card p-5 hard-shadow">
          <span className="spec-label mb-5 block">Chatbot requests by hour — last 24h</span>
          <div className="flex items-end gap-2">
            {REQUESTS.map((v, i) => (
              <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1.5">
                <span className="font-mono-spec text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {v}k
                </span>
                <div
                  className="w-full border border-primary bg-primary transition-colors group-hover:bg-accent group-hover:border-accent"
                  style={{ height: `${Math.round((v / max) * 120)}px` }}
                />
                <span className="font-mono-spec text-[9px] uppercase text-muted-foreground">
                  {REQUEST_HOURS[i]}h
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* activity */}
        <div className="border border-primary bg-card">
          <div className="border-b border-primary px-5 py-2.5">
            <span className="spec-label">Activity</span>
          </div>
          {ACTIVITY.map(([t, cap, msg, mark]) => (
            <div key={t + cap} className="flex items-baseline gap-3 border-b border-border/40 px-5 py-3 last:border-b-0">
              <span className="font-mono-spec text-[11px] text-muted-foreground">{t}</span>
              <span className="font-mono-spec text-[11px] uppercase tracking-wider text-accent">{cap}</span>
              <span className="flex-1 text-xs text-muted-foreground">{msg}</span>
              <span className={mark === '✓' ? 'text-emerald-600' : 'text-amber-600'}>{mark}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Providers & Keys ─────────────────────────────────────────────────────────

export function ProvidersKeys() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Providers & keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The encrypted provider vault is not connected in this build. Do not paste production keys here.
        </p>
      </div>

      <div className="border border-primary bg-card p-5">
        <span className="spec-label mb-3 block">Server-managed vault</span>
        <div className="flex items-start gap-3 border border-amber-600/60 bg-amber-50 p-4 text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm">
            Coming after the backend key-management service is deployed. AI Employee provider keys remain memory-only
            for the current tab; connection credentials are session-only.
          </p>
        </div>
      </div>

      <div className="border border-primary bg-card hard-shadow">
        <div className="border-b border-primary px-5 py-2.5">
          <span className="spec-label">Connected providers</span>
        </div>
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <KeyRound className="h-4 w-4" /> No server-managed provider keys connected.
        </div>
      </div>
    </div>
  )
}
