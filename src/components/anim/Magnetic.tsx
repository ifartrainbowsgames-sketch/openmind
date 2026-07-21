import { useRef, type ReactNode } from 'react'
import { gsap, finePointer, prefersReduced } from '@/lib/anim'

/**
 * Magnetic hover — the wrapped element is gently pulled toward the cursor.
 * Desktop (fine pointer) only; the press itself is pure CSS (:active).
 */
export default function Magnetic({
  children,
  strength = 0.32,
  className,
}: {
  children: ReactNode
  strength?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el || !finePointer() || prefersReduced()) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2)
    const y = e.clientY - (r.top + r.height / 2)
    // only attract when the cursor is close, so far-away hovers stay put
    if (Math.abs(x) > r.width || Math.abs(y) > r.height * 2.5) return
    gsap.to(el, { x: x * strength, y: y * strength, duration: 0.4, ease: 'power3.out' })
  }

  const onLeave = () => {
    const el = ref.current
    if (!el) return
    gsap.to(el, { x: 0, y: 0, duration: 0.5, ease: 'power3.out' })
  }

  return (
    <div ref={ref} className={className} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  )
}
