import { useState } from 'react'
import ChatWidget, { DEFAULT_WIDGET, type WidgetConfig } from '@/components/widget/ChatWidget'
import { Check, Copy, Phone, Video, ImagePlus, Sparkles, MessageSquare } from 'lucide-react'

const ACCENTS = ['#ff4d00', '#17140f', '#0e7490', '#7c3aed', '#15803d', '#b91c1c']
const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none'

/** Shared brand config the widget understands. */
interface SharedCfg {
  accent: string
  theme: 'light' | 'dark'
  radius: 'sharp' | 'soft' | 'round'
}

const DEFAULT_SHARED: SharedCfg = { accent: '#ff4d00', theme: 'light', radius: 'soft' }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="spec-label mb-1.5 block">{label}</span>
      {children}
    </div>
  )
}

function Seg<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="grid border border-border/60" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-2 py-2 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
            value === o ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

const FEATURE_TOGGLES = [
  { key: 'voice' as const, icon: Phone, label: 'Voice calls', note: 'visitors call you from the chat' },
  { key: 'video' as const, icon: Video, label: 'Video calls', note: 'face-to-face support in the widget' },
  { key: 'images' as const, icon: ImagePlus, label: 'Image drop', note: 'drag photos into the conversation' },
  { key: 'aiFix' as const, icon: Sparkles, label: 'Fix with AI', note: 'one-click sentence rewriting for visitors' },
]

