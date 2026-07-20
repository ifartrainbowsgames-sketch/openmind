import { useEffect, useRef, useState } from 'react'
import { streamText } from '@/lib/demo'
import { Phone, Video, ImagePlus, Sparkles, Send, PhoneOff, Bot } from 'lucide-react'

export interface WidgetConfig {
  accent: string
  theme: 'light' | 'dark'
  radius: 'sharp' | 'soft' | 'round'
  agentName: string
  greeting: string
  voice: boolean
  video: boolean
  images: boolean
  aiFix: boolean
}

export const DEFAULT_WIDGET: WidgetConfig = {
  accent: '#ff4d00',
  theme: 'light',
  radius: 'soft',
  agentName: 'Acme Assistant',
  greeting: 'Hi! Ask me anything — or drop an image in.',
  voice: true,
  video: true,
  images: true,
  aiFix: true,
}

interface Msg { from: 'visitor' | 'agent'; text?: string; img?: string }

const TYPOS: Record<string, string> = {
  teh: 'the', adn: 'and', dont: "don't", cant: "can't", wont: "won't", isnt: "isn't",
  didnt: "didn't", doesnt: "doesn't", im: "I'm", i: 'I', ive: "I've", pls: 'please',
  u: 'you', ur: 'your', thx: 'thanks', wanna: 'want to', gonna: 'going to', coudl: 'could',
  recieve: 'receive', definately: 'definitely', seprate: 'separate',
}

/** Local sentence fixer — stands in for the provider-backed rewriter. */
export function fixSentence(s: string): string {
  let out = s.trim().replace(/\s+/g, ' ')
  out = out.split(' ').map((w) => TYPOS[w.toLowerCase()] ?? w).join(' ')
  out = out.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (m) => m.toUpperCase())
  if (out && !/[.!?]$/.test(out)) out += '.'
  return out
}

const REPLIES: [RegExp, string][] = [
  [/refund|return/i, 'Per your attached refund policy: returns are accepted within 30 days, no questions asked. Want me to start one?'],
  [/price|pricing|plan|cost/i, 'Pro is $29/mo for 5 sites with all capabilities — you pay your provider directly for tokens, we add 0% markup.'],
  [/image|picture|photo/i, 'Drop it right into this chat — I\'ll run vision on it and answer questions about what I see.'],
  [/call|talk|phone|video/i, 'Use the call icons in my header — voice or video, a human (or me) picks up in seconds.'],
]

const FALLBACK = [
  'Good question. In live mode I\'d answer from your attached knowledge base — in this demo I\'m running locally in the page.',
  'I can help with that. Try dropping an image, or hit "Fix" on a rough sentence to see the writing assistant.',
  'Noted! Every conversation here also lands in the Inbox — with visitor location, device and page journey.',
]

