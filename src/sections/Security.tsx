import { KeyRound, Vault, EyeOff, FileCheck } from 'lucide-react'

const ROWS = [
  {
    icon: KeyRound,
    title: 'Browser-direct mode',
    body: 'Keys live in the visitor\'s browser; requests go straight to the provider. We physically cannot see your key or your prompts.',
    spec: 'default for embeds',
  },
  {
    icon: Vault,
    title: 'Vault mode',
    body: 'Need server-side calls? Keys are encrypted with AES-256-GCM, scoped per workspace, and never logged. Rotation is one click.',
    spec: 'aes-256-gcm',
  },
  {
    icon: EyeOff,
    title: 'No training, ever',
    body: 'We store request metadata — latency, token counts, errors — never payloads. There is nothing to train on, and nothing to leak.',
    spec: 'metadata only',
  },
  {
    icon: FileCheck,
    title: 'Auditable by design',
    body: 'The gateway is MIT-licensed and self-hostable. Don\'t trust our security page — read the code that handles your keys.',
    spec: 'mit licensed',
  },
]

export default function Security() {
  return (
    <section id="security" className="border-b border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12">
          <p className="spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" />
            Fig. 06 — key handling
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            Your keys are <em className="font-normal italic text-accent">your problem.</em>
            <br />
            <span className="text-muted-foreground">Exactly as it should be.</span>
          </h2>
        </div>

        <div className="grid border-l border-t border-primary md:grid-cols-2">
          {ROWS.map((r) => (
            <div key={r.title} className="border-b border-r border-primary bg-card p-7">
              <div className="flex items-start justify-between">
                <r.icon className="h-6 w-6 text-accent" />
                <span className="font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {r.spec}
                </span>
              </div>
              <h3 className="mt-5 font-serif-display text-2xl font-semibold">{r.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