export default function WidgetBuilder() {
  const [shared, setShared] = useState<SharedCfg>(DEFAULT_SHARED)
  const [chatCfg, setChatCfg] = useState<WidgetConfig>(DEFAULT_WIDGET)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const setChat = <K extends keyof WidgetConfig>(k: K, v: WidgetConfig[K]) =>
    setChatCfg((c) => ({ ...c, [k]: v }))

  // sync chatbot's brand with the shared brand settings
  const chatPreview: WidgetConfig = { ...chatCfg, accent: shared.accent, theme: shared.theme, radius: shared.radius }

  const features = [chatCfg.voice && 'voice', chatCfg.video && 'video', chatCfg.images && 'images', chatCfg.aiFix && 'ai-fix']
    .filter(Boolean)
    .join(',')

  const attr = (k: string, v: string | boolean) => `  data-${k}="${v}"\n`
  const snippet = (() => {
    const attrs =
      attr('service', 'chatbot') +
      attr('accent', shared.accent) +
      attr('theme', shared.theme) +
      attr('radius', shared.radius) +
      attr('agent', chatCfg.agentName) +
      attr('greeting', chatCfg.greeting) +
      attr('preset', chatCfg.preset ?? 'openmind') +
      attr('font', chatCfg.font ?? 'system') +
      attr('features', features)
    return `<script\n  src="https://unpkg.com/@openmind/widget"\n${attrs}  async>\n</script>`
  })()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Widget Builder</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Design the chatbot your visitors get — brand it, tune its behavior, ship the snippet.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">Chatbot:</strong> the full chat window — talk, call, drop images.
      </p>

      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        {/* controls */}
        <div className="space-y-5">
          <div className="border border-primary bg-card p-5 space-y-5">
            <span className="spec-label block">Brand</span>
            <Row label="Accent color">
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setShared((s) => ({ ...s, accent: a }))}
                    className={`h-9 w-9 border-2 ${shared.accent === a ? 'border-primary' : 'border-transparent'}`}
                    style={{ background: a }}
                    aria-label={a}
                  />
                ))}
              </div>
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Theme">
                <Seg options={['light', 'dark'] as const} value={shared.theme} onChange={(v) => setShared((s) => ({ ...s, theme: v }))} />
              </Row>
              <Row label="Corners">
                <Seg options={['sharp', 'soft', 'round'] as const} value={shared.radius} onChange={(v) => setShared((s) => ({ ...s, radius: v }))} />
              </Row>
            </div>
          </div>

          {/* chatbot behavior */}
          <div className="border border-primary bg-card p-5 space-y-5">
            <span className="spec-label block">Personality — familiar layouts visitors already trust</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { id: 'openmind', name: 'OpenMind', note: 'our default' },
                  { id: 'discord', name: 'Discord', note: 'dark, blurple' },
                  { id: 'telegram', name: 'Telegram', note: 'light, green bubbles' },
                  { id: 'instagram', name: 'Instagram', note: 'gradient DMs' },
                ] as const
              ).map((pr) => (
                <button
                  key={pr.id}
                  onClick={() => setChat('preset', pr.id)}
                  className={`border px-3 py-3 text-left transition-colors ${
                    (chatCfg.preset ?? 'openmind') === pr.id
                      ? 'border-accent bg-accent/10'
                      : 'border-border/60 hover:border-primary'
                  }`}
                >
                  <span className="block text-sm font-medium">{pr.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{pr.note}</span>
                </button>
              ))}
            </div>
            <Row label="Font style">
              <Seg
                options={['system', 'serif', 'mono'] as const}
                value={chatCfg.font ?? 'system'}
                onChange={(v) => setChat('font', v)}
              />
            </Row>
            <p className="text-xs text-muted-foreground">
              A preset re-skins the whole widget — bubbles, header, background. Your accent,
              corners and fonts below still apply on the OpenMind default.
            </p>
          </div>
          <div className="border border-primary bg-card p-5 space-y-5">
            <span className="spec-label block">Chatbot behavior</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Agent name">
                <input className={inputCls} value={chatCfg.agentName} onChange={(e) => setChat('agentName', e.target.value)} />
              </Row>
              <Row label="Greeting message">
                <input className={inputCls} value={chatCfg.greeting} onChange={(e) => setChat('greeting', e.target.value)} />
              </Row>
            </div>
          </div>
          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-3 block">Features visitors get</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURE_TOGGLES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setChat(f.key, !chatCfg[f.key])}
                  className={`flex items-start gap-3 border px-4 py-3.5 text-left transition-colors ${
                    chatCfg[f.key] ? 'border-accent bg-accent/10' : 'border-border/60 hover:border-primary'
                  }`}
                >
                  <f.icon className={`mt-0.5 h-4 w-4 shrink-0 ${chatCfg[f.key] ? 'text-accent' : 'text-muted-foreground'}`} />
                  <span>
                    <span className="block text-sm font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.note}</span>
                  </span>
                  <span className={`ml-auto mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${chatCfg[f.key] ? 'bg-accent' : 'bg-border'}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="border border-primary bg-card hard-shadow">
            <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
              <span className="spec-label">Embed snippet — updates live</span>
              <button
                onClick={() => { navigator.clipboard?.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1400) }}
                className="flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-wider text-muted-foreground hover:text-accent"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <pre className="bg-terminal overflow-x-auto p-4 font-mono-spec text-[12px] leading-relaxed text-white/85">
              <code>{snippet}</code>
            </pre>
          </div>

          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1600) }}
            className={`w-full border px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] transition-colors ${
              saved
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-primary bg-primary text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent'
            }`}
          >
            {saved ? '✓ Published to your site' : 'Publish chatbot widget'}
          </button>
        </div>

        {/* live preview */}
        <div className="flex flex-col border border-primary bg-card hard-shadow">
          <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
            <span className="spec-label">Live preview — chatbot</span>
            <span className="flex items-center gap-1.5 font-mono-spec text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" /> try it
            </span>
          </div>
          <div className="bg-ruled flex-1 p-4" style={{ minHeight: 560 }}>
            <div className="mx-auto h-[560px] max-w-[400px]">
              <ChatWidget config={chatPreview} />
            </div>
          </div>
          <div className="border-t border-border/50 px-4 py-2.5 text-center font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            the full chat window — talk, call, drop images
          </div>
        </div>
      </div>
    </div>
  )
}
