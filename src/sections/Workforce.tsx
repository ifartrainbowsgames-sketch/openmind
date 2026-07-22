import { TransitionLink } from '@/components/fx'
import { PRESET_EMPLOYEES } from '@/data/employees'
import { TOOL_REGISTRY } from '@/lib/agent'
import { ArrowUpRight, Bot, Workflow } from 'lucide-react'

export default function Workforce() {
  return (
    <section id="employees" className="border-b border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="spec-label mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 03 — the agent workforce
            </p>
            <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
              Meet the AI employees.
              <br />
              <em className="font-normal italic text-accent">Hire with one prompt.</em>
            </h2>
            <p className="mt-6 max-w-2xl text-muted-foreground">
              Each employee is a LangGraph agent — it plans, calls tools and responds, with the whole
              graph trace and org chart on display. One prompt hires a whole team, wired into Gmail,
              Calendar, GitHub, Slack and more. Take a preset for a spin, or staff up in one sentence.
            </p>
          </div>
          <TransitionLink
            to="/employees"
            className="inline-flex items-center gap-2 border border-primary bg-primary px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] text-primary-foreground hard-shadow-sm transition-colors hover:border-accent hover:bg-accent hover:text-white"
          >
            Staff up with one prompt <ArrowUpRight className="h-4 w-4" />
          </TransitionLink>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PRESET_EMPLOYEES.map((e, i) => (
            <TransitionLink
              key={e.id}
              to="/employees"
              className="group border border-border/60 bg-card p-5 transition-colors hover:border-primary hover:hard-shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center text-white" style={{ background: e.accent }}>
                  <Bot className="h-5 w-5" />
                </span>
                <span className="spec-label !text-[10px]">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="mt-4 font-serif-display text-2xl font-semibold">{e.name}</div>
              <div className="spec-label mt-0.5">{e.role}</div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{e.tagline}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {e.tools.map((t) => (
                  <span key={t} className="border border-border/50 px-1.5 py-0.5 font-mono-spec text-[9px] uppercase tracking-wider text-muted-foreground">
                    {TOOL_REGISTRY[t]?.name ?? t}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground group-hover:text-accent">
                <Workflow className="h-3 w-3" /> see the graph run
              </div>
            </TransitionLink>
          ))}
        </div>
      </div>
    </section>
  )
}
