import { useRef } from 'react'
import { capabilities } from '@/data/capabilities'
import { Badge } from '@/components/ui/badge'
import { Plug, LayoutPanelTop, ArrowUpRight } from 'lucide-react'
import { gsap, useGsap } from '@/lib/anim'

export default function Capabilities() {
  const ref = useRef<HTMLElement>(null)
  const cap = capabilities[0]

  // Photocopier pass — a 2px scan line sweeps the card, its row flashing as it crosses.
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
            Fig. 04 — the capability
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            One capability.
            <br />
            <em className="font-normal italic text-accent">Done properly.</em>
          </h2>
          <p className="mt-6 max-w-2xl text-muted-foreground">
            OpenMind does one thing: the support &amp; sales chatbot. Model-agnostic plumbing — the
            widget, the API route, the analytics. You bring the brain — any provider, any open
            model, swappable in one config line.
          </p>
        </div>

        {/* featured figure card */}
        <div className="cap-table relative border border-primary bg-card hard-shadow">
          <span className="cap-scan pointer-events-none absolute left-0 z-10 hidden h-0.5 w-full bg-accent md:block" />
          <div className="cap-row grid gap-0 lg:grid-cols-[1.2fr_1fr]">
            {/* left — the spec */}
            <div className="border-b border-border/60 p-6 md:p-10 lg:border-b-0 lg:border-r">
              <div className="flex items-baseline gap-4">
                <span className="font-mono-spec text-sm text-accent">{cap.index}</span>
                <div>
                  <h3 className="font-serif-display text-3xl font-semibold md:text-4xl">{cap.name}</h3>
                  <p className="spec-label mt-2">{cap.tagline}</p>
                </div>
              </div>
              <p className="mt-6 max-w-lg leading-relaxed text-muted-foreground">{cap.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {cap.features.map((f) => (
                  <span
                    key={f}
                    className="border border-border/60 px-3 py-1 font-mono-spec text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    {f}
                  </span>
                ))}
              </div>
              <a
                href="#playground"
                className="group mt-8 inline-flex items-center gap-2 border border-primary bg-primary px-5 py-3 font-mono-spec text-xs uppercase tracking-[0.14em] text-primary-foreground hard-shadow-sm transition-colors hover:bg-accent hover:border-accent"
              >
                Test it in the playground
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>

            {/* right — providers & surfaces */}
            <div className="flex flex-col">
              <div className="flex-1 border-b border-border/60 p-6 md:p-8">
                <span className="spec-label mb-4 block">Works with</span>
                <div className="flex flex-wrap gap-1.5">
                  {cap.providers.map((p) => (
                    <Badge
                      key={p}
                      variant="outline"
                      className="rounded-none border-border/60 font-mono-spec text-[10px] font-normal uppercase tracking-wider"
                    >
                      {p}
                    </Badge>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  …or any endpoint that speaks the OpenAI API format.
                </p>
              </div>
              <div className="flex-1 border-b border-border/60 p-6 md:p-8">
                <span className="spec-label mb-4 block">Surface</span>
                <div className="flex items-center gap-6">
                  {cap.api && (
                    <span className="flex items-center gap-2 text-sm">
                      <Plug className="h-4 w-4 text-accent" /> Unified API
                    </span>
                  )}
                  {cap.embed && (
                    <span className="flex items-center gap-2 text-sm">
                      <LayoutPanelTop className="h-4 w-4 text-accent" /> Embed widget
                    </span>
                  )}
                </div>
              </div>
              <div className="p-6 md:p-8">
                <span className="spec-label mb-3 block">In the demo</span>
                <p className="text-sm leading-relaxed text-muted-foreground">{cap.demoNote}.</p>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Surface key: <Plug className="inline h-3 w-3" /> unified api · <LayoutPanelTop className="inline h-3 w-3" /> embed widget — tested live above, in Fig. 02
        </p>
      </div>
    </section>
  )
}
