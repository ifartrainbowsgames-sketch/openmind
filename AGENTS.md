# AGENTS.md

## Cursor Cloud specific instructions

OpenMind is a single React 19 + TypeScript + Vite 7 SPA (no backend service lives in this repo; the backend is an external Supabase project). Standard scripts live in `package.json` (`dev`, `build`, `lint`, `test`, `preview`) and setup is documented in `README.md`.

Non-obvious notes:

- Dependency install requires `npm install --legacy-peer-deps`. A plain `npm install` fails with an `ERESOLVE` error caused by a transitive optional peer (`valibot`) pulled in via `@hookform/resolvers`. The update script already handles this.
- `@langchain/core` is a required peer of `@langchain/langgraph` and is listed in `package.json`. Because `--legacy-peer-deps` does not auto-install peers, it must stay an explicit dependency; without it, the LangGraph-backed lib tests and AI Employees features fail to resolve `@langchain/core`.
- The Vite dev server runs on port **3000** (`npm run dev`, configured in `vite.config.ts`).
- Copy `.env.example` to `.env` before running. Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY`, auth runs in browser-local demo mode and the Playground/ChatWidget fall back to canned "SIMULATED — GATEWAY UNREACHABLE" replies. The marketing site, Playground, and `/employees` still work fully in this mode; the `/dashboard` Supabase-backed data calls require a real hosted Supabase project (schema/migrations and the `openmind-chat` edge function are NOT in this repo).
- Tests (`npm test`, Vitest, Node environment) are unit-only and need no external services. Lint (`npm run lint`) currently reports only `react-refresh` warnings (0 errors).
