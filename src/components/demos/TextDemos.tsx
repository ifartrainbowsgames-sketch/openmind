import { useRef, useState } from 'react'
import { Pane, RunButton, ModeStamp, Field, inputCls, selectCls } from './shared'
import { streamText } from '@/lib/demo'
import { Send } from 'lucide-react'

// ── 01 · Chatbot ─────────────────────────────────────────────────────────────

const CHAT_REPLIES = [
  "Great question. Because OpenMind sits between your app and the model provider, you can swap GPT for Claude or a local Llama by changing one config line — the widget, memory and analytics stay exactly the same.",
  "Your API key is used only to authenticate with your provider. In browser-direct mode it never touches our servers; in vault mode it's encrypted with AES-256 and decryptable only by your workspace.",
  "Setup is two lines: paste the script tag, add data-service=\"chatbot\". The widget inherits your site's fonts automatically, and theming is a handful of CSS variables.",
  "Pricing is simple: you pay your provider for tokens at their list price — we add 0% markup — and a flat software fee for the widgets, gateway and analytics.",
]

interface Msg { role: 'user' | 'assistant'; text: string }

// Secure demo gateway — the OpenAI key lives on the server, never in the browser.
const GATEWAY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openmind-chat`

export function ChatDemo() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: 'Hi — I\'m the embeddable support agent, answering with real ChatGPT. Ask me anything about the product.' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<boolean | null>(null)
  const replyIdx = useRef(0)

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    const history: Msg[] = [...messages, { role: 'user', text: q }]
    setMessages([...history, { role: 'assistant', text: '' }])

    // Real ChatGPT via the secure gateway — no key ever touches this page.
    try {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-6).map((m) => ({ role: m.role, content: m.text })),
        }),
      })
      if (!res.ok) throw new Error(`gateway ${res.status}`)
      const data = await res.json()
      const text = String(data?.text ?? '').trim()
      if (!text) throw new Error('empty reply')
      setLive(true)
      await streamText(text, (partial) =>
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: partial }]),
        { cps: 500 },
      )
    } catch {
      // Gateway offline or unconfigured — fall back to canned answers.
      setLive(false)
      const reply = CHAT_REPLIES[replyIdx.current % CHAT_REPLIES.length]
      replyIdx.current++
      await streamText(reply, (partial) =>
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: partial }]),
      )
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <ModeStamp
          mode={live ? 'live' : 'simulated'}
          liveLabel="via secure gateway"
          note={
            live === true
              ? 'real ChatGPT answers — zero keys on this page'
              : live === false
                ? 'gateway unreachable — showing canned answers'
                : 'asks our secure gateway first — zero keys on this page'
          }
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          This demo talks to real ChatGPT through our server-side gateway. The API key lives in
          a server vault — it is never sent to, stored in, or requested by your browser.
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          And you'll never see a key box on this page. Asking visitors to paste secret keys into
          a website is how keys get leaked — we don't do it, and neither should you.
        </p>
        <p className="border border-primary/15 bg-secondary/60 px-3 py-2 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          your keys → your vault · our demo → our gateway
        </p>
      </div>
      <div>
        <Pane title="widget — chatbot" right={<span className="font-mono-spec text-[10px] text-white/40">gpt-4o-mini · stream</span>}>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <span
                  className={`inline-block max-w-[85%] border px-3 py-2 text-left ${
                    m.role === 'user'
                      ? 'border-accent/60 bg-accent/15 text-white'
                      : 'border-white/20 bg-white/5'
                  }`}
                >
                  {m.text}
                  {busy && i === messages.length - 1 && m.role === 'assistant' && (
                    <span className="cursor-blink text-accent">▊</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 border-t border-white/15 pt-3">
            <input
              className="flex-1 border border-white/25 bg-transparent px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-accent rounded-none"
              placeholder="Ask something…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button
              onClick={send}
              className="border border-accent bg-accent px-4 text-white hover:bg-accent/85"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </Pane>
      </div>
    </div>
  )
}

// ── 05 · Translation ─────────────────────────────────────────────────────────

const TRANSLATIONS: Record<string, (t: string) => string> = {
  French: (t) => `[FR · simulé] Votre texte « ${t.slice(0, 60)}${t.length > 60 ? '…' : ''} » serait traduit par votre fournisseur — DeepL, GPT ou Claude — avec glossaire et registre de langue appliqués.`,
  Spanish: (t) => `[ES · simulado] Su texto « ${t.slice(0, 60)}${t.length > 60 ? '…' : ''} » sería traducido por su proveedor con el glosario y la formalidad configurados.`,
  German: (t) => `[DE · simuliert] Ihr Text „${t.slice(0, 60)}${t.length > 60 ? '…' : ''}" würde von Ihrem Anbieter übersetzt — mit Glossar und gewählter Anredeform.`,
  Japanese: (t) => `[JA · シミュレーション] 入力テキスト「${t.slice(0, 40)}${t.length > 40 ? '…' : ''}」は、お客様のプロバイダーにより用語集と敬語レベルを適用して翻訳されます。`,
}

export function TranslateDemo() {
  const [text, setText] = useState('Our refund policy allows returns within 30 days of purchase, no questions asked.')
  const [lang, setLang] = useState('French')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setOut('')
    await streamText(TRANSLATIONS[lang](text), setOut, { cps: 260 })
    setBusy(false)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="simulated" note="shows routing & formatting — quality comes from your provider" />
        <Field label="Source text">
          <textarea className={inputCls + ' min-h-24 resize-y'} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Target language">
          <select className={selectCls} value={lang} onChange={(e) => setLang(e.target.value)}>
            {Object.keys(TRANSLATIONS).map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <RunButton onClick={run} running={busy} label="Translate" />
      </div>
      <Pane title={`output — ${lang.toLowerCase()}`}>
        {out || <span className="text-white/35">// translation appears here…</span>}
        {busy && <span className="cursor-blink text-accent">▊</span>}
      </Pane>
    </div>
  )
}

// ── 06 · Code Copilot ────────────────────────────────────────────────────────

const CODE_SNIPPETS: Record<string, string> = {
  default: `async function fetchWithRetry(url: string, tries = 3): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      lastErr = new Error(\`HTTP \${res.status}\`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 250)) // backoff
  }
  throw lastErr
}`,
  debounce: `function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}`,
  cache: `const cache = new Map<string, { value: unknown; exp: number }>()

function memo<T>(key: string, ttlMs: number, compute: () => T): T {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return hit.value as T
  const value = compute()
  cache.set(key, { value, exp: Date.now() + ttlMs })
  return value
}`,
}

export function CodeDemo() {
  const [task, setTask] = useState('fetch with retry and exponential backoff')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setOut('')
    const key = Object.keys(CODE_SNIPPETS).find((k) => task.toLowerCase().includes(k)) ?? 'default'
    await streamText(CODE_SNIPPETS[key], setOut, { cps: 900 })
    setBusy(false)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-4">
        <ModeStamp mode="simulated" note="live mode streams from your provider of choice" />
        <Field label="Describe the task">
          <input className={inputCls} value={task} onChange={(e) => setTask(e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">
          Try “debounce”, “cache”, or anything else — the copilot routes to your model.
        </p>
        <RunButton onClick={run} running={busy} label="Complete" />
      </div>
      <Pane title="completion — typescript">
        <pre className="whitespace-pre-wrap text-emerald-300/90">
          {out || <span className="text-white/35">// code appears here…</span>}
          {busy && <span className="cursor-blink text-accent">▊</span>}
        </pre>
      </Pane>
    </div>
  )
}
