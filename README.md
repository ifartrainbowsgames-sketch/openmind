# OpenMind

OpenMind is an open-source React console for BYOK chat experiences and LangGraph-based AI employees. It includes a marketing site, a clearly labeled live/simulated playground, Supabase authentication and storage, and an MCP/REST/webhook plugin marketplace.

## Current status

- The public chat demo calls the `openmind-chat` Edge Function when configured and visibly falls back to canned local responses.
- Published customer widgets use a workspace key, persist conversations, and run with the selected AI employee prompt.
- The chatbot dashboard has connected availability, behavior, widget, staff-routing, and conversation settings.
- Available staff routing surfaces owner-dashboard popups and can deliver individual Telegram or WhatsApp alerts when the required server credentials are configured.
- AI Employees can run with a deterministic local brain or a browser-direct OpenAI-compatible provider.
- Marketplace plugins can be attached per employee. n8n supports MCP or workflow webhooks; OpenClaw supports secure `/hooks/agent` delegation.
- Live connection traffic uses an authenticated Supabase proxy. Connection tokens are session-only and are not persisted to `localStorage`.
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
- persisted `chatbot_configs`, staff availability/routing records, and dashboard notifications
- a private, per-user `sources` storage bucket

Apply migrations and deploy functions with the Supabase CLI:

```bash
supabase db push
supabase functions deploy mcp-proxy
supabase functions deploy openmind-chat --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
```

Configure Edge Function secrets:

```bash
supabase secrets set \
  ALLOWED_ORIGINS=https://your-app.example \
  OPENMIND_CHAT_API_KEY=... \
  OPENMIND_CHAT_BASE_URL=https://api.openai.com/v1 \
  OPENMIND_CHAT_MODEL=gpt-4o-mini \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_WEBHOOK_SECRET=... \
  WHATSAPP_ACCESS_TOKEN=... \
  WHATSAPP_PHONE_NUMBER_ID=... \
  WHATSAPP_NOTIFICATION_TEMPLATE=openmind_staff_alert
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied automatically to hosted Edge Functions. `mcp-proxy` verifies the user again through Supabase Auth in addition to gateway JWT verification.

The public chat function has payload/origin checks and a best-effort per-isolate limit. Production deployments should also enforce a distributed rate limit at the edge.

### Customer chat and staff routing

The dashboard issues a publishable widget key and produces a working `openmind-widget.js` embed snippet. A widget request resolves that key server-side, loads the selected AI employee prompt, persists the thread, and routes message or callback alerts to an available staff member.

- Dashboard alerts use Supabase Realtime.
- Telegram uses the official Bot API `sendMessage` method and a staff member's chat ID.
- The Telegram webhook supports one-click staff linking through `/start <link-code>` and verifies Telegram's secret-token header.
- WhatsApp uses an approved Cloud API template. The configured template must accept two body parameters: alert title and message preview.
- Staff text replies are persisted in the Inbox and polled by the visitor widget.
- “Accept calls” currently means callback-request routing. Live audio/video requires a separate WebRTC or telephony provider and is not represented as connected.

Telegram and WhatsApp tokens are server-only Edge Function secrets. Never place them in `VITE_*` variables or browser storage.
Set `VITE_TELEGRAM_BOT_USERNAME` to the bot's public username, then register
`https://<project>.supabase.co/functions/v1/telegram-webhook` with Telegram's `setWebhook` method using the same `TELEGRAM_WEBHOOK_SECRET` as `secret_token`.

## Connection marketplace

Configure plugins in **Dashboard → Workforce → Connections**, then attach only the required plugins to each employee in the Studio.

- n8n: use its instance-level MCP server for discoverable tools, or a production workflow webhook for a single automation.
- OpenClaw: enable gateway hooks and provide the HTTPS endpoint ending in `/hooks/agent`, its hooks token, and optionally an allowed agent ID.
- Webhook setup is marked `READY` without firing it. Its first employee task is the real execution check.

Non-secret plugin configuration is browser-local. Credentials are held in `sessionStorage` and disappear when the tab session ends; the server-managed vault remains planned.

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
- Public widget keys are identifiers, not secrets. Embedding-site origins are policy-checked, requests consume database-backed tenant/visitor quotas, and conversation resumption additionally requires an unguessable visitor token. Origin headers are not treated as authentication.
- Widget API CORS is restricted to deployment-owned app origins. The iframe derives the customer origin from the browser referrer and fails closed when it is unavailable; add the widget host to `ALLOWED_ORIGINS` and do not embed it under a `no-referrer` policy.
- Browser-direct provider keys remain visible to JavaScript for the current tab. Use only scoped keys until the server-managed vault exists.

## License

MIT — see [LICENSE](LICENSE).
