/**
 * View-Transitions-enabled navigation primitives.
 *
 * - `<TransitionLink>` — drop-in `NavLink` replacement. Clicks are routed
 *   through `document.startViewTransition` when supported (and motion is
 *   allowed); otherwise it's a plain client-side navigation. Modified clicks
 *   (cmd/ctrl/shift/alt, middle button, `target="_blank"`) fall through to
 *   the browser untouched.
 * - `navigateWithTransition(navigate, to)` — imperative equivalent, exported
 *   from `./utils` and from the fx barrel (`components/fx`).
 *
 * Design agents: swap existing `<NavLink>`/`<Link>` for `<TransitionLink>`
 * (same props, plus `className` + `activeClassName` strings). The crossfade
 * itself is defined globally in `index.css`; add the `.vt-page` class to a
 * page-level container for the per-page slide variant.
 */
import { forwardRef, type MouseEvent } from 'react'
import { NavLink, useNavigate, type NavLinkProps } from 'react-router'
import { navigateWithTransition } from './utils'

export interface TransitionLinkProps
  extends Omit<NavLinkProps, 'className' | 'onClick' | 'viewTransition'> {
  /** Base classes, always applied. */
  className?: string
  /** Extra classes applied while the link's route is active. */
  activeClassName?: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

export const TransitionLink = forwardRef<HTMLAnchorElement, TransitionLinkProps>(
  function TransitionLink(
    { className, activeClassName, onClick, ...rest },
    ref,
  ) {
    const navigate = useNavigate()

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        rest.target === '_blank'
      ) {
        return
      }
      event.preventDefault()
      navigateWithTransition(navigate, rest.to, {
        replace: rest.replace,
        state: rest.state,
        preventScrollReset: rest.preventScrollReset,
        relative: rest.relative,
      })
    }

    return (
      <NavLink
        ref={ref}
        {...rest}
        onClick={handleClick}
        className={({ isActive }) =>
          [className, isActive ? activeClassName : undefined]
            .filter(Boolean)
            .join(' ')
        }
      />
    )
  },
)
