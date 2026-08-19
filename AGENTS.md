# AGENTS.md

## Cursor Cloud specific instructions

### What this is
OpenMind is a **frontend-only** single-page app (React 19 + TypeScript + Vite + Tailwind/shadcn). There is no backend server to run locally — data/auth are provided by Supabase (optional) and the AI agent logic runs client-side. `supabase/functions/mcp-proxy` is a Deno edge function that is deployed to Supabase, not run in local dev.

### Running / testing (no secrets required)
The app runs fully in **demo mode when Supabase env vars are absent**: auth becomes browser-local (see `src/lib/auth.ts`) and the chat uses a local `simulatedBrain()` (see `src/lib/agent.ts` / `src/pages/MobileApp.tsx`). So you can run and exercise the core product — including the AI chat at `/app` — without any credentials, network access, or external services.

To enable *live* auth/DB instead, copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`. Stripe checkout billing (`src/lib/billing.ts`) points at an external link and cannot be fully exercised locally.

Standard commands are the npm scripts in `package.json`:
- `npm run dev` — Vite dev server on **port 3000** (`http://localhost:3000`). Key routes: `/` (marketing home), `/login`, `/dashboard`, `/employees`, `/app` (mobile AI chat).
- `npm run test` — Vitest unit tests (all currently pass).
- `npm run build` — type-check + production build.
- `npm run lint` — ESLint.

### Non-obvious notes
- There is **no lockfile**; dependency install is plain `npm install`.
- `npm run lint` currently reports pre-existing errors in `src/pages/MobileApp.tsx` (React "impure function" / `Date.now` purity rules). These are not caused by environment setup — do not treat a red `lint` as a broken environment.
- Good smoke test for the core product: open `/app`, type a message, send it, and confirm the simulated agent replies — this works entirely offline.
