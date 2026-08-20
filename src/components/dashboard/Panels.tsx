import { KeyRound, Lock } from 'lucide-react'

// ── Providers & Keys ─────────────────────────────────────────────────────────

export function ProvidersKeys() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Providers & keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The encrypted model-provider key vault is not connected in this build. OAuth connector tokens use a separate server vault.
        </p>
      </div>

      <div className="border border-primary bg-card p-5">
        <span className="spec-label mb-3 block">Server-managed vault</span>
        <div className="flex items-start gap-3 border border-amber-600/60 bg-amber-50 p-4 text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm">
            Model API key storage remains planned. AI Employee provider keys remain memory-only for the current tab;
            manual connection credentials are session-only, while installed OAuth connectors are encrypted server-side.
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
