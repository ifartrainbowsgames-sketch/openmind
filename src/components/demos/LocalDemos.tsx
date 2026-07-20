import { useRef, useState } from 'react'
import { Pane, RunButton, ModeStamp, Field, inputCls, textareaCls } from './shared'
import { analyzeSentiment, summarize, retrievePassages, extractPalette, type Palette, type SentimentResult } from '@/lib/demo'
import { Upload } from 'lucide-react'

// ── 07 · Document Q&A (real retrieval) ───────────────────────────────────────

const SAMPLE_DOC = `OpenMind never marks up token usage: customers pay their model provider directly at list price. API keys can be used in two modes. In browser-direct mode, the key stays in the visitor's browser and requests go straight to the provider. In vault mode, keys are encrypted with AES-256 and stored per workspace. The embed widget is two lines of code and inherits the host site's fonts automatically. Self-hosting the entire stack takes one docker compose command and requires a machine with 4 GB of RAM. Rate limits are configurable per key and per capability. The analytics dashboard shows latency, token usage and error rates for every provider in one place.`

export function DocQaDemo() {
  const [doc, setDoc] = useState(SAMPLE_DOC)
  const [q, setQ] = useState('How are my API keys stored?')
  const [hits, setHits] = useState<{ sentence: string; score: number }[]>([])
  const [busy, setBusy] = useState(false)

  const run = () => {
    setBusy(true)
    setTimeout(() => {
      setHits(retrievePassages(doc, q, 2))
      setBusy(false)
    }, 350)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="live" note="real retrieval ranking, computed in this page" />
        <Field label="Document">
          <textarea className={textareaCls} value={doc} onChange={(e) => setDoc(e.target.value)} />
        </Field>
        <Field label="Question">
          <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <RunButton onClick={run} running={busy} label="Retrieve" />
      </div>
      <Pane title="cited passages — ranked">
        {hits.length === 0 ? (
          <span className="text-white/35">// run a question — answers come back with citations…</span>
        ) : (
          <div className="space-y-3">
            {hits.map((h, i) => (
              <div key={i} className="border-l-2 border-accent pl-3">
                <div className="mb-1 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-accent">
                  citation {i + 1} · relevance {(h.score * 100).toFixed(0)}%
                </div>
                <p className="text-white/85">{h.sentence}</p>
              </div>
            ))}
          </div>
        )}
      </Pane>
    </div>
  )
}

// ── 08 · Sentiment (real lexicon model) ──────────────────────────────────────

const SAMPLE_REVIEW = `I love how fast the setup was, literally two lines and the widget was live. The docs are excellent and support replied in minutes. Only gripe: the dashboard felt slow once, and I was frustrated when my key expired without warning.`

export function SentimentDemo() {
  const [text, setText] = useState(SAMPLE_REVIEW)
  const [res, setRes] = useState<SentimentResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = () => {
    setBusy(true)
    setTimeout(() => {
      setRes(analyzeSentiment(text))
      setBusy(false)
    }, 300)
  }

  const pct = res ? Math.round(((res.score + 1) / 2) * 100) : 50

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="live" note="real lexicon scoring, computed in this page" />
        <Field label="Feedback text">
          <textarea className={textareaCls} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <RunButton onClick={run} running={busy} label="Classify" />
      </div>
      <Pane title="classification">
        {!res ? (
          <span className="text-white/35">// sentiment, urgency and signal words appear here…</span>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline gap-3">
              <span className={`font-serif-display text-3xl font-semibold ${
                res.label === 'Positive' ? 'text-emerald-400' : res.label === 'Negative' ? 'text-accent' : 'text-amber-300'
              }`}>
                {res.label}
              </span>
              <span className="text-white/50">confidence {(res.confidence * 100).toFixed(0)}%</span>
              <span className="ml-auto text-white/50">urgency {(res.urgency * 100).toFixed(0)}%</span>
            </div>
            <div className="relative h-2 border border-white/25 bg-white/5">
              <div
                className={`absolute top-0 h-full ${res.score >= 0 ? 'bg-emerald-400' : 'bg-accent'}`}
                style={res.score >= 0 ? { left: '50%', width: `${pct - 50}%` } : { left: `${pct}%`, width: `${50 - pct}%` }}
              />
              <div className="absolute top-[-4px] left-1/2 h-4 w-px bg-white/40" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {res.hits.map((h, i) => (
                <span
                  key={i}
                  className={`border px-2 py-0.5 text-[11px] ${
                    h.polarity === 1 ? 'border-emerald-500/50 text-emerald-300' : 'border-accent/60 text-accent'
                  }`}
                >
                  {h.word}
                </span>
              ))}
              {res.hits.length === 0 && <span className="text-white/40">no strong signal words found</span>}
            </div>
          </div>
        )}
      </Pane>
    </div>
  )
}

// ── 09 · Summarizer (real extractive engine) ─────────────────────────────────

