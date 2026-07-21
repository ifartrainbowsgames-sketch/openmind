import { useState } from 'react'
import { capabilities } from '@/data/capabilities'
import { PLAN_LIMITS, type Plan } from '@/hooks/usePlan'
import { Lock, Zap, Check, Plus } from 'lucide-react'

interface Props {
  plan: Plan
  services: string[]
  toggleService: (id: string) => boolean
  onUpgrade: () => void
}

/**
 * Service activation — the menu where customers switch capabilities on
 * one by one instead of getting everything at once. Free: 2 active.
 */
export default function ServicesPanel({ plan, services, toggleService, onUpgrade }: Props) {
  const [blocked, setBlocked] = useState<string | null>(null)
  const limit = PLAN_LIMITS[plan].services

  const onToggle = (id: string) => {
    const ok = toggleService(id)
    if (!ok) {
      setBlocked(id)
      setTimeout(() => setBlocked(null), 2200)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Services</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Activate only what your site needs. Each active service gets its embed snippet in the
            Widget Builder and starts counting in Analytics.
          </p>
        </div>
        <span
          className={`border px-3 py-1.5 font-mono-spec text-[11px] uppercase tracking-[0.14em] ${
            plan === 'pro' ? 'border-accent bg-accent/10 text-accent' : 'border-border/60 text-muted-foreground'
          }`}
        >
          {services.length} / {limit === 99 ? '∞' : limit} active · {plan} plan
        </span>
      </div>

      {plan === 'free' && (
        <div className="flex flex-wrap items-center gap-3 border border-primary bg-terminal px-5 py-3.5">
          <Zap className="h-4 w-4 shrink-0 text-accent" />
          <p className="flex-1 font-mono-spec text-[11px] uppercase tracking-[0.12em] text-white/85">
            Free plan runs {PLAN_LIMITS.free.services} services at once — Pro ($10/mo) unlocks all ten.
          </p>
          <button
            onClick={onUpgrade}
            className="border border-accent bg-accent px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white hover:bg-accent/85"
          >
            Upgrade
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((c) => {
          const active = services.includes(c.id)
          return (
            <div
              key={c.id}
              className={`flex flex-col border bg-card transition-colors ${
                active ? 'border-primary hard-shadow-sm' : 'border-border/60'
              }`}
            >
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
                <span className="font-mono-spec text-[11px] text-accent">{c.index}</span>
                <span
                  className={`flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-wider ${
                    active ? 'text-emerald-700' : 'text-muted-foreground/60'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-600' : 'bg-border'}`} />
                  {active ? 'live on your site' : 'off'}
                </span>
              </div>
              <div className="flex-1 px-4 py-4">
                <h3 className="font-serif-display text-xl font-semibold">{c.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.tagline} — {c.description}</p>
              </div>
              <button
                onClick={() => onToggle(c.id)}
                className={`flex items-center justify-center gap-2 border-t px-4 py-3 font-mono-spec text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  active
                    ? 'border-border/40 text-muted-foreground hover:bg-secondary'
                    : blocked === c.id
                      ? 'border-border/40 text-muted-foreground/50'
                      : 'border-primary bg-primary text-primary-foreground hover:bg-accent hover:border-accent'
                }`}
              >
                {active ? (
                  <><Check className="h-3.5 w-3.5" /> Deactivate</>
                ) : blocked === c.id ? (
                  <><Lock className="h-3.5 w-3.5" /> Free plan is full — upgrade</>
                ) : (
                  <><Plus className="h-3.5 w-3.5" /> Activate</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
