import { useRef, useState } from 'react'
import { Pane, ModeStamp } from './shared'
import { streamText } from '@/lib/demo'
import { requestChat } from '@/lib/chat-gateway'
import { Send } from 'lucide-react'

// ── 01 · Chatbot ─────────────────────────────────────────────────────────────

const CHAT_REPLIES = [
  "Great question. Because OpenMind sits between your app and the model provider, you can swap GPT for Claude or a local Llama by changing one config line — the widget, memory and analytics stay exactly the same.",
  "Your API key is used only to authenticate with your provider. In browser-direct mode it never touches our servers; in vault mode it's encrypted with AES-256 and decryptable only by your workspace.",
  "Setup is two lines: paste the script tag, add data-service=\"chatbot\". The widget inherits your site's fonts automatically, and theming is a handful of CSS variables.",
  "Pricing is simple: you pay your provider for tokens at their list price — we add 0% markup — and a flat software fee for the widgets, gateway and analytics.",
]

interface Msg { role: 'user' | 'assistant'; text: string }

export function ChatDemo() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: 'Hi — I\'m the embeddable support-agent demo. Ask me anything about the product.' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<boolean | null>(null)
  const [gatewayError, setGatewayError] = useState<string | null>(null)
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
      const text = await requestChat(history.map((message) => ({ role: message.role, content: message.text })))
      setLive(true)
      setGatewayError(null)
      await streamText(text, (partial) =>
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: partial }]),
        { cps: 500 },
      )
    } catch (error) {
      // Gateway offline or unconfigured — fall back to canned answers.
      setLive(false)
      setGatewayError(error instanceof Error ? error.message : 'The gateway is unavailable.')
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
          mode={live === null ? 'pending' : live ? 'live' : 'simulated'}
          liveLabel="via secure gateway"
          note={
            live === true
              ? 'real ChatGPT answers — zero keys on this page'
              : live === false
                ? 'gateway unreachable — showing canned answers'
                : 'asks our secure gateway first — zero keys on this page'
          }
        />
        {gatewayError && <p role="status" className="text-xs text-amber-700">{gatewayError} Showing a local canned response.</p>}
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
              aria-label="Chat demo message"
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
