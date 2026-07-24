import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plug, LayoutPanelTop, Container } from 'lucide-react'

const SNIPPETS = [
  {
    id: 'api',
    label: 'API',
    icon: Plug,
    file: 'app.ts',
    code: `// Proposed API — @openmind/sdk is not published yet.
import OpenMind from "@openmind/sdk";

// Your key, your provider — we never touch tokens
const om = new OpenMind({
  provider: "anthropic",          // or "openai", "ollama", ...
  apiKey: process.env.ANTHROPIC_KEY,
});

const reply = await om.run("chatbot", {
  message: "What's your refund policy?",
  knowledge: "acme-corp/docs",   // answers cite your sources
});`,
  },
  {
    id: 'embed',
    label: 'Embed',
    icon: LayoutPanelTop,
    file: 'index.html',
    code: `<!-- Proposed embed API — package/URL not published yet. -->
<script
  src="https://unpkg.com/@openmind/widget"
  data-service="chatbot"
  data-provider="openai"
  data-key-mode="browser"   <!-- key stays client-side -->
  async>
</script>`,
  },
  {
    id: 'selfhost',
    label: 'Self-host',
    icon: Container,
    file: 'terminal',
    code: `# Target self-host flow — docker stack is not published yet.
$ git clone github.com/openmind/stack && cd stack

$ cp .env.example .env   # add YOUR provider keys

$ docker compose up -d

✓ gateway   → :4400
✓ widgets   → :4401
✓ analytics → :4402
# the whole stack, on your metal, in ~40s`,
  },
]

export default function Integrate() {
  return (
    <section id="integrate" className="border-b border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <p className="spec-label mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 bg-accent" />
              Fig. 06 — integration
            </p>
            <h2 className="font-serif-display text-5xl font-semibold tracking-tight md:text-6xl">
              Three ways in,
              <br />
              <em className="font-normal italic text-accent">all of them yours.</em>
            </h2>
          </div>
          <p className="max-w-md text-muted-foreground lg:ml-auto">
            These are target integration designs, not published packages. The current repository
            contains the React prototype and Supabase functions documented in its README.
          </p>
        </div>

        <p className="mb-3 w-fit border border-amber-600 px-2 py-1 font-mono-spec text-[10px] uppercase tracking-wider text-amber-700">
          roadmap API examples · not installable yet
        </p>
        <Tabs defaultValue="api">
          <TabsList className="mb-0 grid w-full max-w-md grid-cols-3 rounded-none border border-primary bg-card p-0">
            {SNIPPETS.map((s) => (
              <TabsTrigger
                key={s.id}
                value={s.id}
                className="gap-2 rounded-none border-r border-primary py-3 font-mono-spec text-xs uppercase tracking-[0.14em] last:border-r-0 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {SNIPPETS.map((s) => (
            <TabsContent key={s.id} value={s.id} className="mt-0">
              <div className="bg-terminal hard-shadow border border-primary">
                <div className="flex items-center justify-between border-b border-white/15 px-5 py-2.5">
                  <span className="font-mono-spec text-[11px] uppercase tracking-[0.18em] text-white/50">
                    {s.file}
                  </span>
                  <span className="font-mono-spec text-[10px] text-white/35">copy · paste · ship</span>
                </div>
                <pre className="overflow-x-auto p-6 font-mono-spec text-[13px] leading-relaxed text-white/85">
                  <code>{s.code}</code>
                </pre>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  )
}
