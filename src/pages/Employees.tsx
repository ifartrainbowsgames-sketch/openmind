import { useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Employee } from '@/lib/agent'
import PromptConsole from '@/components/network/PromptConsole'
import EmployeeNetwork from '@/components/network/EmployeeNetwork'
import { DEMO_TEAM } from '@/components/network/network-model'
import { TransitionLink } from '@/components/fx'
import ScrollToTop from '@/components/site-fx/ScrollToTop'
import { gsap, useGsap } from '@/lib/anim'

export default function Employees() {
  const [team, setTeam] = useState<Employee[] | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  // Entrance choreography — header, console and network panel arrive in
  // sequence on load (transform+opacity only; static under reduced motion).
  // The network's own node/edge life inside the panel is untouched.
  useGsap(mainRef, () => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    tl.from('.emp-hero-stamp', { x: -24, opacity: 0, duration: 0.45 }, 0.05)
    tl.from('.emp-hero-line', { y: 34, opacity: 0, duration: 0.6, stagger: 0.09 }, 0.12)
    tl.from('.emp-hero-sub', { y: 18, opacity: 0, duration: 0.5 }, 0.4)
    tl.from(
      '.emp-console',
      { y: 26, opacity: 0, duration: 0.55 },
      0.5,
    )
    // soft scale-in for the network panel; node pop-in runs inside it
    tl.from(
      '.emp-network',
      { scale: 0.975, opacity: 0, duration: 0.65, transformOrigin: 'center top' },
      0.66,
    )
  })

  return (
    <div className="vt-page min-h-[100dvh] bg-secondary/30">
      <ScrollToTop />
      <header className="border-b border-primary bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <TransitionLink to="/" className="flex items-center gap-2 hover:text-accent">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <span className="font-serif-display text-xl font-bold">
              OpenMind<span className="text-accent">.</span>
            </span>
            <span className="spec-label">agent workforce</span>
          </TransitionLink>
          <TransitionLink
            to="/dashboard"
            className="font-mono-spec text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-accent"
          >
            dashboard →
          </TransitionLink>
        </div>
      </header>

      <main ref={mainRef} className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="emp-hero-stamp spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" /> The agent workforce
          </p>
          <h1 className="font-serif-display text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            <span className="emp-hero-line block">Hire an AI workforce.</span>
            <span className="emp-hero-line block">
              <em className="font-normal italic text-accent">One prompt does the paperwork.</em>
            </span>
          </h1>
          <p className="emp-hero-sub mt-5 max-w-2xl text-muted-foreground">
            Describe the staff you need in one sentence — a planner writes each role, brief and
            toolset, and your new team clocks in below.
          </p>
        </div>

        <div className="emp-console">
          <PromptConsole onTeam={setTeam} />
        </div>

        <div className="emp-network mt-10">
          <EmployeeNetwork team={team ?? DEMO_TEAM} isDemo={!team} />
          <p className="mt-4 font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
            Connections are enabled later in your dashboard — nothing here pretends to be connected.
          </p>
        </div>
      </main>
    </div>
  )
}