const SAMPLE_ARTICLE = `The bring-your-own-key model has quietly become the default architecture for AI tooling startups. Instead of reselling inference at a markup, these companies build the integration layer: widgets, gateways, analytics and guardrails. Customers connect their own provider accounts, paying OpenAI, Anthropic or a local Ollama instance directly. The economics are compelling for both sides. Startups avoid GPU bills entirely and keep software margins above ninety percent. Customers keep their existing provider contracts, compliance posture and negotiated pricing. Privacy improves as well, because keys and prompts can flow directly from the customer's browser to the provider without touching the vendor's servers. Critics point out that support becomes harder when every customer runs a different backend. Proponents answer that a good adapter layer and clear error messages solve most of it. The approach mirrors how payments software evolved: Stripe never held merchant funds for speculation, it simply made the rails usable. Observers expect the pattern to accelerate as open models close the quality gap with hosted ones.`

export function SummarizeDemo() {
  const [text, setText] = useState(SAMPLE_ARTICLE)
  const [ratio, setRatio] = useState(0.3)
  const [out, setOut] = useState<{ sentence: string; score: number }[]>([])
  const [busy, setBusy] = useState(false)

  const run = () => {
    setBusy(true)
    setTimeout(() => {
      setOut(summarize(text, ratio))
      setBusy(false)
    }, 300)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="live" note="real extractive engine, computed in this page" />
        <Field label="Source text">
          <textarea className={textareaCls + ' min-h-40'} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label={`Compression — keep ${Math.round(ratio * 100)}% of sentences`}>
          <input
            type="range" min={0.1} max={0.7} step={0.05} value={ratio}
            onChange={(e) => setRatio(Number(e.target.value))}
            className="mt-3 w-full accent-[#ff4d00]"
          />
        </Field>
        <RunButton onClick={run} running={busy} label="Summarize" />
      </div>
      <Pane title="summary — extractive">
        {out.length === 0 ? (
          <span className="text-white/35">// the most salient sentences appear here…</span>
        ) : (
          <ul className="space-y-3">
            {out.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-accent">{String(i + 1).padStart(2, '0')}</span>
                <span>{s.sentence}</span>
              </li>
            ))}
          </ul>
        )}
      </Pane>
    </div>
  )
}

// ── 10 · Vision (real palette analysis) ──────────────────────────────────────

export function VisionDemo() {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [palette, setPalette] = useState<Palette[]>([])
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const analyze = (url: string) => {
    const img = new Image()
    img.onload = async () => {
      const p = await extractPalette(img, 5)
      setPalette(p)
      // crude but honest local "caption" from measurable properties
      const warmth = p.slice(0, 2).some((c) => {
        const r = parseInt(c.hex.slice(1, 3), 16), b = parseInt(c.hex.slice(5, 7), 16)
        return r > b + 24
      })
      const dark = p[0] ? (parseInt(p[0].hex.slice(1, 3), 16) + parseInt(p[0].hex.slice(3, 5), 16) + parseInt(p[0].hex.slice(5, 7), 16)) / 3 < 90 : false
      setCaption(
        `${img.naturalWidth}×${img.naturalHeight}px · ${dark ? 'dark' : 'light'}, ${warmth ? 'warm-toned' : 'cool-toned'} image dominated by ${p[0]?.hex ?? '—'} (${Math.round((p[0]?.share ?? 0) * 100)}% of pixels). Full captions come from your multimodal provider.`,
      )
      setBusy(false)
    }
    img.src = url
  }

  const onFile = (f: File) => {
    setBusy(true)
    const url = URL.createObjectURL(f)
    setImgUrl(url)
    setPalette([])
    setCaption('')
    analyze(url)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="live" note="real pixel analysis in this page — captions simulated" />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-3 border border-dashed border-primary bg-card px-4 py-10 font-mono-spec text-xs uppercase tracking-[0.14em] text-muted-foreground hover:border-accent hover:text-accent"
        >
          <Upload className="h-4 w-4" />
          {imgUrl ? 'Choose another image' : 'Upload an image'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        {imgUrl && <img src={imgUrl} alt="uploaded" className="max-h-44 border border-primary object-contain" />}
      </div>
      <Pane title="analysis — pixels & palette" right={busy ? <span className="font-mono-spec text-[10px] text-accent">processing…</span> : undefined}>
        {palette.length === 0 ? (
          <span className="text-white/35">// upload an image — dominant colors and a caption appear…</span>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              {palette.map((p) => (
                <div key={p.hex} className="flex-1">
                  <div className="h-14 border border-white/20" style={{ background: p.hex }} />
                  <div className="mt-1 text-[10px] text-white/60">{p.hex}</div>
                  <div className="text-[10px] text-white/35">{Math.round(p.share * 100)}%</div>
                </div>
              ))}
            </div>
            <p className="border-l-2 border-accent pl-3 text-white/85">{caption}</p>
          </div>
        )}
      </Pane>
    </div>
  )
}
