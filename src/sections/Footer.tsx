import { Button } from '@/components/ui/button'
import { ArrowRight, Github } from 'lucide-react'

const cols = [
  { title: 'Product', links: ['Playground', 'Capabilities', 'Providers', 'Pricing', 'Changelog'] },
  { title: 'Developers', links: ['Docs', 'API reference', 'Embed widgets', 'Self-hosting', 'Status'] },
  { title: 'Open source', links: ['GitHub', 'License (MIT)', 'Roadmap', 'Contributing', 'Security'] },
]

export default function Footer() {
  return (
    <footer className="bg-primary text-primary-foreground">
      {/* CTA */}
      <div className="border-b border-white/15">
        <div className="mx-auto max-w-7xl px-6 py-20 text-center">
          <p className="spec-label mb-6 !text-white/50">Fig. 09 — begin</p>
          <h2 className="font-serif-display mx-auto max-w-3xl text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
            Stop renting
            <br />
            <em className="font-normal italic text-accent">someone else's stack.</em>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-white/60">
            Free tier, no card, two lines of code. Your keys stay yours from the first request.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Button
              size="lg"
              className="rounded-none border border-accent bg-accent px-8 py-6 font-mono-spec text-sm uppercase tracking-[0.14em] text-white hard-shadow-white hover:bg-accent/85"
            >
              Start free <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-none border-white/40 bg-transparent px-8 py-6 font-mono-spec text-sm uppercase tracking-[0.14em] text-white hover:bg-white/10 hover:text-white"
            >
              <Github className="mr-2 h-4 w-4" /> Star on GitHub
            </Button>
          </div>
        </div>
      </div>

      {/* link columns */}
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <span className="font-serif-display text-2xl font-bold">
            OpenMind<span className="text-accent">.</span>
          </span>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
            The open-source integration layer for AI. Ten capabilities, every provider, zero
            token markup.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="font-mono-spec text-[11px] uppercase tracking-[0.2em] text-white/45">{c.title}</h4>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l}>
                  <a href="#" className="text-sm text-white/70 transition-colors hover:text-accent">{l}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-5 font-mono-spec text-[11px] uppercase tracking-[0.16em] text-white/40 md:flex-row">
          <span>© 2026 OpenMind — MIT licensed</span>
          <span>set in fraunces & plex mono · no cookies, no trackers</span>
        </div>
      </div>
    </footer>
  )
}
