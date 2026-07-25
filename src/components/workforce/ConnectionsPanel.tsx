// Customer-facing app connections. Technical transports stay inside the
// optional manual setup area.
import { useEffect, useState, type CSSProperties } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Link2, Loader2,
  LockKeyhole, Plug, Search, Sparkles, Unplug,
} from 'lucide-react'
import {
  CONNECTIONS, MCP_PRESETS, probeConnection, removeLiveConnection, upsertLiveConnection,
  type LiveConnectionConfig,
} from '@/lib/agent'
import { inputCls } from '@/components/demos/shared'
import { disconnectConnectorInstallation, startConnectorInstall } from '@/lib/oauth-connections'

interface Props {
  configs: LiveConnectionConfig[]
  onChange: (configs: LiveConnectionConfig[]) => void
  loadError?: string | null
}

interface FormState {
  open: boolean
  mode: 'mcp' | 'webhook'
  url: string
  token: string
  agentId: string
  subdomain: string
  email: string
  apiToken: string
  probing: boolean
  installing: boolean
  formError?: string
}

const EMPTY_FORM: FormState = {
  open: false,
  mode: 'mcp',
  url: '',
  token: '',
  agentId: '',
  subdomain: '',
  email: '',
  apiToken: '',
  probing: false,
  installing: false,
}

export type MarketplaceStatus = 'live' | 'ready' | 'error' | 'mock'

export function connStatus(configs: LiveConnectionConfig[], id: string): MarketplaceStatus {
  const cfg = configs.find((c) => c.connectionId === id)
  if (!cfg) return 'mock'
  if (cfg.status === 'live') return 'live'
  if (cfg.status === 'ready') return 'ready'
  if (cfg.status === 'error') return 'error'
  return 'mock'
}

