# Super Agent stack (Genspark-shaped, OpenMind-real)

OpenMind is a **customer Super Agent** with a **thin Agent OS** under it. `/app` is the first app on that kernel. We build the OS by making the kernel stable — not by pausing `/app` to ship agentgateway + A2A + goose first.

Genspark-style numbers (30+ models, 150+ tools, 700 MCP) are **marketing**. Copy the **shape** (orchestrator + specialists + tools + memory), not the checklist.

ChatGPT’s Aug 2026 research is largely correct on **standards**. Several product picks are wrong for *this* app. Verified: [A2A joined AAIF 17 Aug 2026](https://aaif.io/blog/a2a-joins-aaif); [AutoGen is maintenance-mode](https://github.com/microsoft/autogen); [agentgateway](https://agentgateway.dev/) is a real MCP/A2A/LLM proxy.

## MCP vs A2A (adopt the split, don’t boil the ocean)

```
Customer Super Agent (/app, LangGraph)
        │
        ├── in-process specialists     (research / code / write — already)
        ├── Nango                      (customer OAuth apps — GitHub, Slack, Gmail)
        ├── MCP                        (optional Advanced servers)
        └── A2A                        (later: talk to OpenHands / goose / a foreign agent)
```

- **MCP** = agent ↔ tools/data. We already have MCP in Advanced plus Nango for signed-in Connect.
- **A2A** = agent ↔ agent **across processes/vendors**. In-process LangGraph specialists do **not** need A2A. Add A2A when a second runtime exists (OpenHands worker, goose on the desktop, or an external specialist).
- **agentgateway** = security/routing when we have many MCP servers + LLM routes. Too early as the core. Nango + Edge Functions are the customer gateway today.

## Already in OpenMind (keep)

| Layer | What we use | Why not the ChatGPT default |
| --- | --- | --- |
| Brain | **LangGraph** `runCrew` | Agrees with ChatGPT. Graphs beat chat-forever loops. Not AutoGen (maintenance). Not Microsoft Agent Framework (Azure-shaped). |
| Loop | Thin TS crew, not LangChain soup | Same idea as **smolagents**: small observe/think/act. LangGraph only where state helps. |
| Customer UI | Vite `/app` on Railway | Not a Next rewrite. Not goose as the cloud product. |
| Models | BYOK in `/app` | **LiteLLM later** if we mix providers + spend caps. |
| Customer apps | **Nango Connect** + `nango-act` | Raw MCP is a bad Connect UX. Customers tap Connect; they do not paste 50 MCP URLs. |
| Search / research | DuckDuckGo / SearXNG + **deep-research node** | Open Deep Research Python worker only if we outgrow TS. |
| Browse | Jina + fetch; confirm on checkout-like URLs | **Browser Use / Playwright MCP** later. DOM first, vision fallback. |
| Code | Customer GitHub + `run_code` → **E2B** | Code-as-action is right; we already have a sandbox. **OpenHands** later as the coding worker, not a rewrite of `/app`. |
| Memory | `agent_memories` + device fallback | **Not Qdrant + Mem0** while Supabase exists. pgvector column reserved. |
| Observability | `[LIVE]` / `[MOCK]` / `[BLOCKED]` stamps | **Langfuse + OTel** when a worker exists and spend matters. |
| Local PC | not yet | **goose** is the right *local* study target (AAIF). Optional “local mode” later, not the cloud Super Agent. |

## Kernel vs apps

```
/app  (first shell)
  │
openmind-os  bootKernel + runTurn
  │
  ├── LangGraph crew (staff → gather → dispatch → synthesize)
  ├── tools + confirm
  ├── memory
  └── Nango identity
        │
        └── OS_APPS: research · developer · browser · office · memory · connect
```

New Genspark-like features become a new row in `OS_APPS`, not a new brain.

1. Deep research gather node (parallel search + cites).
2. Confirm before Gmail / Slack / GitHub write / risky browse.
3. `memory_save` / `memory_search` + `agent_memories` (RLS).

Still operator-only: `NANGO_SECRET_KEY` on Edge Functions.

## What we will not make the core

- **Dify**, **Qdrant**, **Mem0 day one**, **Univer office suites**.
- **AutoGen** — maintenance; new work goes elsewhere (we already use LangGraph).
- **Agent OS as a rewrite** — kernel is `src/lib/openmind-os.ts` (`bootKernel` + `runTurn` + `OS_APPS`). Apps plug in; we do not replace `/app` with a gateway company.
- **Shared founder GitHub** — every customer Connects their own account.
- **A2A + agentgateway on day one** — no second agent process yet.

## Next (order), updated Aug 2026

1. Live Nango (operator secret) so Connect/GitHub writes work.
2. Prefer **code in E2B** when the task is data/transform, instead of inventing more JSON tools.
3. Browser worker: Playwright MCP or Browser Use (confirm already exists).
4. OpenHands as coding worker behind GitHub · main.
5. A2A only to that worker (and later goose local).
6. agentgateway if MCP server count + LLM routes become an ops mess.
7. LiteLLM, then Langfuse/OTel.
8. Study **smolagents** CodeAgent and **goose** — copy ideas, don’t replace `/app`.

## Target graph

```
/app  (customers)
  │
LangGraph Super Agent
  ├── Research   → deep-research + agent-tools
  ├── Developer  → customer GitHub + E2B  (+ OpenHands later)
  ├── Browser    → Jina now; Playwright/Browser Use later
  └── Memory     → agent_memories
  │
Nango (OAuth apps)  |  MCP (Advanced)
  │
A2A ……………… later, to other runtimes
  │
Supabase
```

## Operator vs customer

Customers never set `NANGO_SECRET_KEY`, LiteLLM, Langfuse, A2A, or gateway keys. They sign in and tap **Connect apps**.
