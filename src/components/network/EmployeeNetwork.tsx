// ── Employee network — the centerpiece of the public /employees page ─────────
// One large animated panel: employee nodes as the heroes, their services as
// small satellite chips fanned above each card, thin connector lines, message
// packets travelling between employees, floating handoff captions and a
// cycling "working on…" status per node. All motion is GSAP, transform-only,
// one gsap.context per team, and fully static under prefers-reduced-motion.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CONNECTIONS, type Employee } from '@/lib/agent'
import { finePointer, gsap, prefersReduced, useGsap } from '@/lib/anim'
import EmployeeModal from './EmployeeModal'
import {
  NODE_H,
  NODE_W,
  buildEdges,
  computeLayout,
  eventForEdge,
  packetCaption,
  satelliteOffsets,
  seeded,
  taskLinesFor,
  type NetPoint,
  type NetworkEvent,
} from './network-model'

interface Props {
  team: Employee[]
  isDemo: boolean
  /**
   * Real handoffs to visualise. Omitted or empty means nothing has moved, and
   * the graph renders topology only — no captions, no invented traffic.
   */
  events?: NetworkEvent[]
  /** Live status per employee id, for nodes actually running right now. */
  liveStatus?: Record<string, string>
}

const MAX_PACKETS = 6
const MAX_CAPTIONS = 3

const sameTeam = (a: Employee[], b: Employee[]) =>
  a.length === b.length && a.every((e, i) => e.id === b[i].id)

