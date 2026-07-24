import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import Magnetic from '@/components/anim/Magnetic'
import { TransitionLink } from '@/components/fx'

const links = [
  { label: 'Playground', href: '#playground' },
  { label: 'Employees', href: '/employees' },
  { label: 'Chatbot', href: '#capabilities' },
  { label: 'Providers', href: '#providers' },
  { label: 'Docs', href: '#integrate' },
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
      {/* top spec strip */}
      <div className="border-b border-border/40 bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-1 font-mono-spec text-[10px] uppercase tracking-[0.18em]">
          <span>v2.0 — BYOK release</span>
          <span className="hidden sm:block">zero token markup · mit licensed</span>
          <span className="text-accent">● early access prototype</span>
        </div>
      </div>

      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <a href="#top" className="flex items-baseline gap-2">
          <span className="font-serif-display text-2xl font-bold tracking-tight">
            OpenMind<span className="text-accent">.</span>
          </span>
          <span className="spec-label hidden sm:inline">integration layer</span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
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

        <div className="hidden items-center gap-3 md:flex">
          <Magnetic>
            <Button
              size="sm"
              asChild
              className="rounded-none border border-primary bg-primary font-mono-spec text-xs uppercase tracking-[0.14em] hard-shadow-sm hover:bg-accent hover:border-accent hover:text-white"
            >
              <TransitionLink to="/dashboard">Open console</TransitionLink>
            </Button>
          </Magnetic>
        </div>

        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-border bg-background md:hidden">
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
              <TransitionLink to="/dashboard" onClick={() => setOpen(false)}>Open console</TransitionLink>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
