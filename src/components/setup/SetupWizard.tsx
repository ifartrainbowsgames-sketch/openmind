import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowLeft, ArrowRight, Check, Copy, Loader2, KeyRound, Bot, MessageSquare, Sparkles,
  AlertCircle, Send, RotateCcw,
} from 'lucide-react'
import { inputCls, selectCls, textareaCls, Field } from '@/components/demos/shared'
import {
  WIZARD_STEPS, WIZARD_STEP_COUNT, DEFAULT_APPEARANCE, type Tone, type WidgetAppearance,
} from '@/lib/onboarding'
import {
  SETUP_PROVIDERS, DEFAULT_PROVIDER, providerById, testProvider, providerChat, buildSystemPrompt,
  type SetupProvider, type ChatTurn,
} from '@/lib/providers'
import { useOnboarding } from '@/hooks/useOnboarding'

const TONES: { id: Tone; label: string }[] = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'professional', label: 'Professional' },
  { id: 'concise', label: 'Concise' },
  { id: 'playful', label: 'Playful' },
]
const ACCENTS = ['#ff4d00', '#17140f', '#0e7490', '#7c3aed', '#15803d']

/** Shared props handed to every step body. */
interface StepApi {
  onboarding: ReturnType<typeof useOnboarding>
  /** Session-only provider key — never persisted. */
  providerKey: string
  setProviderKey: (v: string) => void
}

