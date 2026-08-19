// Connections panel — upgrade any of the 11 app connections from MOCK to LIVE.
// Every connection ships as a canned-data mock (honestly stamped); pasting real
// MCP/REST credentials + a successful probe flips it to LIVE with the real
// tool count. "Mock data until you connect — no fake integrations."
import { useState, type CSSProperties } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Link2, Loader2, Plug, Unplug,
} from 'lucide-react'
import {
  CONNECTIONS, MCP_PRESETS, probeConnection, removeLiveConnection, upsertLiveConnection,
  type LiveConnectionConfig,
} from '@/lib/agent'
import { inputCls } from '@/components/demos/shared'

interface Props {
  configs: LiveConnectionConfig[]
  onChange: (configs: LiveConnectionConfig[]) => void
}

interface FormState {
  open: boolean
  url: string
  token: string
  subdomain: string
  email: string
  apiToken: string
  probing: boolean
  formError?: string
}

const EMPTY_FORM: FormState = { open: false, url: '', token: '', subdomain: '', email: '', apiToken: '', probing: false }

export function connStatus(configs: LiveConnectionConfig[], id: string): 'live' | 'error' | 'mock' {
  const cfg = configs.find((c) => c.connectionId === id)
  if (!cfg) return 'mock'
  if (cfg.status === 'live') return 'live'
  if (cfg.status === 'error') return 'error'
  return 'mock'
}

