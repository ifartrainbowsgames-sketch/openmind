import { useState } from 'react'
import { capabilities, providers } from '@/data/capabilities'
import type { Source } from './types'
import { Check, Plus, KeyRound } from 'lucide-react'

// ── Overview ─────────────────────────────────────────────────────────────────

const REQUESTS = [42, 18, 9, 12, 7, 15, 22, 6, 11, 8]
const ACTIVITY = [
  ['09:41', 'chat', '2,104 requests · openai/gpt-4o-mini', '✓'],
  ['09:38', 'docqa', 'knowledge base re-indexed · 412 chunks', '✓'],
  ['09:12', 'image', 'batch render · 38 images · together/flux.1', '✓'],
  ['08:57', 'stt', 'rate limit 80% — groq/whisper-v3', '!'],
  ['08:30', 'translate', 'glossary updated · 214 terms', '✓'],
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
      <h2 className="font-serif-display text-3xl font-semibold">Overview</h2>

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
        {/* requests by capability */}
        <div className="border border-primary bg-card p-5 hard-shadow">
          <span className="spec-label mb-5 block">Requests by capability — last 24h</span>
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
                  {capabilities[i].id.slice(0, 4)}
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

interface Connected { name: string; masked: string; mode: 'browser' | 'vault' }

export function ProvidersKeys() {
  const [connected, setConnected] = useState<Connected[]>([
    { name: 'OpenAI', masked: 'sk-…9f2a', mode: 'vault' },
    { name: 'Ollama', masked: 'localhost:11434', mode: 'browser' },
  ])
  const [sel, setSel] = useState(providers[0].name)
  const [key, setKey] = useState('')

  const connect = () => {
    if (!key.trim()) return
    setConnected((c) => [...c, { name: sel, masked: key.slice(0, 3) + '…' + key.slice(-4), mode: 'vault' }])
    setKey('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Providers & keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keys are used only to authenticate with <em>your</em> provider. Vault keys are AES-256
          encrypted; browser keys never touch our servers.
        </p>
      </div>

      <div className="border border-primary bg-card p-5">
        <span className="spec-label mb-3 block">Connect a provider</span>
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            className="border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none"
            value={sel}
            onChange={(e) => setSel(e.target.value)}
          >
            {providers.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
          <input
            className="flex-1 border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none"
            type="password"
            placeholder="API key or endpoint URL"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            onClick={connect}
            className="flex items-center justify-center gap-2 border border-primary bg-primary px-5 py-2.5 font-mono-spec text-xs uppercase tracking-wider text-primary-foreground hover:bg-accent hover:border-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Connect
          </button>
        </div>
      </div>

      <div className="border border-primary bg-card hard-shadow">
        <div className="border-b border-primary px-5 py-2.5">
          <span className="spec-label">Connected</span>
        </div>
        {connected.map((c) => (
          <div key={c.name + c.masked} className="flex items-center gap-4 border-b border-border/40 px-5 py-3.5 last:border-b-0">
            <KeyRound className="h-4 w-4 text-accent" />
            <span className="font-medium">{c.name}</span>
            <span className="font-mono-spec text-xs text-muted-foreground">{c.masked}</span>
            <span className="ml-auto border border-border/60 px-2 py-0.5 font-mono-spec text-[10px] uppercase tracking-wider text-muted-foreground">
              {c.mode}
            </span>
            <span className="flex items-center gap-1 font-mono-spec text-[10px] uppercase tracking-wider text-emerald-700">
              <Check className="h-3 w-3" /> active
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
