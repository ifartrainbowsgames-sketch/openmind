/**
 * Lazy Rive host (canvas runtime).
 *
 * `@rive-app/react-canvas` is loaded via `React.lazy` + dynamic import, so
 * the Rive runtime/WASM ships as a separate chunk and never hits the entry
 * bundle. `fallback` renders inside Suspense while the runtime downloads.
 *
 * Under `prefers-reduced-motion` the animation never mounts — `fallback`
 * (a poster image, typically) is rendered statically instead.
 *
 * ```tsx
 * <LazyRive
 *   src="/anim/hero.riv"
 *   className="h-80 w-full"   // give the host an explicit size
 *   stateMachine="State Machine 1"
 *   fallback={<img src="/anim/hero-poster.jpg" alt="" />}
 * />
 * ```
 */
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { prefersReducedMotion } from './utils'

interface RivePlayerProps {
  src: string
  artboard?: string
  stateMachines?: string
  autoplay: boolean
}

/**
 * The player component is created inside the lazy factory so `useRive`
 * (and the whole canvas runtime) only loads on first render. The factory
 * runs at most once; afterwards React caches the component.
 */
const RivePlayer = lazy(async () => {
  const { useRive } = await import('@rive-app/react-canvas')
  function Player({ src, artboard, stateMachines, autoplay }: RivePlayerProps) {
    const { RiveComponent } = useRive({
      src,
      artboard,
      stateMachines,
      autoplay,
    })
    return <RiveComponent />
  }
  return { default: Player }
})

export interface LazyRiveProps {
  /** URL of the .riv file (put it in `public/`). */
  src: string
  /** Classes for the host div — the Rive canvas fills it. */
  className?: string
  /** Rendered while the runtime loads, and statically under reduced motion. */
  fallback?: ReactNode
  /** Rive artboard name (optional). */
  artboard?: string
  /** State machine to play (singular; mapped to Rive's `stateMachines` option). */
  stateMachine?: string
  /** Autoplay the animation/state machine. Defaults to true. */
  autoplay?: boolean
}

export function LazyRive({
  src,
  className,
  fallback = null,
  artboard,
  stateMachine,
  autoplay = true,
}: LazyRiveProps) {
  const [reducedMotion] = useState(() => prefersReducedMotion())

  if (reducedMotion) {
    return <div className={className}>{fallback}</div>
  }

  return (
    <div className={className}>
      <Suspense fallback={fallback}>
        <RivePlayer
          src={src}
          artboard={artboard}
          stateMachines={stateMachine}
          autoplay={autoplay}
        />
      </Suspense>
    </div>
  )
}
