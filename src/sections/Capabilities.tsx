import { BookOpen, MessagesSquare, Paintbrush, ArrowRight } from 'lucide-react'

const FEATURES = [
  {
    icon: BookOpen,
    title: 'Answers from your business',
    body: 'Add policies, product information, and frequently asked questions so every reply stays useful.',
  },
  {
    icon: MessagesSquare,
    title: 'Your team can step in',
    body: 'Keep every conversation in one inbox and notify available people when a customer needs help.',
  },
  {
    icon: Paintbrush,
    title: 'Looks like your brand',
    body: 'Choose every color, message style, size, and position before publishing it to your website.',
  },
]

export default function Capabilities() {
  return (
    <section id="capabilities" className="border-b border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <p className="spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" />
            Your customer chatbot
          </p>
          <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
            Helpful by default.
            <br />
            <em className="font-normal italic text-accent">Yours in every detail.</em>
          </h2>
        </div>

        <div className="grid border-l border-t border-primary md:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <div key={feature.title} className="border-b border-r border-primary bg-card p-7">
              <div className="flex items-center justify-between">
                <feature.icon className="h-6 w-6 text-accent" />
                <span className="spec-label">0{index + 1}</span>
              </div>
              <h3 className="mt-8 font-serif-display text-2xl font-semibold">{feature.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>

        <a href="/dashboard" className="mt-8 inline-flex items-center gap-2 border border-primary bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:border-accent hover:bg-accent">
          Start building <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  )
}
