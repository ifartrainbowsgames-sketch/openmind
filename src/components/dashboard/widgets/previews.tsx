import {
  Camera, Mic, Play, Square, Languages, AlignLeft, FileSearch, Search, ScanEye,
} from 'lucide-react'

/** Shared brand config every widget type understands. */
export interface SharedCfg {
  accent: string
  theme: 'light' | 'dark'
  radius: 'sharp' | 'soft' | 'round'
}

export const DEFAULT_SHARED: SharedCfg = { accent: '#ff4d00', theme: 'light', radius: 'soft' }

type Cfg = Record<string, string | boolean>

const rad = (r: string) => (r === 'sharp' ? 'rounded-none' : r === 'round' ? 'rounded-2xl' : 'rounded-xl')

function Shell({
  shared, label, children,
}: { shared: SharedCfg; label: string; children: React.ReactNode }) {
  const dark = shared.theme === 'dark'
  return (
    <div className="mx-auto flex h-[560px] max-w-[400px] flex-col items-center justify-center">
      <div
        className={`w-full border ${rad(shared.radius)} ${
          dark ? 'border-white/15 bg-[#17140f] text-[#faf8f5]' : 'border-[#17140f]/15 bg-white text-[#17140f]'
        } shadow-xl`}
      >
        <div
          className={`flex items-center justify-between border-b px-4 py-2.5 ${
            dark ? 'border-white/10' : 'border-black/10'
          }`}
        >
          <span className="text-xs font-semibold">{label}</span>
          <span className="h-2 w-2 rounded-full" style={{ background: shared.accent }} />
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

// ── Vision ───────────────────────────────────────────────────────────────────

export function VisionPreview({ shared, cfg }: { shared: SharedCfg; cfg: Cfg }) {
  const mode = String(cfg.mode ?? 'caption')
  const result =
    mode === 'moderate'
      ? '✓ safe — no policy flags'
      : mode === 'qa'
        ? '“There are 3 people in the photo.”'
        : '“A golden retriever sitting in tall grass.”'
  return (
    <Shell shared={shared} label="Visual answers">
      <div
        className={`flex h-36 flex-col items-center justify-center gap-2 border-2 border-dashed ${rad(shared.radius)}`}
        style={{ borderColor: shared.accent }}
      >
        <ScanEye className="h-7 w-7" style={{ color: shared.accent }} />
        <span className="text-xs opacity-60">drop a photo — or tap to upload</span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-md" style={{ background: `linear-gradient(135deg, ${shared.accent}, ${shared.accent}66)` }} />
        <div className="min-w-0">
          <p className="text-sm leading-snug">{result}</p>
          {Boolean(cfg.confidence) && (
            <span className="mt-1 inline-block font-mono-spec text-[10px] uppercase tracking-wider opacity-50">
              {mode} · 98.2% confidence
            </span>
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] opacity-40">mode: {mode} · powered by OpenMind</p>
    </Shell>
  )
}

// ── Speech-to-text mic ───────────────────────────────────────────────────────

export function SttPreview({ shared, cfg }: { shared: SharedCfg; cfg: Cfg }) {
  return (
    <Shell shared={shared} label="Voice input">
      <div className="flex flex-col items-center py-4">
        <button
          className="relative flex h-16 w-16 items-center justify-center rounded-full text-white"
          style={{ background: shared.accent }}
          aria-label="Push to talk"
        >
          <span className="pulse-dot absolute inset-0 rounded-full border-2" style={{ borderColor: shared.accent }} />
          <Mic className="h-7 w-7" />
        </button>
        <div className="mt-4 flex h-8 items-end gap-1">
          {Array.from({ length: 18 }).map((_, i) => (
            <span
              key={i}
              className="w-1 rounded-full"
              style={{
                background: shared.accent,
                height: `${8 + ((i * 31) % 24)}px`,
                animation: `pulse-dot ${0.5 + (i % 5) * 0.12}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
        <p className="mt-3 text-sm italic opacity-70">“Book a demo for Thursday at two…”</p>
        <p className="mt-2 text-center text-[10px] opacity-40">
          {String(cfg.language ?? 'auto-detect')} · {cfg.autoSend ? 'sends on pause' : 'tap to send'} · powered by OpenMind
        </p>
      </div>
    </Shell>
  )
}

// ── Text-to-speech player ────────────────────────────────────────────────────

export function TtsPreview({ shared, cfg }: { shared: SharedCfg; cfg: Cfg }) {
  const compact = Boolean(cfg.compact)
  return (
    <Shell shared={shared} label="Listen to this page">
      <div className="flex items-center gap-3">
        <button
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: shared.accent }}
          aria-label="Play"
        >
          <Play className="ml-0.5 h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          {!compact && <p className="truncate text-sm font-medium">Pricing, explained out loud</p>}
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full" style={{ width: '34%', background: shared.accent }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] opacity-50">
            <span>1:12</span>
            <span>{String(cfg.voice ?? 'Aria')} · {String(cfg.speed ?? '1.0')}×</span>
            <span>3:48</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] opacity-40">reads your content aloud · powered by OpenMind</p>
    </Shell>
  )
}

// ── Translator bar ───────────────────────────────────────────────────────────

export function TranslatePreview({ shared, cfg }: { shared: SharedCfg; cfg: Cfg }) {
  const langs = String(cfg.languages ?? 'FR,ES,DE,JA').split(',').map((s) => s.trim()).filter(Boolean)
  return (
    <Shell shared={shared} label="Read this in your language">
      <div className="flex flex-wrap items-center gap-1.5">
        <Languages className="mr-1 h-4 w-4" style={{ color: shared.accent }} />
        {langs.map((l, i) => (
          <span
            key={l}
            className={`border px-2.5 py-1 font-mono-spec text-[11px] ${i === 0 ? 'text-white' : 'opacity-70'}`}
            style={i === 0 ? { background: shared.accent, borderColor: shared.accent } : { borderColor: `${shared.accent}55` }}
          >
            {l}
          </span>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-sm line-through opacity-40">Our refund policy allows returns within 30 days…</p>
        <p className="text-sm">« Notre politique de remboursement autorise les retours sous 30 jours… »</p>
      </div>
      <p className="mt-3 text-center text-[10px] opacity-40">
        {cfg.formality ? 'formal register · ' : ''}auto-detect visitor language · powered by OpenMind
      </p>
    </Shell>
  )
}

// ── Summarizer ───────────────────────────────────────────────────────────────

export function SummarizePreview({ shared, cfg }: { shared: SharedCfg; cfg: Cfg }) {
  const bullets = Boolean(cfg.bullets)
  return (
    <Shell shared={shared} label="Too long? Get the gist">
      <p className="text-xs leading-relaxed opacity-40">
        Our quarterly report covers twelve regions, four product lines and a complete restatement of
        last year's figures across two accounting standards, followed by…
      </p>
      <button
        className="mt-3 flex items-center gap-2 border px-3 py-2 font-mono-spec text-[11px] uppercase tracking-wider text-white"
        style={{ background: shared.accent, borderColor: shared.accent }}
      >
        <AlignLeft className="h-3.5 w-3.5" /> TL;DR — {String(cfg.length ?? 'medium')}
      </button>
      {bullets ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {['Revenue up 14% across all regions', 'Two product lines now profitable', 'Figures restated under IFRS 18'].map((b) => (
            <li key={b} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: shared.accent }} />
              {b}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-relaxed">
          Revenue grew 14% with two lines turning profitable; prior figures were restated under IFRS 18.
        </p>
      )}
    </Shell>
  )
}

// ── Document Q&A search ──────────────────────────────────────────────────────

export function DocQaPreview({ shared, cfg }: { shared: SharedCfg; cfg: Cfg }) {
  const citations = Boolean(cfg.citations)
  return (
    <Shell shared={shared} label="Ask our docs">
      <div className={`flex items-center gap-2 border px-3 py-2.5 ${rad(shared.radius)}`} style={{ borderColor: `${shared.accent}66` }}>
        <Search className="h-4 w-4 opacity-50" />
        <span className="text-sm opacity-50">{String(cfg.placeholder ?? 'Ask anything about our product…')}</span>
      </div>
      <div className="mt-3 border-l-2 pl-3 text-sm leading-relaxed" style={{ borderColor: shared.accent }}>
        Returns are accepted within 30 days of purchase, no questions asked — refunds land in 3–5
        business days.
      </div>
      {citations && (
        <div className="mt-2 flex gap-1.5">
          {['refund-policy.pdf', 'faq · returns'].map((s) => (
            <span key={s} className="flex items-center gap-1 border px-2 py-0.5 font-mono-spec text-[10px] opacity-70" style={{ borderColor: `${shared.accent}55` }}>
              <FileSearch className="h-3 w-3" /> {s}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[10px] opacity-40">answers cite your sources · powered by OpenMind</p>
    </Shell>
  )
}

// ── API-only pane (sentiment, code) ──────────────────────────────────────────

export function ApiPreview({ shared, service }: { shared: SharedCfg; service: 'sentiment' | 'code' }) {
  const curl =
    service === 'sentiment'
      ? `curl https://api.openmind.dev/v1/sentiment \\
  -H "Authorization: Bearer $OM_KEY" \\
  -d '{ "text": "the checkout flow was broken for an hour" }'

→ { "sentiment": "negative",
    "emotions": ["frustration"],
    "urgency": 0.91 }`
      : `curl https://api.openmind.dev/v1/code/complete \\
  -H "Authorization: Bearer $OM_KEY" \\
  -d '{ "lang": "ts", "prompt": "retrying fetch" }'

→ async function fetchWithRetry(url, tries = 3) …`
  return (
    <div className="mx-auto flex h-[560px] max-w-[400px] flex-col items-center justify-center">
      <div className="bg-terminal w-full border border-primary shadow-xl">
        <div className="flex items-center justify-between border-b border-white/15 px-4 py-2.5">
          <span className="font-mono-spec text-[11px] uppercase tracking-[0.18em] text-white/50">
            api-only capability
          </span>
          <Camera className="hidden" />
          <Square className="hidden" />
          <span className="h-2 w-2 rounded-full" style={{ background: shared.accent }} />
        </div>
        <pre className="overflow-x-auto p-4 font-mono-spec text-[11px] leading-relaxed text-white/85">
          {curl}
        </pre>
        <div className="border-t border-white/15 px-4 py-2.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white/40">
          no visitor widget — integrate via api or sdk
        </div>
      </div>
    </div>
  )
}
