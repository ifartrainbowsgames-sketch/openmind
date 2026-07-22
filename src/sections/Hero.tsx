import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { gsap, useGsap, prefersReduced } from '@/lib/anim'
import Magnetic from '@/components/anim/Magnetic'
import HeroLattice from '@/components/site-fx/HeroLattice'

interface LogLine {
  id: number
  method: string
  path: string
  route: string
  ms: number
  ok: boolean
}

const ROUTES = [
  { path: '/v1/chat', route: '→ anthropic/claude-4' },
  { path: '/v1/chat', route: '→ ollama/llama3.3' },
  { path: '/v1/chat', route: '→ mistral/large-3' },
  { path: '/v1/chat', route: '→ groq/llama-3.3-70b' },
  { path: '/v1/chat', route: '→ openai/gpt-5' },
  { path: '/v1/chat', route: '→ vllm/self-hosted' },
  { path: '/v1/chat', route: '→ cohere/command-a' },
  { path: '/v1/chat', route: '→ google/gemini-3' },
  { path: '/v1/chat', route: '→ openrouter/auto' },
  { path: '/v1/chat', route: '→ azure/gpt-5' },
]

let logSeq = 0
function randomLog(): LogLine {
  const r = ROUTES[Math.floor(Math.random() * ROUTES.length)]
  return {
    id: ++logSeq,
    method: 'POST',
    path: r.path,
    route: r.route,
    ms: 18 + Math.floor(Math.random() * 180),
    ok: Math.random() > 0.03,
  }
}

/** Latency figure that counts up from zero when the line lands. */
function Ms({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReduced()) return
    const obj = { n: 0 }
    const tw = gsap.to(obj, {
      n: value,
      duration: 0.55,
      ease: 'power1.out',
      onUpdate: () => {
        el.textContent = `${Math.round(obj.n)}ms`
      },
    })
    return () => {
      tw.kill()
    }
  }, [value])
  return (
    <span ref={ref} className="ml-auto text-white/40">
      {value}ms
    </span>
  )
}

/** One log line — slides up into the feed when it mounts. */
function LogRow({ l }: { l: LogLine }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReduced()) return
    gsap.from(el, { y: 16, opacity: 0, duration: 0.4, ease: 'power2.out' })
  }, [])
  return (
    <div ref={ref} className="flex items-center gap-3 whitespace-nowrap">
      <span className="text-white/35">{l.method}</span>
      <span className="text-white/85">{l.path}</span>
      <span className="hidden text-white/50 sm:inline">{l.route}</span>
      <Ms value={l.ms} />
      <span className={l.ok ? 'text-emerald-400' : 'text-accent'}>{l.ok ? '✓' : '✗'}</span>
    </div>
  )
}

function RequestLog() {
  const [lines, setLines] = useState<LogLine[]>(() => Array.from({ length: 6 }, randomLog))

  useEffect(() => {
    const t = setInterval(() => {
      setLines((prev) => [...prev.slice(-13), randomLog()])
    }, 900)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="hero-log bg-terminal hard-shadow relative border border-primary">
      <div className="flex items-center justify-between border-b border-white/15 px-4 py-2.5">
        <span className="font-mono-spec text-[11px] uppercase tracking-[0.2em] text-white/50">
          live — gateway request log
        </span>
        <span className="flex items-center gap-1.5 font-mono-spec text-[11px] text-accent">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          streaming
        </span>
      </div>
      <div className="flex h-64 flex-col justify-end overflow-hidden px-4 py-3 font-mono-spec text-[12px] leading-7">
        {lines.map((l) => (
          <LogRow key={l.id} l={l} />
        ))}
        <div className="text-accent">
          ▍<span className="cursor-blink">▊</span>
        </div>
      </div>
    </div>
  )
}

const SPECS = [
  ['SERVICE', 'CHATBOT'],
  ['PROVIDERS', '12+'],
  ['TOKEN MARKUP', '0%'],
  ['LICENSE', 'MIT'],
]

/** Spec-strip figure — counts up if it starts with digits. */
function SpecValue({ v }: { v: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReduced()) return
    const m = v.match(/^(\d+)(.*)$/)
    if (!m) return
    const obj = { n: 0 }
    const tw = gsap.to(obj, {
      n: parseInt(m[1], 10),
      duration: 1.1,
      delay: 0.9,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = Math.round(obj.n) + m[2]
      },
    })
    return () => {
      tw.kill()
    }
  }, [v])
  return (
    <span ref={ref} className="font-serif-display text-3xl font-semibold">
      {v}
    </span>
  )
}

