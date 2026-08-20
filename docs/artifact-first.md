# Artifact-first architecture

OpenMind agents **produce artifacts**, not meetings.

## The failure mode we fixed

```
Agent → message → agent → message → agent   ❌  (theater)
```

```
Agent → TASK → ARTIFACT → VALIDATION → NEXT TASK   ✅  (production line)
```

Role-play multi-agent systems (CEO ↔ Manager ↔ Researcher) look busy but often burn tokens on coordination without deliverables. The fix is not "smarter personalities" — it is **structured state** and **artifact contracts**.

## Task Ledger (blackboard)

Every substantive run gets shared project state:

```
PROJECT
├── goal
├── requirements
├── tasks[]          # DAG with deps, limits, status
├── artifacts[]      # files on the blackboard
├── evidence[]
├── decisions[]
├── blockers[]
└── final_output
```

Implementation: `src/lib/task-ledger.ts`

Agents **read artifacts** (`read_artifact`) and **write artifacts** (`write_artifact`). There is no `chatWithAgent()`.

## Agent actions (schema, not chat)

| Action | Purpose |
| --- | --- |
| `create_task` | Planner adds DAG node |
| `read_artifact` | Worker loads prior output |
| `write_artifact` | Worker submits deliverable |
| `request_review` | Trigger judge |
| `request_tool` | Run web/code/browser tool |
| `report_blocker` | Stop with reason |
| `complete_task` | Structured completion record |

## Capability workers (not C-suite roles)

Workers are **machines with tools**, not characters:

| Worker | Tools | Required outputs |
| --- | --- | --- |
| research | web_search, browse_url, search_docs | `research/*.json` |
| code | run_code, github_*, code_review | `website/*`, code files |
| analyst | summarize, calculator | `analysis/report.md` |
| writer | business_plan, summarize | `output/*.md` |
| tester | browse_url, web_act | `qa/test_results.json` |
| reviewer / judge | none | structured `{ passed, problems, requiredFixes }` |

## Artifact contract

Every task declares:

- **outputs** — paths that must exist (`competitors.json`)
- **acceptance** — min sources, min array length, required sections
- **limits** — max steps, retries, cost

No artifact → **TASK FAILED**. No prose-only "I researched the landscape…".

Judge (`src/lib/task-judge.ts`) returns structured verdicts only — never forwards to Manager → CEO chains.

## Orchestration graph

LangGraph in `src/lib/task-runner.ts`:

```
START → execute (ready tasks in parallel)
     → judge (validate artifacts)
     → execute | finish
     → END
```

`/app` routing (`openmind-os.ts`):

- **"hi"** → single chat assistant (Claude/ChatGPT mode)
- **Substantive goals** → `runTaskGraph` (competitor analysis, landing page, etc.)
- **WorkforceStudio** → legacy `runCrew` when `crew: true`

## UI

`TaskLedgerPanel` shows task progress + artifact list — not agent chat bubbles.

```
Planner                    ✓
Research
├─ Competitors             ✓ 17 sources
├─ Pricing                 ● Working
└─ Features                ○ Waiting
```

## Influences (study, don't rewrite)

| Project | Steal |
| --- | --- |
| **MetaGPT** | SOPs + deliverables per role, not personality |
| **LangGraph** | Explicit state transitions, checkpoints |
| **AFlow** | Optimize workflows, not who talks next |
| **Agent Lightning** | Later: RL on worker accuracy |

## Roadmap

1. ✅ Task ledger types + planner + judge + runner
2. LLM planner (replace heuristics in `task-planner.ts`)
3. Supabase persistence (`tasks`, `artifacts`, `ledger_events`)
4. Playwright tester worker with real pass/fail
5. Agent Lightning for worker prompt optimization

See also: `docs/super-agent.md` for kernel + Nango + Railway stack.
