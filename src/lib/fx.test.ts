/**
 * Tests for the motion-foundation guards in src/components/fx/utils.ts.
 * Runs in vitest's node environment (no DOM), which doubles as a check
 * that every helper is SSR/test-safe by default.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prefersReducedMotion,
  supportsViewTransitions,
  shouldUseViewTransition,
  supportsIntersectionObserver,
  navigateWithTransition,
} from '../components/fx/utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('returns false when window is missing (SSR/test)', () => {
    expect(prefersReducedMotion()).toBe(false)
  })

  it('returns false when matchMedia is not a function', () => {
    vi.stubGlobal('window', {})
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reflects the media query when matchMedia exists', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({
        matches: q === '(prefers-reduced-motion: reduce)',
        media: q,
      }),
    })
    expect(prefersReducedMotion()).toBe(true)
  })
})

describe('supportsViewTransitions', () => {
  it('returns false when document is missing', () => {
    expect(supportsViewTransitions()).toBe(false)
  })

  it('returns false when startViewTransition is absent', () => {
    vi.stubGlobal('document', {})
    expect(supportsViewTransitions()).toBe(false)
  })

  it('returns true when startViewTransition exists', () => {
    vi.stubGlobal('document', { startViewTransition: () => undefined })
    expect(supportsViewTransitions()).toBe(true)
  })
})

describe('shouldUseViewTransition', () => {
  it('is false without API support', () => {
    expect(shouldUseViewTransition()).toBe(false)
  })

  it('is false when the API exists but motion is reduced', () => {
    vi.stubGlobal('document', { startViewTransition: () => undefined })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    })
    expect(shouldUseViewTransition()).toBe(false)
  })

  it('is true when supported and motion is allowed', () => {
    vi.stubGlobal('document', { startViewTransition: () => undefined })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })
    expect(shouldUseViewTransition()).toBe(true)
  })
})

describe('supportsIntersectionObserver', () => {
  it('returns false without window', () => {
    expect(supportsIntersectionObserver()).toBe(false)
  })

  it('returns true when IntersectionObserver exists', () => {
    vi.stubGlobal('window', { IntersectionObserver: class {} })
    expect(supportsIntersectionObserver()).toBe(true)
  })
})

describe('navigateWithTransition', () => {
  it('falls back to plain navigate when unsupported', () => {
    const navigate = vi.fn()
    navigateWithTransition(navigate, '/dashboard')
    expect(navigate).toHaveBeenCalledWith('/dashboard', undefined)
  })

  it('falls back to plain navigate under reduced motion', () => {
    vi.stubGlobal('document', {
      startViewTransition: vi.fn(),
    })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    })
    const navigate = vi.fn()
    navigateWithTransition(navigate, '/login', { replace: true })
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
    expect(
      (document as unknown as { startViewTransition: unknown }).startViewTransition,
    ).not.toHaveBeenCalled()
  })

  it('wraps navigation in startViewTransition when available', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb()
    })
    vi.stubGlobal('document', { startViewTransition })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })
    const navigate = vi.fn()
    navigateWithTransition(navigate, '/employees')
    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('/employees', undefined)
  })
})
