# OpenMind

An AI agent workspace. Agents plan work into tasks, use real tools, produce
artifacts, and validate each other's output before anything counts as done.

The customer chatbot is one service on top of that runtime, not the whole
product.

## Services

| Service | What it does | Status |
| --- | --- | --- |
| **Chat** (`/app`) | Single assistant with live tools, voice, and connected apps | Real |
| **Workforce** | Task DAG, capability-matched workers, artifacts, acceptance criteria, delegation | Real |
| **Build** | E2B sandbox: clone, edit, run the repo's own checks, read real exit codes | Real |
| **Research** | Search and browse with citations; sources counted, not asserted | Real |
| **Chatbot** | Embeddable customer widget, designer, conversations, staff handoff | Real |
| **Knowledge** | Stores files and pasted text | Partial — no extraction, crawling, chunking or embedding yet |
| **Automations** | n8n and OpenClaw plugins per employee | Real |
| **Apps** | MCP and REST connections, OAuth installations | Real |

## How a run works

```
USER GOAL → PLANNER → TASK DAG → WORKERS → TOOLS → ARTIFACTS
                                     ↓
                          SHARED PROJECT LEDGER
                                     ↓
                       VALIDATOR → pass / replan → RESULT
```

Workers do not talk to each other. They communicate through structured tasks,
artifacts, and the project ledger. A worker needing a capability it lacks files
a delegation request naming the artifact it will produce; the orchestrator
decides, within a depth and count budget. A request that cannot name an output
is a conversation, and is refused.

Every task ends in one of four outcomes — **completed**, **failed**,
**blocked**, or **needs user**. Never "still discussing".

## Real, simulated, blocked

The app distinguishes these everywhere, and so does this README:

- **Real** — actually ran. Tool output is stamped `[LIVE · id]`.
- **Simulated** — canned. Stamped `[MOCK · id]`, and never presented as real.
- **Blocked** — a capability is missing. Reported as a blocker, not substituted
  with something that looks like an answer.

Strict mode removes the middle option: a missing connection blocks the task
instead of returning mock data that would pass validation.

## Current status

Honest about what is not finished:

- Knowledge stores files and pasted text. Automatic extraction, crawling,
  chunking and embedding are **not implemented**.
- Billing is **not live**. Plan fields are server-controlled.
- Live audio and video calls in the widget designer are **preview only**.
- Worktrees, external coding-agent adapters (Claude Code, Codex, ACP) and the
  browser-worker provider are **interfaces with tests, not live integrations**.
- The provider-key vault **is** implemented: keys are sealed with AES-256-GCM
  server-side and are not readable back, including by their owner.
- Model keys are yours. Search, browsing, the sandbox and hosted Chrome run on
  OpenMind's credentials and need no key from you.

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
- persisted `chatbot_configs`, immutable published design versions, staff availability/routing records, and dashboard notifications
- a private, per-user `sources` storage bucket

Apply migrations and deploy functions with the Supabase CLI:

```bash
supabase db push
supabase functions deploy mcp-proxy
supabase functions deploy oauth-connector --no-verify-jwt
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
  GITHUB_CONNECTOR_CLIENT_ID=... \
  GITHUB_CONNECTOR_CLIENT_SECRET=... \
  OAUTH_TOKEN_ENCRYPTION_KEY=... \
  OAUTH_CONNECTOR_CALLBACK_URL=https://your-project.supabase.co/functions/v1/oauth-connector/callback \
  OAUTH_APP_URL=https://your-app.example \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_WEBHOOK_SECRET=... \
  WHATSAPP_ACCESS_TOKEN=... \
  WHATSAPP_PHONE_NUMBER_ID=... \
  WHATSAPP_NOTIFICATION_TEMPLATE=openmind_staff_alert
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the service-role credential are supplied automatically to hosted Edge Functions. `mcp-proxy` verifies the user again through Supabase Auth in addition to gateway JWT verification.

The public chat function has payload/origin checks and a best-effort per-isolate limit. Production deployments should also enforce a distributed rate limit at the edge.

### Customer chat and staff routing

The designer saves visual edits as a draft. Publishing atomically copies that draft to the public widget configuration and records an immutable version. The install snippet only needs a workspace widget key; the loader receives published launcher and panel settings from the iframe at runtime. A widget request resolves the key server-side, loads the selected reply instructions, persists the thread, and routes message or callback alerts to an available staff member.

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

Configure customer-facing connections in **Workspace → Apps**. Advanced automations can attach only the required apps to each assistant.

- GitHub: click **Install**, approve access on GitHub, and return to Apps. OAuth state and PKCE are single-use; access tokens are encrypted server-side and injected only by the authenticated proxy.
- n8n: use its instance-level MCP server for discoverable tools, or a production workflow webhook for a single automation.
- OpenClaw: enable gateway hooks and provide the HTTPS endpoint ending in `/hooks/agent`, its hooks token, and optionally an allowed agent ID.
- Webhook setup is marked `READY` without firing it. Its first employee task is the real execution check.

Register the exact `OAUTH_CONNECTOR_CALLBACK_URL` in the GitHub OAuth App settings. Generate `OAUTH_TOKEN_ENCRYPTION_KEY` from 32 random bytes and keep it stable; rotating it requires re-authorizing existing connector installations.

OAuth connector credentials are encrypted in a service-role-only server vault and never returned to the browser. Manual plugin credentials remain in `sessionStorage` and disappear when the tab session ends. n8n and OpenClaw remain manual because their self-hosted endpoints do not expose one shared consumer OAuth install flow.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:agents
npm run build
npm run test:e2e
npx tsx scripts/verify-mcp.ts
```

CI runs all checks and Chromium smoke tests. Install the browser locally with `npx playwright install chromium`.

`npx tsx scripts/verify-mcp.ts` drives the MCP transport against a real HTTP server and asserts the URL guard — typechecking alone has already missed a transport endpoint that did not exist.

`npm run test:agents` executes the curated AI employee benchmark. It covers more than 30 knowledge, analysis, code, connection, multi-tool and direct-answer tasks, and scores tool selection, execution, answer content and graph traces separately.

## Security notes

- Never put provider service-role keys in `VITE_*` variables.
- The MCP proxy permits only HTTPS port 443, resolves DNS before requests, blocks private/reserved addresses, and rejects redirects.
- Vaulted connector calls are bound to the installation owner and a provider-specific upstream host; browser-supplied authorization headers are ignored for OAuth installations.
- Public widget keys are identifiers, not secrets. Embedding-site origins are policy-checked, requests consume database-backed tenant/visitor quotas, and conversation resumption additionally requires an unguessable visitor token. Origin headers are not treated as authentication.
- Widget API CORS is restricted to deployment-owned app origins. The iframe derives the customer origin from the browser referrer and fails closed when it is unavailable; add the widget host to `ALLOWED_ORIGINS` and do not embed it under a `no-referrer` policy.
- Browser-held provider keys remain visible to JavaScript for the current tab. Foreground runs use them; background runs use the server-side vault instead.
- Vaulted keys are sealed with AES-256-GCM before reaching Postgres, and column grants deny `authenticated` any access to the ciphertext — a `select` on it fails even with a valid session on your own row.
- Tool credentials (search, browse, sandbox, hosted Chrome) live only in Edge Function secrets. `scripts/verify-mcp.ts` and the client key-mode tests assert they never reach the JS bundle.

## License

MIT — see [LICENSE](LICENSE).
