/**
 * Lazy, viewport-gated Three.js host.
 *
 * Keeps `three` OUT of the main bundle: the library is dynamic-imported the
 * first time the host element scrolls near the viewport (IntersectionObserver,
 * `rootMargin` preload zone). Design agents supply the scene; this component
 * supplies the full lifecycle.
 *
 * Contract:
 * ```tsx
 * <LazyThree className="h-96" fallback={<img src="/poster.jpg" alt="" />}>
 *   {(THREE, canvas) => {
 *     const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
 *     // ...build scene, start rAF loop...
 *     return () => { cancelAnimationFrame(id); renderer.dispose() }
 *   }}
 * </LazyThree>
 * ```
 *
 * - `children(three, canvas)` runs when visible and must return a cleanup
 *   that stops the rAF loop and disposes the renderer. It is re-invoked when
 *   the element re-enters the viewport after leaving it — so setup must be
 *   idempotent and the cleanup must fully pause the scene.
 * - Offscreen ⇒ the latest cleanup is called (rendering pauses).
 * - Unmount ⇒ cleanup + canvas removal + observer disconnect.
 * - Reduced motion ⇒ the canvas is never created; `fallback` (or nothing)
 *   is rendered instead. When IntersectionObserver is missing entirely the
 *   scene mounts immediately (degraded but functional).
 * - Size the host via `className`; the canvas fills it (100% × 100%).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { prefersReducedMotion, supportsIntersectionObserver } from './utils'

export type ThreeModule = typeof import('three')
export type ThreeSetupFn = (
  three: ThreeModule,
  canvas: HTMLCanvasElement,
) => (() => void) | void

export interface LazyThreeProps {
  /** Classes for the host div — give it an explicit size. */
  className?: string
  /** Static content rendered instead of the canvas under reduced motion. */
  fallback?: ReactNode
  /** Scene setup: receives the three module + canvas, returns a cleanup. */
  children: ThreeSetupFn
  /** Preload margin so the scene is ready before it enters view. */
  rootMargin?: string
  /** IntersectionObserver threshold (0 = any visible pixel). */
  threshold?: number
}

export function LazyThree({
  className,
  fallback = null,
  children,
  rootMargin = '200px',
  threshold = 0,
}: LazyThreeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const setupRef = useRef<ThreeSetupFn>(children)
  const [reducedMotion] = useState(() => prefersReducedMotion())

  useEffect(() => {
    setupRef.current = children
  }, [children])

  useEffect(() => {
    if (reducedMotion) return
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let threeModule: ThreeModule | null = null
    let canvas: HTMLCanvasElement | null = null
    let cleanup: (() => void) | void
    let mounted = false

    const mount = async () => {
      if (mounted) return
      mounted = true
      threeModule ??= await import('three')
      if (disposed || !mounted) return
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.style.display = 'block'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        host.appendChild(canvas)
      }
      cleanup = setupRef.current(threeModule, canvas)
    }

    const unmount = () => {
      if (!mounted) return
      mounted = false
      cleanup?.()
      cleanup = undefined
    }

    const teardown = () => {
      disposed = true
      unmount()
      canvas?.remove()
      canvas = null
    }

    if (!supportsIntersectionObserver()) {
      void mount()
      return teardown
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void mount()
          else unmount()
        }
      },
      { rootMargin, threshold },
    )
    observer.observe(host)

    return () => {
      observer.disconnect()
      teardown()
    }
  }, [reducedMotion, rootMargin, threshold])

  if (reducedMotion) {
    return <div className={className}>{fallback}</div>
  }
  return <div ref={hostRef} className={className} />
}
