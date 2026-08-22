# Provider platform — research and decision

**Date:** 2026-08-22 · against `cursor/openmind-v2` @ `3db8c55`

Written before implementation, per the brief. Every claim about an external
project was checked against the live package registry or the live API, not
against a blog post. Every claim about OpenMind was checked against the file.

---

## 1. What OpenMind has today

### 1.1 The provider layer is one fetch call

`src/lib/agent/brains.ts` holds the entire model abstraction:

```ts
export const LIVE_PROVIDERS: readonly LiveProviderSpec[] = [
  { id: 'kimi',       baseUrl: 'https://api.moonshot.ai/v1',   model: 'kimi-k3' },
  { id: 'kimi-cn',    baseUrl: 'https://api.moonshot.cn/v1',   model: 'kimi-k3' },
  { id: 'openai',     baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o-mini' },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2.5' },
  { id: 'groq',       baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
  { id: 'ollama',     baseUrl: 'http://localhost:11434/v1',    model: 'llama3.1' },
]
```

`chatComplete()` POSTs `{baseUrl}/chat/completions` with a Bearer token.

Consequences, stated plainly:

- **Six providers, and every one is OpenAI-shaped.** There is no Anthropic, no
  Gemini, no DeepSeek, no xAI, no Mistral, no Together, no Cohere, no
  Perplexity, no Qwen, no MiniMax.
- **One hard-coded model per provider.** A customer cannot pick a model; they
  pick a provider and get whatever string is in that table.
- **No tool calling, no streaming, no structured output** in the model layer.
  Tool use is OpenMind's own plan/act loop over prose — the provider is only
  ever asked for text.
- **Anthropic is absent, which is why `ClaudeCodeRuntime` had no credential to
  resolve.** The gap found in the previous pass was a symptom of this table.

### 1.2 The vault is correct and stays

| Piece | State |
|---|---|
| `provider_keys` | ciphertext + iv, **column-grant denied to `authenticated`**, RLS owner-only, `hint` for display |
| `vault-keys` fn | stores; `list` returns `role, provider_id, hint, updated_at` — never the key |
| `worker/credential-vault.ts` | resolves by `provider_id`, decrypts with the service role |
| `ProviderCredential.toJSON()` | returns metadata; `JSON.stringify` cannot leak |
| `childEnv()` | allowlist filter; worker secrets never reach an agent |
| `RuntimeCredentialRequirement` | declared by the runtime, resolved in the worker |

This is the part of the brief that already exists. Nothing here should be
replaced. **The provider platform must be built on top of it, not beside it.**

### 1.3 What is duplicated, and what is legacy

There are **three** places a provider identity is expressed today:

1. `LIVE_PROVIDERS` — id, baseUrl, model, key URL (browser + worker)
2. `provider_keys.provider_id` — a free-text column, whatever the UI sent
3. `MobileProviderConfig` in `localStorage` — `providerId` + raw `apiKey`

Nothing reconciles them. A `provider_id` of `"anthropic"` is storable today and
resolvable by the vault, but there is no provider by that name in
`LIVE_PROVIDERS`, so nothing can call it.

**Legacy:** `src/lib/mobile-provider.ts` keeps `apiKey`, `plannerApiKey` and
`judgeApiKey` in `localStorage`. This is the deliberate browser-direct mode,
not an accident — but it is the path the brief says must stop being the normal
one.

### 1.4 Browser vs server, and what can reach a browser

| Runs in browser | Runs server-side |
|---|---|
| `LIVE_PROVIDERS`, `chatComplete` | `worker/index.ts` `loadKeys` (model keys) |
| `mobile-provider` localStorage keys | `worker/credential-vault.ts` (provider credentials) |
| `provider-vault` client (metadata only) | `vault-keys` edge function |
| Settings UI | `agent-tools` (platform tool keys) |

Secrets that can reach a browser today: **only the ones the customer typed into
browser-direct mode.** The vault never returns a stored key. That property is
already tested (`runtimes/credentials.test.ts`).

### 1.5 Where provider names are hard-coded

