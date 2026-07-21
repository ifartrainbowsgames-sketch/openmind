import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Minus } from 'lucide-react'
import { gsap, useGsap } from '@/lib/anim'

interface Tier {
  name: string
  price: string
  per: string
  blurb: string
  rows: (string | null)[]
  featured?: boolean
  cta: string
}

const FEATURES = ['Sites / widgets', 'All 10 capabilities', 'Analytics & logs', 'Server-side key vault', 'Team seats', 'Self-host license', 'Support']

const TIERS: Tier[] = [
  {
    name: 'Free', price: '$0', per: '/forever', blurb: 'For side projects and evaluation.',
    rows: ['1 site', 'yes', '7 days', null, '1', null, 'community'], cta: 'Start free',
  },
  {
    name: 'Pro', price: '$29', per: '/mo', blurb: 'For products with real users.', featured: true,
    rows: ['5 sites', 'yes', '90 days', 'yes', '3', null, 'next-day'], cta: 'Start trial',
  },
  {
    name: 'Team', price: '$99', per: '/mo', blurb: 'For companies standardizing on BYOK.',
    rows: ['unlimited', 'yes', '13 months', 'yes', '10', 'yes', 'same-day'], cta: 'Start trial',
  },
  {
    name: 'Enterprise', price: 'Custom', per: '', blurb: 'Compliance, SSO, dedicated support.',
    rows: ['unlimited', 'yes', 'unlimited', 'yes', 'unlimited', 'yes', 'dedicated'], cta: 'Talk to us',
  },
]

export default function Pricing() {
  const ref = useRef<HTMLElement>(null)

  useGsap(ref, () => {
    // the Pro column stamps down like a rubber stamp, with a two-frame settle
    gsap.from('.price-stamp', {
      scale: 1.45,
      rotation: -6,
      opacity: 0,
      duration: 0.4,
      ease: 'steps(4)',
      transformOrigin: 'center top',
      scrollTrigger: { trigger: '.price-table', start: 'top 72%' },
    })
    // spec rows tick in one after another
    gsap.from('.price-row', {
      opacity: 0,
      x: -14,
      duration: 0.3,
      stagger: 0.06,
      ease: 'power1.out',
      scrollTrigger: { trigger: '.price-table', start: 'top 68%' },
    })
  })

  return (
    <section id="pricing" ref={ref} className="border-b border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12">
          <p className="spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" />
            Fig. 08 — price sheet
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            Software pricing.
            <br />
            <em className="font-normal italic text-accent">Not token pricing.</em>
          </h2>
          <p className="mt-6 max-w-2xl text-muted-foreground">
            You pay your model provider directly at their list price — we add 0% markup, forever.
            What you're buying here is the layer on top.
          </p>
        </div>

        {/* spec table */}
        <div className="price-table overflow-x-auto border border-primary bg-card hard-shadow">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-primary">
                <th className="px-5 py-4 spec-label">Specification</th>
                {TIERS.map((t) => (
                  <th key={t.name} className={`border-l border-border/50 px-5 py-4 align-top ${t.featured ? 'bg-primary text-primary-foreground' : ''}`}>
                    <div className={t.featured ? 'price-stamp inline-block' : undefined}>
                      <div className="font-serif-display text-xl font-semibold">{t.name}</div>
                      <div className="mt-1">
                        <span className={`font-serif-display text-3xl font-semibold ${t.featured ? 'text-accent' : ''}`}>{t.price}</span>
                        <span className={`text-xs ${t.featured ? 'text-white/60' : 'text-muted-foreground'}`}>{t.per}</span>
                      </div>
                      <div className={`mt-1 text-xs ${t.featured ? 'text-white/60' : 'text-muted-foreground'}`}>{t.blurb}</div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, fi) => (
                <tr key={f} className="price-row border-b border-border/40 last:border-b-0">
                  <td className="px-5 py-3.5 text-sm font-medium">{f}</td>
                  {TIERS.map((t) => {
                    const v = t.rows[fi]
                    return (
                      <td key={t.name} className={`border-l border-border/40 px-5 py-3.5 text-sm ${t.featured ? 'bg-primary/[0.03]' : ''}`}>
                        {v === null ? (
                          <Minus className="h-4 w-4 text-muted-foreground/40" />
                        ) : v === 'yes' ? (
                          <Check className="h-4 w-4 text-accent" />
                        ) : (
                          <span className="font-mono-spec text-[13px]">{v}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <td className="px-5 py-4" />
                {TIERS.map((t) => (
                  <td key={t.name} className={`border-l border-border/40 px-5 py-4 ${t.featured ? 'bg-primary/[0.03]' : ''}`}>
                    <Button
                      className={`w-full rounded-none font-mono-spec text-xs uppercase tracking-[0.14em] ${
                        t.featured
                          ? 'border border-accent bg-accent text-white hard-shadow-sm hover:bg-accent/85'
                          : 'border border-primary bg-transparent text-foreground hover:bg-primary hover:text-primary-foreground'
                      }`}
                      variant={t.featured ? 'default' : 'outline'}
                    >
                      {t.cta}
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          * model usage billed by your provider at list price · token markup: 0% · cancel anytime
        </p>
      </div>
    </section>
  )
}
