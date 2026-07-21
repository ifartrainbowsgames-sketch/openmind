import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flip } from 'gsap/Flip'
import { useEffect } from 'react'

gsap.registerPlugin(ScrollTrigger, Flip)

export const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const finePointer = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * Run a gsap.context-scoped setup inside `scope`, with automatic cleanup.
 * No-ops entirely when the user prefers reduced motion — because every
 * animation here uses gsap.from(), skipping means content renders naturally.
 */
export function useGsap(
  scope: React.RefObject<Element | null>,
  fn: () => void,
  deps: unknown[] = [],
) {
  useEffect(() => {
    if (prefersReduced()) return
    const ctx = gsap.context(fn, scope)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export { gsap, ScrollTrigger, Flip }