- `LIVE_PROVIDERS` (the table itself)
- `worker/credential-vault.ts` — `PREFERENCE = ['anthropic', 'worker', …]`
- `runtimes/claude-code-runtime.ts` — `provider: 'anthropic'`
- `supabase/functions/vault-keys/index.ts` — the `ROLES` union
- migration check constraints — `role in (…)`

Five places. The brief's "do not scatter `if (provider === 'anthropic')`" is
already half-violated, and will be fully violated by the fourth provider.

---

## 2. External projects

### Vercel AI SDK — `ai@7.0.76`, **Apache-2.0**

Verified live against npm:

| Package | Version |
|---|---|
| `ai` | 7.0.76 |
| `@ai-sdk/openai` | 4.0.45 |
| `@ai-sdk/anthropic` | 4.0.40 |
| `@ai-sdk/google` | 4.0.49 |
| `@ai-sdk/xai` | 4.0.42 |
| `@ai-sdk/mistral` | 4.0.31 |
| `@ai-sdk/groq` | 4.0.29 |
| `@ai-sdk/deepseek` | 3.0.30 |
| `@ai-sdk/togetherai` | 3.0.35 |
| `@ai-sdk/cohere` | 4.0.28 |
| `@ai-sdk/perplexity` | 4.0.30 |
| `@ai-sdk/openai-compatible` | 3.0.34 |
| `@openrouter/ai-sdk-provider` | 3.0.0 |

**Solves:** calling models. One `LanguageModel` interface across providers, with
streaming, tool calling and structured output — the three things OpenMind's
`chatComplete` cannot do.

**TypeScript:** native. Runs in Node and the browser.
**BYOK:** yes — every provider factory takes an `apiKey`.
**Cost tracking:** reports `usage` per call; does not price it.
**Routing:** `createProviderRegistry` resolves `"provider:model"` strings. That
is *lookup*, not routing — no scoring, no fallback, no learning.

**Reuse:** yes, as the **model adapter layer only**.
**Do not reuse:** its agent/tool loop. OpenMind has `AgentRuntime`,
`ExecutionContext` and a judged task graph. Adopting the SDK's agent
abstraction would create a second orchestrator inside the first.

### AI SDK Provider Registry example — `vercel-labs/ai-sdk-preview-provider-registry`

A Next.js demo of `createProviderRegistry`. No package on npm
(`ai-sdk-provider-registry` → NOT FOUND).

**Verdict: study only.** The pattern — one registry keyed by provider id,
resolving `provider:model` — is right and is two lines of our own code. There
is nothing to install.

### LiteLLM — Python, MIT

**Solves:** 100+ providers behind an OpenAI-shaped API, plus a proxy with keys,
budgets and cost tracking.

**Blocker: it is Python.** OpenMind's worker is Node/TypeScript. Adopting
LiteLLM means running a second service, a second credential store and a second
place that knows which customer owns what — the "competing source of truth" the
brief forbids.

**Verdict: reject as a runtime dependency.**

**But take the data idea.** `model_prices_and_context_window.json` (MIT) is the
best-known model pricing table. It is a viable pricing source. See §3 for why
`models.dev` wins on shape.

### LLM Gateway — `theopenco/llmgateway`, **AGPLv3**

TypeScript monorepo, Hono services, OpenAI-compatible `/v1/chat/completions`,
Redis semantic caching, dashboard with usage and billing.

**Verdict: reject.** Two independent reasons, either sufficient:

1. **AGPLv3.** Network-copyleft on a hosted product. Not a licence to take
   lightly for a commercial control plane, and not one to adopt casually.
2. **It is the same product shape as the thing we are building.** It owns keys,
   users, usage and a dashboard. OpenMind already owns all four. Importing it
   would mean two credential stores and two dashboards.

**Study:** its usage schema — provider, model, tokens in/out/cached, latency,
cost, cached-hit — is the right set of columns for Phase 11.

### DeltaLLM — `deltawi/deltallm`, MIT, **19 stars**

Python + Node self-hosted gateway with an admin UI, routing, budgets, guardrails.

**Verdict: reject.** Python again, same architectural overlap as LLM Gateway,
and at 19 stars it carries maintenance risk without offering anything the
better-known projects do not.

### Discovered during research

