// ── Prompt console — the only input on the public /employees page ────────────
// One textarea, one button, a few example chips. Submitting runs the silent
// offline planner (planWorkforce with brain=null — no provider/key UI anywhere)
// and paces its real onStage events into a single minimal status line. Finished
// teams persist through the same save/load mechanism the dashboard roster reads.

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { Employee } from '@/lib/agent'
import { planWorkforce, type StaffingStage } from '@/lib/llm-staffing'
import { loadCustomEmployees, saveCustomEmployees } from '@/data/employees'
import { gsap, prefersReduced } from '@/lib/anim'
import { LazyRive } from '@/components/fx'

interface Props {
  onTeam: (employees: Employee[]) => void
}

const EXAMPLES = [
  'Two support agents who live in Zendesk and Gmail',
  'A code reviewer wired into GitHub and Linear',
  'An analyst pair for Drive, Notion and Slack',
]

/** Planner stage events → quiet human lines. No provider, key or brain talk. */
function friendlyLabel(s: StaffingStage): string | null {
  if (s.key === 'offline-planner' || s.key === 'contacting-planner' || s.key === 'designing-team') {
    return 'Drafting roles…'
  }
  if (s.key.startsWith('hired-')) return s.label
  return null
}

export default function PromptConsole({ onTeam }: Props) {
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const timers = useRef<number[]>([])

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t))
    },
    [],
  )

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const shake = () => {
    const el = formRef.current
    if (!el || prefersReduced()) return
    gsap.fromTo(
      el,
      { x: 0 },
      { keyframes: [{ x: -7 }, { x: 6 }, { x: -4 }, { x: 2 }, { x: 0 }], duration: 0.4, ease: 'power1.inOut' },
    )
  }

  const submit = async () => {
    if (busy) return
    const trimmed = brief.trim()
    if (!trimmed) {
      setError(null)
      shake()
      return
    }
    setBusy(true)
    setError(null)
    setStatus('Reading your request…')
    const stages: StaffingStage[] = []
    try {
      const result = await planWorkforce(trimmed, null, (s) => {
        stages.push(s)
      })
      // Pace the real stage events into the status line, then land the team.
      const labels: string[] = []
      for (const s of stages) {
        const l = friendlyLabel(s)
        if (l && labels[labels.length - 1] !== l) labels.push(l)
      }
      labels.push(`Team ready — ${result.employees.length} hire${result.employees.length === 1 ? '' : 's'}`)
      labels.forEach((l, i) => later(240 + i * 460, () => setStatus(l)))
      later(240 + labels.length * 460 + 200, () => {
        saveCustomEmployees([...loadCustomEmployees(), ...result.employees])
        onTeam(result.employees)
        setBusy(false)
      })
    } catch {
      setStatus(null)
      setError("Couldn't build that — try rephrasing.")
      setBusy(false)
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="hard-shadow border border-primary bg-card"
    >
      <label
        htmlFor="employee-brief"
        className="spec-label block border-b border-border/60 px-4 py-2.5"
      >
        Brief the staffing office
      </label>
      <textarea
        id="employee-brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        placeholder="Describe the staff you need in one sentence…"
        className="block w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/70"
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
        {EXAMPLES.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setBrief(x)}
            className="border border-border/60 px-2 py-1 font-mono-spec text-[10px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
          >
            {x}
          </button>
        ))}
        <button
          type="submit"
          disabled={busy}
          className="ml-auto inline-flex items-center gap-2 border border-primary bg-primary px-5 py-2.5 font-mono-spec text-[11px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:border-accent hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {busy ? 'Building…' : 'Build my team'}
        </button>
      </div>
      {(status || error) && (
        <div className="border-t border-border/60 px-4 py-2.5" aria-live="polite">
          {error ? (
            <p className="font-mono-spec text-[11px] text-destructive">{error}</p>
          ) : (
            <p className="flex items-center gap-2 font-mono-spec text-[11px] text-muted-foreground">
              {busy ? (
                /* planner at work — tiny Rive spinner in a terminal-dark chip;
                   reduced motion / runtime still loading → static pulse dot */
                <LazyRive
                  src="/rive/planner-spinner.riv"
                  stateMachine="State Machine 1"
                  className="flex h-5 w-5 shrink-0 items-center justify-center border border-primary bg-terminal"
                  fallback={<span className="pulse-dot inline-block h-1.5 w-1.5 bg-accent" />}
                />
              ) : (
                <span className="pulse-dot inline-block h-1.5 w-1.5 bg-accent" />
              )}
              {status}
            </p>
          )}
        </div>
      )}
    </form>
  )
}