export default function ChatWidget({ config }: { config: WidgetConfig }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'agent', text: config.greeting }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [call, setCall] = useState<'voice' | 'video' | null>(null)
  const [callSecs, setCallSecs] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const replyIdx = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const dark = config.theme === 'dark'
  const radius = config.radius === 'sharp' ? 'rounded-none' : config.radius === 'soft' ? 'rounded-xl' : 'rounded-2xl'
  const bg = dark ? 'bg-[#17140f] text-[#faf8f5]' : 'bg-white text-[#17140f]'
  const subtle = dark ? 'text-white/50' : 'text-[#17140f]/50'
  const line = dark ? 'border-white/15' : 'border-[#17140f]/15'

  useEffect(() => {
    setMsgs([{ from: 'agent', text: config.greeting }])
  }, [config.greeting, config.agentName])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, busy])

  useEffect(() => {
    if (!call) return
    const t = setInterval(() => setCallSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [call])

  const agentReply = async (userText: string, hadImage: boolean) => {
    setBusy(true)
    setMsgs((m) => [...m, { from: 'agent', text: '' }])
    const reply = hadImage
      ? 'Got it — I can see your image. In live mode I\'d describe it, extract text and answer questions about it. What would you like to know?'
      : (REPLIES.find(([re]) => re.test(userText))?.[1] ?? FALLBACK[replyIdx.current++ % FALLBACK.length])
    await streamText(reply, (p) => setMsgs((m) => [...m.slice(0, -1), { from: 'agent', text: p }]), { cps: 400 })
    setBusy(false)
  }

  const send = () => {
    const t = draft.trim()
    if (!t || busy) return
    setDraft('')
    setMsgs((m) => [...m, { from: 'visitor', text: t }])
    agentReply(t, false)
  }

  const onImage = (f?: File | null) => {
    if (!f || !f.type.startsWith('image/') || busy) return
    const url = URL.createObjectURL(f)
    setMsgs((m) => [...m, { from: 'visitor', img: url }])
    agentReply('', true)
  }

  const runFix = async () => {
    const t = draft.trim()
    if (!t || fixing) return
    setFixing(true)
    const fixed = fixSentence(t)
    await streamText(fixed, setDraft, { cps: 320 })
    setFixing(false)
  }

  const startCall = (kind: 'voice' | 'video') => { setCall(kind); setCallSecs(0) }
  const mmss = `${String(Math.floor(callSecs / 60)).padStart(2, '0')}:${String(callSecs % 60).padStart(2, '0')}`

  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden border ${line} ${bg} ${radius} shadow-2xl`}>
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: config.accent }}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white">
          <Bot className="h-5 w-5" />
        </span>
        <div className="flex-1 leading-tight">
          <div className="text-sm font-semibold text-white">{config.agentName}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> online · replies instantly
          </div>
        </div>
        {config.voice && (
          <button onClick={() => startCall('voice')} className="rounded-full p-2 text-white/90 hover:bg-white/15" aria-label="Voice call">
            <Phone className="h-4 w-4" />
          </button>
        )}
        {config.video && (
          <button onClick={() => startCall('video')} className="rounded-full p-2 text-white/90 hover:bg-white/15" aria-label="Video call">
            <Video className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        onDragOver={(e) => { if (config.images) { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onImage(e.dataTransfer.files?.[0]) }}
        className={`relative flex-1 space-y-3 overflow-y-auto p-4 ${dark ? 'bg-black/20' : 'bg-[#faf8f5]'}`}
      >
        {msgs.map((m, i) => (
          <div key={i} className={m.from === 'visitor' ? 'text-right' : ''}>
            {m.img ? (
              <img src={m.img} alt="shared" className="ml-auto max-h-36 rounded-lg border border-black/10 object-cover" />
            ) : (
              <span
                className={`inline-block max-w-[82%] px-3 py-2 text-left text-sm leading-relaxed ${
                  m.from === 'visitor' ? 'text-white' : dark ? 'bg-white/10' : 'bg-white border border-black/10'
                } ${config.radius === 'sharp' ? '' : 'rounded-xl'}`}
                style={m.from === 'visitor' ? { background: config.accent } : undefined}
              >
                {m.text}
                {busy && i === msgs.length - 1 && m.from === 'agent' && <span className="cursor-blink">▍</span>}
              </span>
            )}
          </div>
        ))}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed bg-black/40" style={{ borderColor: config.accent }}>
            <span className="font-mono-spec text-xs uppercase tracking-widest text-white">Drop image to send</span>
          </div>
        )}
      </div>

      {/* composer */}
      <div className={`border-t ${line} p-3`}>
        <div className="flex items-end gap-2">
          {config.images && (
            <>
              <button onClick={() => fileRef.current?.click()} className={`p-2.5 ${subtle} hover:opacity-100 opacity-70`} aria-label="Attach image">
                <ImagePlus className="h-4.5 w-4.5" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = '' }} />
            </>
          )}
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message…"
            className={`max-h-24 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:opacity-40 ${config.radius === 'sharp' ? '' : 'rounded-lg'}`}
          />
          {config.aiFix && (
            <button
              onClick={runFix}
              disabled={!draft.trim() || fixing}
              className={`flex items-center gap-1 px-2.5 py-2 text-xs font-medium disabled:opacity-40 ${subtle}`}
              style={draft.trim() ? { color: config.accent } : undefined}
            >
              <Sparkles className="h-4 w-4" />
              {fixing ? 'Fixing…' : 'Fix'}
            </button>
          )}
          <button
            onClick={send}
            disabled={!draft.trim() || busy}
            className="p-2.5 text-white disabled:opacity-40"
            style={{ background: config.accent, borderRadius: config.radius === 'sharp' ? 0 : 10 }}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className={`mt-1.5 text-center text-[10px] ${subtle}`}>
          {config.images ? 'drop images anywhere in this chat · ' : ''}powered by OpenMind
        </div>
      </div>

      {/* call overlay */}
      {call && (
        <div className={`absolute inset-0 z-10 flex flex-col ${dark ? 'bg-[#17140f]' : 'bg-[#17140f]'} text-white`}>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: config.accent }}>
            <span className="text-sm font-semibold">{call === 'voice' ? 'Voice call' : 'Video call'} · {config.agentName}</span>
            <span className="font-mono-spec text-xs">{mmss}</span>
          </div>
          <div className="relative flex flex-1 items-center justify-center">
            {call === 'video' ? (
              <>
                <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${config.accent}55, #17140f)` }} />
                <span className="absolute flex h-20 w-20 items-center justify-center rounded-full text-white" style={{ background: config.accent }}>
                  <Bot className="h-10 w-10" />
                </span>
                <div className="absolute bottom-3 right-3 h-20 w-14 rounded-md border border-white/30 bg-white/10" />
              </>
            ) : (
              <div className="flex items-end gap-1.5">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span key={i} className="w-1.5 rounded-full" style={{
                    background: config.accent,
                    height: `${14 + ((i * 29) % 46)}px`,
                    animation: `pulse-dot ${0.5 + (i % 4) * 0.15}s ease-in-out infinite`,
                  }} />
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-4 py-5">
            <button className="rounded-full bg-white/10 p-3 hover:bg-white/20" aria-label="Mute">
              <Phone className="h-5 w-5" />
            </button>
            <button onClick={() => setCall(null)} className="rounded-full bg-red-500 p-4 hover:bg-red-600" aria-label="End call">
              <PhoneOff className="h-5 w-5" />
            </button>
            <button className="rounded-full bg-white/10 p-3 hover:bg-white/20" aria-label="More">
              <Video className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
