import { providers } from '@/data/capabilities'

const TICKER = [...providers, ...providers]

export default function Providers() {
  return (
    <section id="providers" className="border-b border-border bg-primary py-24 text-primary-foreground">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12">
          <p className="spec-label mb-4 flex items-center gap-3 !text-white/50">
            <span className="inline-block h-2 w-2 bg-accent" />
            Fig. 04 — provider matrix
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            Connect <em className="font-normal italic text-accent">anything.</em>
          </h2>
          <p className="mt-6 max-w-2xl text-white/60">
            Cloud giants, fast routers, or a laptop under your desk running Ollama. If it speaks
            the OpenAI API format — and everything does now — it plugs in.
          </p>
        </div>

        {/* stamp grid */}
        <div className="grid grid-cols-2 border-l border-t border-white/20 sm:grid-cols-3 lg:grid-cols-4">
          {providers.map((p, i) => (
            <div
              key={p.name}
              className="group relative border-b border-r border-white/20 px-5 py-7 transition-colors hover:bg-white/5"
            >
              <span className="font-mono-spec text-[10px] text-white/35">{String(i + 1).padStart(2, '0')}</span>
              <div className="mt-2 font-serif-display text-xl font-semibold">{p.name}</div>
              <div className="mt-1 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-white/45">
                {p.type}
              </div>
              <span className="absolute right-4 top-4 h-2 w-2 rounded-full bg-white/20 transition-colors group-hover:bg-accent" />
            </div>
          ))}
          {/* fill tile */}
          <div className="flex items-center justify-center border-b border-r border-white/20 bg-accent px-5 py-7">
            <span className="font-mono-spec text-xs uppercase tracking-[0.16em] text-white">
              + your endpoint
            </span>
          </div>
        </div>
      </div>

      {/* ticker */}
      <div className="mt-16 overflow-hidden border-y border-white/20 py-3">
        <div className="animate-marquee flex w-max gap-10 font-mono-spec text-xs uppercase tracking-[0.2em] text-white/50">
          {TICKER.map((p, i) => (
            <span key={i} className="flex items-center gap-10">
              {p.name} <span className="text-accent">·</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