export function StatusChip({ status }: { status: MarketplaceStatus }) {
  const cls =
    status === 'live'
      ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
      : status === 'ready'
      ? 'border-sky-700 bg-sky-50 text-sky-800'
      : status === 'error'
      ? 'border-red-600 bg-red-50 text-red-700'
      : 'border-amber-600 bg-amber-50 text-amber-800'
  const dot =
    status === 'live' ? 'bg-emerald-600'
    : status === 'ready' ? 'bg-sky-600'
    : status === 'error' ? 'bg-red-500'
    : 'bg-amber-500'
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${cls}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot} ${status === 'live' ? 'pulse-dot' : ''}`} />
      {status === 'live' || status === 'ready'
        ? 'connected'
        : status === 'error'
        ? 'needs attention'
        : 'not connected'}
    </span>
  )
}

export default function ConnectionsPanel({ configs, onChange, loadError }: Props) {
  const [forms, setForms] = useState<Record<string, FormState>>({})
  const [query, setQuery] = useState('')
  const [oauthNotice] = useState(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const status = params.get('oauthStatus')
    if (!status) return null
    return {
      status,
      plugin: params.get('oauth'),
      reason: params.get('reason'),
    }
  })

  const form = (id: string): FormState => forms[id] ?? EMPTY_FORM
  const patch = (id: string, p: Partial<FormState>) =>
    setForms((f) => ({ ...f, [id]: { ...EMPTY_FORM, ...f[id], ...p } }))

  const connectedCount = configs.filter((c) => c.status === 'live' || c.status === 'ready').length
  const plugins = Object.values(CONNECTIONS)
    .filter((conn) => `${conn.name} ${conn.desc} ${conn.category}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name))

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
        authSource: 'manual',
        status: 'untested',
      }
    }
    if (f.mode === 'webhook') {
      const url = f.url.trim()
      if (!url) {
        return {
          error: id === 'openclaw'
            ? 'Paste the public OpenClaw endpoint ending in /hooks/agent.'
            : 'Paste the production webhook URL from your n8n workflow.',
        }
      }
      if (id === 'openclaw' && !f.token.trim()) return { error: 'OpenClaw requires its hooks token.' }
      return {
        connectionId: id,
        mode: 'webhook',
        serverUrl: url,
        token: f.token.trim() || undefined,
        authSource: 'manual',
        status: 'untested',
        ...(id === 'openclaw' && f.agentId.trim() ? { options: { agentId: f.agentId.trim() } } : {}),
      }
    }
    const url = f.url.trim() || preset.serverUrl || ''
    if (!url) return { error: 'Paste the MCP server URL from your aggregator (Composio / Zapier / Klavis).' }
    return {
      connectionId: id,
      mode: 'mcp',
      serverUrl: url,
      token: f.token.trim() || undefined,
      authSource: 'manual',
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

  const install = async (id: string) => {
    patch(id, { installing: true, formError: undefined })
    try {
      await startConnectorInstall(id)
    } catch (error) {
      patch(id, {
        installing: false,
        formError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const disconnect = async (id: string) => {
    const cfg = configs.find((config) => config.connectionId === id)
    try {
      if (cfg?.installationId) await disconnectConnectorInstallation(cfg.installationId)
      onChange(removeLiveConnection(id))
      patch(id, { formError: undefined })
    } catch (error) {
      patch(id, { formError: error instanceof Error ? error.message : String(error) })
    }
  }

  useEffect(() => {
    if (!oauthNotice || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.delete('oauth')
    url.searchParams.delete('oauthStatus')
    url.searchParams.delete('reason')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [oauthNotice])

  return (
    <div className="border border-border/60 bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="spec-label flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5" /> Apps
        </span>
        <span className="font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {connectedCount} connected · {Object.keys(CONNECTIONS).length} available
        </span>
      </div>
      <p className="mb-4 max-w-2xl font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
        Connect the tools your business already uses. Secure sign-in opens on the provider's website when available.
      </p>

      {oauthNotice && (
        <div className={`mb-4 flex items-start gap-2 border px-3 py-2.5 text-sm ${
          oauthNotice.status === 'connected'
            ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
            : 'border-red-600 bg-red-50 text-red-700'
        }`}>
          {oauthNotice.status === 'connected'
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {oauthNotice.status === 'connected'
              ? `${CONNECTIONS[oauthNotice.plugin ?? '']?.name ?? 'App'} is connected.`
              : `Connection failed${oauthNotice.reason ? ` (${oauthNotice.reason.replace(/_/g, ' ')})` : ''}.`}
          </span>
        </div>
      )}
      {loadError && (
        <p className="mb-4 flex items-start gap-2 border border-amber-600 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {loadError}
        </p>
      )}

      <label className="mb-4 flex max-w-md items-center gap-2 border border-border/60 bg-background px-3">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="sr-only">Search connection plugins</span>
        <input
          className="min-w-0 flex-1 bg-transparent py-2 font-mono-spec text-[11px] outline-none placeholder:text-muted-foreground/60"
          placeholder="Search plugins, categories, or capabilities…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        {plugins.map((conn, ci) => {
          const preset = MCP_PRESETS[conn.id]
          const cfg = configs.find((c) => c.connectionId === conn.id)
          const status = connStatus(configs, conn.id)
          const f = form(conn.id)
          return (
            <div
              key={conn.id}
              className={`dash-cascade border bg-card/60 p-3.5 ${conn.featured ? 'border-primary/70' : 'border-border/60'}`}
              style={{ '--dash-i': ci } as CSSProperties}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-serif-display text-base font-semibold">{conn.name}</span>
                  <span className="ml-2 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    {conn.category}
                  </span>
                  {conn.badge && (
                    <span className="ml-2 inline-flex items-center gap-1 border border-primary/50 px-1.5 py-0.5 font-mono-spec text-[8px] uppercase tracking-[0.12em] text-primary">
                      <Sparkles className="h-2.5 w-2.5" /> {conn.badge}
                    </span>
                  )}
                </div>
                <StatusChip status={status} />
              </div>
              <p className="mt-1 font-mono-spec text-[10px] leading-relaxed text-muted-foreground">{conn.desc}</p>
              {status === 'live' && (
                <p className="mt-1.5 flex items-center gap-1.5 font-mono-spec text-[10px] text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" /> Ready to use
                </p>
              )}
              {status === 'ready' && (
                <p className="mt-1.5 flex items-center gap-1.5 font-mono-spec text-[10px] text-sky-700">
                  <CheckCircle2 className="h-3 w-3" />
                  {cfg?.authSource === 'oauth'
                    ? 'Finishing connection check'
                    : 'Saved and ready to use'}
                </p>
              )}
              {status === 'error' && cfg?.lastError && (
                <p className="mt-1.5 flex items-start gap-1.5 font-mono-spec text-[10px] leading-relaxed text-red-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {cfg.lastError}
                </p>
              )}

              {conn.auth === 'oauth' && (
                <div className="mt-2.5 border border-emerald-700/40 bg-emerald-50/60 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void install(conn.id)}
                      disabled={f.installing}
                      className="inline-flex items-center gap-2 border border-emerald-800 bg-emerald-800 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {f.installing
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <LockKeyhole className="h-3 w-3" />}
                      {f.installing
                        ? 'Opening authorization…'
                        : cfg?.authSource === 'oauth' ? 'Reauthorize' : 'Install'}
                    </button>
                    {cfg?.authSource === 'oauth' && (
                      <button
                        onClick={() => void disconnect(conn.id)}
                        className="inline-flex items-center gap-1.5 border border-border/60 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-red-600 hover:text-red-600"
                      >
                        <Unplug className="h-3 w-3" /> Disconnect
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 font-mono-spec text-[9px] leading-relaxed text-emerald-900/75">
                    {cfg?.authSource === 'oauth'
                      ? `Connected securely${cfg.accountLabel ? ` as ${cfg.accountLabel}` : ''}`
                      : 'Sign in on the provider website to connect'}
                  </p>
                  {f.formError && (
                    <p className="mt-1.5 flex items-start gap-1.5 font-mono-spec text-[10px] text-red-600">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {f.formError}
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={() =>
                  patch(conn.id, {
                    open: !f.open,
                    // prefill from the saved config, else the preset's first-party URL
                    url: f.url || cfg?.serverUrl || preset?.serverUrl || '',
                    mode:
                      cfg?.mode === 'webhook' || cfg?.mode === 'mcp'
                        ? cfg.mode
                        : preset?.mode === 'webhook' ? 'webhook' : 'mcp',
                    agentId: f.agentId || cfg?.options?.agentId || '',
                  })
                }
                className="mt-2 flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
              >
                {f.open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {conn.auth === 'oauth'
                  ? f.open ? 'Hide manual setup' : 'Set up manually'
                  : status === 'mock' ? 'Set up' : 'Edit connection'}
              </button>

              {f.open && preset && (
                <div className="mt-2.5 space-y-2 border-t border-border/40 pt-2.5 animate-stamp">
                  {preset.supportedModes && preset.supportedModes.length > 1 && (
                    <div>
                      <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                        Connection method
                      </span>
                      <div className="inline-grid grid-cols-2 border border-border/60">
                        {preset.supportedModes.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => patch(conn.id, { mode })}
                            className={`px-3 py-1.5 font-mono-spec text-[9px] uppercase tracking-[0.13em] ${
                              f.mode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            {mode === 'mcp' ? 'MCP server' : 'Workflow webhook'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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
                        <input className={inputCls} type="password" placeholder="API token — session only" value={f.apiToken}
                          onChange={(e) => patch(conn.id, { apiToken: e.target.value })} />
                      </label>
                    </>
                  ) : f.mode === 'webhook' ? (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                          {conn.id === 'openclaw' ? 'OpenClaw /hooks/agent URL' : 'Production workflow webhook URL'}
                        </span>
                        <input
                          className={inputCls}
                          placeholder={
                            conn.id === 'openclaw'
                              ? 'https://claw.example.com/hooks/agent'
                              : 'https://n8n.example.com/webhook/openmind'
                          }
                          value={f.url}
                          onChange={(e) => patch(conn.id, { url: e.target.value })}
                        />
                      </label>
                      {conn.id === 'openclaw' && (
                        <label className="block">
                          <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                            Agent ID (optional; must be allowed by the gateway)
                          </span>
                          <input
                            className={inputCls}
                            placeholder="operations"
                            value={f.agentId}
                            onChange={(e) => patch(conn.id, { agentId: e.target.value })}
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-1 block font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                          {preset.tokenLabel}
                        </span>
                        <input
                          className={inputCls}
                          type="password"
                          placeholder={conn.id === 'openclaw' ? 'Hooks token — session only' : 'Optional bearer token — session only'}
                          value={f.token}
                          onChange={(e) => patch(conn.id, { token: e.target.value })}
                        />
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
                        <input className={inputCls} type="password" placeholder="Token / key — session only" value={f.token}
                          onChange={(e) => patch(conn.id, { token: e.target.value })} />
                      </label>
                    </>
                  )}
                  <p className="font-mono-spec text-[9px] leading-relaxed text-muted-foreground/80">{preset.note}</p>
                  {conn.docsUrl && (
                    <a
                      href={conn.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-accent"
                    >
                      Setup guide <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
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
                      {f.probing ? 'Checking…' : f.mode === 'webhook' ? 'Save webhook' : 'Test connection'}
                    </button>
                    {cfg && (
                      <button
                        onClick={() => void disconnect(conn.id)}
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