**`models.dev` — `anomalyco/models.dev`, MIT.** *The most useful find.*

An open, community-maintained catalog of providers and models, served as JSON:

- `https://models.dev/api.json` — full catalog
- `https://models.dev/logos/{provider}.svg` — provider logos

Verified live: **193 providers**, and each provider record carries exactly the
fields the brief's `ProviderDefinition` asks for:

```json
"deepseek": {
  "id": "deepseek",
  "name": "DeepSeek",
  "env": ["DEEPSEEK_API_KEY"],
  "npm": "@ai-sdk/openai-compatible",
  "api": "https://api.deepseek.com",
  "doc": "https://platform.deepseek.com",
  "models": { … }
}
```

And each model carries the brief's `ModelDefinition`:

```json
{
  "id": "claude-fable-5",
  "name": "Claude Fable 5",
  "family": "claude-fable",
  "attachment": true, "reasoning": true,
  "tool_call": true, "structured_output": true,
  "modalities": { "input": ["text","image","pdf"], "output": ["text"] },
  "limit": { "context": 1000000, "output": 128000 },
  "cost": { "input": 10, "output": 50, "cache_read": 1, "cache_write": 12.5 }
}
```

The `npm` field is the part that matters most: **the catalog states which AI SDK
adapter each provider needs.** That answers Phase 8 from data instead of
assumption.

**`@lobehub/icons` — 5.16.0, MIT.** 200+ AI provider logos as tree-shakeable
React components, plus static SVG packages. This is the maintainable logo source
the brief asked for.

**`token.js` — 0.7.1, MIT.** A thinner TS multi-provider client. Rejected: the
AI SDK covers the same ground with vastly more provider coverage and a bigger
maintenance base.

---

## 3. Phase 8 answered from data, not assumption

The brief said *DO NOT ASSUME* which providers are OpenAI-compatible. The
catalog states it. Across 193 providers:

| Adapter | Providers |
|---|---|
| `@ai-sdk/openai-compatible` | **154** |
| `@ai-sdk/anthropic` | 9 |
| `@ai-sdk/openai` | 4 |
| `@ai-sdk/azure` | 2 |
| dedicated (google, vertex, deepinfra, qvac) | 4 |

For the providers the brief named:

| Provider | Adapter | Base URL |
|---|---|---|
| OpenAI | `@ai-sdk/openai` | — |
| Anthropic | `@ai-sdk/anthropic` | — |
| Google Gemini | `@ai-sdk/google` | — |
| xAI | `@ai-sdk/xai` | — |
| Mistral | `@ai-sdk/mistral` | — |
| Groq | `@ai-sdk/groq` | — |
| Together AI | `@ai-sdk/togetherai` | — |
| Cohere | `@ai-sdk/cohere` | — |
| Perplexity | `@ai-sdk/perplexity` | — |
| **DeepSeek** | `@ai-sdk/openai-compatible` | `https://api.deepseek.com` |
| **Moonshot / Kimi** | `@ai-sdk/openai-compatible` | `https://api.moonshot.ai/v1` |
| **Alibaba / Qwen** | `@ai-sdk/openai-compatible` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| OpenRouter | `@openrouter/ai-sdk-provider` | `https://openrouter.ai/api/v1` |
| **MiniMax** | **`@ai-sdk/anthropic`** | `https://api.minimax.io/anthropic/v1` |

That last row is the vindication of "do not assume": **MiniMax exposes an
Anthropic-shaped API, not an OpenAI-shaped one.** A hand-written
`OpenAICompatibleProviderAdapter` applied by guesswork would have produced a
provider card that renders, a credential that stores, a test that fails, and no
obvious reason why.

---

## 4. Decision matrix

| | Use directly | Adapt | Study | Reject |
|---|---|---|---|---|
| **Vercel AI SDK** | ✅ model adapter layer | | | its agent loop |
| **AI SDK Provider Registry** | | | ✅ pattern | nothing to install |
| **LiteLLM** | | | ✅ pricing data shape | ❌ Python service |
| **LLM Gateway** | | | ✅ usage schema | ❌ AGPLv3 + duplicate product |
| **DeltaLLM** | | | | ❌ Python, 19 stars, duplicate |
| **models.dev** | ✅ catalog data | ✅ vendored snapshot | | |
| **@lobehub/icons** | ✅ logos | | | |

