import type { ReactNode } from 'react'
import { Play, Square } from 'lucide-react'

/** Dark terminal-style output pane. */
export function Pane({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="bg-terminal border border-primary">
      <div className="flex items-center justify-between border-b border-white/15 px-4 py-2">
        <span className="font-mono-spec text-[11px] uppercase tracking-[0.18em] text-white/50">{title}</span>
        {right}
      </div>
      <div className="min-h-56 p-4 font-mono-spec text-[13px] leading-relaxed text-white/85">
        {children}
      </div>
    </div>
  )
}

/** Honesty stamp — every demo declares how it's running. */
export function ModeStamp({
  mode,
  note,
  liveLabel = 'in your browser',
}: {
  mode: 'live' | 'simulated' | 'pending'
  note: string
  /** Where the live computation happens — defaults to the browser. */
  liveLabel?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 border px-3 py-2 font-mono-spec text-[11px] uppercase tracking-[0.14em] ${
        mode === 'live'
          ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
          : mode === 'simulated'
            ? 'border-amber-600 bg-amber-50 text-amber-800'
            : 'border-border bg-secondary text-muted-foreground'
      }`}
    >
      <span className={`pulse-dot inline-block h-2 w-2 rounded-full ${
        mode === 'live' ? 'bg-emerald-600' : mode === 'simulated' ? 'bg-amber-500' : 'bg-muted-foreground'
      }`} />
      {mode === 'live' ? `Running live — ${liveLabel}` : mode === 'simulated' ? 'Simulated' : 'Gateway pending'} · {note}
    </div>
  )
}

export function RunButton({
  onClick,
  running,
  label = 'Run',
  stopLabel = 'Stop',
  disabled,
}: {
  onClick: () => void
  running: boolean
  label?: string
  stopLabel?: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 border border-primary px-5 py-2.5 font-mono-spec text-xs uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        running
          ? 'bg-accent text-white border-accent'
          : 'bg-primary text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent'
      }`}
    >
      {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {running ? stopLabel : label}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="spec-label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full border border-primary bg-card px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-accent focus:ring-1 focus:ring-accent rounded-none'
export const textareaCls = `${inputCls} min-h-28 resize-y font-mono-spec text-[13px] leading-relaxed`
export const selectCls = `${inputCls} appearance-none cursor-pointer`
