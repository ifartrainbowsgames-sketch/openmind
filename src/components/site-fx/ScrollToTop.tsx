/**
 * ScrollToTop — public-site route reset.
 *
 * Mounted once per public page (Home / Employees). On mount it jumps the
 * scroll position back to the top so View-Transition navigations never
 * land mid-page. Runs in a layout effect so the scroll happens before the
 * browser captures the new-view snapshot. Prefers the app-wide Lenis
 * instance (immediate, no smoothing) and falls back to window.scrollTo.
 */
import { useLayoutEffect } from 'react'
import { useLenis } from '@/components/fx'

export default function ScrollToTop() {
  const lenis = useLenis()

  useLayoutEffect(() => {
    if (lenis) {
      lenis.scrollTo(0, { immediate: true })
    } else if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
    // run on mount only — page-level component, remounts per route
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
