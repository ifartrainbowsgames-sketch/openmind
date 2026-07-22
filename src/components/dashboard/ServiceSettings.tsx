import { useState } from 'react'
import type { Capability } from '@/data/capabilities'
import type { Source } from './types'
import { CAP_SETTINGS } from './types'
import { Check, Copy, Database, KeyRound, MessageSquare } from 'lucide-react'

const ACCENTS = ['#ff4d00', '#17140f', '#0e7490', '#7c3aed', '#15803d']
const inputCls =
  'w-full border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="spec-label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

export default function ServiceSettings({ cap, sources }: { cap: Capability; sources: Source[] }) {
  const cfg = CAP_SETTINGS[cap.id]
  const [provider, setProvider] = useState(cap.providers[0])
  const [model, setModel] = useState(cfg.models[0])
  const [keyMode, setKeyMode] = useState<'browser' | 'vault'>('browser')
  const [temp, setTemp] = useState(0.7)
  const [prompt, setPrompt] = useState(
    cap.id === 'chat'
      ? 'You are Acme Corp\'s support agent. Answer only from the attached knowledge base. Be concise and friendly.'
      : 'Answer strictly from the attached sources and always cite them.',
  )
  const [accent, setAccent] = useState(ACCENTS[0])
  const [greeting, setGreeting] = useState('Hi! How can I help?')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const attached = sources.filter((s) => s.attached.includes(cap.id))

  const snippet = cfg.widget
    ? `<script\n  src="https://unpkg.com/@openmind/widget"\n  data-service="${cap.id}"\n  data-provider="${provider.toLowerCase().replace(/\s/g, '-')}"\n  data-model="${model}"\n  data-key-mode="${keyMode}"\n  data-accent="${accent}"\n  data-greeting="${greeting}"\n  async>\n</script>`
    : `curl https://api.openmind.dev/v1/${cap.id} \\\n  -H "Authorization: Bearer $OM_KEY" \\\n  -d '{"provider":"${provider.toLowerCase().replace(/\s/g, '-')}","model":"${model}"}'`

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif-display text-3xl font-semibold">
          <span className="font-mono-spec text-sm font-normal text-accent">{cap.index} / </span>
          {cap.name}
        </h2>
        <span className="spec-label">{cap.tagline}</span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        {/* ── left: configuration ── */}
        <div className="space-y-5">
          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-4 block">Provider & model</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {cap.providers.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Model">
                <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
                  {cfg.models.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>

            <div className="mt-4">
              <span className="spec-label mb-1.5 block">Key mode</span>
              <div className="grid grid-cols-2 border border-border/60">
                <button
                  onClick={() => setKeyMode('browser')}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
                    keyMode === 'browser' ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
                  }`}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Browser-direct
                </button>
                <button
                  disabled
                  title="Server-side key vault is on the roadmap — not available yet."
                  className="flex cursor-not-allowed items-center justify-center gap-2 px-3 py-2.5 font-mono-spec text-[11px] uppercase tracking-wider text-muted-foreground/50"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Encrypted vault — soon
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Key stays in the visitor&apos;s browser and requests go straight to the provider.
                A server-side encrypted vault (keys never reach the browser) is on the roadmap.
              </p>
            </div>

            {cfg.params.includes('temperature') && (
              <div className="mt-4">
                <Field label={`Temperature — ${temp.toFixed(2)}`}>
                  <input type="range" min={0} max={1} step={0.05} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="w-full accent-[#ff4d00]" />
                </Field>
              </div>
            )}
          </div>

          {cfg.params.includes('systemPrompt') && (
            <div className="border border-primary bg-card p-5">
              <Field label="System prompt">
                <textarea className={`${inputCls} min-h-24 resize-y font-mono-spec text-[13px]`} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </Field>
            </div>
          )}

          {/* attached data */}
          <div className="border border-primary bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="spec-label flex items-center gap-2"><Database className="h-3.5 w-3.5" /> Data feeding this service</span>
              <span className="font-mono-spec text-[10px] text-muted-foreground">{attached.length} attached</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{cfg.dataHint}</p>
            <div className="mt-3 space-y-2">
              {attached.length === 0 ? (
                <p className="border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                  Nothing attached — add sources in Data Studio and tick “{cap.name}”.
                </p>
              ) : (
                attached.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 border border-border/50 px-3 py-2">
                    <span className={`h-2 w-2 rounded-full ${s.status === 'indexed' ? 'bg-emerald-600' : 'bg-amber-500'}`} />
                    <span className="truncate text-sm">{s.name}</span>
                    <span className="ml-auto font-mono-spec text-[10px] text-muted-foreground">
                      {s.status === 'indexed' ? `${s.chunks} chunks` : 'indexing…'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── right: appearance + snippet ── */}
        <div className="space-y-5">
          {cfg.widget && (
            <div className="border border-primary bg-card p-5">
              <span className="spec-label mb-4 block">Widget appearance</span>
              <Field label="Accent color">
                <div className="flex gap-2">
                  {ACCENTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAccent(a)}
                      className={`h-9 w-9 border-2 ${accent === a ? 'border-primary' : 'border-transparent'}`}
                      style={{ background: a }}
                      aria-label={a}
                    />
                  ))}
                </div>
              </Field>
              <div className="mt-4">
                <Field label="Greeting message">
                  <input className={inputCls} value={greeting} onChange={(e) => setGreeting(e.target.value)} />
                </Field>
              </div>
              {/* preview */}
              <div className="mt-4 border border-dashed border-border/60 bg-secondary/40 p-4">
                <span className="spec-label mb-3 block">Preview</span>
                <div className="flex items-end justify-end gap-2">
                  <div className="max-w-56 border px-3 py-2 text-sm text-white" style={{ background: accent, borderColor: accent }}>
                    <MessageSquare className="mb-1 h-3.5 w-3.5" />
                    {greeting}
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center text-white" style={{ background: accent }}>
                    <MessageSquare className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="border border-primary bg-card hard-shadow">
            <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
              <span className="spec-label">{cfg.widget ? 'Embed snippet — updates live' : 'API snippet — updates live'}</span>
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
            onClick={save}
            className={`w-full border px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] transition-colors ${
              saved
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-primary bg-primary text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent'
            }`}
          >
            {saved ? '✓ Saved to workspace' : 'Save configuration'}
          </button>
        </div>
      </div>
    </div>
  )
}