---

## 5. Recommended architecture

```
                       OpenMind Console
                              │
              Settings → AI Providers  (logos, connect, test)
                              │
                   ┌──────────┴──────────┐
                   ▼                     ▼
          Provider Registry        Model Registry
          (static identity)      (catalog-backed, cached)
                   │                     │
                   └──────────┬──────────┘
                              ▼
                      Credential Vault          ← unchanged, authoritative
                              │  (worker only)
                              ▼
                     Model Adapter Layer
                              │
                       Vercel AI SDK
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          OpenAI         Anthropic          154 others
       @ai-sdk/openai  @ai-sdk/anthropic  openai-compatible
```

**Kept strictly separate, per the brief:**

| Layer | Question it answers |
|---|---|
| Model provider | *How do we call a model?* |
| `AgentRuntime` | *Who performs the task?* |
| `Runtime` | *Where does execution happen?* |
| OpenMind kernel | *Who owns memory, workspace, permissions, sessions?* |

The AI SDK does **not** become `AgentRuntime`. It sits below `AgentBrain` — the
existing interface the task graph already calls.

### Static vs dynamic, resolved

The brief warned against a table that needs a deploy per model release.

| Static (in code) | Dynamic (catalog, cached) |
|---|---|
| provider id | available models |
| display name | context window |
| logo | pricing |
| adapter type | capabilities |
| credential shape | knowledge cutoff |
| runtime requirements | release date |

The catalog snapshot is **vendored** as a build-time JSON so the app works
offline and a models.dev outage cannot break the settings page, with a runtime
refresh that overlays newer data. A vendored snapshot that is never refreshed is
a static table wearing a costume; a live fetch with no snapshot is a settings
page that breaks when someone else's CDN does. Both, or neither is honest.

---

## 6. Migration plan

1. `provider-registry.ts` — canonical static identity for the providers we
   support. Replaces `LIVE_PROVIDERS` as the source of truth; `LIVE_PROVIDERS`
   becomes a derived view so nothing breaks at once.
2. `model-catalog.ts` — vendored models.dev snapshot + typed accessors +
   refresh.
3. Model adapter over the AI SDK, behind the existing `AgentBrain` interface.
4. Settings → AI Providers UI with real logos.
5. Server-side `provider-test` edge function.
6. `/app` selects model + runtime, never a secret.
7. Browser-direct preserved, marked legacy, no new localStorage flows.

---

## 7. Security implications

Nothing in this plan weakens the vault, and two things must be watched:

- **The catalog is untrusted third-party data.** It names base URLs. A poisoned
  entry could point a customer's key at an attacker's endpoint. Mitigation: the
  vendored snapshot is the trusted copy, refresh only *adds model metadata* and
  may never override a provider's `api` or `npm` for a provider we ship.
- **Test-connection is a server-side credential use.** It must run in a
  function with the service role, return a normalized verdict, and never
  echo the provider's raw error body — provider errors sometimes include the
  submitted key prefix.

`ProviderCredential.toJSON()`, `childEnv` allowlisting, and the
`ciphertext`/`iv` column denial all stay exactly as they are.

---

## 8. Cost and routing implications

The catalog's `cost` block (`input`, `output`, `cache_read`, `cache_write` per
million tokens) plus the AI SDK's per-call `usage` gives everything Phase 11
needs without building billing now: a usage row of

```
provider · model · tokens in/out/cached · latency · cost · runtime · task · user
```

is computable from data we will already have.

For Phase 12, model `capabilities` in the same vocabulary as
`WorkerCapability` is what lets a future router ask *"which models can do
`tools` + `reasoning` under $X?"*. That is why capabilities belong in the model
registry rather than in prompt text.

---

## 9. What this explicitly does not do

- No Wayland Core.
- No evolution or learned routing — only the registries that make it possible.
- No billing system.
- No silent migration of browser-direct keys.
- No `tenant_id`. Ownership stays `user_id`; a future
  `credential_scope: user | organization` is noted and not built.
