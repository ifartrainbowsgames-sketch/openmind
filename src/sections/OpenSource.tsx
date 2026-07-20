import { Github, GitFork, ScrollText, Map } from 'lucide-react'
import { Button } from '@/components/ui/button'

const FACTS = [
  { icon: ScrollText, k: 'license', v: 'MIT — all of it', note: 'widgets, gateway, SDKs, docs' },
  { icon: GitFork, k: 'forks welcome', v: 'Fork us. Seriously.', note: 'compete with us if you like' },
  { icon: Map, k: 'roadmap', v: 'Public & voted', note: 'issues decide what ships next' },
]

export default function OpenSource() {
  return (
    <section id="opensource" className="border-b border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="spec-label mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 07 — the stack itself
            </p>
            <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
              We sell convenience,
              <br />
              <em className="font-normal italic text-accent">not secrecy.</em>
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Every line of OpenMind is public. Audit the key handling, read the adapter layer,
              run the whole thing on a Raspberry Pi if that's your idea of fun. What you pay for
              is hosting, updates and support — never access to your own infrastructure.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Button className="rounded-none border border-primary bg-primary px-6 font-mono-spec text-xs uppercase tracking-[0.14em] hard-shadow-sm hover:bg-accent hover:border-accent">
                <Github className="mr-2 h-4 w-4" /> github.com/openmind
              </Button>
              <Button
                variant="outline"
                className="rounded-none border-primary px-6 font-mono-spec text-xs uppercase tracking-[0.14em] hover:bg-secondary"
              >
                Read the license
              </Button>
            </div>
          </div>

          <div className="border border-primary bg-card hard-shadow">
            <div className="border-b border-primary px-5 py-2.5">
              <span className="spec-label">repository facts</span>
            </div>
            {FACTS.map((f) => (
              <div key={f.k} className="flex items-start gap-4 border-b border-border/50 px-5 py-5 last:border-b-0">
                <f.icon className="mt-1 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <div className="spec-label">{f.k}</div>
                  <div className="mt-1 font-serif-display text-xl font-semibold">{f.v}</div>
                  <div className="text-sm text-muted-foreground">{f.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
