import { useState } from 'react'
import ChatWidget, { DEFAULT_WIDGET, type WidgetConfig } from '@/components/widget/ChatWidget'
import { Check, Copy, Phone, Video, ImagePlus, Sparkles, MessageSquare } from 'lucide-react'

const ACCENTS = ['#ff4d00', '#17140f', '#0e7490', '#7c3aed', '#15803d', '#b91c1c']
const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="spec-label mb-1.5 block">{label}</span>
      {children}
    </div>
  )
}

function Seg<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={`grid border border-border/60`} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
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

export default function WidgetBuilder() {
  const [cfg, setCfg] = useState<WidgetConfig>(DEFAULT_WIDGET)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof WidgetConfig>(k: K, v: WidgetConfig[K]) => setCfg((c) => ({ ...c, [k]: v }))

  const features = [cfg.voice && 'voice', cfg.video && 'video', cfg.images && 'images', cfg.aiFix && 'ai-fix']
    .filter(Boolean)
    .join(',')

  const snippet = `<script\n  src="https://unpkg.com/@openmind/widget"\n  data-service="chatbot"\n  data-accent="${cfg.accent}"\n  data-theme="${cfg.theme}"\n  data-radius="${cfg.radius}"\n  data-agent="${cfg.agentName}"\n  data-greeting="${cfg.greeting}"\n  data-features="${features}"\n  async>\n</script>`

  const FEATURE_TOGGLES = [
    { key: 'voice' as const, icon: Phone, label: 'Voice calls', note: 'visitors call you from the chat' },
    { key: 'video' as const, icon: Video, label: 'Video calls', note: 'face-to-face support in the widget' },
    { key: 'images' as const, icon: ImagePlus, label: 'Image drop', note: 'drag photos into the conversation' },
    { key: 'aiFix' as const, icon: Sparkles, label: 'Fix with AI', note: 'one-click sentence rewriting for visitors' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Widget Builder</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Design the widget your visitors actually touch. Every change on the left is live in the
          preview on the right — and in the snippet below.
        </p>
      </div>

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
                    onClick={() => set('accent', a)}
                    className={`h-9 w-9 border-2 ${cfg.accent === a ? 'border-primary' : 'border-transparent'}`}
                    style={{ background: a }}
                    aria-label={a}
                  />
                ))}
              </div>
            </Row>
            <div className="grid gap-4 sm:grid-cols-3">
              <Row label="Theme">
                <Seg options={['light', 'dark'] as const} value={cfg.theme} onChange={(v) => set('theme', v)} />
              </Row>
              <Row label="Corners">
                <Seg options={['sharp', 'soft', 'round'] as const} value={cfg.radius} onChange={(v) => set('radius', v)} />
              </Row>
              <Row label="Agent name">
                <input className={inputCls} value={cfg.agentName} onChange={(e) => set('agentName', e.target.value)} />
              </Row>
            </div>
            <Row label="Greeting message">
              <input className={inputCls} value={cfg.greeting} onChange={(e) => set('greeting', e.target.value)} />
            </Row>
          </div>

          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-3 block">Features visitors get</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURE_TOGGLES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => set(f.key, !cfg[f.key])}
                  className={`flex items-start gap-3 border px-4 py-3.5 text-left transition-colors ${
                    cfg[f.key] ? 'border-accent bg-accent/10' : 'border-border/60 hover:border-primary'
                  }`}
                >
                  <f.icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg[f.key] ? 'text-accent' : 'text-muted-foreground'}`} />
                  <span>
                    <span className="block text-sm font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.note}</span>
                  </span>
                  <span className={`ml-auto mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${cfg[f.key] ? 'bg-accent' : 'bg-border'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* snippet */}
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
            {saved ? '✓ Published to your site' : 'Publish widget'}
          </button>
        </div>

        {/* live preview */}
        <div className="flex flex-col border border-primary bg-card hard-shadow">
          <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
            <span className="spec-label">Live preview — fully interactive</span>
            <span className="flex items-center gap-1.5 font-mono-spec text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" /> try it
            </span>
          </div>
          <div className="bg-ruled flex-1 p-4" style={{ minHeight: 560 }}>
            <div className="mx-auto h-[560px] max-w-[400px]">
              <ChatWidget config={cfg} />
            </div>
          </div>
          <div className="border-t border-border/50 px-4 py-2.5 text-center font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            chat · call · drop an image · fix a sentence — it all works right here
          </div>
        </div>
      </div>
    </div>
  )
}
