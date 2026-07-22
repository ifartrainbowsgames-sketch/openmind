// Per-run employee report card — categorical QA verdict after every run,
// plus a mini scorecard for roster cards. Honesty stamps throughout:
// LLM JUDGE · <model> when a provider judged, HEURISTIC · NO KEY otherwise.
import { ClipboardCheck } from 'lucide-react'
import { trendSummary, type RunScore, type Verdict } from '@/lib/reportcard'

const VERDICT_DARK: Record<Verdict, string> = {
  excellent: 'border-emerald-500/70 bg-emerald-500/15 text-emerald-300',
  good: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  mixed: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  poor: 'border-red-500/60 bg-red-500/10 text-red-300',
  unsure: 'border-white/25 bg-white/5 text-white/55',
}

const VERDICT_LIGHT: Record<Verdict, string> = {
  excellent: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  good: 'border-emerald-700/60 bg-emerald-50 text-emerald-800',
  mixed: 'border-amber-600 bg-amber-50 text-amber-800',
  poor: 'border-red-600 bg-red-50 text-red-700',
  unsure: 'border-border/60 bg-secondary/60 text-muted-foreground',
}

const DOT: Record<Verdict, string> = {
  excellent: 'bg-emerald-500',
  good: 'bg-emerald-500',
  mixed: 'bg-amber-500',
  poor: 'bg-red-500',
  unsure: 'bg-white/40',
}

export function VerdictChip({ verdict, dark = false }: { verdict: Verdict; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${
        dark ? VERDICT_DARK[verdict] : VERDICT_LIGHT[verdict]
      }`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[verdict]}`} />
      {verdict}
    </span>
  )
}

function fmtTime(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return new Date(at).toISOString()
  }
}

/** Full report card — renders inside the dark run panel after an agent reply. */
export default function ReportCard({ score, employeeName }: { score: RunScore; employeeName: string }) {
  return (
    <div className="mt-2 border border-white/15 animate-stamp">
      <div className="flex items-center justify-between gap-2 border-b border-white/15 px-2.5 py-1.5">
        <span className="flex items-center gap-2 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-white/50">
          <ClipboardCheck className="h-3 w-3" /> report card — {employeeName}
        </span>
        <VerdictChip verdict={score.verdict} dark />
      </div>
      <div className="space-y-1 px-3 py-2.5">
        {score.axes.map((a) => (
          <div key={a.label} className="flex items-center justify-between gap-3 font-mono-spec text-[10px]">
            <span className="uppercase tracking-[0.14em] text-white/45">{a.label}</span>
            <VerdictChip verdict={a.verdict} dark />
          </div>
        ))}
        <p className="pt-1 font-mono-spec text-[11px] leading-relaxed text-white/70">{score.note}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/15 px-2.5 py-1.5">
        <span
          className={`font-mono-spec text-[9px] uppercase tracking-[0.16em] ${
            score.source === 'llm-judge' ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {score.source === 'llm-judge' ? `LLM JUDGE · ${score.judge ?? 'provider'}` : 'HEURISTIC · NO KEY'}
        </span>
        <span className="font-mono-spec text-[9px] uppercase tracking-[0.14em] text-white/35">{fmtTime(score.at)}</span>
      </div>
    </div>
  )
}

/** Roster-card mini scorecard — last verdict + trend counts (light theme). */
export function MiniScorecard({ scores }: { scores: RunScore[] }) {
  if (scores.length === 0) {
    return (
      <span className="font-mono-spec text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
        no runs scored yet
      </span>
    )
  }
  const last = scores[0]
  const trend = trendSummary(scores)
  const parts = (['excellent', 'good', 'mixed', 'poor', 'unsure'] as const).filter((v) => trend[v] > 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5" title={`${scores.length} run${scores.length > 1 ? 's' : ''} scored`}>
      <VerdictChip verdict={last.verdict} />
      <span className="font-mono-spec text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        last run · {scores.length} scored
      </span>
      <span className="font-mono-spec text-[9px] tracking-[0.06em] text-muted-foreground/70">
        {parts.map((v) => `${trend[v]} ${v}`).join(' · ')}
      </span>
    </div>
  )
}
