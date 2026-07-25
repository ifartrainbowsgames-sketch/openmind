import { EyeOff, FileCheck, LockKeyhole } from 'lucide-react'

const ITEMS = [
  {
    icon: LockKeyhole,
    title: 'Secure app connections',
    body: 'Supported apps open their own sign-in page. Connected account credentials are encrypted and never shown to the chatbot.',
  },
  {
    icon: EyeOff,
    title: 'Private workspace data',
    body: 'Customer conversations, knowledge, and team settings stay inside your workspace with account-level access controls.',
  },
  {
    icon: FileCheck,
    title: 'Inspectable software',
    body: 'OpenMind is open source, so your technical team can inspect how customer data and connections are handled.',
  },
]

export default function Security() {
  return (
    <section id="security" className="border-b border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <p className="spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" />
            Security
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            Your business data
            <br />
            <em className="font-normal italic text-accent">stays under your control.</em>
          </h2>
        </div>
        <div className="grid border-l border-t border-primary md:grid-cols-3">
          {ITEMS.map((item) => (
            <div key={item.title} className="border-b border-r border-primary bg-card p-7">
              <item.icon className="h-6 w-6 text-accent" />
              <h3 className="mt-6 font-serif-display text-2xl font-semibold">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
