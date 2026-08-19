# OpenMind product map — build with open source, don’t become it

Research snapshot: **19 Aug 2026**. Companion to [`super-agent.md`](./super-agent.md).

This is a **build plan**, not a rewrite. `/app` stays the customer Super Agent. Each “studio” below is a **worker + pane** behind `runCrew` / `runTurn`. We **study** Continue, Cline, goose, OpenHands, Browser Use, Dyad — we do **not** ship them as the product.

**Do not expose 100 MCP tools to one model.** Cloud-scale MCP research is consistent: huge tool catalogs inflate tokens and hurt selection. Retrieve 5–15 tools per turn (gateway / RAG over tool descriptions). Nango stays the customer Connect UX; MCP stays Advanced.

---

## How every feature is built

| Layer | OpenMind already | Open-source pick when we outgrow it |
| --- | --- | --- |
| Shell | Vite `/app`, LangGraph crew | stay |
| Models | BYOK in settings | **LiteLLM** later (spend caps, many providers) |
| Customer apps | Nango Connect | stay — not raw MCP |
| Code / data exec | E2B `run_code` | **OpenHands** worker later |
| Browse | Jina + fetch; Browserless `web_act` | **Browser Use** or **Playwright** worker |
| Memory | `agent_memories` + RLS | pgvector in the **same** table; not Qdrant/Mem0 day one |
| Files | workbench Files pane | object storage + sandbox FS |
| Confirm | `ToolConfirmSheet` | stay for send / write / click / spend |

**Customer vs operator.** Customers never set Nango secrets, LiteLLM, Langfuse, Kasm, or GPU cluster keys. They Connect their GitHub/Gmail and paste **their** model key.

---

## Universal Tasks (“Do Anything”)

This is the product. Studios are specialists the planner calls.

```
USER  →  Planner (LangGraph, already)
            ├─ Research (deep-research — already)
            ├─ Browser (Browserless now → Browser Use later)
            ├─ Data (E2B Python)
            ├─ Docs / Slides (libraries below)
            ├─ Code / Build (E2B → OpenHands)
            ├─ Image / Video / Music (ComfyUI or BYOK APIs)
            └─ Computer (Kasm / Coder — last)
                    →  RESULT + artifacts in Files / Preview
```

**OSS to study, not to replace the planner:** Hugging Face **smolagents** (tiny observe/think/act), **CrewAI** (role prompts — we already staff a crew), **AutoGPT** (too much product). Keep **LangGraph**.

