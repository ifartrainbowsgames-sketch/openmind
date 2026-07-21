import { useState } from 'react'
import ChatWidget, { DEFAULT_WIDGET, type WidgetConfig } from '@/components/widget/ChatWidget'
import {
  VisionPreview, SttPreview, TtsPreview, TranslatePreview, SummarizePreview,
  DocQaPreview, ApiPreview, DEFAULT_SHARED, type SharedCfg,
} from './widgets/previews'
import {
  Check, Copy, Phone, Video, ImagePlus, Sparkles, MessageSquare, ScanEye, Mic,
  Volume2, Languages, AlignLeft, FileSearch, HeartPulse, Code2,
} from 'lucide-react'

const ACCENTS = ['#ff4d00', '#17140f', '#0e7490', '#7c3aed', '#15803d', '#b91c1c']
const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none'

type Cfg = Record<string, string | boolean>

type WidgetType =
  | 'chatbot' | 'vision' | 'stt' | 'tts' | 'translate' | 'summarize' | 'docqa'
  | 'sentiment' | 'code'

interface TypeDef {
  id: WidgetType
  name: string
  does: string // what the visitor actually gets
  icon: typeof MessageSquare
  apiOnly?: boolean
}

const TYPES: TypeDef[] = [
  { id: 'chatbot', name: 'Chatbot', does: 'the full chat window — talk, call, drop images', icon: MessageSquare },
  { id: 'vision', name: 'Vision', does: 'drop a photo, get a caption, answer or verdict', icon: ScanEye },
  { id: 'stt', name: 'Voice input', does: 'a push-to-talk mic that types for your visitors', icon: Mic },
  { id: 'tts', name: 'Listen player', does: 'a "listen to this page" player for articles', icon: Volume2 },
  { id: 'translate', name: 'Translate bar', does: 'one-tap language switch for your content', icon: Languages },
  { id: 'summarize', name: 'TL;DR button', does: 'shrinks a long page into the gist', icon: AlignLeft },
  { id: 'docqa', name: 'Doc answers', does: 'a search box that answers from your files, cited', icon: FileSearch },
  { id: 'sentiment', name: 'Sentiment', does: 'classifies feedback — api only, no widget', icon: HeartPulse, apiOnly: true },
  { id: 'code', name: 'Code copilot', does: 'completes code — api only, no widget', icon: Code2, apiOnly: true },
]

const DEFAULTS: Record<WidgetType, Cfg> = {
  chatbot: {},
  vision: { mode: 'caption', confidence: true },
  stt: { language: 'auto-detect', autoSend: true },
  tts: { voice: 'Aria', speed: '1.0', compact: false },
  translate: { languages: 'FR,ES,DE,JA', formality: true },
  summarize: { length: 'medium', bullets: true },
  docqa: { placeholder: 'Ask anything about our product…', citations: true },
  sentiment: {},
  code: {},
}

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

function Toggle({ label, note, on, onChange }: { label: string; note: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`flex items-start gap-3 border px-4 py-3.5 text-left transition-colors ${
        on ? 'border-accent bg-accent/10' : 'border-border/60 hover:border-primary'
      }`}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
      <span className={`ml-auto mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${on ? 'bg-accent' : 'bg-border'}`} />
    </button>
  )
}

const FEATURE_TOGGLES = [
  { key: 'voice' as const, icon: Phone, label: 'Voice calls', note: 'visitors call you from the chat' },
  { key: 'video' as const, icon: Video, label: 'Video calls', note: 'face-to-face support in the widget' },
  { key: 'images' as const, icon: ImagePlus, label: 'Image drop', note: 'drag photos into the conversation' },
  { key: 'aiFix' as const, icon: Sparkles, label: 'Fix with AI', note: 'one-click sentence rewriting for visitors' },
]