export default function SetupWizard({ userId }: { userId?: string }) {
  const onboarding = useOnboarding(userId)
  const navigate = useNavigate()
  const [providerKey, setProviderKey] = useState('')
  const { state, loading, back, next, setStep, complete } = onboarding

  const stepDef = WIZARD_STEPS[state.step]
  const isLast = state.step === WIZARD_STEP_COUNT - 1

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    )
  }

  const api: StepApi = { onboarding, providerKey, setProviderKey }

  const finish = async () => {
    await complete()
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 md:grid-cols-[220px_1fr]">
        {/* progress rail */}
        <aside className="hidden border-r border-primary bg-card px-5 py-8 md:block">
          <div className="mb-6 font-serif-display text-xl font-bold">
            OpenMind<span className="text-accent">.</span>
          </div>
          <ol className="space-y-1">
            {WIZARD_STEPS.map((s, i) => {
              const done = i < state.step
              const current = i === state.step
              return (
                <li key={s.id}>
                  <button
                    disabled={i > state.step}
                    onClick={() => setStep(i)}
                    className={`flex w-full items-center gap-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      current ? 'text-foreground' : done ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground/40'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] ${
                        current ? 'border-accent bg-accent text-white'
                          : done ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-border/60'
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        {/* step body */}
        <main className="flex flex-col px-5 py-8 md:px-12">
          <div className="mb-1 font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Step {state.step + 1} of {WIZARD_STEP_COUNT}
          </div>
          <h1 className="mb-6 font-serif-display text-3xl font-semibold">{stepDef.heading}</h1>

          <div className="flex-1">
            <StepBody api={api} />
          </div>

          {/* footer nav */}
          <div className="mt-8 flex items-center gap-3 border-t border-border/50 pt-5">
            {state.step > 0 && (
              <button
                onClick={back}
                className="flex items-center gap-1.5 border border-border/60 px-4 py-2.5 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              {stepDef.canSkip && !isLast && (
                <button
                  onClick={next}
                  className="font-mono-spec text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
                >
                  Skip for now
                </button>
              )}
              {isLast ? (
                <button
                  onClick={() => void finish()}
                  className="flex items-center gap-2 border border-primary bg-primary px-6 py-2.5 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-primary-foreground transition-colors hover:border-accent hover:bg-accent"
                >
                  Go to dashboard <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={next}
                  className="flex items-center gap-2 border border-primary bg-primary px-6 py-2.5 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-primary-foreground transition-colors hover:border-accent hover:bg-accent"
                >
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Step router ───────────────────────────────────────────────────────────────

function StepBody({ api }: { api: StepApi }) {
  const { step } = api.onboarding.state
  switch (WIZARD_STEPS[step].id) {
    case 'welcome': return <WelcomeStep />
    case 'provider': return <ProviderStep api={api} />
    case 'type': return <TypeStep api={api} />
    case 'identity': return <IdentityStep api={api} />
    case 'knowledge': return <KnowledgeStep api={api} />
    case 'appearance': return <AppearanceStep api={api} />
    case 'preview': return <PreviewStep api={api} />
    case 'embed': return <EmbedStep api={api} />
    case 'verify': return <VerifyStep api={api} />
    case 'done': return <DoneStep api={api} />
    default: return null
  }
}

const card = 'border border-primary bg-card p-6'

// ── Steps (skeleton — polished individually next) ─────────────────────────────

function WelcomeStep() {
  return (
    <div className={card}>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        We&apos;ll walk you through connecting your own AI provider, giving your assistant a name and
        knowledge, and getting a single line of code to paste on your site. No credit card, and your
        API key never leaves your control.
      </p>
      <p className="mt-4 flex items-center gap-2 font-mono-spec text-[12px] text-accent">
        <Sparkles className="h-4 w-4" /> Takes about 5 minutes.
      </p>
    </div>
  )
}

function ProviderStep({ api }: { api: StepApi }) {
  const { state, patchConfig } = api.onboarding
  const conn = state.config.provider
  const initial = (conn?.id && providerById(conn.id)) || DEFAULT_PROVIDER
  const [prov, setProv] = useState<SetupProvider>(initial)
  const [baseUrl, setBaseUrl] = useState(conn?.baseUrl ?? '')
  const [model, setModel] = useState(conn?.model ?? '')
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>(conn?.connected ? 'ok' : 'idle')
  const [error, setError] = useState('')

  const keyMissing = prov.keyRequired && !api.providerKey.trim()
  const baseMissing = Boolean(prov.custom) && !baseUrl.trim()
  const modelMissing = Boolean(prov.custom) && !model.trim()

  const pickProvider = (id: string) => {
    setProv(providerById(id) ?? DEFAULT_PROVIDER)
    setStatus('idle')
    setError('')
  }

  const test = async () => {
    setStatus('testing')
    setError('')
    const over = { baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined }
    const result = await testProvider(prov, api.providerKey, over)
    if (!result.ok) {
      setStatus('error')
      setError(result.error ?? 'Connection failed.')
      return
    }
    const k = api.providerKey.trim()
    const chosenModel = model.trim() || prov.defaultModel
    patchConfig({
      provider: {
        id: prov.id,
        provider: prov.name,
        model: chosenModel,
        baseUrl: baseUrl.trim() || undefined,
        masked: k.length > 7 ? `${k.slice(0, 3)}…${k.slice(-4)}` : k ? '••••' : undefined,
        connected: true,
      },
    })
    setStatus('ok')
  }

  return (
    <div className={`${card} space-y-4`}>
      <p className="text-sm text-muted-foreground">
        Paste a key from your provider. We test it against the provider directly, then keep it for this
        session only — it never touches our servers or your disk. (Durable, encrypted storage arrives
        with the key vault.)
      </p>
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <Field label="Provider">
          <select className={selectCls} value={prov.id} onChange={(e) => pickProvider(e.target.value)}>
            {SETUP_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={prov.keyRequired ? 'API key' : 'API key (optional — local provider)'}>
          <input
            className={inputCls}
            type="password"
            placeholder={prov.keyRequired ? 'sk-… (held for this session only)' : 'not needed for a local provider'}
            value={api.providerKey}
            onChange={(e) => { api.setProviderKey(e.target.value); setStatus('idle'); setError('') }}
          />
        </Field>
      </div>
      {prov.custom && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Base URL">
            <input
              className={inputCls}
              placeholder="https://your-gateway/v1"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setStatus('idle'); setError('') }}
            />
          </Field>
          <Field label="Model">
            <input
              className={inputCls}
              placeholder="model id, e.g. gpt-4o-mini"
              value={model}
              onChange={(e) => { setModel(e.target.value); setStatus('idle'); setError('') }}
            />
          </Field>
        </div>
      )}
      <p className="font-mono-spec text-[11px] text-muted-foreground">Get a key: {prov.keyHint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={test}
          disabled={status === 'testing' || keyMissing || baseMissing || modelMissing}
          className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-primary-foreground transition-colors hover:border-accent hover:bg-accent disabled:opacity-40"
        >
          {status === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {status === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {status === 'ok' && (
          <span className="flex items-center gap-1.5 font-mono-spec text-[11px] text-emerald-700">
            <Check className="h-3.5 w-3.5" /> {prov.name} connected · {model.trim() || prov.defaultModel}
          </span>
        )}
      </div>
      {status === 'error' && (
        <div className="flex items-start gap-2 border border-red-600/40 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
    </div>
  )
}

function TypeStep({ api }: { api: StepApi }) {
  const { state, patchConfig } = api.onboarding
  const pick = state.config.buildType
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <button
        onClick={() => patchConfig({ buildType: 'chatbot' })}
        className={`${card} text-left transition-colors ${pick === 'chatbot' ? 'border-accent ring-1 ring-accent' : 'hover:border-primary'}`}
      >
        <MessageSquare className="mb-3 h-6 w-6 text-accent" />
        <div className="font-serif-display text-xl font-semibold">Website chatbot</div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          An embeddable assistant that answers from your content. This is the fast path — ship it first.
        </p>
      </button>
      <div className={`${card} cursor-not-allowed opacity-60`}>
        <Bot className="mb-3 h-6 w-6 text-muted-foreground" />
        <div className="flex items-center gap-2">
          <span className="font-serif-display text-xl font-semibold">AI employee</span>
          <span className="border border-border/60 px-1.5 py-0.5 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Agents that run real tasks across your tools. Available once the task backend ships.
        </p>
      </div>
    </div>
  )
}

function IdentityStep({ api }: { api: StepApi }) {
  const { state, patchConfig } = api.onboarding
  const c = state.config
  return (
    <div className={`${card} space-y-4`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assistant name">
          <input className={inputCls} placeholder="Acme Assistant" value={c.name ?? ''} onChange={(e) => patchConfig({ name: e.target.value })} />
        </Field>
        <Field label="Tone">
          <select className={selectCls} value={c.tone ?? 'friendly'} onChange={(e) => patchConfig({ tone: e.target.value as Tone })}>
            {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Greeting">
        <textarea className={textareaCls} placeholder="Hi! How can I help?" value={c.greeting ?? ''} onChange={(e) => patchConfig({ greeting: e.target.value })} />
      </Field>
    </div>
  )
}

function KnowledgeStep({ api }: { api: StepApi }) {
  const { patchConfig, next } = api.onboarding
  return (
    <div className={`${card} space-y-4`}>
      <p className="text-sm text-muted-foreground">
        Optional. Add a PDF, paste an FAQ, or point at a URL and we&apos;ll index it so your assistant
        answers from your own content. You can always do this later from the dashboard.
      </p>
      <div className="border border-dashed border-border/60 px-4 py-10 text-center">
        <p className="font-mono-spec text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
          Upload / paste / URL — added in this step next
        </p>
      </div>
      <button
        onClick={() => { patchConfig({ knowledgeSkipped: true }); next() }}
        className="font-mono-spec text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
      >
        Skip — I&apos;ll add knowledge later
      </button>
    </div>
  )
}

function AppearanceStep({ api }: { api: StepApi }) {
  const { state, patchConfig } = api.onboarding
  const appearance: WidgetAppearance = state.config.appearance ?? DEFAULT_APPEARANCE
  const set = (patch: Partial<WidgetAppearance>) => patchConfig({ appearance: { ...appearance, ...patch } })
  return (
    <div className={`${card} space-y-5`}>
      <Field label="Accent color">
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button key={a} onClick={() => set({ accent: a })} aria-label={a}
              className={`h-9 w-9 border-2 ${appearance.accent === a ? 'border-primary' : 'border-transparent'}`}
              style={{ background: a }} />
          ))}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Theme">
          <select className={selectCls} value={appearance.theme} onChange={(e) => set({ theme: e.target.value as WidgetAppearance['theme'] })}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Auto</option>
          </select>
        </Field>
        <Field label={`Corner radius — ${appearance.radius}px`}>
          <input type="range" min={0} max={24} value={appearance.radius} onChange={(e) => set({ radius: Number(e.target.value) })} className="w-full accent-[#ff4d00]" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        {(['voice', 'video'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={appearance[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<WidgetAppearance>)} />
            Enable {k}
          </label>
        ))}
      </div>
    </div>
  )
}

function PreviewStep({ api }: { api: StepApi }) {
  const c = api.onboarding.state.config
  const accent = c.appearance?.accent ?? DEFAULT_APPEARANCE.accent
  const radius = c.appearance?.radius ?? 0
  const greeting = c.greeting?.trim() || 'Hi! How can I help?'

  const conn = c.provider
  const prov = conn?.id ? providerById(conn.id) : undefined
  const hasKey = Boolean(api.providerKey.trim())
  // A local provider (Ollama) needs no key; everything else needs the session key
  // that step 2 held. After a reload that key is gone, so chatting is disabled
  // until the user re-tests the connection — honest about the session-only model.
  const canChat = Boolean(prov && conn?.connected && (hasKey || prov.keyRequired === false))

  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    const text = draft.trim()
    if (!text || !prov || busy) return
    setError('')
    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages(history)
    setDraft('')
    setBusy(true)
    try {
      const reply = await providerChat(prov, api.providerKey, buildSystemPrompt(c), history, {
        baseUrl: conn?.baseUrl,
        model: conn?.model,
      })
      setMessages([...history, { role: 'assistant', content: reply || '(empty response)' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${card} space-y-4`}>
      {canChat ? (
        <p className="text-sm text-muted-foreground">
          This is a real conversation with <strong>{conn?.model}</strong> on {prov?.name}, using the key
          you tested in step 2. Try a question a visitor might ask.
        </p>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          {conn?.connected
            ? 'Your session key was cleared (a reload drops it, by design). Go back to the Provider step and re-test the connection to chat here.'
            : 'Connect and test a provider in step 2 to chat with your assistant live. Below is how the widget will look.'}
        </p>
      )}

      <div className="mx-auto w-full max-w-md border border-primary bg-secondary/30">
        <div className="flex items-center gap-2 border-b border-primary px-4 py-2.5 text-white" style={{ background: accent }}>
          <MessageSquare className="h-4 w-4" />
          <span className="text-sm font-semibold">{c.name || 'Assistant'}</span>
        </div>
        <div className="flex max-h-72 min-h-40 flex-col gap-2 overflow-y-auto p-3">
          <Bubble role="assistant" accent={accent} radius={radius}>{greeting}</Bubble>
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} accent={accent} radius={radius}>{m.content}</Bubble>
          ))}
          {busy && (
            <span className="flex items-center gap-1.5 self-start px-1 font-mono-spec text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> thinking…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-primary p-2">
          <input
            className={`${inputCls} py-2`}
            placeholder={canChat ? 'Ask something…' : 'Connect a provider to chat'}
            value={draft}
            disabled={!canChat || busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send() } }}
          />
          <button
            onClick={() => void send()}
            disabled={!canChat || busy || !draft.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center text-white transition-opacity disabled:opacity-40"
            style={{ background: accent, borderRadius: radius }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-red-600/40 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {messages.length > 0 && (
        <button
          onClick={() => { setMessages([]); setError('') }}
          className="flex items-center gap-1.5 font-mono-spec text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset conversation
        </button>
      )}
    </div>
  )
}

function Bubble({
  role, accent, radius, children,
}: { role: 'user' | 'assistant'; accent: string; radius: number; children: ReactNode }) {
  const mine = role === 'user'
  return (
    <div
      className={`max-w-[85%] whitespace-pre-wrap px-3.5 py-2 text-sm ${
        mine ? 'self-end text-white' : 'self-start border border-border/60 bg-card text-foreground'
      }`}
      style={mine ? { background: accent, borderRadius: radius } : { borderRadius: radius }}
    >
      {children}
    </div>
  )
}

function buildSnippet(config: { name?: string; provider?: { provider: string; model?: string }; appearance?: WidgetAppearance }): string {
  const attrs = [
    'src="https://unpkg.com/@openmind/widget"',
    `data-name="${config.name || 'Assistant'}"`,
    config.provider ? `data-provider="${config.provider.provider.toLowerCase().replace(/\s+/g, '-')}"` : '',
    config.appearance ? `data-accent="${config.appearance.accent}"` : '',
    config.appearance ? `data-theme="${config.appearance.theme}"` : '',
    'async',
  ].filter(Boolean)
  return `<script\n  ${attrs.join('\n  ')}>\n</script>`
}

function EmbedStep({ api }: { api: StepApi }) {
  const snippet = useMemo(() => buildSnippet(api.onboarding.state.config), [api.onboarding.state.config])
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Paste this just before the closing <code>&lt;/body&gt;</code> tag on your site.</p>
      <div className="border border-primary bg-card hard-shadow">
        <div className="flex items-center justify-between border-b border-primary px-4 py-2.5">
          <span className="spec-label">Embed snippet</span>
          <button
            onClick={() => { navigator.clipboard?.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1400) }}
            className="flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-wider text-muted-foreground hover:text-accent"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
        <pre className="bg-terminal overflow-x-auto p-4 font-mono-spec text-[12px] leading-relaxed text-white/85"><code>{snippet}</code></pre>
      </div>
    </div>
  )
}

function VerifyStep({ api }: { api: StepApi }) {
  const { state, patchConfig } = api.onboarding
  return (
    <div className={`${card} space-y-4`}>
      <p className="text-sm text-muted-foreground">
        Open your site in a new tab. When the widget appears in the corner, you&apos;re done. Automatic
        detection is coming — for now, confirm it yourself.
      </p>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" checked={Boolean(state.config.verified)} onChange={(e) => patchConfig({ verified: e.target.checked })} />
        I pasted the snippet and the widget loaded on my site.
      </label>
    </div>
  )
}

function DoneStep({ api }: { api: StepApi }) {
  const c = api.onboarding.state.config
  return (
    <div className={`${card} space-y-3`}>
      <p className="flex items-center gap-2 font-serif-display text-xl font-semibold">
        <Check className="h-5 w-5 text-emerald-600" /> {c.name || 'Your assistant'} is ready
      </p>
      <p className="text-sm text-muted-foreground">
        Your dashboard now shows its status and embed code. You can edit the personality, appearance,
        or knowledge any time — and advanced tools live under Settings.
      </p>
    </div>
  )
}
