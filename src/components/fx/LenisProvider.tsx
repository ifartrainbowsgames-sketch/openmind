/**
 * Global Lenis smooth-scroll provider.
 *
 * Already wired app-wide in `src/App.tsx` — routes do NOT need to add it.
 *
 * Behavior:
 * - `lenis` is loaded via dynamic `import()` so it stays out of the entry chunk.
 * - Instantiated with `autoRaf: true` (Lenis drives its own rAF loop; no GSAP
 *   ticker integration needed — gsap animations are time-based, not scroll-tied).
 * - Respects `prefers-reduced-motion`: Lenis is never created and the page
 *   keeps native scrolling.
 * - Keeps native momentum scrolling on coarse-pointer touch devices.
 * - SSR/test-safe: no-op when `window`/`matchMedia` are unavailable.
 * - Destroyed on unmount (StrictMode double-mount safe).
 *
 * `useLenis()` returns the live Lenis instance or `null` (reduced motion,
 * still loading, or server). Use it for `lenis.scrollTo()`, `lenis.stop()`,
 * or to subscribe via `lenis.on('scroll', ...)`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type Lenis from 'lenis'
import type { LenisOptions } from 'lenis'
import { prefersReducedMotion } from './utils'

const LenisContext = createContext<Lenis | null>(null)

/** Returns the app-wide Lenis instance, or null (reduced motion / not ready). */
export function useLenis(): Lenis | null {
  return useContext(LenisContext)
}

export interface LenisProviderProps {
  children: ReactNode
  /** Optional Lenis overrides. Captured once on mount — memoize if dynamic. */
  options?: LenisOptions
}

export function LenisProvider({ children, options }: LenisProviderProps) {
  const [lenis, setLenis] = useState<Lenis | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (prefersReducedMotion()) return // keep native scroll
    if (window.matchMedia?.('(pointer: coarse)').matches) return // touch devices need native momentum + keyboard behavior

    let cancelled = false
    let instance: Lenis | null = null

    void import('lenis').then(({ default: LenisClass }) => {
      if (cancelled) return
      instance = new LenisClass({ autoRaf: true, ...options })
      setLenis(instance)
    })

    return () => {
      cancelled = true
      instance?.destroy()
      setLenis(null)
    }
    // options are captured once on mount by design
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>
}