export default function WidgetBuilder() {
  const [type, setType] = useState<WidgetType>('chatbot')
  const [shared, setShared] = useState<SharedCfg>(DEFAULT_SHARED)
  const [chatCfg, setChatCfg] = useState<WidgetConfig>(DEFAULT_WIDGET)
  const [cfgs, setCfgs] = useState<Record<string, Cfg>>({})
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const def = TYPES.find((t) => t.id === type)!
  const cfg: Cfg = { ...DEFAULTS[type], ...(cfgs[type] ?? {}) }
  const setCfg = (k: string, v: string | boolean) =>
    setCfgs((all) => ({ ...all, [type]: { ...DEFAULTS[type], ...(all[type] ?? {}), [k]: v } }))
  const setChat = <K extends keyof WidgetConfig>(k: K, v: WidgetConfig[K]) =>
    setChatCfg((c) => ({ ...c, [k]: v }))

  // sync chatbot's brand with the shared brand settings
  const chatPreview: WidgetConfig = { ...chatCfg, accent: shared.accent, theme: shared.theme, radius: shared.radius }

  const features = [chatCfg.voice && 'voice', chatCfg.video && 'video', chatCfg.images && 'images', chatCfg.aiFix && 'ai-fix']
    .filter(Boolean)
    .join(',')

  const attr = (k: string, v: string | boolean) => `  data-${k}="${v}"\n`
  const snippet = (() => {
    let attrs = attr('service', type) + attr('accent', shared.accent) + attr('theme', shared.theme) + attr('radius', shared.radius)
    if (type === 'chatbot') {
      attrs +=
        attr('agent', chatCfg.agentName) +
        attr('greeting', chatCfg.greeting) +
        attr('preset', chatCfg.preset ?? 'openmind') +
        attr('font', chatCfg.font ?? 'system') +
        attr('features', features)
    } else if (!def.apiOnly) {
      for (const [k, v] of Object.entries(cfg)) attrs += attr(k, String(v))
    }
    return `<script\n  src="https://unpkg.com/@openmind/widget"\n${attrs}  async>\n</script>`
  })()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Widget Builder</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Every capability has its own embeddable surface — pick one, design it, ship the snippet.
          API-only capabilities say so honestly instead of pretending to be widgets.
        </p>
      </div>

      {/* type selector */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`flex flex-col items-start gap-2 border p-3 text-left transition-colors ${
              type === t.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 bg-card hover:border-primary'
            }`}
          >
            <t.icon className={`h-4 w-4 ${type === t.id ? 'text-accent' : 'text-muted-foreground'}`} />
            <span className="text-xs font-medium leading-tight">{t.name}</span>
            {t.apiOnly && (
              <span className={`font-mono-spec text-[9px] uppercase tracking-wider ${type === t.id ? 'text-accent' : 'text-muted-foreground'}`}>
                api only
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        <strong className="text-foreground">{def.name}:</strong> {def.does}.
      </p>

      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        {/* controls */}
        <div className="space-y-5">
          <div className="border border-primary bg-card p-5 space-y-5">
            <span className="spec-label block">Brand — applies to every widget type</span>
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

          {/* per-type behavior */}
          {type === 'chatbot' && (
            <>
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
            </>
          )}

          {type === 'vision' && (
            <div className="border border-primary bg-card p-5 space-y-5">
              <span className="spec-label block">Vision behavior</span>
              <Row label="Default mode">
                <Seg options={['caption', 'qa', 'moderate'] as const} value={String(cfg.mode)} onChange={(v) => setCfg('mode', v)} />
              </Row>
              <Toggle label="Show confidence" note="display the model's certainty under each result" on={Boolean(cfg.confidence)} onChange={(v) => setCfg('confidence', v)} />
            </div>
          )}

          {type === 'stt' && (
            <div className="border border-primary bg-card p-5 space-y-5">
              <span className="spec-label block">Voice input behavior</span>
              <Row label="Language">
                <Seg options={['auto-detect', 'english', 'german', 'french'] as const} value={String(cfg.language)} onChange={(v) => setCfg('language', v)} />
              </Row>
              <Toggle label="Send on pause" note="auto-submit when the visitor stops talking" on={Boolean(cfg.autoSend)} onChange={(v) => setCfg('autoSend', v)} />
            </div>
          )}

          {type === 'tts' && (
            <div className="border border-primary bg-card p-5 space-y-5">
              <span className="spec-label block">Player behavior</span>
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Voice">
                  <Seg options={['Aria', 'Onyx', 'Juniper'] as const} value={String(cfg.voice)} onChange={(v) => setCfg('voice', v)} />
                </Row>
                <Row label="Speed">
                  <Seg options={['0.75', '1.0', '1.25', '1.5'] as const} value={String(cfg.speed)} onChange={(v) => setCfg('speed', v)} />
                </Row>
              </div>
              <Toggle label="Compact mode" note="just the play button and progress — no title" on={Boolean(cfg.compact)} onChange={(v) => setCfg('compact', v)} />
            </div>
          )}

          {type === 'translate' && (
            <div className="border border-primary bg-card p-5 space-y-5">
              <span className="spec-label block">Translate bar behavior</span>
              <Row label="Languages offered (comma-separated)">
                <input className={inputCls} value={String(cfg.languages)} onChange={(e) => setCfg('languages', e.target.value)} />
              </Row>
              <Toggle label="Formal register" note="use formal address where the language has one" on={Boolean(cfg.formality)} onChange={(v) => setCfg('formality', v)} />
            </div>
          )}

          {type === 'summarize' && (
            <div className="border border-primary bg-card p-5 space-y-5">
              <span className="spec-label block">TL;DR behavior</span>
              <Row label="Default length">
                <Seg options={['short', 'medium', 'long'] as const} value={String(cfg.length)} onChange={(v) => setCfg('length', v)} />
              </Row>
              <Toggle label="Bullet mode" note="return key points instead of a paragraph" on={Boolean(cfg.bullets)} onChange={(v) => setCfg('bullets', v)} />
            </div>
          )}

          {type === 'docqa' && (
            <div className="border border-primary bg-card p-5 space-y-5">
              <span className="spec-label block">Doc answers behavior</span>
              <Row label="Placeholder question">
                <input className={inputCls} value={String(cfg.placeholder)} onChange={(e) => setCfg('placeholder', e.target.value)} />
              </Row>
              <Toggle label="Cite sources" note="link each answer back to the document it came from" on={Boolean(cfg.citations)} onChange={(v) => setCfg('citations', v)} />
            </div>
          )}

          {def.apiOnly && (
            <div className="border border-primary bg-card p-5">
              <span className="spec-label mb-2 block">Why no widget?</span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {def.name} runs inside your product, not on top of it — results feed your own UI,
                pipeline or CI. Use the REST endpoint or an SDK; the request/response shape is in
                the preview pane.
              </p>
            </div>
          )}

          {!def.apiOnly && (
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
          )}

          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1600) }}
            className={`w-full border px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] transition-colors ${
              saved
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-primary bg-primary text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent'
            }`}
          >
            {saved ? '✓ Published to your site' : `Publish ${def.name.toLowerCase()} widget`}
          </button>
        </div>

        {/* live preview */}
        <div className="flex flex-col border border-primary bg-card hard-shadow">
          <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
            <span className="spec-label">Live preview — {def.name.toLowerCase()}</span>
            <span className="flex items-center gap-1.5 font-mono-spec text-[10px] text-muted-foreground">
              <def.icon className="h-3 w-3" /> {def.apiOnly ? 'api shape' : 'try it'}
            </span>
          </div>
          <div className="bg-ruled flex-1 p-4" style={{ minHeight: 560 }}>
            {type === 'chatbot' && (
              <div className="mx-auto h-[560px] max-w-[400px]">
                <ChatWidget config={chatPreview} />
              </div>
            )}
            {type === 'vision' && <VisionPreview shared={shared} cfg={cfg} />}
            {type === 'stt' && <SttPreview shared={shared} cfg={cfg} />}
            {type === 'tts' && <TtsPreview shared={shared} cfg={cfg} />}
            {type === 'translate' && <TranslatePreview shared={shared} cfg={cfg} />}
            {type === 'summarize' && <SummarizePreview shared={shared} cfg={cfg} />}
            {type === 'docqa' && <DocQaPreview shared={shared} cfg={cfg} />}
            {type === 'sentiment' && <ApiPreview shared={shared} service="sentiment" />}
            {type === 'code' && <ApiPreview shared={shared} service="code" />}
          </div>
          <div className="border-t border-border/50 px-4 py-2.5 text-center font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {def.does}
          </div>
        </div>
      </div>
    </div>
  )
}