export function StatusChip({ status }: { status: 'live' | 'error' | 'mock' }) {
  const cls =
    status === 'live'
      ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
      : status === 'error'
      ? 'border-red-600 bg-red-50 text-red-700'
      : 'border-amber-600 bg-amber-50 text-amber-800'
  const dot = status === 'live' ? 'bg-emerald-600' : status === 'error' ? 'bg-red-500' : 'bg-amber-500'
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${cls}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot} ${status === 'live' ? 'pulse-dot' : ''}`} />
      {status}
    </span>
  )
}

export default function ConnectionsPanel({ configs, onChange }: Props) {
  const [forms, setForms] = useState<Record<string, FormState>>({})

  const form = (id: string): FormState => forms[id] ?? EMPTY_FORM
  const patch = (id: string, p: Partial<FormState>) =>
    setForms((f) => ({ ...f, [id]: { ...EMPTY_FORM, ...f[id], ...p } }))

  const liveCount = configs.filter((c) => c.status === 'live').length

  const buildConfig = (id: string): LiveConnectionConfig | { error: string } => {
    const preset = MCP_PRESETS[id]
    const f = form(id)
    if (!preset) return { error: `No setup recipe for ${id}.` }
    if (preset.mode === 'rest') {
      const sub = f.subdomain.trim().replace(/\.zendesk\.com.*$/i, '')
      if (!sub) return { error: 'Enter your Zendesk subdomain (the "acme" in acme.zendesk.com).' }
      if (!f.email.trim() || !f.apiToken.trim()) return { error: 'Zendesk needs both the account email and an API token.' }
      return {
        connectionId: id,
        mode: 'rest',
        serverUrl: `https://${sub}.zendesk.com`,
        token: `${f.email.trim()}/token:${f.apiToken.trim()}`,
        status: 'untested',
      }
    }
    const url = f.url.trim() || preset.serverUrl || ''
    if (!url) return { error: 'Paste the MCP server URL from your aggregator (Composio / Zapier / Klavis).' }
    return {
      connectionId: id,
      mode: 'mcp',
      serverUrl: url,
      token: f.token.trim() || undefined,
      status: 'untested',
    }
  }

  const test = async (id: string) => {
    const built = buildConfig(id)
    if ('error' in built) {
      patch(id, { formError: built.error })
      return
    }
    patch(id, { probing: true, formError: undefined })
    try {
      const result = await probeConnection(built)
      onChange(upsertLiveConnection(result))
    } finally {
      patch(id, { probing: false })
    }
  }

  const disconnect = (id: string) => {
    onChange(removeLiveConnection(id))
    patch(id, { formError: undefined })
  }

  return (
    <div className="border border-border/60 bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="spec-label flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5" /> Advanced MCP / REST
        </span>
        <span className="font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {liveCount} live · {Object.keys(CONNECTIONS).length} total
        </span>
      </div>
      <p className="mb-4 max-w-2xl font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
        Advanced — paste an MCP URL or Zendesk token if you are not using the Nango marketplace above.
        Mock data until you connect. Tokens stay in this browser.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {Object.values(CONNECTIONS).map((conn, ci) => {
          const preset = MCP_PRESETS[conn.id]
          const cfg = configs.find((c) => c.connectionId === conn.id)
          const status = connStatus(configs, conn.id)
          const f = form(conn.id)
          return (
            <div key={conn.id} className="dash-cascade border border-border/60 bg-card/60 p-3.5" style={{ '--dash-i': ci } as CSSProperties}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-serif-display text-base font-semibold">{conn.name}</span>
                  <span className="ml-2 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    {conn.category}
                  </span>
                </div>
                <StatusChip status={status} />
              </div>
              <p className="mt-1 font-mono-spec text-[10px] leading-relaxed text-muted-foreground">{conn.desc}</p>

              {status === 'live' && (
                <p className="mt-1.5 flex items-center gap-1.5 font-mono-spec text-[10px] text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" /> {cfg?.toolNames?.length ?? 0} tools live
                </p>
              )}
              {status === 'error' && cfg?.lastError && (
                <p className="mt-1.5 flex items-start gap-1.5 font-mono-spec text-[10px] leading-relaxed text-red-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {cfg.lastError}
                </p>
              )}

              <button
                onClick={() =>
                  patch(conn.id, {
                    open: !f.open,
                    // prefill from the saved config, else the preset's first-party URL
                    url: f.url || cfg?.serverUrl || preset?.serverUrl || '',
                  })
                }
                className="mt-2 flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
              >
                {f.open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {status === 'mock' ? 'Set up live connection' : 'Edit credentials'}
              </button>

              {f.open && preset && (
                <div className="mt-2.5 space-y-2 border-t border-border/40 pt-2.5 animate-stamp">
                  {preset.mode === 'rest' ? (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Zendesk subdomain</span>
                        <input className={inputCls} placeholder="acme — for acme.zendesk.com" value={f.subdomain}
                          onChange={(e) => patch(conn.id, { subdomain: e.target.value })} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Account email</span>
                        <input className={inputCls} type="email" placeholder="you@company.com" value={f.email}
                          onChange={(e) => patch(conn.id, { email: e.target.value })} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Zendesk API token</span>
                        <input className={inputCls} type="password" placeholder="API token — stays in this browser" value={f.apiToken}
                          onChange={(e) => patch(conn.id, { apiToken: e.target.value })} />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                          MCP server URL{preset.mode === 'aggregator' ? ' (from your aggregator)' : ''}
                        </span>
                        <input className={inputCls} placeholder={preset.serverUrl ?? 'https://your-aggregator.example/mcp'}
                          value={f.url}
                          onChange={(e) => patch(conn.id, { url: e.target.value })} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{preset.tokenLabel}</span>
                        <input className={inputCls} type="password" placeholder="Token / key — stays in this browser" value={f.token}
                          onChange={(e) => patch(conn.id, { token: e.target.value })} />
                      </label>
                    </>
                  )}
                  <p className="font-mono-spec text-[9px] leading-relaxed text-muted-foreground/80">{preset.note}</p>
                  {f.formError && (
                    <p className="flex items-start gap-1.5 font-mono-spec text-[10px] text-red-600">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {f.formError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      onClick={() => test(conn.id)}
                      disabled={f.probing}
                      className="inline-flex items-center gap-2 border border-primary bg-primary px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-primary-foreground transition-colors hover:border-accent hover:bg-accent disabled:opacity-40"
                    >
                      {f.probing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                      {f.probing ? 'Testing…' : 'Test connection'}
                    </button>
                    {cfg && (
                      <button
                        onClick={() => disconnect(conn.id)}
                        className="inline-flex items-center gap-2 border border-border/60 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-red-600 hover:text-red-600"
                      >
                        <Unplug className="h-3 w-3" /> Disconnect
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
