import { KeyRound, Vault, EyeOff, FileCheck } from 'lucide-react'

const ROWS = [
  {
    icon: KeyRound,
    title: 'Browser-direct mode',
    body: 'AI Employee provider keys stay in memory for the current tab and requests go directly to the selected provider.',
    spec: 'available now',
  },
  {
    icon: Vault,
    title: 'Server-managed vault',
    body: 'A workspace-scoped encrypted provider vault is planned, but is not connected in this build. The console will not ask you to paste a production key into a fake vault.',
    spec: 'planned',
  },
  {
    icon: EyeOff,
    title: 'Authenticated proxy',
    body: 'MCP traffic requires a user session, restricts browser origins, rejects private network targets and does not follow redirects.',
    spec: 'available now',
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
            Fig. 07 — key handling
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
