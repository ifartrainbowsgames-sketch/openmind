import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import Magnetic from '@/components/anim/Magnetic'
import { TransitionLink } from '@/components/fx'

const links = [
  { label: 'Playground', href: '#playground' },
  { label: 'Mobile app', href: '/app' },
  { label: 'Employees', href: '/employees' },
  { label: 'Chatbot', href: '#capabilities' },
  { label: 'Automations', href: '#employees' },
  { label: 'Security', href: '#security' },
  { label: 'Pricing', href: '#pricing' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 border-b bg-background/95 backdrop-blur-sm transition-shadow ${
        scrolled ? 'border-border' : 'border-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <a href="#top" className="flex items-baseline gap-2">
          <span className="font-serif-display text-2xl font-bold tracking-tight">
            OpenMind<span className="text-accent">.</span>
          </span>
          <span className="spec-label hidden sm:inline">customer support</span>
        </a>

        <div className="hidden items-center gap-6 lg:flex">
          {links.map((l) =>
            l.href.startsWith('/') ? (
              <TransitionLink
                key={l.href}
                to={l.href}
                className="font-mono-spec text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-accent"
                activeClassName="text-accent"
              >
                {l.label}
              </TransitionLink>
            ) : (
              <a
                key={l.href}
                href={l.href}
                className="font-mono-spec text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-accent"
              >
                {l.label}
              </a>
            ),
          )}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <Magnetic>
            <Button
              size="sm"
              asChild
              className="rounded-none border border-primary bg-primary font-mono-spec text-xs uppercase tracking-[0.14em] hard-shadow-sm hover:bg-accent hover:border-accent hover:text-white"
            >
              <TransitionLink to="/dashboard">Get started</TransitionLink>
            </Button>
          </Magnetic>
        </div>

        <button className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <div className="flex flex-col gap-1 px-6 py-4">
            {links.map((l) =>
              l.href.startsWith('/') ? (
                <TransitionLink
                  key={l.href}
                  to={l.href}
                  onClick={() => setOpen(false)}
                  className="px-2 py-2.5 font-mono-spec text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
                  activeClassName="text-accent"
                >
                  {l.label}
                </TransitionLink>
              ) : (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="px-2 py-2.5 font-mono-spec text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
                >
                  {l.label}
                </a>
              ),
            )}
            <Button asChild className="mt-2 rounded-none bg-primary font-mono-spec text-xs uppercase tracking-[0.14em]">
              <TransitionLink to="/dashboard" onClick={() => setOpen(false)}>Get started</TransitionLink>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
