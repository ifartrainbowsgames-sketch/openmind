/**
 * Motion foundation — public API for the design agents (E2/E3).
 *
 * - `<LenisProvider>` / `useLenis()` — global smooth scroll (wired in App).
 * - `<TransitionLink>` / `navigateWithTransition()` — View Transitions nav.
 * - `<LazyThree>` — viewport-gated, code-split Three.js host.
 * - `<LazyRive>` — code-split Rive (canvas runtime) host.
 * - `prefersReducedMotion()` etc. — shared environment guards.
 */
export { LenisProvider, useLenis, type LenisProviderProps } from './LenisProvider'
export {
  TransitionLink,
  type TransitionLinkProps,
} from './ViewTransitionLink'
export {
  LazyThree,
  type LazyThreeProps,
  type ThreeModule,
  type ThreeSetupFn,
} from './LazyThree'
export { LazyRive, type LazyRiveProps } from './LazyRive'
export {
  navigateWithTransition,
  prefersReducedMotion,
  supportsViewTransitions,
  shouldUseViewTransition,
  supportsIntersectionObserver,
} from './utils'
