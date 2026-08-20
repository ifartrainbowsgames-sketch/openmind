# OpenMind

**Your models. Your keys. One open stack.**

The open-source integration layer for AI: an embeddable chatbot (trained on your docs, answered by any model) as a two-line widget and one unified API — running on the customer's own provider keys with zero token markup.

## What's inside

- **Marketing site** — spec-sheet editorial design, live request log, provider matrix
- **Playground** — the chatbot testable in the browser via a secure gateway (zero keys on the page)
- **Console** (`/dashboard`) — Data Studio (upload/index company data), Widget Builder (design + live preview: voice/video calls, image drop, Fix-with-AI), Inbox, Engage popups, Prompt Studio, per-service settings
- **Super Agent** (`/app`) — customer product: LangGraph crew, Connect your GitHub/Slack/Gmail, GitHub · main workspace. Stack plan: [docs/super-agent.md](docs/super-agent.md)
- **Auth** — Supabase Auth (email/password), route-guarded console
- **Database** — Supabase Postgres with row-level security (profiles, sources, conversations, messages, subscriptions)
- **Billing** — Stripe checkout (Pro $29/mo)

## Stack

React 19 · TypeScript · Vite · Tailwind CSS · shadcn/ui · Supabase · Stripe

## Run

```bash
npm install
cp .env.example .env   # add your Supabase URL + publishable key
npm run dev
```

## Supabase schema

Applied via migration `openmind_initial_schema`: `profiles`, `sources`, `conversations`, `messages`, `subscriptions` — RLS enabled, users only ever see their own rows. A trigger provisions a profile + free subscription on signup.

## Billing

`src/lib/billing.ts` holds the Stripe checkout link. Test mode: use card `4242 4242 4242 4242`, any future expiry, any CVC.
