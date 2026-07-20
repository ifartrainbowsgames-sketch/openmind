import { useState } from 'react'
import { streamText } from '@/lib/demo'
import { Play, RotateCcw, Save, ShieldCheck } from 'lucide-react'

const TONES = [
  {
    id: 'support', label: 'Support',
    prompt: 'You are Acme Corp\'s support agent. Answer only from the attached knowledge base. Be concise, warm and never guess — if unsure, offer human handoff.',
    sample: 'Happy to help. According to your attached refund policy, customers can return items within 30 days, no questions asked. If you\'d like, I can start that process for you right here.',
  },
  {
    id: 'sales', label: 'Sales',
    prompt: 'You are Acme Corp\'s product specialist. Your goal is to understand the visitor\'s use case and point them to the right plan. Be enthusiastic but honest. Always end with a next step.',
    sample: 'Great question — and honestly, the timing is perfect. Based on what you described, Pro fits: all 10 capabilities, 5 sites, zero token markup. Want me to set up a trial while we chat?',
  },
  {
    id: 'formal', label: 'Formal',
    prompt: 'You are the official assistant of Acme Corp. Respond in precise, professional language. Cite attached documents for every claim. Do not use contractions or colloquialisms.',
    sample: 'Thank you for your inquiry. Per the attached refund policy (section 2), returns are accepted within thirty days of purchase without condition. Shall I provide the complete document?',
  },
]

const GUARDRAILS = [
  { id: 'cite', label: 'Always cite attached sources' },
  { id: 'scope', label: 'Refuse off-topic questions' },
  { id: 'escalate', label: 'Escalate on frustration' },
  { id: 'piise', label: 'Never repeat PII back' },
]

const VERSIONS = [
  { v: 'v4', note: 'Sales tone + escalation guardrail', when: 'current', current: true },
  { v: 'v3', note: 'Shorter answers, added citations', when: '3 days ago', current: false },
  { v: 'v2', note: 'Switched from formal to support tone', when: '1 wk ago', current: false },
  { v: 'v1', note: 'Initial prompt', when: '2 wks ago', current: false },
]

export default function PromptStudio() {
  const [tone, setTone] = useState('support')
  const [prompt, setPrompt] = useState(TONES[0].prompt)
  const [rails, setRails] = useState<string[]>(['cite', 'escalate'])
  const [question, setQuestion] = useState('Can I get a refund?')
  const [answer, setAnswer] = useState('')
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)

  const tokens = Math.max(1, Math.round(prompt.split(/\s+/).filter(Boolean).length * 1.33))

  const applyTone = (id: string) => {
    const t = TONES.find((x) => x.id === id)!
    setTone(id)
    setPrompt(t.prompt)
  }

  const toggleRail = (id: string) =>
    setRails((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))

  const test = async () => {
    if (testing) return
    setTesting(true)
    setAnswer('')
    const t = TONES.find((x) => x.id === tone)!
    const railNote =
      rails.includes('cite') ? '\n\n— cited: refund-policy.pdf · chunk 14' : ''
    await streamText(`${t.sample}${railNote}`, setAnswer, { cps: 300 })
    setTesting(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif-display text-3xl font-semibold">Prompt Studio</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          The prompt is the product. Write it, guardrail it, test it against your attached data —
          then ship it to the widget with one save.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        {/* editor */}
        <div className="space-y-5">
          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-3 block">Tone preset</span>
            <div className="grid grid-cols-3 border border-border/60">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTone(t.id)}
                  className={`px-3 py-2.5 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
                    tone === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="spec-label">System prompt</span>
                <span className="font-mono-spec text-[10px] text-muted-foreground">≈ {tokens} tokens</span>
              </div>
              <textarea
                className="min-h-36 w-full resize-y border border-border/60 bg-background px-3 py-2.5 font-mono-spec text-[13px] leading-relaxed outline-none focus:border-accent rounded-none"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {['{company}', '{docs}', '{plan}', '{locale}'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setPrompt((p) => `${p} ${v}`)}
                    className="border border-border/60 px-2 py-0.5 font-mono-spec text-[10px] text-muted-foreground hover:border-accent hover:text-accent"
                  >
                    {v}
                  </button>
                ))}
                <span className="ml-1 self-center text-[10px] text-muted-foreground">insert variable</span>
              </div>
            </div>
          </div>

          <div className="border border-primary bg-card p-5">
            <span className="spec-label mb-3 flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" /> Guardrails
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {GUARDRAILS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => toggleRail(g.id)}
                  className={`flex items-center justify-between border px-3 py-2.5 text-left text-xs transition-colors ${
                    rails.includes(g.id)
                      ? 'border-accent bg-accent/10 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:border-primary'
                  }`}
                >
                  {g.label}
                  <span className={`h-2 w-2 rounded-full ${rails.includes(g.id) ? 'bg-accent' : 'bg-border'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* versions */}
          <div className="border border-primary bg-card">
            <div className="border-b border-primary px-5 py-2.5">
              <span className="spec-label">Version history</span>
            </div>
            {VERSIONS.map((v) => (
              <div key={v.v} className="flex items-center gap-3 border-b border-border/40 px-5 py-3 last:border-b-0">
                <span className={`font-mono-spec text-xs ${v.current ? 'text-accent' : 'text-muted-foreground'}`}>{v.v}</span>
                <span className="text-sm">{v.note}</span>
                <span className="ml-auto font-mono-spec text-[10px] text-muted-foreground">{v.when}</span>
                {!v.current && (
                  <button className="flex items-center gap-1 font-mono-spec text-[10px] uppercase tracking-wider text-muted-foreground hover:text-accent">
                    <RotateCcw className="h-3 w-3" /> restore
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* test bench */}
        <div className="space-y-5">
          <div className="flex flex-col border border-primary bg-card hard-shadow">
            <div className="border-b border-primary px-4 py-2.5">
              <span className="spec-label">Test bench — tries the prompt before it ships</span>
            </div>
            <div className="bg-terminal min-h-72 flex-1 p-4 font-mono-spec text-[13px] leading-relaxed text-white/85">
              <div className="mb-3 border-b border-white/15 pb-3">
                <span className="text-white/40">visitor: </span>{question}
              </div>
              {answer ? (
                <>
                  <span className="text-accent">agent: </span>{answer}
                  {testing && <span className="cursor-blink text-accent">▊</span>}
                </>
              ) : (
                <span className="text-white/35">// run a test — the agent answers with your prompt, tone and guardrails…</span>
              )}
            </div>
            <div className="flex gap-2 border-t border-primary p-3">
              <input
                className="flex-1 border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent rounded-none"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && test()}
              />
              <button
                onClick={test}
                className="flex items-center gap-2 border border-primary bg-primary px-4 font-mono-spec text-xs uppercase tracking-wider text-primary-foreground hover:bg-accent hover:border-accent"
              >
                <Play className="h-3.5 w-3.5" /> Test
              </button>
            </div>
          </div>

          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1600) }}
            className={`flex w-full items-center justify-center gap-2 border px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] transition-colors ${
              saved
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-primary bg-primary text-primary-foreground hard-shadow-sm hover:bg-accent hover:border-accent'
            }`}
          >
            <Save className="h-3.5 w-3.5" />
            {saved ? '✓ Live on your widget' : 'Ship prompt to widget'}
          </button>
          <p className="text-center font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            saves as v5 · previous versions restorable above
          </p>
        </div>
      </div>
    </div>
  )
}
