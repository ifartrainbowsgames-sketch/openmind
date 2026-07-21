import { useRef } from 'react'
import { capabilities } from '@/data/capabilities'
import { Badge } from '@/components/ui/badge'
import { Plug, LayoutPanelTop, ArrowUpRight } from 'lucide-react'
import { gsap, useGsap } from '@/lib/anim'

export default function Capabilities() {
  const ref = useRef<HTMLElement>(null)

  // Photocopier pass — a 2px scan line sweeps the table, each row flashing as it crosses.
  useGsap(ref, () => {
    const rows = gsap.utils.toArray<HTMLElement>('.cap-row')
    const tl = gsap.timeline({
      scrollTrigger: { trigger: '.cap-table', start: 'top 78%', end: 'bottom 45%', scrub: 1 },
    })
    tl.fromTo('.cap-scan', { top: '0%', opacity: 1 }, { top: '100%', ease: 'none', duration: rows.length }, 0)
    rows.forEach((row, i) => {
      tl.to(row, { backgroundColor: 'rgba(255,77,0,0.08)', duration: 0.45, ease: 'none' }, i)
      tl.to(row, { backgroundColor: 'rgba(255,77,0,0)', duration: 0.55, ease: 'none' }, i + 0.45)
    })
    tl.to('.cap-scan', { opacity: 0, duration: 0.6 }, rows.length - 0.5)
    // hand the rows back to CSS so :hover styles work after the sweep
    tl.set(rows, { clearProps: 'backgroundColor' }, rows.length)
  })

  return (
    <section id="capabilities" ref={ref} className="border-b border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12">
          <p className="spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" />
            Fig. 03 — capability index
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            Ten capabilities.
            <br />
            <em className="font-normal italic text-accent">Zero lock-in.</em>
          </h2>
          <p className="mt-6 max-w-2xl text-muted-foreground">
            Each capability is model-agnostic plumbing: the widget, the API route, the analytics.
            You bring the brain — any provider, any open model, swappable in one config line.
          </p>
        </div>

        {/* spec-table header */}
        <div className="hidden grid-cols-[64px_1.2fr_1.6fr_1.4fr_120px] gap-4 border-y border-primary bg-card px-4 py-2.5 md:grid">
          {['№', 'Capability', 'What it does', 'Works with', 'Surface'].map((h) => (
            <span key={h} className="spec-label">{h}</span>
          ))}
        </div>

        <div className="cap-table relative border-x border-b border-primary md:border-x-0 md:border-b-0">
          <span className="cap-scan pointer-events-none absolute left-0 z-10 hidden h-0.5 w-full bg-accent md:block" />
          {capabilities.map((c) => (
            <a
              key={c.id}
              href="#playground"
              className="cap-row group grid grid-cols-1 gap-3 border-b border-primary px-4 py-5 transition-colors hover:bg-card md:grid-cols-[64px_1.2fr_1.6fr_1.4fr_120px] md:items-center md:gap-4 md:border-x md:border-border/60 md:hover:bg-secondary/60"
            >
              <span className="font-mono-spec text-sm text-accent">{c.index}</span>
              <span className="font-serif-display text-xl font-semibold">{c.name}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{c.description}</span>
              <span className="flex flex-wrap gap-1.5">
                {c.providers.map((p) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className="rounded-none border-border/60 font-mono-spec text-[10px] font-normal uppercase tracking-wider"
                  >
                    {p}
                  </Badge>
                ))}
              </span>
              <span className="flex items-center gap-2">
                {c.api && <Plug className="h-3.5 w-3.5 text-muted-foreground" />}
                {c.embed && <LayoutPanelTop className="h-3.5 w-3.5 text-muted-foreground" />}
                <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
              </span>
            </a>
          ))}
        </div>

        <p className="mt-4 font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Surface key: <Plug className="inline h-3 w-3" /> unified api · <LayoutPanelTop className="inline h-3 w-3" /> embed widget — click a row to test it above
        </p>
      </div>
    </section>
  )
}
