import { useEffect, useRef, useState } from 'react'
import { streamText } from '@/lib/demo'
import {
  requestChat,
  requestChatSession,
  requestStaffCallback,
  pollStaffReplies,
  type GatewayMessage,
  type ChatGatewayReply,
} from '@/lib/chat-gateway'
import { Phone, Video, ImagePlus, Sparkles, Send, PhoneOff, Bot } from 'lucide-react'

export type WidgetPreset = 'openmind' | 'discord' | 'telegram' | 'instagram'
export type WidgetFont = 'system' | 'serif' | 'mono'

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
  preset?: WidgetPreset
  font?: WidgetFont
}

export const DEFAULT_WIDGET: WidgetConfig = {
  accent: '#ff4d00',
  theme: 'light',
  radius: 'soft',
  agentName: 'Acme Assistant',
  greeting: 'Hi! How can I help?',
  voice: true,
  video: false,
  images: false,
  aiFix: false,
  preset: 'openmind',
  font: 'system',
}

/** Platform personalities — full re-skins, not just a color swap. */
export const PRESETS: Record<
  Exclude<WidgetPreset, 'openmind'>,
  {
    label: string
    bg: string
    text: string
    subtle: string
    line: string
    headerBg: string
    headerText: string
    accent: string
    msgArea: string
    visitor: { background: string; color: string }
    agent: { background: string; color: string }
    radius: string
  }
> = {
  discord: {
    label: 'Discord',
    bg: '#313338', text: '#dbdee1', subtle: 'rgba(219,222,225,0.45)', line: 'rgba(255,255,255,0.08)',
    headerBg: '#1e1f22', headerText: '#ffffff', accent: '#5865F2', msgArea: '#313338',
    visitor: { background: '#5865F2', color: '#ffffff' },
    agent: { background: '#2b2d31', color: '#dbdee1' },
    radius: '8px',
  },
  telegram: {
    label: 'Telegram',
    bg: '#e7ebf0', text: '#000000', subtle: 'rgba(0,0,0,0.45)', line: 'rgba(0,0,0,0.08)',
    headerBg: '#517da2', headerText: '#ffffff', accent: '#4f9fdd', msgArea: '#e7ebf0',
    visitor: { background: '#eeffde', color: '#000000' },
    agent: { background: '#ffffff', color: '#000000' },
    radius: '14px',
  },
  instagram: {
    label: 'Instagram',
    bg: '#ffffff', text: '#0f1419', subtle: 'rgba(15,20,25,0.45)', line: 'rgba(0,0,0,0.08)',
    headerBg: '#ffffff', headerText: '#0f1419', accent: '#d62976', msgArea: '#ffffff',
    visitor: { background: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', color: '#ffffff' },
    agent: { background: '#efefef', color: '#0f1419' },
    radius: '18px',
  },
}

const FONT_STACKS: Record<WidgetFont, string | undefined> = {
  system: undefined,
  serif: "'Fraunces', Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
}

interface Msg { from: 'visitor' | 'agent' | 'staff'; text?: string; img?: string }

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
  [/price|pricing|plan|cost/i, 'Pro is $10/mo for the chatbot on 5 sites — you pay your provider directly for tokens, we add 0% markup.'],
  [/image|picture|photo/i, 'Drop it right into this chat — I\'ll take a look and answer questions about what I see.'],
  [/call|talk|phone|video/i, 'Use the phone icon to send a callback request to an available staff member.'],
]

const FALLBACK = [
  'Good question. In live mode I\'d answer from your attached knowledge base — in this demo I\'m running locally in the page.',
  'I can help with that. Try dropping an image, or hit "Fix" on a rough sentence to see the writing assistant.',
  'Noted! Every conversation here also lands in the Inbox — with visitor location, device and page journey.',
]