**Tool retrieval OSS:** description embeddings over a small catalog (pgvector); later **agentgateway** when MCP server count is an ops mess. [A2A](https://aaif.io/blog/a2a-joins-aaif) only when a **second process** exists (OpenHands, goose local).

---

## 3. Computer Agent — OpenMind Computer

**Job.** Virtual desktop: Chrome, VS Code, Terminal, Files, LibreOffice, Python, Node. “Download this CSV, clean it, graph it, put it in PowerPoint” by **operating a machine**, not chatting.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Web desktop** | [KasmVNC](https://github.com/kasmtech/KasmVNC) + [Kasm Workspaces images](https://github.com/kasmtech/workspaces-images) | Browser-streamed Linux desktop with Chrome, LibreOffice, terminals. Community Edition exists; full platform is productized — **images + KasmVNC are the open core**. |
| **Dev workspace** | [Coder](https://github.com/coder/coder) + [code-server](https://github.com/coder/code-server) | Terraform-defined workspaces; Coder already ships a **KasmVNC module**. Better for Code than for a consumer “PC”. |
| **Cheap sandbox (now)** | **E2B** (already) | Files + Python + Node **without** a full GUI. Enough for CSV → graphs → PPTX via libraries. |
| **Desktop GUI agent** | [UI-TARS](https://github.com/bytedance/UI-TARS) / Agent-S family, [OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt) | Screenshot + click when you truly need native UI. Heavy, flaky, expensive. |
| **Browser-only “computer”** | [Browser Use](https://github.com/browser-use/browser-use) | Most “computer use” in 2026 is still **the web**. Odysseys-class browser tasks; MIT library. |

**Do not.** Full Windows VMs per user on Railway ($5). **goose** as the hosted product. Anthropic/OpenAI computer-use APIs as the only path (BYOK later, not the OSS story).

**First slice (before a desktop):** E2B + LibreOffice-in-container **or** `python-pptx` + pandas + matplotlib. Same user story, no VNC. **Desktop is Phase 3** because GPU/RAM and isolation are real money.

**Watch:** ByteDance **UI-TARS**, Microsoft **UFO³**, [Skyvern](https://github.com/Skyvern-AI/skyvern) (forms), [Stagehand](https://github.com/browserbase/stagehand) (typed Playwright).

---

## 4. OpenMind Code — lightweight Claude Code / Codex / OpenHands

**Job.** Import GitHub → read project → chat | tree | terminal | preview. Create/edit files, install, test, commit, PR, browser test, deploy.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Coding worker** | [OpenHands](https://github.com/All-Hands-AI/OpenHands) | MIT-ish Devin-class loop; CodeAct; SWE-Bench competitive; 100+ LLMs / Ollama. Talk over **A2A** later. OpenHands already wraps **Browser Use**. |
| **Agent–computer interface** | [SWE-agent](https://github.com/SWE-agent/SWE-agent) | Clean ACI; study file/edit/run protocol, don’t embed Princeton’s UI. |
| **IDE-shaped UX (ideas only)** | [Continue](https://github.com/continuedev/continue), [Cline](https://github.com/cline/cline) | Slash, files, terminal. **Do not embed.** We already copied slash + files pane. |
| **Local desktop later** | [goose](https://github.com/block/goose) (AAIF) | Optional “run on my PC”, never Railway `/app`. |
| **Sandbox** | **E2B** now; Coder/Daytona if we need persistent disks | Railway Edge **cannot** Docker. |
| **Preview** | Vite sandbox, [Sandpack](https://github.com/codesandbox/sandpack), or iframe of `npm run dev` in E2B | Consumer preview without shipping VS Code. |
| **GitHub** | Nango `nango-act` (already) | Customer’s repo, not founder tokens. |

**Do not.** Fork OpenHands into `/app`. **Aider** is a fine CLI — use as a *pattern* (repo map + diffs). **MetaGPT** is a research company-sim, not a product.

**First slice:** E2B workspace clone of **customer** GitHub + `run_code` + PR via Nango. Preview iframe. OpenHands only when multi-file PRs outgrow that.

---

## 5. OpenMind Build — Lovable / Bolt / v0

**Job.** “Pizza restaurant website” → generate → run → preview → “make the header darker”.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Study UX** | [Dyad](https://github.com/dyad-sh/dyad) | Local Lovable/Bolt/v0-shaped builder, **BYOK**, Apache 2.0 core (Pro is FSL — don’t copy `src/pro`). |
| **Study prompts** | [Dewhale / vx.dev](https://github.com/Yuyz0112/dewhale) | Open v0-style prompts + GitHub Actions. Author is rewriting v2 to GitHub-as-MCP; **fork prompts**, don’t depend on the live product. |
| **Run + preview** | E2B or WebContainers-class sandbox + iframe | Same as Code, fewer git knobs. |
| **Components** | shadcn/ui (already in this repo) | Match OpenMind design; Dyad/Dewhale also target shadcn. |

**Do not.** Embed Dyad desktop. Don’t wait on vx.dev as a dependency.

**First slice:** one template (Vite + React + Tailwind) in E2B, chat edits files, live preview. That’s Build. Code is the same worker with a GitHub import.

---

## 6. OpenMind Voice — realtime, then delegate

**Job.** Mic → streaming STT → LLM → streaming TTS → speaker. Then: “Open my project and check yesterday’s deploy” → Code agent.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Realtime transport** | [LiveKit](https://github.com/livekit/livekit) + [LiveKit Agents](https://github.com/livekit/agents) | WebRTC that actually works in a browser/PWA. Apache 2.0. |
| **Swappable pipeline** | [Pipecat](https://github.com/pipecat-ai/pipecat) (Daily, BSD) | STT / LLM / TTS as frames; OpenAI Realtime as one service. Best if we need **BYOK** STT/TTS (Whisper, Groq, local). |
| **Local STT** | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / whisper.cpp | Offline / cheap. |
| **Local TTS** | [Piper](https://github.com/rhasspy/piper), Kokoro, [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) | BYOK playground later. |
| **Now** | OpenAI voice already in `/app` (record → wait) | Upgrade path: LiveKit room in `/app`, agent tools = `runTurn`. |

**Do not.** Stay on record-upload forever. Don’t build our own SFU.

**First slice:** LiveKit (or Pipecat Cloud later) streaming; tool calls into existing crew. Interrupt handling is the hard part — don’t invent it.

**Watch:** TEN Framework, Vocode (telephony), Bolna (Indic).

---

## 7. Image Studio — playground, not one box

**Job.** One prompt → FLUX / Qwen Image / SDXL / other side by side. Compare, upscale, rembg, inpaint, outpaint, img2img, img2video.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Orchestrator** | [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Native Flux.1/2, Qwen-Image, SDXL, edit (Kontext / Qwen Edit), upscale, SAM, rembg-class nodes. **App Mode** hides the node graph. |
| **API to Comfy** | Comfy `/prompt` HTTP or [ComfyUI-to-API](https://github.com/1111-Collaborations) style wrappers | `/app` is the playground UI; Comfy is the GPU worker. |
| **Cheap path** | BYOK Replicate / Fal / Together / OpenRouter image models | Railway has **no** GPU. Self-host Comfy on a GPU box or RunPod **later**. |
| **Rembg / upscale without Comfy** | [rembg](https://github.com/danielgatis/rembg), Real-ESRGAN | Small tools in E2B if we don’t want a Comfy cluster yet. |

**Do not.** Train our own diffusion model. Don’t put HF weights in the Vite client.

**First slice:** 2–4 BYOK image endpoints, compare grid, download. Comfy when we need inpaint/outpaint graphs.

---

## 8. Video Studio — pipeline, not isolated generators

**Job.** T2V, I2V, V2V, avatar, lipsync, upscale, interpolation, bg replace. Later: research → script → voice → images → video → captions → music.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Worker** | **ComfyUI** again | Wan 2.1/2.2, HunyuanVideo, LTX-Video, CogVideoX, lipsync/avatar nodes (InfiniteTalk etc.). |
| **Captions** | faster-whisper | Same as Voice. |
| **Edit / stitch** | [FFmpeg](https://ffmpeg.org/) | Non-negotiable. |
| **Script** | existing Research + crew | Don’t buy a “video LLM”. |

**First slice:** one BYOK T2V/I2V API + FFmpeg concat. Full Comfy video is GPU-hours, Phase 2+.

---

## 9. AI Music

**Job.** Prompt → track, waveform, BPM/key, download, remix, stems, extend, master.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Gen** | ComfyUI **ACE-Step**, Stable Audio, MiniMax Music nodes; [AudioCraft](https://github.com/facebookresearch/audiocraft) / MusicGen lineage | Pick **one** worker (Comfy or a single HF Space), not five UIs. |
| **Stems** | [Demucs](https://github.com/adefossez/demucs) / hybrid Demucs | Vocals vs instrumental is a solved OSS problem. |
| **DSP** | [Pedalboard](https://github.com/spotify/pedalboard), FFmpeg | Extend/master lightly; don’t claim iZotope. |

**First slice:** one music API + waveform in `/app` + Demucs in E2B/GPU worker.

---

## 10. Documents

**Job.** Business plan as an **editable artifact**, not 8k tokens of chat. Export PDF / DOCX / MD / HTML. Patch sections, don’t regenerate the whole file.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Editor in the browser** | [TipTap](https://github.com/ueberdosis/tiptap) or [Milkdown](https://github.com/Milkdown/milkdown) | Markdown source of truth; AI patches JSON/Markdown. |
| **DOCX** | [python-docx](https://github.com/python-openxml/python-docx) or [docx](https://github.com/dolanmiu/docx) (TS) | Real `.docx`. |
| **PDF** | [Typst](https://github.com/typst/typst) or WeasyPrint / Playwright print | Better than “print HTML and pray”. |
| **Office convert** | LibreOffice `--headless` in a worker | DOCX ↔ PDF when needed. |
| **Already** | `business_plan` tool | Promote output into Docs, don’t start over. |

**Do not.** [Univer](https://github.com/dream-num/univer) as the **core** (see `super-agent.md`) — huge suite. Revisit only if Sheets + Docs + Slides must be one canvas.

**First slice:** Markdown artifact in Files pane + download MD/DOCX. Section-level rewrite tool.

---

## 11. Presentations (high priority)

**Job.** “15-slide investor deck” → research → outline → write → charts → images → **real PPTX**, editable.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Write PPTX** | [python-pptx](https://github.com/scanny/python-pptx) **or** [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | Real OOXML, not screenshots. PptxGenJS fits Vite; python-pptx fits E2B data/charts. **Use both:** crew outlines in JSON, E2B fills python-pptx templates. |
| **Charts** | matplotlib / Altair in E2B, or PptxGenJS charts | Same as Sheets. |
| **Preview** | LibreOffice → PDF → images **or** pptx-preview JS | Don’t rasterize as the source of truth. |
| **Research** | existing gather node | Outline agent = crew role, not a new framework. |

**First slice:** JSON slide schema → PptxGenJS download + thumbnail strip in `/app`.

---

## 12. AI Sheets / Data Analyst

**Job.** Upload `sales.xlsx` → “why did July drop?” → Python/SQL → chart → explain → write forecast **back into the workbook**.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Exec** | E2B + **pandas** / **Polars** / **DuckDB** | DuckDB eats CSV/Parquet/xlsx via connectors; SQL the model can write. |
| **xlsx** | [openpyxl](https://foss.heptapod.net/openpyxl/openpyxl) | Read/write the same file. |
| **Viz** | matplotlib, plotly, Vega | Return PNG + updated xlsx as artifacts. |
| **In-browser grid (optional)** | [Luckysheet](https://github.com/dream-num/Luckysheet) / Univer sheets later | Preview only; compute stays in Python. |

**First slice:** upload → E2B notebook-style `run_code` → chart + explanation. Write-back cells with openpyxl.

---

## 13. Knowledge

**Job.** Per-user/workspace corpus: PDFs, sites, GitHub, Notion, Drive, DB, email. Every service can retrieve it.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Parse** | [Unstructured](https://github.com/Unstructured-IO/unstructured), [Docling](https://github.com/docling-project/docling) | PDFs that aren’t plain text. |
| **Index** | **Supabase pgvector** (column already reserved) | Don’t add Qdrant until this burns. |
| **Orchestrate ingest** | [LlamaIndex](https://github.com/run-llama/llama_index) **as a library in a worker** | Connectors + chunking. Not LlamaIndex Cloud as the product. |
| **Web ingest** | Firecrawl OSS / Jina (already browse) | Customer URLs with confirm. |
| **Drive/Notion/Gmail** | **Nango** + existing Gmail tools | Same Connect, not 50 MCP URLs. |
| **Study UX** | [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Workspace-of-docs UX; don’t replace `/app`. |

**First slice:** upload PDF/CSV → chunk → `agent_memories` or `knowledge_chunks` with RLS → `memory_search`-style retrieve in `runTurn`.

---

## 14. Memory (≠ Knowledge)

**Job.** Preferences, businesses, projects, coding taste, people, recurring tasks. Conversations don’t reset.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Now** | `agent_memories` + `memory_save` / `memory_search` | Ship this hard: typed keys (`preference`, `person`, `decision`). |
| **Later** | Extract-on-turn (small LLM JSON) into the same table | Mem0’s *idea*, not Mem0 as infra. |
| **Study only** | [Mem0](https://github.com/mem0ai/mem0) | If we ever need their extract graph, self-host — still behind our RLS. |

**Do not.** Qdrant + Mem0 day one.

---

## 15. Workflows

**Job.** n8n-shaped: new email → classify → invoice vs customer → human approve → send. Monday cron: research competitors → report → email.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Product UX** | [n8n](https://github.com/n8n-io/n8n) | Visual graph, cron, email, MCP client/server nodes (2026). Fair-code: **self-host** for OpenMind; don’t resell n8n Cloud as us. |
| **Reliable cron / long jobs** | [Temporal](https://github.com/temporalio/temporal) | When n8n isn’t enough for durable Code/Computer runs. |
| **Lighter** | [Activepieces](https://github.com/activepieces/activepieces), [Windmill](https://github.com/windmill-labs/windmill) | If n8n license/ops hurts. |
| **Triggers** | Nango webhooks + Gmail already | Classify with crew; confirm sheet = human approval. |

**First slice:** “Every Monday” as a **scheduled `runTurn`** in Supabase `pg_cron` or a tiny worker — no n8n until users ask for a canvas.

---

## 16. Agent Marketplace

**Job.** Shareable agents: model, prompt, skills, MCP, knowledge, memory, permissions, workflows. Create Agent UI. Platform, not a pile of pages.

| Role | Best OSS | Why |
| --- | --- | --- |
| **Schema** | Our JSON (employee + `SkillId` + tool allowlist) in Postgres | We already have preset employees. |
| **Permissions** | confirm + allowlists (already) | Marketplace agents default **read-only**. |
| **MCP** | customer-added servers, **retrieved** not mounted | Same MCP-scale lesson. |
| **Study** | CrewAI templates, OpenHands skills, Browser Use marketplace | Copy **packaging**, not their stores. |

**First slice:** export/import an agent card (prompt + tools + knowledge ids). Public gallery later (moderation = real work).

---

## Phase order (theirs, mapped to ours)

Their phases are right. **Insert “make Nango + Browserless live” before Phase 1 looks pretty.**

| Phase | Features | OSS actually on the critical path |
| --- | --- | --- |
| **0 — now** | Deep research, confirm, memory, slash, files pane | already |
| **1** | Browser worker, Files/Knowledge, Memory quality, Code (E2B) | Browser Use **or** Playwright; pgvector ingest; OpenHands **study** |
| **2** | Docs, Slides, Sheets, Image playground, Voice streaming | python-docx / PptxGenJS / DuckDB; BYOK images; LiveKit or Pipecat |
| **3** | Computer desktop, Workflows, cron, MCP marketplace, Agent builder | KasmVNC/Coder; n8n or Temporal; tool RAG |
| **4** | Universal Tasks as the **only** front door | LangGraph planner + retrieved tools — already the shape |

---

## Watchlist (monitor the ecosystem)

Scan monthly. **Integrate** only if it maps to a row above and does not replace `/app`.

| Watch | Why it might matter |
| --- | --- |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | Default OSS browser agent |
| [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands) | Coding worker |
| [block/goose](https://github.com/block/goose) | Local computer agent |
| [dyad-sh/dyad](https://github.com/dyad-sh/dyad) | Build UX |
| [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Image/video/music worker |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat), LiveKit Agents | Voice |
| [coder/coder](https://github.com/coder/coder), KasmVNC | Computer |
| [n8n-io/n8n](https://github.com/n8n-io/n8n) | Workflows |
| [agentgateway](https://agentgateway.dev/) | MCP/A2A/LLM proxy when ops hurt |
| [huggingface/smolagents](https://github.com/huggingface/smolagents) | Keep the loop small |
| Stagehand, Skyvern, UI-TARS | Browser / GUI |
| Dewhale v2 | GitHub-as-MCP |
| SWE-agent, Continue, Cline | Ideas only |

**Skip unless the job changes:** Dify (another frontend), AutoGen (maintenance), Qdrant+Mem0 as greenfield, Univer as day-one office, another image **model** with no playground.

---

## Honest cost note

Railway `/app` is a **static SPA**. GPU (Comfy), VNC desktops (Kasm), WebRTC (LiveKit), and OpenHands all need **other machines**. The open-source picks above are still the right ones — they just aren’t free to host. Until then: **E2B + BYOK APIs + Nango + confirm** is the Super Agent.
