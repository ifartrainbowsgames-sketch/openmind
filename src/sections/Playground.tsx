import { useEffect, useRef } from 'react'
import { capabilities } from '@/data/capabilities'
import { ChatDemo } from '@/components/demos/TextDemos'
import { gsap, prefersReduced } from '@/lib/anim'

export default function Playground() {
  const cap = capabilities[0]
  const stageRef = useRef<HTMLDivElement>(null)

  // binder flip — the demo page snaps in from the right with a hard stepped ease
  useEffect(() => {
    const el = stageRef.current
    if (!el || prefersReduced()) return
    gsap.fromTo(
      el,
      { x: 30, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.38, ease: 'steps(6)' },
    )
  }, [])

  return (
    <section id="playground" className="border-b border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="spec-label mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 02 — the playground
            </p>
            <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
              Don't read the pitch.
              <br />
              <em className="font-normal italic text-accent">Test the product.</em>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            The chatbot tries the configured server-side gateway first. If the function or provider
            is unavailable, it switches to a visibly labeled local canned response.
          </p>
        </div>

        <div className="border border-primary bg-card hard-shadow">
          {/* demo stage */}
          <div ref={stageRef} className="p-6 md:p-8">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 pb-4">
              <h3 className="font-serif-display text-2xl font-semibold">
                <span className="font-mono-spec text-sm font-normal text-accent">{cap.index} / </span>
                {cap.name}
              </h3>
              <span className="spec-label">{cap.tagline}</span>
            </div>
            <ChatDemo />
          </div>
        </div>
      </div>
    </section>
  )
}