export default function ChatWidget({
  config,
  live = false,
  widgetKey,
  siteOrigin,
  page,
}: {
  config: WidgetConfig
  live?: boolean
  widgetKey?: string
  siteOrigin?: string
  page?: string
}) {
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'agent', text: config.greeting }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [call, setCall] = useState<'voice' | 'video' | null>(null)
  const [callSecs, setCallSecs] = useState(0)
  const [callStatus, setCallStatus] = useState('')
  const [conversationId, setConversationId] = useState<string>()
  const [visitorToken, setVisitorToken] = useState<string>()
  const [dragOver, setDragOver] = useState(false)
  const [gatewayMode, setGatewayMode] = useState<'pending' | 'live' | 'fallback'>(live ? 'pending' : 'fallback')
  const fileRef = useRef<HTMLInputElement>(null)
  const replyIdx = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const seenStaffMessages = useRef(new Set<string>())
  const staffCursor = useRef('')

  const dark = config.theme === 'dark'
  const radius = config.radius === 'sharp' ? 'rounded-none' : config.radius === 'soft' ? 'rounded-xl' : 'rounded-2xl'
  const bg = dark ? 'bg-[#17140f] text-[#faf8f5]' : 'bg-white text-[#17140f]'
  const subtle = dark ? 'text-white/50' : 'text-[#17140f]/50'
  const line = dark ? 'border-white/15' : 'border-[#17140f]/15'

  // platform personality — when set, it re-skins the whole widget
  const p = config.preset && config.preset !== 'openmind' ? PRESETS[config.preset] : null
  const accent = p?.accent ?? config.accent
  const fontFamily = FONT_STACKS[config.font ?? 'system']

  // reset the conversation when the builder changes greeting/agent — the
  // React-endorsed "adjust state during render" pattern (avoids effect cascades)
  const resetKey = `${config.greeting}|${config.agentName}`
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setMsgs([{ from: 'agent', text: config.greeting }])
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, busy])

  useEffect(() => {
    if (!call) return
    const t = setInterval(() => setCallSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [call])

  useEffect(() => {
    if (!live || !widgetKey || !conversationId || !visitorToken) return
    let active = true
    const poll = async () => {
      try {
        const reply = await pollStaffReplies({
          widgetKey,
          conversationId,
          visitorToken,
          ...(siteOrigin ? { siteOrigin } : {}),
          ...(staffCursor.current ? { staffAfter: staffCursor.current } : {}),
        })
        if (!active) return
        const fresh = (reply.staffMessages ?? []).filter((message) => !seenStaffMessages.current.has(message.id))
        fresh.forEach((message) => seenStaffMessages.current.add(message.id))
        const latest = reply.staffMessages?.at(-1)?.createdAt
        if (latest) staffCursor.current = latest
        if (fresh.length) {
          setMsgs((current) => [
            ...current,
            ...fresh.map((message) => ({ from: 'staff' as const, text: message.text })),
          ])
        }
      } catch {
        // Message sending still works; retry staff delivery on the next poll.
      }
    }
    void poll()
    const timer = setInterval(poll, 4_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [live, widgetKey, conversationId, visitorToken, siteOrigin])

  const agentReply = async (userText: string, hadImage: boolean) => {
    setBusy(true)
    setMsgs((m) => [...m, { from: 'agent', text: '' }])
    const streamReply = async (reply: string) => {
      await streamText(reply, (p) => setMsgs((m) => [...m.slice(0, -1), { from: 'agent', text: p }]), { cps: 400 })
    }
    if (hadImage) {
      await streamReply('Got it — I can see your image. In live mode I\'d describe it, extract text and answer questions about it. What would you like to know?')
      setBusy(false)
      return
    }
    // Live mode (marketing site): real ChatGPT via the secure gateway, canned fallback.
    if (live) {
      try {
        const history = msgs.slice(-6)
          .filter((message) => Boolean(message.text?.trim()))
          .map((message) => ({
            role: message.from === 'agent' ? 'assistant' : 'user',
            content: message.text!,
          }))
        const gatewayMessages: GatewayMessage[] = [
          ...history.map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content ?? '',
          })),
          { role: 'user', content: userText },
        ]
        const options = {
          ...(widgetKey ? { widgetKey } : {}),
          ...(conversationId ? { conversationId } : {}),
          ...(visitorToken ? { visitorToken } : {}),
          visitor: 'Website visitor',
          page: page ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
          ...(siteOrigin ? { siteOrigin } : {}),
        }
        const reply: ChatGatewayReply = widgetKey
          ? await requestChatSession(gatewayMessages, options)
          : { text: await requestChat(gatewayMessages) }
        if (reply.conversationId) setConversationId(reply.conversationId)
        if (reply.visitorToken) setVisitorToken(reply.visitorToken)
        setGatewayMode('live')
        await streamReply(reply.text)
        setBusy(false)
        return
      } catch {
        setGatewayMode('fallback')
        // fall through to canned replies
      }
    }
    await streamReply(REPLIES.find(([re]) => re.test(userText))?.[1] ?? FALLBACK[replyIdx.current++ % FALLBACK.length])
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

  const startCall = async (kind: 'voice' | 'video') => {
    setCall(kind)
    setCallSecs(0)
    if (!live || !widgetKey) {
      setCallStatus('Preview only — publish the widget to send a real staff callback request.')
      return
    }
    setCallStatus('Notifying an available staff member…')
    try {
      const reply = await requestStaffCallback({
        widgetKey,
        ...(conversationId ? { conversationId } : {}),
        ...(visitorToken ? { visitorToken } : {}),
        visitor: 'Website visitor',
        page: page ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
        ...(siteOrigin ? { siteOrigin } : {}),
      })
      if (reply.conversationId) setConversationId(reply.conversationId)
      if (reply.visitorToken) setVisitorToken(reply.visitorToken)
      setCallStatus(reply.text)
      setGatewayMode('live')
    } catch {
      setCallStatus('The callback request could not be sent. Please leave a text message instead.')
      setGatewayMode('fallback')
    }
  }
  const mmss = `${String(Math.floor(callSecs / 60)).padStart(2, '0')}:${String(callSecs % 60).padStart(2, '0')}`

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden border ${line} ${bg} ${radius} shadow-2xl`}
      style={p ? { background: p.bg, color: p.text, borderColor: p.line, borderRadius: p.radius, fontFamily } : { fontFamily }}
    >
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: p?.headerBg ?? accent, color: p?.headerText }}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20" style={{ color: p?.headerText ?? '#fff' }}>
          <Bot className="h-5 w-5" />
        </span>
        <div className="flex-1 leading-tight">
          <div className="text-sm font-semibold" style={{ color: p?.headerText ?? '#fff' }}>{config.agentName}</div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: p ? `${p.headerText}cc` : 'rgba(255,255,255,0.8)' }}>
            <span className={`h-1.5 w-1.5 rounded-full ${gatewayMode === 'live' ? 'bg-emerald-300' : 'bg-amber-300'}`} />
            {gatewayMode === 'live' ? 'live gateway' : gatewayMode === 'pending' ? 'gateway pending' : 'local preview'}
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
        style={p ? { background: p.msgArea } : undefined}
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
                style={
                  m.from === 'visitor'
                    ? { background: p?.visitor.background ?? accent, color: p?.visitor.color, borderRadius: p?.radius }
                    : p
                      ? { background: p.agent.background, color: p.agent.color, borderRadius: p.radius, border: 'none' }
                      : undefined
                }
              >
                {m.from === 'staff' && (
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider opacity-60">
                    Human support
                  </span>
                )}
                {m.text}
                {busy && i === msgs.length - 1 && m.from === 'agent' && <span className="cursor-blink">▍</span>}
              </span>
            )}
          </div>
        ))}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed bg-black/40" style={{ borderColor: accent }}>
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
            aria-label="Chat message"
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
              style={draft.trim() ? { color: accent } : undefined}
            >
              <Sparkles className="h-4 w-4" />
              {fixing ? 'Fixing…' : 'Fix'}
            </button>
          )}
          <button
            onClick={send}
            disabled={!draft.trim() || busy}
            className="p-2.5 text-white disabled:opacity-40"
            style={{ background: accent, borderRadius: config.radius === 'sharp' ? 0 : 10 }}
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
          <div className="flex items-center justify-between px-4 py-3" style={{ background: accent }}>
            <span className="text-sm font-semibold">{call === 'voice' ? 'Callback request' : 'Video callback request'} · {config.agentName}</span>
            <span className="font-mono-spec text-xs">waiting {mmss}</span>
          </div>
          <div className="relative flex flex-1 items-center justify-center">
            <div className="flex max-w-xs flex-col items-center gap-5 px-6 text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full text-white" style={{ background: accent }}>
                {call === 'video' ? <Video className="h-9 w-9" /> : <Phone className="h-9 w-9" />}
              </span>
              <p className="text-sm leading-relaxed text-white/75">{callStatus}</p>
              <div className="flex items-end gap-1.5">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span key={i} className="w-1.5 rounded-full" style={{
                    background: accent,
                    height: `${14 + ((i * 29) % 46)}px`,
                    animation: `pulse-dot ${0.5 + (i % 4) * 0.15}s ease-in-out infinite`,
                  }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center py-5">
            <button onClick={() => setCall(null)} className="rounded-full bg-red-500 p-4 hover:bg-red-600" aria-label="Close callback request">
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
