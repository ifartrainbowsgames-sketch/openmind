# OpenMind

OpenMind is an open-source React console for BYOK chat experiences and LangGraph-based AI employees. It includes a marketing site, a clearly labeled live/simulated playground, Supabase authentication and storage, and MCP/REST connections.

## Current status

- The public chat demo calls the `openmind-chat` Edge Function when configured and visibly falls back to canned local responses.
- AI Employees can run with a deterministic local brain or a browser-direct OpenAI-compatible provider.
- MCP connections use an authenticated Supabase proxy. Connection tokens are session-only and are not persisted to `localStorage`.
- Data Studio stores files, URLs and pasted text. Automatic crawling, chunking and embedding are not implemented yet.
- Inbox, analytics and Prompt Studio are explicitly labeled interactive previews.
- Billing is not live. Pro is planned at $10/month; plan fields are server-controlled.
- A server-managed provider-key vault is planned and is not represented as implemented.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS · LangGraph · Supabase · Vitest · Playwright

## Local development

```bash
npm ci
cp .env.example .env
npm run dev
```

Without Supabase environment variables, authentication and console data run in clearly labeled browser-local demo mode.

Client environment:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_KEY=sb_publishable_...
```

## Supabase

The reproducible schema and RLS policies live in `supabase/migrations/`. They create:

- `profiles` with a client-readable, billing-controlled plan
- `subscriptions` for the future Stripe webhook
- tenant-isolated `sources`, `conversations`, and `messages`
- a private, per-user `sources` storage bucket

Apply migrations and deploy functions with the Supabase CLI:

```bash
supabase db push
supabase functions deploy mcp-proxy
supabase functions deploy openmind-chat --no-verify-jwt
```

Configure Edge Function secrets:

```bash
supabase secrets set \
  ALLOWED_ORIGINS=https://your-app.example \
  OPENMIND_CHAT_API_KEY=... \
  OPENMIND_CHAT_BASE_URL=https://api.openai.com/v1 \
  OPENMIND_CHAT_MODEL=gpt-4o-mini
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied automatically to hosted Edge Functions. `mcp-proxy` verifies the user again through Supabase Auth in addition to gateway JWT verification.

The public chat function has payload/origin checks and a best-effort per-isolate limit. Production deployments should also enforce a distributed rate limit at the edge.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:agents
npm run build
npm run test:e2e
```

CI runs all checks and Chromium smoke tests. Install the browser locally with `npx playwright install chromium`.

`npm run test:agents` executes the curated AI employee benchmark. It covers more than 30 knowledge, analysis, code, connection, multi-tool and direct-answer tasks, and scores tool selection, execution, answer content and graph traces separately.

## Security notes

- Never put provider service-role keys in `VITE_*` variables.
- The MCP proxy permits only HTTPS port 443, resolves DNS before requests, blocks private/reserved addresses, and rejects redirects.
- Browser-direct provider keys remain visible to JavaScript for the current tab. Use only scoped keys until the server-managed vault exists.

## License

MIT — see [LICENSE](LICENSE).
