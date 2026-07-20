// ── Demo engines. Everything here runs 100% client-side. ─────────────────────

/** Simulated token streaming with a typewriter cadence. */
export function streamText(
  full: string,
  onChunk: (partial: string) => void,
  opts: { cps?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const cps = opts.cps ?? 220
  return new Promise((resolve) => {
    let i = 0
    const step = () => {
      if (opts.signal?.aborted) return resolve()
      i = Math.min(full.length, i + Math.max(1, Math.round(cps / 30)))
      onChunk(full.slice(0, i))
      if (i < full.length) setTimeout(step, 33)
      else resolve()
    }
    step()
  })
}

/** Tiny deterministic PRNG so procedural "generations" are stable per prompt. */
export function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Sentiment ────────────────────────────────────────────────────────────────

const POSITIVE = [
  'love', 'great', 'excellent', 'amazing', 'awesome', 'fantastic', 'good', 'best',
  'happy', 'pleased', 'wonderful', 'brilliant', 'perfect', 'fast', 'easy', 'helpful',
  'smooth', 'recommend', 'impressed', 'beautiful', 'reliable', 'intuitive', 'thanks',
  'delighted', 'superb', 'outstanding', 'glad', 'nice', 'win', 'solved', 'works',
]
const NEGATIVE = [
  'hate', 'terrible', 'awful', 'bad', 'worst', 'broken', 'slow', 'bug', 'bugs',
  'crash', 'crashed', 'useless', 'angry', 'frustrated', 'disappointed', 'poor',
  'fail', 'failed', 'failure', 'refund', 'cancel', 'scam', 'horrible', 'annoying',
  'confusing', 'expensive', 'late', 'never', 'wrong', 'missing', 'sucks', 'rage',
]
const URGENT = ['asap', 'urgent', 'immediately', 'now', 'emergency', 'critical', 'outage', 'down', 'lawsuit', 'chargeback']

export interface SentimentResult {
  score: number // -1..1
  label: 'Positive' | 'Negative' | 'Neutral' | 'Mixed'
  confidence: number
  urgency: number
  hits: { word: string; polarity: 1 | -1 }[]
}

export function analyzeSentiment(text: string): SentimentResult {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? []
  const hits: SentimentResult['hits'] = []
  let score = 0
  for (const w of words) {
    if (POSITIVE.includes(w)) { score += 1; hits.push({ word: w, polarity: 1 }) }
    if (NEGATIVE.includes(w)) { score -= 1; hits.push({ word: w, polarity: -1 }) }
  }
  const norm = Math.max(-1, Math.min(1, score / Math.max(3, words.length / 8)))
  const urgency = Math.min(1, words.filter((w) => URGENT.includes(w)).length / 2)
  const hasPos = hits.some((h) => h.polarity === 1)
  const hasNeg = hits.some((h) => h.polarity === -1)
  const label: SentimentResult['label'] =
    hasPos && hasNeg ? 'Mixed' : norm > 0.12 ? 'Positive' : norm < -0.12 ? 'Negative' : 'Neutral'
  const confidence = Math.min(0.98, 0.45 + hits.length * 0.11)
  return { score: norm, label, confidence, urgency, hits }
}

// ── Extractive summarizer (frequency-scored sentences) ───────────────────────

const STOPWORDS = new Set(
  'the a an and or but if then of to in on for with as at by from is are was were be been it its this that these those we you they he she i not no do does did have has had will would can could should'.split(' '),
)

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+/g)
    ?.map((s) => s.trim())
    .filter((s) => s.length > 2) ?? (text.trim() ? [text.trim()] : [])
}

export function summarize(text: string, ratio: number): { sentence: string; score: number }[] {
  const sentences = splitSentences(text)
  if (sentences.length <= 1) return sentences.map((s) => ({ sentence: s, score: 1 }))
  const freq = new Map<string, number>()
  for (const s of sentences) {
    for (const w of s.toLowerCase().match(/[a-z']+/g) ?? []) {
      if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }
  const scored = sentences.map((s, idx) => {
    const words = s.toLowerCase().match(/[a-z']+/g) ?? []
    const raw = words.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0)
    return { sentence: s, score: raw / Math.max(1, words.length), idx }
  })
  const keep = Math.max(1, Math.round(sentences.length * ratio))
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, keep)
    .sort((a, b) => a.idx - b.idx)
    .map(({ sentence, score }) => ({ sentence, score }))
}

// ── Document Q&A retrieval (keyword-overlap passage ranking) ────────────────

export function retrievePassages(doc: string, question: string, k = 2): { sentence: string; score: number }[] {
  const q = new Set((question.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !STOPWORDS.has(w)))
  if (q.size === 0) return []
  return splitSentences(doc)
    .map((s) => {
      const words = s.toLowerCase().match(/[a-z']+/g) ?? []
      const overlap = words.filter((w) => q.has(w)).length
      return { sentence: s, score: overlap / Math.sqrt(words.length + 1) }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

// ── Vision: dominant-color extraction via canvas ────────────────────────────

export interface Palette { hex: string; share: number }

export async function extractPalette(img: HTMLImageElement, colors = 5): Promise<Palette[]> {
  const canvas = document.createElement('canvas')
  const size = 64
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`
    const b = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.n++
    buckets.set(key, b)
  }
  const total = size * size
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, colors)
    .map((b) => {
      const r = Math.round(b.r / b.n), g = Math.round(b.g / b.n), bl = Math.round(b.b / b.n)
      return { hex: `#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`, share: b.n / total }
    })
}

// ── Procedural "image generation" preview ────────────────────────────────────

export function paintProcedural(canvas: HTMLCanvasElement, prompt: string) {
  const rnd = mulberry(hashSeed(prompt || 'openmind'))
  const w = (canvas.width = 640)
  const h = (canvas.height = 400)
  const ctx = canvas.getContext('2d')!
  const hue = Math.floor(rnd() * 360)
  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, `hsl(${hue} 60% ${12 + rnd() * 10}%)`)
  grad.addColorStop(1, `hsl(${(hue + 60 + rnd() * 80) % 360} 55% ${20 + rnd() * 14}%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  // layered translucent geometry
  const shapes = 14 + Math.floor(rnd() * 10)
  for (let i = 0; i < shapes; i++) {
    const sh = (hue + rnd() * 180) % 360
    ctx.fillStyle = `hsla(${sh} 70% ${45 + rnd() * 30}% / ${0.12 + rnd() * 0.3})`
    const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 160
    if (rnd() > 0.5) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    } else {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI)
      ctx.fillRect(-r / 2, -r / 2, r, r * (0.4 + rnd())); ctx.restore()
    }
  }
  // grain lines
  ctx.strokeStyle = 'rgba(250,248,245,0.06)'
  for (let y = 0; y < h; y += 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }
  // prompt stamp
  ctx.fillStyle = 'rgba(250,248,245,0.85)'
  ctx.font = '600 13px "IBM Plex Mono", monospace'
  ctx.fillText(`seed:${hashSeed(prompt).toString(16).slice(0, 8)}`, 16, h - 16)
}
