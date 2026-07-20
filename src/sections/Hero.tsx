import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight, FlaskConical } from 'lucide-react'

interface LogLine {
  method: string
  path: string
  route: string
  ms: number
  ok: boolean
}

const ROUTES = [
  { path: '/v1/chat', route: '→ anthropic/claude-4' },
  { path: '/v1/chat', route: '→ ollama/llama3.3' },
  { path: '/v1/images', route: '→ together/flux.1' },
  { path: '/v1/audio/stt', route: '→ groq/whisper-v3' },
  { path: '/v1/chat', route: '→ openai/gpt-5' },
  { path: '/v1/rag/query', route: '→ vllm/self-hosted' },
  { path: '/v1/embed', route: '→ cohere/embed-v4' },
  { path: '/v1/translate', route: '→ deepl/v3' },
  { path: '/v1/vision', route: '→ google/gemini-3' },
  { path: '/v1/tts', route: '→ elevenlabs/v3' },
]

function randomLog(): LogLine {
  const r = ROUTES[Math.floor(Math.random() * ROUTES.length)]
  return {
    method: 'POST',
    path: r.path,
    route: r.route,
    ms: 18 + Math.floor(Math.random() * 180),
    ok: Math.random() > 0.03,
  }
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
    <div className="bg-terminal hard-shadow relative border border-primary">
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
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-3 whitespace-nowrap">
            <span className="text-white/35">{l.method}</span>
            <span className="text-white/85">{l.path}</span>
            <span className="hidden text-white/50 sm:inline">{l.route}</span>
            <span className="ml-auto text-white/40">{l.ms}ms</span>
            <span className={l.ok ? 'text-emerald-400' : 'text-accent'}>{l.ok ? '✓' : '✗'}</span>
          </div>
        ))}
        <div className="text-accent">
          ▍<span className="cursor-blink">▊</span>
        </div>
      </div>
    </div>
  )
}

const SPECS = [
  ['CAPABILITIES', '10'],
  ['PROVIDERS', '12+'],
  ['TOKEN MARKUP', '0%'],
  ['LICENSE', 'MIT'],
]

export default function Hero() {
  return (
    <section id="top" className="bg-ruled border-b border-border pt-40 pb-0">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-end gap-12 pb-16 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="spec-label mb-6 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 01 — the integration layer for AI
            </p>
            <h1 className="font-serif-display text-[13vw] font-semibold leading-[0.95] tracking-tight sm:text-7xl lg:text-[5.6rem]">
              Your models.
              <br />
              Your keys.
              <br />
              <em className="font-normal italic text-accent">One open stack.</em>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Ten AI capabilities — chatbot, vision, speech, RAG — as embeddable widgets and one
              unified API. They run on <strong className="text-foreground">your provider keys</strong>,
              we never mark up a single token, and the whole stack is MIT-licensed.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                className="h-13 rounded-none border border-primary bg-primary px-8 py-6 font-mono-spec text-sm uppercase tracking-[0.14em] hard-shadow hover:bg-accent hover:border-accent"
                asChild
              >
                <a href="#playground">
                  <FlaskConical className="mr-2 h-4 w-4" />
                  Test all 10 live
                </a>
              </Button>
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
            </div>
          </div>

          <RequestLog />
        </div>
      </div>

      {/* spec strip */}
      <div className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl grid-cols-2 md:grid-cols-4">
          {SPECS.map(([k, v], i) => (
            <div
              key={k}
              className={`flex items-baseline justify-between gap-3 px-6 py-5 ${
                i < SPECS.length - 1 ? 'border-r border-border/50' : ''
              }`}
            >
              <span className="spec-label">{k}</span>
              <span className="font-serif-display text-3xl font-semibold">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
