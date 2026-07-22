// ── Employee detail modal ────────────────────────────────────────────────────
// Opened by hover-intent (desktop, ≥lg, ~300ms) or tap (any device) on a node
// in the EmployeeNetwork. Bottom-sheet on phones, centered card on desktop.
// GSAP fade+rise entrance, backdrop / X / Esc to close, close button autofocus.

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { ALL_TOOLS, CONNECTIONS, type Employee } from '@/lib/agent'
import { gsap, prefersReduced } from '@/lib/anim'
import { worksWithLine } from './network-model'

interface Props {
  employee: Employee
  onClose: () => void
}

export default function EmployeeModal({ employee, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Esc closes + autofocus the close button + lock body scroll while open.
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // GSAP entrance — skipped under prefers-reduced-motion (renders naturally).
  useEffect(() => {
    if (prefersReduced()) return
    const ctx = gsap.context(() => {
      gsap.from('.em-backdrop', { opacity: 0, duration: 0.22, ease: 'power1.out' })
      gsap.from('.em-card', { opacity: 0, y: 28, duration: 0.35, ease: 'power3.out' })
    }, wrapRef)
    return () => ctx.revert()
  }, [])

  const tools = employee.tools.map((id) => ({ id, name: ALL_TOOLS[id]?.name ?? id }))
  const services = (employee.connections ?? []).map((id) => ({ id, name: CONNECTIONS[id]?.name ?? id }))

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${employee.name} — ${employee.role}`}
    >
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="em-backdrop absolute inset-0 cursor-default bg-primary/70"
      />
      <div className="em-card relative max-h-[85dvh] w-full overflow-y-auto border border-primary bg-card sm:m-4 sm:max-w-lg">
        <div className="h-1.5" style={{ background: employee.accent }} />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center border border-border/60 bg-background text-muted-foreground transition-colors hover:border-accent hover:text-accent"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-5 sm:p-6">
          <p className="spec-label !text-[10px]">employee file</p>
          <h3 className="mt-2 font-serif-display text-3xl font-semibold tracking-tight">{employee.name}</h3>
          <p className="spec-label mt-1">{employee.role}</p>
          {employee.tagline && <p className="mt-3 text-sm text-muted-foreground">{employee.tagline}</p>}

          <p className="spec-label !text-[10px] mt-6 mb-2">brief — system prompt</p>
          <p className="line-clamp-4 border border-border/60 bg-background p-3 font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
            {employee.prompt}
          </p>

          {tools.length > 0 && (
            <>
              <p className="spec-label !text-[10px] mt-5 mb-2">desk tools</p>
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t) => (
                  <span
                    key={t.id}
                    className="border border-border/60 px-1.5 py-0.5 font-mono-spec text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </>
          )}

          {services.length > 0 && (
            <>
              <p className="spec-label !text-[10px] mt-5 mb-2">services</p>
              <div className="flex flex-wrap gap-1.5">
                {services.map((s) => (
                  <span
                    key={s.id}
                    className="border border-primary/70 px-1.5 py-0.5 font-mono-spec text-[10px] uppercase tracking-wider"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            </>
          )}

          <p className="mt-6 border-t border-border/60 pt-4 font-mono-spec text-[11px] leading-relaxed text-muted-foreground">
            Works with {worksWithLine(employee)} — connections are enabled later in your dashboard.
          </p>
        </div>
      </div>
    </div>
  )
}
