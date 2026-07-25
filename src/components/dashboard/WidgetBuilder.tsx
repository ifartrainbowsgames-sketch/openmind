import { useMemo, useState } from 'react'
import {
  Check,
  Copy,
  History,
  Laptop,
  MessageSquare,
  MonitorSmartphone,
  Paintbrush,
  Phone,
  Rocket,
  RotateCcw,
  Save,
  Settings2,
  Smartphone,
} from 'lucide-react'
import ChatWidget, {
  DEFAULT_WIDGET_COLORS,
  DEFAULT_WIDGET_LAUNCHER,
  DEFAULT_WIDGET_PANEL,
  DEFAULT_WIDGET_STYLE,
  WIDGET_PRESETS,
  applyWidgetPreset,
  type WidgetColors,
  type WidgetConfig,
  type WidgetLauncher,
  type WidgetPanel,
  type WidgetPreset,
  type WidgetStyle,
} from '@/components/widget/ChatWidget'
import { withWidgetConfig, type ChatbotConfig } from '@/lib/chatbot-config'
import type { ChatbotConfigVersion } from '@/hooks/useChatbotConfig'

const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent'

type StudioSection = 'design' | 'content' | 'launcher' | 'publish'
type Device = 'desktop' | 'mobile'

const COLOR_FIELDS: { key: keyof WidgetColors; label: string }[] = [
  { key: 'headerBackground', label: 'Header' },
  { key: 'headerText', label: 'Header text' },
  { key: 'canvas', label: 'Chat background' },
  { key: 'text', label: 'Main text' },
  { key: 'visitorBubble', label: 'Visitor message' },
  { key: 'visitorText', label: 'Visitor text' },
  { key: 'agentBubble', label: 'Reply message' },
  { key: 'agentText', label: 'Reply text' },
  { key: 'composerBackground', label: 'Message box' },
  { key: 'launcherBackground', label: 'Chat button' },
  { key: 'launcherText', label: 'Button text' },
  { key: 'border', label: 'Borders' },
]

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const safe = isHex(value) ? value : '#000000'
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <div className="flex border border-border/60 bg-background">
        <input
          type="color"
          value={safe}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-11 cursor-pointer border-0 bg-transparent p-1"
          aria-label={`${label} color`}
        />
        <input
          value={value}
          onChange={(event) => {
            const next = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`
            if (next.length <= 7) onChange(next)
          }}
          className="min-w-0 flex-1 bg-transparent px-2 font-mono-spec text-xs uppercase outline-none"
          aria-label={`${label} hex value`}
        />
      </div>
    </label>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  unit = 'px',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <span className="font-mono-spec text-[10px] text-foreground">{value}{unit}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  )
}

function relativeLuminance(hex: string): number {
  if (!isHex(hex)) return 1
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(a: string, b: string): number {
  const one = relativeLuminance(a)
  const two = relativeLuminance(b)
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)
}

export default function WidgetBuilder({
  config,
  published,
  saving,
  publishing,
  saved,
  versions,
  onChange,
  onSave,
  onPublish,
  onRestore,
}: {
  config: ChatbotConfig
  published: boolean
  saving: boolean
  publishing: boolean
  saved: boolean
  versions: ChatbotConfigVersion[]
  onChange: (config: ChatbotConfig) => void
  onSave: () => Promise<boolean>
  onPublish: () => Promise<boolean>
  onRestore: (version: ChatbotConfigVersion) => Promise<boolean>
}) {
  const [section, setSection] = useState<StudioSection>('design')
  const [device, setDevice] = useState<Device>('desktop')
  const [copied, setCopied] = useState(false)
  const chat = config.widget
  const colors = chat.colors ?? DEFAULT_WIDGET_COLORS
  const style = chat.style ?? DEFAULT_WIDGET_STYLE
  const launcher = chat.launcher ?? DEFAULT_WIDGET_LAUNCHER
  const panel = chat.panel ?? DEFAULT_WIDGET_PANEL

  const updateWidget = (next: WidgetConfig) => onChange(withWidgetConfig(config, next))
  const patchWidget = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) =>
    updateWidget({ ...chat, [key]: value })
  const patchColors = (patch: Partial<WidgetColors>) => {
    const nextColors = { ...colors, ...patch }
    updateWidget({ ...chat, accent: nextColors.accent, colors: nextColors })
  }
  const patchStyle = (patch: Partial<WidgetStyle>) => patchWidget('style', { ...style, ...patch })
  const patchLauncher = (patch: Partial<WidgetLauncher>) => patchWidget('launcher', { ...launcher, ...patch })
  const patchPanel = (patch: Partial<WidgetPanel>) => patchWidget('panel', { ...panel, ...patch })

  const contrastWarnings = useMemo(() => {
    const pairs = [
      ['header', colors.headerText, colors.headerBackground],
      ['visitor message', colors.visitorText, colors.visitorBubble],
      ['reply message', colors.agentText, colors.agentBubble],
      ['chat button', colors.launcherText, colors.launcherBackground],
    ] as const
    return pairs.filter(([, foreground, background]) => contrastRatio(foreground, background) < 4.5)
      .map(([label]) => label)
  }, [colors])

  const widgetScriptUrl =
    typeof window === 'undefined' ? 'https://your-openmind-domain/openmind-widget.js' : `${window.location.origin}/openmind-widget.js`
  const snippet = `<script src="${widgetScriptUrl}" data-key="${config.publicKey || 'publish-to-create-key'}" async></script>`
  const sections: { id: StudioSection; label: string; icon: typeof Paintbrush }[] = [
    { id: 'design', label: 'Design', icon: Paintbrush },
    { id: 'content', label: 'Content', icon: MessageSquare },
    { id: 'launcher', label: 'Layout', icon: Settings2 },
    { id: 'publish', label: 'Publish', icon: Rocket },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Chatbot designer</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Design freely, preview every screen size, then publish when it is ready.
          </p>
        </div>
        <div className="flex items-center border border-border/60 bg-card">
          <button
            onClick={() => setDevice('desktop')}
            className={`p-2.5 ${device === 'desktop' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            aria-label="Desktop preview"
          >
            <Laptop className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDevice('mobile')}
            className={`p-2.5 ${device === 'mobile' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            aria-label="Mobile preview"
          >
            <Smartphone className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(340px,0.8fr)_minmax(420px,1.2fr)]">
        <div className="border border-primary bg-card">
          <div className="grid grid-cols-4 border-b border-primary">
            {sections.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex flex-col items-center gap-1 px-2 py-3 text-[10px] uppercase tracking-[0.12em] ${
                  section === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <item.icon className="h-4 w-4" /> {item.label}
              </button>
            ))}
          </div>

          <div className="space-y-5 p-5">
            {section === 'design' && (
              <>
                <div>
                  <span className="spec-label mb-2 block">Starting style</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(Object.entries(WIDGET_PRESETS) as [WidgetPreset, (typeof WIDGET_PRESETS)[WidgetPreset]][]).map(([id, preset]) => (
                      <button
                        key={id}
                        onClick={() => updateWidget(applyWidgetPreset(chat, id))}
                        className={`border p-2 text-left ${chat.preset === id ? 'border-accent' : 'border-border/60'}`}
                      >
                        <span className="mb-2 block h-5" style={{ background: preset.colors.headerBackground }} />
                        <span className="text-xs font-medium">{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="spec-label mb-3 block">Colors</span>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {COLOR_FIELDS.map((field) => (
                      <ColorControl
                        key={field.key}
                        label={field.label}
                        value={colors[field.key]}
                        onChange={(value) => patchColors({
                          [field.key]: value,
                          ...(field.key === 'visitorBubble' ? { accent: value } : {}),
                        })}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <RangeControl label="Panel corners" value={style.panelRadius} min={0} max={32}
                    onChange={(panelRadius) => patchStyle({ panelRadius })} />
                  <RangeControl label="Message corners" value={style.bubbleRadius} min={0} max={28}
                    onChange={(bubbleRadius) => patchStyle({ bubbleRadius })} />
                  <RangeControl label="Control corners" value={style.controlRadius} min={0} max={24}
                    onChange={(controlRadius) => patchStyle({ controlRadius })} />
                  <RangeControl label="Text size" value={style.fontSize} min={12} max={18}
                    onChange={(fontSize) => patchStyle({ fontSize })} />
                </div>

                <label className="block">
                  <span className="spec-label mb-1.5 block">Shadow</span>
                  <select className={inputCls} value={style.shadow}
                    onChange={(event) => patchStyle({ shadow: event.target.value as WidgetStyle['shadow'] })}>
                    <option value="none">None</option>
                    <option value="soft">Soft</option>
                    <option value="strong">Strong</option>
                  </select>
                </label>
              </>
            )}

            {section === 'content' && (
              <>
                <label className="block">
                  <span className="spec-label mb-1.5 block">Name</span>
                  <input className={inputCls} value={chat.agentName}
                    onChange={(event) => patchWidget('agentName', event.target.value)} />
                </label>
                <label className="block">
                  <span className="spec-label mb-1.5 block">Welcome message</span>
                  <textarea className={`${inputCls} min-h-24 resize-y`} value={chat.greeting}
                    onChange={(event) => patchWidget('greeting', event.target.value)} />
                </label>
                <label className="block">
                  <span className="spec-label mb-1.5 block">Font</span>
                  <select className={inputCls} value={chat.font ?? 'system'}
                    onChange={(event) => patchWidget('font', event.target.value as WidgetConfig['font'])}>
                    <option value="system">Clean</option>
                    <option value="serif">Editorial</option>
                    <option value="mono">Technical</option>
                  </select>
                </label>
                <div className="space-y-2">
                  <button
                    onClick={() => patchWidget('voice', !chat.voice)}
                    className={`flex w-full items-center gap-3 border p-3 text-left ${chat.voice ? 'border-accent bg-accent/5' : 'border-border/60'}`}
                  >
                    <Phone className="h-4 w-4" />
                    <span className="flex-1 text-sm">Show callback button</span>
                    <span className="text-xs text-muted-foreground">{chat.voice ? 'On' : 'Off'}</span>
                  </button>
                </div>
              </>
            )}

            {section === 'launcher' && (
              <>
                <label className="block">
                  <span className="spec-label mb-1.5 block">Button label</span>
                  <input className={inputCls} maxLength={32} value={launcher.label}
                    onChange={(event) => patchLauncher({ label: event.target.value })} />
                </label>
                <label className="block">
                  <span className="spec-label mb-1.5 block">Position</span>
                  <select className={inputCls} value={launcher.position}
                    onChange={(event) => patchLauncher({ position: event.target.value as WidgetLauncher['position'] })}>
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                  </select>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <RangeControl label="Button height" value={launcher.size} min={44} max={72}
                    onChange={(size) => patchLauncher({ size })} />
                  <RangeControl label="Side spacing" value={launcher.offsetX} min={8} max={80}
                    onChange={(offsetX) => patchLauncher({ offsetX })} />
                  <RangeControl label="Bottom spacing" value={launcher.offsetY} min={8} max={80}
                    onChange={(offsetY) => patchLauncher({ offsetY })} />
                  <RangeControl label="Panel width" value={panel.width} min={320} max={520}
                    onChange={(width) => patchPanel({ width })} />
                  <RangeControl label="Panel height" value={panel.height} min={480} max={760}
                    onChange={(height) => patchPanel({ height })} />
                </div>
              </>
            )}

            {section === 'publish' && (
              <>
                <div>
                  <span className="spec-label mb-2 block">Install on your website</span>
                  <pre className="overflow-x-auto bg-terminal p-3 font-mono-spec text-[11px] leading-relaxed text-white/85">
                    <code>{snippet}</code>
                  </pre>
                  <button
                    onClick={() => {
                      if (!published) return
                      void navigator.clipboard?.writeText(snippet)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1400)
                    }}
                    disabled={!published}
                    className="mt-2 inline-flex items-center gap-2 border border-border/60 px-3 py-2 text-xs hover:border-primary disabled:opacity-40"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy install code'}
                  </button>
                </div>

                <div>
                  <span className="spec-label mb-2 flex items-center gap-2"><History className="h-3.5 w-3.5" /> Version history</span>
                  {versions.length ? (
                    <div className="divide-y divide-border/50 border border-border/60">
                      {versions.slice(0, 6).map((version) => (
                        <div key={version.id} className="flex items-center gap-3 px-3 py-2.5">
                          <span className="text-sm font-medium">Version {version.version}</span>
                          <span className="flex-1 text-xs text-muted-foreground">
                            {new Date(version.createdAt).toLocaleString()}
                          </span>
                          <button onClick={() => void onRestore(version)}
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                            <RotateCcw className="h-3 w-3" /> Restore draft
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Published versions will appear here.</p>
                  )}
                </div>
              </>
            )}

            {contrastWarnings.length > 0 && (
              <p className="border border-amber-600 bg-amber-50 p-3 text-xs text-amber-900">
                Improve text contrast before publishing: {contrastWarnings.join(', ')}.
              </p>
            )}

            <div className="grid gap-2 border-t border-border/60 pt-4 sm:grid-cols-2">
              <button
                onClick={() => void onSave()}
                disabled={saving || publishing}
                className="inline-flex items-center justify-center gap-2 border border-primary px-4 py-3 text-sm font-medium hover:bg-secondary disabled:opacity-40"
              >
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : saved ? 'Draft saved' : 'Save draft'}
              </button>
              <button
                onClick={() => void onPublish()}
                disabled={saving || publishing}
                className="inline-flex items-center justify-center gap-2 border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-accent disabled:opacity-40"
              >
                <Rocket className="h-4 w-4" /> {publishing ? 'Publishing…' : `Publish${config.appearanceVersion ? ` v${config.appearanceVersion + 1}` : ''}`}
              </button>
            </div>
          </div>
        </div>

        <div className="min-w-0 border border-primary bg-card">
          <div className="flex items-center justify-between border-b border-primary px-4 py-3">
            <span className="spec-label">Draft preview</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MonitorSmartphone className="h-3.5 w-3.5" />
              {device === 'mobile' ? 'Mobile' : `${panel.width} × ${panel.height}`}
            </span>
          </div>
          <div className="flex min-h-[680px] items-center justify-center overflow-auto bg-ruled p-4">
            <div
              className="transition-[width,height] duration-200"
              style={{
                width: device === 'mobile' ? Math.min(360, panel.width) : panel.width,
                height: device === 'mobile' ? Math.min(640, panel.height) : panel.height,
                maxWidth: '100%',
              }}
            >
              <ChatWidget config={chat} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