export default function Hero() {
  const ref = useRef<HTMLElement>(null)

  useGsap(ref, () => {
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } })
    // rubber stamp — two hard frames, like ink hitting paper
    tl.from('.hero-stamp', {
      scale: 1.6,
      rotation: -5,
      opacity: 0,
      duration: 0.3,
      ease: 'steps(3)',
      transformOrigin: 'left center',
    })
    // print-press line reveal
    tl.from(
      '.hero-line',
      { yPercent: 115, duration: 0.85, stagger: 0.14 },
      0.25,
    )
    tl.from('.hero-sub', { y: 24, opacity: 0, duration: 0.6 }, 0.9)
    tl.from('.hero-cta', { y: 20, opacity: 0, duration: 0.5, stagger: 0.1 }, 1.05)
    tl.from('.hero-log', { x: 48, opacity: 0, duration: 0.8 }, 0.7)
    tl.from('.hero-spec', { y: 14, opacity: 0, duration: 0.4, stagger: 0.08 }, 1.2)
  })

  return (
    <section id="top" ref={ref} className="bg-ruled relative overflow-hidden border-b border-border pt-40 pb-0">
      {/* lazy three.js lattice — sits behind all hero content, inert to input */}
      <HeroLattice className="hero-lattice pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-end gap-12 pb-16 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="hero-stamp spec-label mb-6 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 01 — the integration layer for AI
            </p>
            <h1 className="font-serif-display text-[13vw] font-semibold leading-[0.95] tracking-tight sm:text-7xl lg:text-[5.6rem]">
              <span className="block overflow-hidden pb-1">
                <span className="hero-line block">Your models.</span>
              </span>
              <span className="block overflow-hidden pb-1">
                <span className="hero-line block">Your keys.</span>
              </span>
              <span className="block overflow-hidden pb-2">
                <span className="hero-line block">
                  <em className="font-normal italic text-accent">One open stack.</em>
                </span>
              </span>
            </h1>
            <p className="hero-sub mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              An embeddable AI chatbot — trained on your docs, answered by any model you choose —
              as a two-line widget and one unified API. It runs on <strong className="text-foreground">your provider keys</strong>,
              we never mark up a single token, and the whole stack is MIT-licensed.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Magnetic className="hero-cta">
                <Button
                  size="lg"
                  className="h-13 rounded-none border border-primary bg-primary px-8 py-6 font-mono-spec text-sm uppercase tracking-[0.14em] hard-shadow hover:bg-accent hover:border-accent"
                  asChild
                >
                  <a href="#playground">
                    <FlaskConical className="mr-2 h-4 w-4" />
                    Test it live
                  </a>
                </Button>
              </Magnetic>
              <Magnetic className="hero-cta">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-13 rounded-none border-primary px-8 py-6 font-mono-spec text-sm uppercase tracking-[0.14em] hard-shadow-sm hover:bg-secondary"
                  asChild
                >
                  <a href="#integrate">
                    Read the docs <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </Magnetic>
            </div>
          </div>

          <RequestLog />
        </div>
      </div>

      {/* spec strip */}
      <div className="relative border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl grid-cols-2 md:grid-cols-4">
          {SPECS.map(([k, v], i) => (
            <div
              key={k}
              className={`hero-spec flex items-baseline justify-between gap-3 px-6 py-5 ${
                i < SPECS.length - 1 ? 'border-r border-border/50' : ''
              }`}
            >
              <span className="spec-label">{k}</span>
              <SpecValue v={v} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
