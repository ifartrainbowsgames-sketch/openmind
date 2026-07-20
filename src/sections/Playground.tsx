import { useState } from 'react'
import { capabilities } from '@/data/capabilities'
import { ChatDemo, TranslateDemo, CodeDemo } from '@/components/demos/TextDemos'
import { ImageDemo, SttDemo, TtsDemo } from '@/components/demos/MediaDemos'
import { DocQaDemo, SentimentDemo, SummarizeDemo, VisionDemo } from '@/components/demos/LocalDemos'
import type { JSX } from 'react'

const demoMap: Record<string, () => JSX.Element> = {
  chat: ChatDemo,
  image: ImageDemo,
  stt: SttDemo,
  tts: TtsDemo,
  translate: TranslateDemo,
  code: CodeDemo,
  docqa: DocQaDemo,
  sentiment: SentimentDemo,
  summarize: SummarizeDemo,
  vision: VisionDemo,
}

export default function Playground() {
  const [active, setActive] = useState('chat')
  const cap = capabilities.find((c) => c.id === active)!
  const Demo = demoMap[active]

  return (
    <section id="playground" className="border-b border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="spec-label mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 02 — the playground
            </p>
            <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
              Don't read the pitch.
              <br />
              <em className="font-normal italic text-accent">Test the product.</em>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            All ten capabilities below are runnable right now. The chatbot answers with real
            ChatGPT through our secure gateway — no key ever touches this page. The rest run
            genuinely in your browser or stream as labelled simulations. That distinction is
            the whole product, so we label it honestly.
          </p>
        </div>

        <div className="grid gap-0 border border-primary bg-card hard-shadow lg:grid-cols-[280px_1fr]">
          {/* numbered rail */}
          <div className="border-b border-primary lg:border-b-0 lg:border-r">
            <div className="border-b border-primary px-4 py-2.5">
              <span className="spec-label">select capability</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-1">
              {capabilities.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={`flex items-baseline gap-2.5 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-b-0 ${
                    active === c.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-secondary'
                  }`}
                >
                  <span className={`font-mono-spec text-[11px] ${active === c.id ? 'text-accent' : 'text-muted-foreground'}`}>
                    {c.index}
                  </span>
                  <span className="text-sm font-medium">{c.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* demo stage */}
          <div className="p-6 md:p-8">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 pb-4">
              <h3 className="font-serif-display text-2xl font-semibold">
                <span className="font-mono-spec text-sm font-normal text-accent">{cap.index} / </span>
                {cap.name}
              </h3>
              <span className="spec-label">{cap.tagline}</span>
            </div>
            <Demo />
          </div>
        </div>
      </div>
    </section>
  )
}
