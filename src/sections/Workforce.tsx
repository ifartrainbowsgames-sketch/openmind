import { TransitionLink } from '@/components/fx'
import { PRESET_EMPLOYEES } from '@/data/employees'
import { ArrowUpRight, Bot } from 'lucide-react'

export default function Workforce() {
  return (
    <section id="employees" className="border-b border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="spec-label mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Optional automations
            </p>
            <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
              Automate routine work.
              <br />
              <em className="font-normal italic text-accent">Keep people in control.</em>
            </h2>
            <p className="mt-6 max-w-2xl text-muted-foreground">
              Create focused assistants for support, research, content, or operations. Connect only the apps
              each one needs and choose when approval is required.
            </p>
          </div>
          <TransitionLink
            to="/dashboard?view=automations"
            className="inline-flex items-center gap-2 border border-primary bg-primary px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] text-primary-foreground hard-shadow-sm transition-colors hover:border-accent hover:bg-accent hover:text-white"
          >
            Explore automations <ArrowUpRight className="h-4 w-4" />
          </TransitionLink>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PRESET_EMPLOYEES.map((e, i) => (
            <TransitionLink
              key={e.id}
              to="/dashboard?view=automations"
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
              <div className="mt-4 text-xs text-muted-foreground group-hover:text-accent">View assistant →</div>
            </TransitionLink>
          ))}
        </div>
      </div>
    </section>
  )
}
