# OpenMind

**Your models. Your keys. One open stack.**

The open-source integration layer for AI: ten model-agnostic capabilities (chatbot, vision, speech, RAG…) as embeddable widgets and one unified API — running on the customer's own provider keys with zero token markup.

## What's inside

- **Marketing site** — spec-sheet editorial design, live request log, provider matrix
- **Playground** — all 10 capabilities testable in the browser (six run genuinely client-side)
- **Console** (`/dashboard`) — Data Studio (upload/index company data), Widget Builder (design + live preview: voice/video calls, image drop, Fix-with-AI), Inbox, Engage popups, Prompt Studio, per-service settings
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