export default function EmployeeNetwork({ team, isDemo, events, liveStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [shown, setShown] = useState(team)
  const [selected, setSelected] = useState<Employee | null>(null)
  const hoverTimer = useRef<number | null>(null)

  // ── measure the panel ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const compact = size.w > 0 && size.w < 640
  const nodeW = compact ? 148 : NODE_W
  const padTop = compact ? 66 : 72
  const satR = compact ? { x: 56, y: 74 } : { x: 84, y: 74 }

  const layout = useMemo(
    () => computeLayout(size.w, size.h, shown.length, nodeW, NODE_H, padTop),
    [size.w, size.h, shown.length, nodeW, padTop],
  )
  const edges = useMemo(() => buildEdges(shown.length), [shown.length])
  const satellites = useMemo(
    () => shown.map((e, i) => satelliteOffsets((e.connections ?? []).length, satR.x, satR.y, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, compact],
  )

  // Live refs so in-flight tweens follow resizes without rebuilding the context.
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  // ── team swap: stagger the old crew out, then the new team pops in ─────────
  // Reduced motion swaps instantly (adjust-state-during-render pattern);
  // otherwise the effect below animates the old nodes out first.
  const [lastTeam, setLastTeam] = useState(team)
  if (team !== lastTeam) {
    setLastTeam(team)
    if (prefersReduced()) setShown(team)
  }
  useEffect(() => {
    if (sameTeam(shown, team) || prefersReduced()) return
    const nodes = containerRef.current?.querySelectorAll('.en-node')
    if (!nodes || nodes.length === 0) {
      const t = window.setTimeout(() => setShown(team), 0)
      return () => window.clearTimeout(t)
    }
    const tween = gsap.to(nodes, {
      opacity: 0,
      scale: 0.82,
      y: -10,
      duration: 0.26,
      stagger: 0.055,
      ease: 'power2.in',
      onComplete: () => setShown(team),
    })
    return () => {
      tween.kill()
    }
  }, [team, shown])

  // ── hover-intent (desktop ≥lg, fine pointer) / tap anywhere ───────────────
  const clearHover = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  useEffect(() => clearHover, [])

  const openModal = (emp: Employee) => {
    clearHover()
    setSelected(emp)
  }
  const onNodeEnter = (emp: Employee) => {
    if (!finePointer() || !window.matchMedia('(min-width: 1024px)').matches) return
    clearHover()
    hoverTimer.current = window.setTimeout(() => setSelected(emp), 300)
  }

  // ── GSAP life: entrance, drift, packets, captions, task statuses ───────────
  const packetRefs = useRef<(HTMLDivElement | null)[]>([])
  const captionRefs = useRef<(HTMLDivElement | null)[]>([])

  useGsap(
    containerRef,
    () => {
      const root = containerRef.current
      if (!root) return

      // entrance — staggered pop
      gsap.from(root.querySelectorAll('.en-node'), {
        opacity: 0,
        scale: 0.7,
        y: 16,
        duration: 0.5,
        ease: 'back.out(1.7)',
        stagger: 0.09,
      })
      gsap.from(root.querySelectorAll('.en-edge'), {
        opacity: 0,
        duration: 0.9,
        delay: 0.25,
        stagger: 0.04,
        ease: 'power1.out',
      })

      // gentle drift — transform-only sine motion, deterministic phases
      root.querySelectorAll<HTMLElement>('.en-drift').forEach((el, i) => {
        gsap.to(el, {
          x: 4 + seeded(i, 21) * 5,
          duration: 2.8 + seeded(i, 23) * 1.6,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        })
        gsap.to(el, {
          y: 4 + seeded(i, 22) * 5,
          duration: 3.4 + seeded(i, 24) * 1.6,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        })
      })

      // message packets — dots travelling between employees along the edges
      packetRefs.current.slice(0, edges.length).forEach((el, i) => {
        if (!el) return
        const state = { t: 0 }
        gsap.to(state, {
          t: 1,
          duration: 2.1 + seeded(i, 31) * 0.9,
          repeat: -1,
          repeatDelay: 1.1 + seeded(i, 32) * 2.4,
          delay: seeded(i, 33) * 2,
          ease: 'none',
          onUpdate: () => {
            const pts = layoutRef.current
            const e = edges[i]
            const a: NetPoint | undefined = pts[e.from]
            const b: NetPoint | undefined = pts[e.to]
            if (!a || !b) return
            const t = state.t
            const x = a.x + (b.x - a.x) * t
            const y = a.y + (b.y - a.y) * t
            el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
            el.style.opacity = String(Math.sin(Math.PI * t) * 0.9)
          },
        })
      })

      // Handoff captions ride an edge ONLY when a real event says something
      // moved across it. No event, no caption — the animation shows topology,
      // it does not narrate work that did not happen.
      captionRefs.current.slice(0, edges.length).forEach((el, i) => {
        if (!el) return
        const e = edges[i]
        const from = shown[e.from]
        const to = shown[e.to]
        if (!from || !to) return
        const event = eventForEdge(events, from, to)
        if (!event) {
          el.style.opacity = '0'
          return
        }
        let cycle = 0
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 5 + i * 1.7, delay: 1.6 + i * 1.3 })
        tl.call(() => {
          cycle += 1
          const text = el.firstElementChild
          if (text) text.textContent = packetCaption(from, to, event)
          const pts = layoutRef.current
          const a = pts[e.from]
          const b = pts[e.to]
          if (!a || !b) return
          const t = 0.3 + seeded(cycle, 41) * 0.4
          el.style.left = `${a.x + (b.x - a.x) * t}px`
          el.style.top = `${a.y + (b.y - a.y) * t}px`
        })
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' })
        tl.to(el, { opacity: 0, duration: 0.4, ease: 'power2.in' }, '+=1.7')
      })

      // task statuses — each node cycles what it's working on
      root.querySelectorAll<HTMLElement>('.en-status').forEach((el, i) => {
        const lines = taskLinesFor(shown[i], liveStatus?.[shown[i]?.id])
        if (lines.length < 2) return
        let idx = 0
        const tl = gsap.timeline({ repeat: -1, delay: i * 0.9, repeatDelay: 2.8 + seeded(i, 51) })
        tl.to(el, { opacity: 0, duration: 0.28, ease: 'power1.in' })
        tl.call(() => {
          idx = (idx + 1) % lines.length
          el.textContent = lines[idx]
        })
        tl.to(el, { opacity: 1, duration: 0.28, ease: 'power1.out' })
      })
    },
    [shown, compact, events, liveStatus],
  )

  const point = (i: number): NetPoint => layout[i] ?? { x: size.w / 2, y: size.h / 2 }

  return (
    <section aria-label="Employee network">
      <div className="mb-3 flex items-end justify-between gap-4">
        <p className="spec-label flex items-center gap-3">
          <span className="inline-block h-2 w-2 bg-accent" /> How they'll work
        </p>
        <p className="hidden font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:block">
          tap an employee for their file
        </p>
      </div>

      <div
        ref={containerRef}
        className="hard-shadow relative h-[540px] w-full overflow-hidden border border-primary bg-card sm:h-[560px] lg:h-[600px]"
      >
        <span className="absolute right-2.5 top-2.5 z-10 border border-border/60 bg-background px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {isDemo ? 'Demo team — build yours above' : 'Your team — saved · manage in the dashboard'}
        </span>

        {size.w > 0 && (
          <>
            {/* edges + satellite connectors */}
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${size.w} ${size.h}`}
              aria-hidden="true"
            >
              {edges.map((e, i) => {
                const a = point(e.from)
                const b = point(e.to)
                return (
                  <line
                    key={`edge-${i}`}
                    className="en-edge"
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#17140f"
                    strokeOpacity="0.2"
                    strokeWidth="1"
                  />
                )
              })}
              {shown.map((emp, i) => {
                const p = point(i)
                return (satellites[i] ?? []).map((s, k) => (
                  <line
                    key={`sat-${emp.id}-${k}`}
                    className="en-edge"
                    x1={p.x}
                    y1={p.y}
                    x2={p.x + s.dx}
                    y2={p.y + s.dy}
                    stroke="#17140f"
                    strokeOpacity="0.3"
                    strokeWidth="1"
                  />
                ))
              })}
            </svg>

            {/* message packets */}
            {edges.slice(0, MAX_PACKETS).map((_, i) => (
              <div
                key={`pkt-${i}`}
                ref={(el) => {
                  packetRefs.current[i] = el
                }}
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 h-1.5 w-1.5 bg-accent"
                style={{ opacity: 0 }}
              />
            ))}

            {/* floating handoff captions — desktop only, phones stay clean */}
            {!compact &&
              edges.slice(0, MAX_CAPTIONS).map((_, i) => (
                <div
                  key={`cap-${i}`}
                  ref={(el) => {
                    captionRefs.current[i] = el
                  }}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 z-10"
                  style={{ opacity: 0 }}
                >
                  <span className="block -translate-x-1/2 -translate-y-full whitespace-nowrap border border-border/60 bg-background px-1.5 py-0.5 font-mono-spec text-[9px] text-muted-foreground" />
                </div>
              ))}

            {/* employee nodes */}
            {shown.map((emp, i) => {
              const p = point(i)
              const sats = satellites[i] ?? []
              const conns = emp.connections ?? []
              return (
                <div
                  key={emp.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${emp.name}, ${emp.role} — open employee file`}
                  className="en-node absolute cursor-pointer outline-none"
                  style={{ left: p.x - nodeW / 2, top: p.y - NODE_H / 2, width: nodeW, height: NODE_H }}
                  onMouseEnter={() => onNodeEnter(emp)}
                  onMouseLeave={clearHover}
                  onClick={() => openModal(emp)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openModal(emp)
                    }
                  }}
                >
                  <div className="en-drift">
                    <div className="hard-shadow-sm border border-primary bg-card text-left transition-colors focus-visible:border-accent hover:border-accent">
                      <div className="h-1" style={{ background: emp.accent }} />
                      <div className="px-2.5 py-2 sm:px-3">
                        <div className="font-serif-display text-base font-semibold leading-tight sm:text-lg">
                          {emp.name}
                        </div>
                        <div className="spec-label mt-0.5 !text-[9px]">{emp.role}</div>
                        <div className="en-status mt-1.5 truncate font-mono-spec text-[9px] text-accent">
                          {taskLinesFor(emp, liveStatus?.[emp.id])[0]}
                        </div>
                      </div>
                    </div>
                    {conns.map((cid, k) => {
                      const s = sats[k]
                      if (!s) return null
                      return (
                        <span
                          key={cid}
                          aria-hidden="true"
                          className="absolute border border-border/70 bg-background px-1.5 py-px font-mono-spec text-[8px] uppercase tracking-[0.12em] text-muted-foreground"
                          style={{
                            left: nodeW / 2 + s.dx,
                            top: NODE_H / 2 + s.dy,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          {CONNECTIONS[cid]?.name ?? cid}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {selected && <EmployeeModal employee={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}
