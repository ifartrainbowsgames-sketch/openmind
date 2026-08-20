import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronDown, Github, HardDrive, Hash, Loader2, Mail, Plug, Unplug, X } from 'lucide-react'
import { probeConnection, upsertLiveConnection } from '@/lib/agent'
import {
  CUSTOMER_APPS,
  connectProvider,
  customerConnectError,
  disconnectProvider,
} from '@/lib/nango-connect'
import { loadNangoConnections, nangoLinked } from '@/lib/nango'

function AppIcon({ id }: { id: string }) {
  if (id === 'github') return <Github className="h-4 w-4" />
  if (id === 'slack') return <Hash className="h-4 w-4" />
  if (id === 'gmail') return <Mail className="h-4 w-4" />
  return <HardDrive className="h-4 w-4" />
}

export default function ConnectAppsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [linked, setLinked] = useState(() => loadNangoConnections())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpToken, setMcpToken] = useState('')
  const [mcpTarget, setMcpTarget] = useState<'github' | 'slack' | 'gmail' | 'gdrive'>('github')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNote, setMcpNote] = useState<string | null>(null)

  if (!open) return null

  const connect = async (providerId: string) => {
    setError(null)
    setBusyId(providerId)
    try {
      await connectProvider(providerId, (event) => {
        if (event.type === 'connect') setLinked(loadNangoConnections())
        setBusyId(null)
      })
    } catch (err) {
      const msg = customerConnectError(err)
      if (/sign in/i.test(err instanceof Error ? err.message : msg)) {
        navigate(`/login?next=${encodeURIComponent('/app')}`)
        return
      }
      setError(msg)
      setBusyId(null)
    }
  }

  const disconnect = (providerId: string) => {
    setLinked(disconnectProvider(providerId))
  }

  const saveAdvanced = async () => {
    const url = mcpUrl.trim()
    if (!url) {
      setMcpNote('Paste a server URL first.')
      return
    }
    setMcpBusy(true)
    setMcpNote(null)
    try {
      const result = await probeConnection({
        connectionId: mcpTarget,
        mode: 'mcp',
        serverUrl: url,
        token: mcpToken.trim() || undefined,
        status: 'untested',
      })
      upsertLiveConnection(result)
      setMcpNote(result.status === 'live' ? 'Connected.' : result.lastError ?? 'Couldn’t verify. Check the URL.')
    } catch (err) {
      setMcpNote(customerConnectError(err))
    } finally {
      setMcpBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Connect apps">
      <button className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-label="Close connect apps" />
      <div className="mobile-sheet-in relative z-10 w-full rounded-t-[28px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl lg:max-w-md lg:rounded-[24px] lg:p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 lg:hidden" />
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Connect apps</h2>
            <p className="mt-0.5 text-xs text-[#85827b]">Connect GitHub / Slack / Gmail so the crew can use them.</p>
          </div>
          <button onClick={onClose} className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f1ed]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="mb-3 text-xs leading-5 text-red-600">{error}</p>}

        <div className="space-y-2">
          {CUSTOMER_APPS.map((app) => {
            const on = linked.some((c) => c.providerId === app.providerId) || !!nangoLinked(app.id)
            const busy = busyId === app.providerId
            return (
              <div
                key={app.id}
                className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-[#faf9f6] p-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#17140f] shadow-sm">
                  <AppIcon id={app.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{app.name}</span>
                  <span className="block text-[11px] text-[#7e7b74]">{app.blurb}</span>
                </span>
                {on ? (
                  <button
                    type="button"
                    onClick={() => disconnect(app.providerId)}
                    className="mobile-tap inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Connected
                    <Unplug className="h-3 w-3 opacity-60" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void connect(app.providerId)}
                    className="mobile-tap inline-flex items-center gap-1.5 rounded-full bg-[#17140f] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                    Connect {app.name}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="mt-4 flex w-full items-center gap-1.5 px-1 text-[11px] font-medium text-[#8d8b84]"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advanced ? 'rotate-180' : ''}`} />
          Advanced
        </button>
        {advanced && (
          <div className="mt-2 space-y-2 rounded-2xl border border-black/[0.07] p-3">
            <p className="text-[11px] leading-5 text-[#7e7b74]">
              Paste your own MCP server URL if you already run one. Most people can skip this.
            </p>
            <select
              value={mcpTarget}
              onChange={(e) => setMcpTarget(e.target.value as typeof mcpTarget)}
              className="w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2 text-sm outline-none"
            >
              <option value="github">GitHub</option>
              <option value="slack">Slack</option>
              <option value="gmail">Gmail</option>
              <option value="gdrive">Drive</option>
            </select>
            <input
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2 text-sm outline-none"
            />
            <input
              type="password"
              value={mcpToken}
              onChange={(e) => setMcpToken(e.target.value)}
              placeholder="Token (optional)"
              className="w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2 text-sm outline-none"
              autoComplete="off"
            />
            <button
              type="button"
              disabled={mcpBusy}
              onClick={() => void saveAdvanced()}
              className="mobile-tap w-full rounded-xl bg-[#f2f0ec] py-2.5 text-sm font-medium text-[#37342f] disabled:opacity-40"
            >
              {mcpBusy ? 'Testing…' : 'Save'}
            </button>
            {mcpNote && <p className="text-[11px] text-[#5f5c56]">{mcpNote}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
