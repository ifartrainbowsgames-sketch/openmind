import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowLeft, Blocks, Brain, ChevronRight, KeyRound, Palette, Play, Search,
  UserRound, Wrench, X, type LucideIcon,
} from 'lucide-react'
import {
  SECTION_META, SETTINGS_SECTIONS, scrollToAnchor, searchSettings, sectionPath,
  type SettingsSection,
} from '@/lib/settings-catalog'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  UserRound, Brain, KeyRound, Wrench, Play, Palette, Blocks,
}

function SectionIcon({ section, className }: { section: SettingsSection; className?: string }) {
  const Icon = ICONS[SECTION_META[section].icon] ?? UserRound
  return <Icon className={className} />
}

/**
 * Search over the catalog. Selecting a result navigates to its section and
 * scrolls to the row — the reason every row carries an anchor id.
 */
function SettingsSearch({ onNavigate }: { onNavigate: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const results = useMemo(() => searchSettings(query), [query])
  const inputRef = useRef<HTMLInputElement>(null)

  const go = (index: number) => {
    const hit = results[index]
    if (!hit) return
    setQuery('')
    onNavigate()
    navigate(sectionPath(hit.section))
    // The panel mounts on the next frame; scrolling before that finds nothing.
    window.setTimeout(() => scrollToAnchor(hit.anchor), 60)
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#a8a49c]" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); go(active) }
          else if (e.key === 'Escape') setQuery('')
        }}
        placeholder="Search settings"
        aria-label="Search settings"
        className="w-full rounded-xl border border-black/10 bg-white py-2 pl-9 pr-8 text-sm outline-none placeholder:text-[#a8a49c] focus:border-[#17140f]"
      />
      {query ? (
        <button
          type="button"
          onClick={() => { setQuery(''); inputRef.current?.focus() }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a8a49c] hover:bg-black/5"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {query ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg">
          {results.length ? (
            <ul role="listbox">
              {results.map((hit, i) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(i)}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                      i === active ? 'bg-[#f3f1ed]' : 'bg-white',
                    )}
                  >
                    <span>{hit.title}</span>
                    <span className="ml-3 shrink-0 text-[11px] text-[#a8a49c]">
                      {SECTION_META[hit.section].label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-[13px] text-[#8d8b84]">
              Nothing matches “{query.trim()}”.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Two-pane on desktop, drill-down on mobile. The same routes serve both, so a
 * link to /settings/keys opens the right thing on a phone and on a laptop.
 */
export default function SettingsLayout({
  section,
  children,
}: {
  section: SettingsSection
  children: ReactNode
}) {
  const meta = SECTION_META[section]
  const [mobileNav, setMobileNav] = useState(false)

  return (
    <div className="min-h-dvh bg-[#f3f1ed] text-[#17140f]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:py-10">
        {/* Sidebar — a plain list on desktop, a sheet on mobile. */}
        <aside
          className={cn(
            'lg:block lg:w-56 lg:shrink-0',
            mobileNav ? 'fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] lg:static lg:bg-transparent lg:backdrop-blur-none' : 'hidden',
          )}
          onClick={(e) => { if (e.target === e.currentTarget) setMobileNav(false) }}
        >
          <div className="h-full w-64 max-w-[85vw] overflow-y-auto bg-[#f3f1ed] p-4 lg:w-auto lg:max-w-none lg:overflow-visible lg:bg-transparent lg:p-0">
            <div className="mb-4 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileNav(false)}
                className="rounded-full p-1.5 text-[#8d8b84] hover:bg-black/5"
                aria-label="Close settings navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav aria-label="Settings sections">
              <ul className="space-y-0.5">
                {SETTINGS_SECTIONS.map((s) => (
                  <li key={s}>
                    <Link
                      to={sectionPath(s)}
                      onClick={() => setMobileNav(false)}
                      aria-current={s === section ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
                        s === section
                          ? 'bg-[#17140f] text-white'
                          : 'text-[#4a463f] hover:bg-black/5',
                      )}
                    >
                      <SectionIcon section={s} className="h-4 w-4 shrink-0" />
                      {SECTION_META[s].label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex items-center gap-3">
            <Link
              to="/app"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#4a463f] shadow-sm hover:bg-white/70"
              aria-label="Back to the app"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setMobileNav(true)}
              className="flex min-w-0 items-center gap-1.5 text-left lg:pointer-events-none"
            >
              <span className="text-[13px] text-[#8d8b84]">Settings</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a8a49c] lg:hidden" />
              <span className="truncate text-[13px] font-medium lg:hidden">{meta.label}</span>
            </button>
          </div>

          <div className="mb-5 lg:max-w-sm">
            <SettingsSearch onNavigate={() => setMobileNav(false)} />
          </div>

          <header className="mb-5">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{meta.label}</h1>
            <p className="mt-1 text-[13px] leading-snug text-[#8d8b84]">{meta.blurb}</p>
          </header>

          <div className="space-y-4 pb-16">{children}</div>
        </main>
      </div>
    </div>
  )
}

/** A titled card. Every settings row lives in one so the page reads as a list. */
export function SettingsCard({
  title,
  description,
  anchor,
  children,
  footer,
}: {
  title: string
  description?: string
  anchor?: { id: string; 'data-settings-anchor': string }
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <section
      {...anchor}
      className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-4 transition-shadow"
    >
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description ? (
        <p className="mt-1 text-[12px] leading-snug text-[#8d8b84]">{description}</p>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
      {footer ? <div className="mt-3 border-t border-black/5 pt-3">{footer}</div> : null}
    </section>
  )
}

/** Label + control on one line, stacking on narrow screens. */
export function SettingsRow({
  label,
  hint,
  control,
}: {
  label: string
  hint?: string
  control: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-[#8d8b84]">{hint}</p> : null}
      </div>
      <div className="sm:w-64 sm:shrink-0">{control}</div>
    </div>
  )
}

export const inputClass =
  'w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2 text-sm outline-none focus:border-[#17140f]'
