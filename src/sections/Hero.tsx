import { useRef } from 'react'
import { ArrowRight, MessageSquare, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { gsap, useGsap } from '@/lib/anim'
import Magnetic from '@/components/anim/Magnetic'
import HeroLattice from '@/components/site-fx/HeroLattice'

export default function Hero() {
  const ref = useRef<HTMLElement>(null)

  useGsap(ref, () => {
    const timeline = gsap.timeline({ defaults: { ease: 'power4.out' } })
    timeline.from('.hero-line', { yPercent: 110, duration: 0.8, stagger: 0.12 })
    timeline.from('.hero-sub', { y: 20, opacity: 0, duration: 0.5 }, 0.55)
    timeline.from('.hero-cta', { y: 16, opacity: 0, duration: 0.45, stagger: 0.08 }, 0.7)
    timeline.from('.hero-preview', { x: 40, opacity: 0, duration: 0.7 }, 0.5)
  })

  return (
    <section id="top" ref={ref} className="bg-ruled relative overflow-hidden border-b border-border pb-0 pt-32">
      <HeroLattice className="pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-12 pb-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="spec-label mb-6 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Customer support that is always ready
            </p>
            <h1 className="font-serif-display text-[13vw] font-semibold leading-[0.95] tracking-tight sm:text-7xl lg:text-[5.4rem]">
              <span className="block overflow-hidden pb-1"><span className="hero-line block">A better chatbot</span></span>
              <span className="block overflow-hidden pb-2">
                <span className="hero-line block"><em className="font-normal italic text-accent">for your business.</em></span>
              </span>
            </h1>
            <p className="hero-sub mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Answer customers from your own knowledge, hand conversations to your team, and make the widget match your brand.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Magnetic className="hero-cta">
                <Button size="lg" className="rounded-none border border-primary bg-primary px-8 font-mono-spec text-sm uppercase tracking-[0.14em] hard-shadow hover:border-accent hover:bg-accent" asChild>
                  <a href="/dashboard">Build your chatbot <ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              </Magnetic>
              <Magnetic className="hero-cta">
                <Button size="lg" variant="outline" className="rounded-none border-primary px-8 font-mono-spec text-sm uppercase tracking-[0.14em]" asChild>
                  <a href="#capabilities">See how it works</a>
                </Button>
              </Magnetic>
            </div>
          </div>

          <div className="hero-preview border border-primary bg-card p-4 hard-shadow">
            <div className="flex items-center gap-3 border-b border-border/60 pb-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white">
                <MessageSquare className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-semibold">Acme Support</div>
                <div className="text-xs text-emerald-700">Available now</div>
              </div>
            </div>
            <div className="space-y-4 bg-secondary/35 p-4">
              <div className="max-w-[82%] rounded-xl border border-border/60 bg-white px-4 py-3 text-sm">
                Can I return an order that arrived yesterday?
              </div>
              <div className="ml-auto max-w-[82%] rounded-xl bg-accent px-4 py-3 text-sm text-white">
                Yes. Your order is covered by our 30-day return policy. Would you like me to start the return?
              </div>
              <div className="flex items-center gap-2 border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
                <Users className="h-4 w-4 text-accent" /> A team member can join this conversation at any time.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl sm:grid-cols-3">
          {[
            ['01', 'Answers from your knowledge'],
            ['02', 'Human handoff when needed'],
            ['03', 'Designed for your brand'],
          ].map(([number, label]) => (
            <div key={number} className="flex items-center gap-4 border-b border-border/50 px-6 py-5 sm:border-b-0 sm:border-r">
              <span className="font-serif-display text-2xl text-accent">{number}</span>
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
