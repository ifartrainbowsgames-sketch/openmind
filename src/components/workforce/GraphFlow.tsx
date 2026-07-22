// Live LangGraph workflow viz — nodes light up as the graph streams.
import type { Employee, TraceLine } from '@/lib/agent'
import { Check, Loader2, Repeat } from 'lucide-react'

type NodeState = 'idle' | 'active' | 'done' | 'skipped'

interface Props {
  employee: Employee
  trace: TraceLine[]
  running: boolean
}

function derive(trace: TraceLine[], running: boolean) {
  const hasPlan = trace.some((t) => t.node === 'plan')
  const noTools = trace.some((t) => t.node === 'plan' && /no tools needed/.test(t.text))
  const acts = trace.filter((t) => t.node === 'act')
  const hasRespond = trace.some((t) => t.node === 'respond')

  const planner: NodeState = hasPlan ? 'done' : running ? 'active' : 'idle'
  const actor: NodeState = noTools
    ? 'skipped'
    : hasRespond
    ? 'done'
    : acts.length > 0 || (running && hasPlan)
    ? 'active'
    : 'idle'
  const responder: NodeState = hasRespond ? 'done' : running && (noTools || (hasPlan && actor === 'done')) ? 'active' : 'idle'
  const toolsRun = acts.map((a) => a.text.split('(')[0])
  return { planner, actor, responder, toolsRun, noTools }
}

function Node({ label, sub, state, accent }: { label: string; sub: string; state: NodeState; accent: string }) {
  // dash-fx: color/glow tween between idle/active/done (300ms, state feedback)
  const base = 'relative flex min-w-28 flex-col items-center justify-center border px-4 py-3 transition-all duration-300 ease-out'
  const style =
    state === 'done'
      ? 'border-emerald-700 bg-emerald-700/10'
      : state === 'active'
      ? 'border-accent bg-accent/10 dash-glow-active'
      : state === 'skipped'
      ? 'border-dashed border-border/60 opacity-50'
      : 'border-border/60 bg-card'
  return (
    <div className={`${base} ${style}`}>
      <span className="font-mono-spec text-[11px] uppercase tracking-[0.16em]">{label}</span>
      <span className="mt-0.5 font-mono-spec text-[9px] text-muted-foreground">{sub}</span>
      <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full transition-colors duration-300"
        style={{ background: state === 'done' ? '#15803d' : state === 'active' ? accent : 'transparent' }}>
        {state === 'done' && <Check className="h-3 w-3 text-white" />}
        {state === 'active' && <Loader2 className="h-3 w-3 animate-spin text-white" />}
      </span>
    </div>
  )
}

const Arrow = ({ label, active }: { label?: string; active?: boolean }) => (
  <div className={`flex flex-col items-center justify-center px-1 transition-colors duration-300 ${active ? 'text-accent' : 'text-muted-foreground/50'}`}>
    {label && <span className="mb-0.5 font-mono-spec text-[8px] uppercase tracking-[0.14em]">{label}</span>}
    <svg width="34" height="10" viewBox="0 0 34 10">
      <line x1="0" y1="5" x2="26" y2="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M 26 1 L 33 5 L 26 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  </div>
)

export default function GraphFlow({ employee, trace, running }: Props) {
  const { planner, actor, responder, toolsRun, noTools } = derive(trace, running)
  const planned =
    trace.find((t) => t.node === 'plan' && /queued/.test(t.text))?.text.split('—')[1]?.split('→').map((s) => s.trim()) ?? []
  const pending = planned.filter((p) => !toolsRun.includes(p))

  return (
    <div className="border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="spec-label !text-[10px]">LangGraph — {employee.name}'s workflow</span>
        <span className="font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {running ? 'running…' : trace.length ? 'complete' : 'idle — assign a task below'}
        </span>
      </div>

      <div className="flex items-stretch justify-center gap-0 overflow-x-auto py-2">
        <Node label="Input" sub="your task" state={trace.length || running ? 'done' : 'idle'} accent={employee.accent} />
        <Arrow active={planner !== 'idle'} />
        <Node label="Planner" sub="queues steps" state={planner} accent={employee.accent} />
        <Arrow active={actor !== 'idle'} label={noTools ? '∅ skip' : undefined} />
        <div className="relative">
          <Node label="Actor" sub="calls tools" state={actor} accent={employee.accent} />
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-muted-foreground/60" title="loops until steps are done">
            <Repeat className="h-3 w-3" />
          </span>
        </div>
        <Arrow active={responder !== 'idle'} />
        <Node label="Responder" sub="writes answer" state={responder} accent={employee.accent} />
      </div>

      {(toolsRun.length > 0 || pending.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {toolsRun.map((t, i) => (
            <span key={`${t}-${i}`} className="dash-feed-in flex items-center gap-1 border border-emerald-700/60 bg-emerald-700/10 px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.1em] text-emerald-700">
              <Check className="h-2.5 w-2.5" /> {t}
            </span>
          ))}
          {running &&
            pending.map((t) => (
              <span key={t} className="border border-border/60 px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
                {t}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
