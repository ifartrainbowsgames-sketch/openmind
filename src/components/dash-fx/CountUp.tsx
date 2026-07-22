/**
 * dash-fx — CountUp: KPI numbers tween from 0 on first paint so magnitudes
 * read as quantities, not just digits. GSAP is dynamically imported (the
 * motion chunk never blocks the dashboard's first paint) and the final value
 * is rendered synchronously, so no-JS-motion environments lose nothing.
 */
import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/components/fx'

interface Props {
  value: number
  format?: (n: number) => string
  className?: string
  duration?: number
}

export default function CountUp({ value, format, className, duration = 0.9 }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString())

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    let killed = false
    let tween: { kill: () => void } | null = null
    const state = { v: 0 }
    void import('gsap').then(({ gsap }) => {
      if (killed) return
      tween = gsap.to(state, {
        v: value,
        duration,
        ease: 'power2.out',
        onUpdate: () => { el.textContent = fmt(state.v) },
      })
    })
    return () => {
      killed = true
      tween?.kill()
      el.textContent = fmt(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <span ref={ref} className={className}>
      {fmt(value)}
    </span>
  )
}
