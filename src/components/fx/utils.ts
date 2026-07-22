/**
 * Shared, SSR/test-safe environment guards for the motion foundation.
 * Every helper no-ops gracefully when `window` / `document` are missing
 * (vitest node environment, prerendering, etc.).
 */
import { flushSync } from 'react-dom'
import type { NavigateFunction, NavigateOptions, To } from 'react-router'

/** True when the user asked the OS to reduce motion. Missing matchMedia ⇒ false. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True when the browser supports the View Transitions API. */
export function supportsViewTransitions(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as Document).startViewTransition === 'function'
  )
}

/** View transitions run only when supported AND motion is allowed. */
export function shouldUseViewTransition(): boolean {
  return supportsViewTransitions() && !prefersReducedMotion()
}

/** True when IntersectionObserver is available (used by LazyThree). */
export function supportsIntersectionObserver(): boolean {
  return typeof window !== 'undefined' && 'IntersectionObserver' in window
}

/**
 * Imperative navigation wrapped in `document.startViewTransition`.
 * Progressive enhancement: falls back to a plain `navigate()` when the API
 * is missing or the user prefers reduced motion.
 *
 * `flushSync` forces React to commit the new route synchronously inside the
 * transition callback so the browser captures correct old/new snapshots.
 *
 * @example
 * const navigate = useNavigate()
 * navigateWithTransition(navigate, '/dashboard')
 */
export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To,
  options?: NavigateOptions,
): void {
  if (!shouldUseViewTransition()) {
    void navigate(to, options)
    return
  }
  document.startViewTransition(() => {
    flushSync(() => {
      void navigate(to, options)
    })
  })
}
