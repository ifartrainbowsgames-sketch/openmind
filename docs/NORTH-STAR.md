# OpenMind vs Wayland — Complete Gap Research & Upgrade Blueprint

**Date:** 2026-08-21
**OpenMind repo reviewed:** `ifartrainbowsgames-sketch/openmind`, primarily branch `cursor/openmind-v2`
**Wayland reviewed:** `FerroxLabs/wayland` and `FerroxLabs/wayland-core`
**Target:** Turn OpenMind into a web-native AI Agent OS / workbench that can compete with the capabilities and feel of Wayland while keeping OpenMind's stronger artifact-first orchestration.

> **Status of this document:** this is the north star. When work drifts, come back here.
> Progress against it is tracked in [ROADMAP-STATUS.md](ROADMAP-STATUS.md); open defects
> found along the way are in [ISSUES.md](ISSUES.md).

> **Important UI note:** the Railway `/app` URL could not be rendered from the research environment, so the UI/UX audit is based on the current `/app` source (`src/pages/MobileApp.tsx`, `WorkbenchPanes.tsx`, related components), not a pixel-level live screenshot review.

---

# 1. Executive summary

OpenMind has made a major architectural improvement. The earlier version behaved like a role-play multi-agent system: multiple "employees" appeared to collaborate but mainly exchanged text and produced repetitive discussion. The current `openmind-v2` architecture has moved toward a much stronger model:

```text
USER GOAL
   ↓
PROJECT PLANNER
   ↓
TASK DAG
   ↓
CAPABILITY WORKERS
   ↓
TOOLS
   ↓
ARTIFACTS
   ↓
SHARED PROJECT LEDGER
   ↓
VALIDATION
   ↓
RETRY / REPLAN / COMPLETE
```

This is good.

In several areas, this artifact-first model is actually a better foundation than simply copying a conversational multi-agent system.

The remaining difference between OpenMind and Wayland is now mostly elsewhere.

Wayland behaves like an **agent operating environment**:

- persistent agent processes
- real filesystem and shell
- local-first execution
- ACP-driven external agents
- browser/computer control
- multi-layer persistent memory
- background memory consolidation
- skill libraries
- self-evolving skill prompts
- learned skill/agent routing
- scheduled work
- channels
- permissions
- secrets
- diagnostics
- replay/resilience
- a workspace designed around doing work rather than only chatting

OpenMind currently behaves more like:

> **a strong web agent orchestrator with an emerging runtime**

The correct goal is therefore **not to replace the OpenMind Task DAG with Wayland**.

The best architecture is:

```text
           OPENMIND ARTIFACT-FIRST ORCHESTRATION
       Task DAG · Contracts · Validation · Budgets · Evidence
                           +
              WAYLAND-CLASS AGENT RUNTIME
   Persistent sessions · ACP · Shell · Browser · Memory · Evolution
                           +
                 CURSOR-LIKE WEB WORKBENCH
       Explorer · Editor · Diff · Terminal · Preview · AI · Tasks
                           =
                     OPENMIND OS
```

The highest-priority gaps are:

1. **Self-evolution and learning**
2. **Real desktop-class web workbench**
3. **Interactive terminal**
4. **Real editable filesystem/editor workflow**
5. **Durable execution and replay**
6. **Live ACP/external-agent adapters**
7. **Memory consolidation / "dreaming"**
8. **Outcome-based evaluation infrastructure**
9. **Learned skill/worker routing**
10. **First-class permissions and event bus**
11. **Real browser worker and later computer use**
12. **Native scheduled/proactive agents**

---

# 2. What OpenMind already has — do not rebuild this

The latest OpenMind branch already contains several important pieces that should be preserved.

## 2.1 Artifact-first task ledger

`src/lib/task-ledger.ts` now contains:

- `ProjectState`
- `TaskRecord`
- artifact records
- dependencies
- acceptance criteria
- budgets
- spend tracking
- blockers
- evidence
- decisions
- real handoff derivation
- structured `AgentAction`
- delegation state
- terminal outcomes

This is a strong foundation.

OpenMind's central rule should remain:

```text
Agent → Task → Tool → Artifact → Validate → Next Task
```

not:

```text
Agent → Agent → Agent → discussion
```

## 2.2 Project-level LangGraph

`src/lib/task-runner.ts` now runs an artifact-first graph broadly shaped like:

```text
START
  ↓
execute
  ↓
judge
  ├── more work/retry → execute
  └── done → finish
               ↓
              END
```

This directly addresses the original failure mode.

Keep this.

## 2.3 Capability workers

OpenMind has moved away from meaningless corporate roles toward:

- research
- browser
- code
- analyst
- writer
- reviewer
- tester

That is correct.

A worker should exist because a task requires a capability, not because the imaginary company needs a "VP of Something."

## 2.4 SOP layer

`src/lib/workforce/sop.ts` is one of the best additions.

It already links procedures to acceptance conditions.

That matters because:

```text
"cite sources"
```

is merely a prompt suggestion.

While:

```text
acceptance.minSources = 3
```

is machine-enforceable.

Do not replace this with a giant free-form skill prompt library.

Instead evolve it.

## 2.5 Runtime abstraction

`src/lib/workforce/runtime.ts` is the right architectural direction.

The orchestrator should deal with:

```ts
readFile()
writeFile()
list()
exec()
git()
createWorkspace()
```

instead of interpreting prose returned by an LLM.

Keep expanding this typed edge.

## 2.6 E2B runtime adapter

`sandbox-runtime.ts` provides a first implementation of the Runtime interface on top of the existing workspace tools.

This is enough to establish the abstraction.

Do not hardwire the entire system to E2B.

Later implementations can include:

- Docker
- OpenHands Agent Server
- local OpenMind Node
- Kubernetes
- another sandbox provider

## 2.7 Worktree design

OpenMind already has worktree planning and isolated branches for parallel coding workers.

Good.

This is exactly the kind of "boring infrastructure" multi-agent coding systems need.

## 2.8 External agent adapter interface

`src/lib/workforce/adapters.ts` already defines a strong shape for:

- session creation
- event streaming
- cancellation
- resume
- capabilities
- terminal outcomes

The gap is now primarily **live implementations**, not the abstraction.

## 2.9 Worker sessions

`sessions.ts` correctly separates a worker's durable session from an individual task.

Again, the remaining gap is persistence and live provider integration.

## 2.10 Project persistence and background runs

OpenMind already persists projects to local storage and Supabase, and has a server-backed run queue so work can outlive the browser tab.

That is meaningful progress.

However, this is not yet the same as **durable workflow replay**, discussed later.

---

# 3. What Wayland actually is

Wayland is easy to misunderstand as "a multi-agent desktop app."

That description is too small.

The important architecture is closer to:

```text
                         WAYLAND

                         Desktop UI
                             ↓
                    Agent control plane
                             ↓
          ┌──────────────────┼──────────────────┐
          ↓                  ↓                  ↓
       Native agent       ACP agents        Remote agents
          ↓                  ↓                  ↓
          └──────────────────┼──────────────────┘
                             ↓
                         Agent engine
                             ↓
              ┌──────────────┼──────────────┐
              ↓              ↓              ↓
           Memory         Skills         Routing
              ↓              ↓              ↓
              └──────────────┼──────────────┘
                             ↓
                 Files / Bash / Git / Browser
                             ↓
                     Native sandbox
```

Its process tree includes dedicated subsystems for:

- agents
- ACP
- child agents
- channels
- connectors
- permissions
- providers
- resources
- secrets
- services
- storage
- extensions
- diagnostics
- onboarding
- scheduling
- browser/computer use
- memory
- evolution

That modularity is a major part of the maturity gap.

---

# 4. Gap matrix

Legend:

- **Strong** — implementation is already meaningful
- **Partial** — interface/foundation exists but is not yet Wayland-class
- **Missing** — major capability absent

| Area | OpenMind V2 | Wayland-class target | Priority |
|---|---|---|---:|
| Task DAG | Strong | Keep | — |
| Artifact contracts | Strong | Keep | — |
| Acceptance criteria | Strong | Improve evaluator depth | High |
| Delegation | Strong foundation | Real persistent subagents | Medium |
| Budgets | Strong | Keep | — |
| Background runs | Partial | Durable replay/checkpointing | High |
| Worker sessions | Partial | Persisted provider sessions | High |
| Agent registry | Partial | Universal ACP/native registry | High |
| ACP | Interface only | Live protocol | High |
| External coding agents | Interface only | Claude Code/Codex/OpenCode/etc. | High |
| Runtime | Partial | Multiple backends | High |
| Filesystem | Partial | Real explorer/editor synchronization | Critical UX |
| Terminal | Missing as user surface | Interactive PTY | Critical UX |
| Editor | Missing | Monaco/Theia-class editor | Critical UX |
| Diff/review UI | Missing | First-class | Critical UX |
| Browser preview | Weak | Live controlled browser session | High |
| Computer use | Missing | Optional later | Medium |
| Structured memory | Partial | Five-part cognitive memory | High |
| Memory persistence | Partial | durable project/global memory | High |
| Memory consolidation | Missing | dream/background cycle | Critical evolution |
| Self-evolution | Missing | GEPA-style | Critical |
| Skill versioning | Missing | generations/history/rollback | Critical |
| Outcome eval dataset | Partial | production eval store | Critical |
| Learned routing | Missing | Thompson/bandit routing | High |
| Multi-model cross-audit | Missing | Crucible-like council | Medium |
| Event bus | Partial traces only | one canonical event stream | High |
| Permissions | Partial | action/actor/resource policy | High |
| Secrets | Good start | scoped secret grants | Medium |
| Channels | Product-specific | runtime-level channels | Medium |
| Native cron | Weak / external plugins | first-class schedules | Medium |
| Replay/WAL | Missing | checkpoint/recovery | High |
| Doctor/diagnostics | Missing | one health view | Medium |
| Local node | Missing | optional local execution | Medium |
| Extension SDK | Partial via MCP | tools + triggers + UI + secrets | Medium |
| UI workspace | Chat-first | Cursor-like workbench | Critical |

---

# 5. The most important missing feature: evolution

Wayland's strongest differentiator is not "lots of agents."

It is that its architecture treats agent behavior as something that can be measured and improved over time.

OpenMind currently has:

- static SOP definitions
- static skill prompts
- task judge
- benchmark tests
- report traces

These are the raw materials for evolution.

What is missing is the **learning loop**.

---

# 6. What "evolving" must mean in OpenMind

Do not interpret "self-evolving" as:

> Let an LLM rewrite its own production source code whenever it wants.

That is dangerous and hard to evaluate.

The initial unit of evolution should be:

1. SOP prompts
2. skill instructions
3. routing policies
4. planner templates
5. reviewer criteria
6. tool descriptions
7. context selection policy

Not production code.

The architecture should be:

```text
                   PRODUCTION RUNS
                         ↓
                    RUN TRACES
                         ↓
             ┌───────────┴───────────┐
             ↓                       ↓
       task outcomes             feedback
       test results              user accept/reject
       judge verdict             retry count
       cost/latency              edits after result
             ↓                       ↓
             └───────────┬───────────┘
                         ↓
                  EVOLUTION DATASET
                         ↓
                     OPTIMIZER
                       GEPA
                         ↓
                candidate versions
                         ↓
                DETERMINISTIC EVALS
                         ↓
                 ┌───────┴───────┐
                 ↓               ↓
               lose             win
                 ↓               ↓
             graveyard        shadow
                                 ↓
                               canary
                                 ↓
                         promote / rollback
```

This is the system OpenMind needs.

---

# 7. Wayland's evolution loop — and where OpenMind can improve it

Wayland Core describes a GEPA-style evolution system:

- the unit is a skill/prompt
- variants are generated
- candidates are evaluated
- a candidate must outperform its parent and current best
- losers are preserved in a graveyard
- winners persist across runs
- routing separately learns which templates/skills work using Thompson sampling

Important: Wayland itself admits that its current live-session success signal is shallow in some paths.

That means OpenMind has an opportunity to build a **better outcome signal**.

Your artifact architecture makes this possible.

## OpenMind should score evolution using actual outcomes

A run can produce:

```json
{
  "skillVersion": "deep-research@17",
  "taskType": "research",
  "passed": true,
  "acceptanceScore": 0.96,
  "sourceVerification": 0.92,
  "retries": 1,
  "tokens": 18320,
  "costUsd": 0.24,
  "latencyMs": 41120,
  "userAccepted": true
}
```

That is far stronger than:

```text
"the agent used tools a lot, therefore it probably succeeded"
```

---

# 8. Evolution database design

Add tables similar to:

```text
skills
skill_versions
skill_assignments

eval_cases
eval_runs
eval_results

agent_run_outcomes

evolution_jobs
evolution_candidates
evolution_promotions

routing_arms
routing_observations

memory_entries
memory_consolidation_runs
```

## `skills`

```text
id
name
worker_kind
active_version_id
created_at
```

## `skill_versions`

```text
id
skill_id
parent_version_id
prompt
sop_json
created_by          human | gepa | import
status              draft | shadow | canary | active | retired
generation
metrics_json
created_at
```

## `agent_run_outcomes`

```text
run_id
project_id
task_id
skill_version_id
worker
provider
passed
score
retries
tokens
cost_usd
latency_ms
human_feedback
created_at
```

## `evolution_candidates`

```text
id
job_id
skill_version_id
parent_version_id
eval_score
quality_score
safety_score
cost_score
latency_score
promoted
```

---

# 9. Use GEPA for the first evolution engine

The strongest open-source project for this specific goal is:

**GEPA — Genetic-Pareto prompt evolution**

Repository:

`https://github.com/gepa-ai/gepa`

Why it fits OpenMind:

- evolves prompts/text components
- takes an evaluator supplied by you
- supports reflection on traces
- performs candidate search instead of one-shot rewriting
- Pareto optimization fits multi-objective agent quality
- can optimize more than one text component
- can eventually evolve complete agent programs

Do not put GEPA inside the React application.

Create a separate service:

```text
services/
  evolution/
    python
```

API example:

```text
POST /evolution/jobs

{
  "skill": "deep-research",
  "baselineVersion": "v17",
  "dataset": "research-regression-v3",
  "objectives": [
    "task_success",
    "source_accuracy",
    "cost",
    "latency"
  ]
}
```

The service returns candidate versions, scores and lineage.

OpenMind decides promotion.

GEPA should **never directly alter production configuration**.

---

# 10. Evolution promotion policy

Never automatically deploy a prompt simply because it scored 1% better once.

Use stages:

```text
DRAFT
 ↓
OFFLINE EVAL
 ↓
SHADOW
 ↓
CANARY 5–10%
 ↓
ACTIVE
```

Promotion rules should include:

```text
quality >= baseline + required_delta
safety >= baseline
task_success >= baseline
cost <= acceptable ceiling
latency <= acceptable ceiling
minimum evaluation count reached
no critical regression cases
```

Rollback must be one click.

Every production run must record:

```text
skill_version
planner_version
model/provider
toolset_version
```

Otherwise you cannot know which behavior produced the result.

---

# 11. Learned routing — the other half of evolution

Prompt improvement is not enough.

The system should also learn:

> Which worker / skill / strategy works best for this kind of task?

Use a multi-armed bandit such as simple Thompson sampling.

For each routing choice:

```text
arm:
  worker=research
  skill=deep-research@17
  provider=claude
```

maintain success/failure evidence.

Over time:

```text
pricing research
  → deep-research-v21 wins most

code migration
  → claude-code + refactor-sop-v8 wins most

small bug
  → builtin code worker cheaper and equally reliable
```

Do not make this the same as model routing.

You need at least three independent decisions:

```text
1. TASK ROUTING
Which capability/worker?

2. SKILL ROUTING
Which SOP/version?

3. MODEL ROUTING
Which model/provider?
```

Wayland separates these ideas. OpenMind should too.

A Thompson sampler is small enough to implement yourself in TypeScript.

Do not add a huge dependency solely for this.

---

# 12. Memory is not evolution

OpenMind must keep these concepts separate:

```text
MEMORY
What happened / what we know.

EVOLUTION
How the agent should behave better next time.
```

Right now `memory-layers.ts` provides:

- task
- project
- user

with types such as:

- finding
- decision
- constraint
- failure
- preference

This is sensible but incomplete.

---

# 13. Move toward Wayland's cognitive memory model

Eventually support these memory categories:

```text
Working
Episodic
Semantic
Procedural
User Model
```

## Working

Temporary active-task notes.

Usually short-lived.

## Episodic

What happened.

Examples:

```text
On 2026-08-21 TASK-019 failed because Browserless rejected authentication.
```

## Semantic

Facts currently believed true.

```text
OpenMind uses React 19.
Production agent work runs through E2B.
```

## Procedural

How to do things.

```text
For this repo:
1. npm ci
2. npm run typecheck
3. npm test
4. npm run build
```

Procedural memory feeds **skills/SOPs** and therefore directly connects to evolution.

## User model

Stable preferences.

```text
User wants concise plans.
Never push without approval.
Prefers TypeScript.
```

---

# 14. Add a dream / consolidation cycle

This is one of the most important missing capabilities.

Do not stuff every old message into long-term memory.

Periodically run:

```text
RECENT RUNS
   ↓
extract durable facts
   ↓
deduplicate
   ↓
resolve contradictions
   ↓
promote reusable failures/lessons
   ↓
update memory
```

Trigger it:

- after a project completes
- every N completed tasks
- nightly
- after context compaction
- when memory grows beyond threshold

A dream cycle should produce a proposed change set:

```text
+ semantic: project uses pnpm
+ procedural: run lint before unit tests
~ replace previous decision about branch naming
- remove obsolete API endpoint
```

Then commit the memory update.

Do not silently rewrite the user's constitution.

---

# 15. Open-source memory projects worth using/studying

## LangMem

`https://github.com/langchain-ai/langmem`

Very relevant because OpenMind already uses LangGraph.

Useful concepts:

- hot-path memory tools
- background memory manager
- extraction and consolidation
- prompt refinement
- persistent store integration

Recommendation:

**Study/integrate first if you want the smallest jump from your LangGraph architecture.**

## Letta / MemFS

`https://github.com/letta-ai/letta`

Particularly useful as a reference for:

- long-lived stateful agent identity
- git-backed memory filesystem
- editable memory
- dreaming/background reflection
- procedural skills
- subagents

Recommendation:

Do not replace OpenMind with Letta.

Borrow:

```text
memory as inspectable files
versioned memory
dreaming
agent-owned procedural memory
```

## Mem0

`https://github.com/mem0ai/mem0`

Useful if you want a ready-made personalization/long-term memory layer.

However, OpenMind already has structured memory primitives.

Avoid replacing structured typed memory with a generic semantic-memory bucket.

---

# 16. OpenMind still needs durable execution

A Supabase run row means:

> the browser can close.

It does **not** automatically mean:

> the worker can crash halfway through 14 tool calls and resume from the exact safe checkpoint without duplicating actions.

Wayland invests heavily in:

- write-ahead state
- recovery
- replay
- process timeouts
- rollback
- restart behavior

OpenMind needs equivalent reliability before long autonomous work.

---

# 17. Recommended durable workflow engine

Two realistic options:

## Option A — Hatchet

`https://github.com/hatchet-dev/hatchet`

Advantages:

- designed for background tasks and AI agents
- DAGs
- durable tasks
- event triggers
- pause/resume
- child tasks
- strong fit with OpenMind's current architecture
- less conceptual overhead than Temporal

**Recommended first choice for OpenMind.**

Map:

```text
ProjectRun → Hatchet durable task
TaskRecord → child task
approval   → durable wait/event
delegation → child task
schedule   → trigger
```

## Option B — Temporal

`https://github.com/temporalio/temporal`

Advantages:

- battle-tested
- excellent recovery semantics
- replay
- long-running workflows
- human-in-the-loop signals
- mature observability

Disadvantages:

- heavier operationally
- stricter programming model
- probably unnecessary for OpenMind's next milestone

Use Temporal if OpenMind becomes enterprise infrastructure with very long-lived high-value runs.

---

# 18. The UI problem: `/app` is still fundamentally chat-first

The current `/app` source is visually evolving, but its information architecture remains:

```text
left rail
thread history
      ↓
   CHAT FEED
      ↓
      ├── task ledger inside messages
      ├── artifacts inside messages
      └── tool calls inside messages

right side:
files / iframe browser
```

This is still a chat product.

A Cursor-like agent workspace reverses this relationship:

```text
The WORKSPACE is primary.
Chat is one control surface inside it.
```

That is the major UI/UX change required.

---

# 19. Target desktop `/app` layout

Do not continue stretching `MobileApp.tsx` into the desktop IDE.

Create a separate desktop shell.

Suggested:

```text
src/pages/WorkbenchApp.tsx
```

Use responsive routing/components so mobile retains the conversation-first design.

Desktop:

```text
┌────┬──────────────────┬─────────────────────────────────┬──────────────────────┐
│    │                  │                                 │                      │
│ A  │ EXPLORER         │ EDITOR / ARTIFACT / BROWSER     │ AI / TASK PANEL      │
│ C  │                  │                                 │                      │
│ T  │ workspace/       │ tabs:                           │ Plan                 │
│ I  │  src/            │ App.tsx                         │ Tasks                │
│ V  │  tests/          │ report.md                       │ Approvals            │
│ I  │  research/       │ diff                            │ Agent trace          │
│ T  │                  │ preview                         │ Chat                 │
│ Y  │ Tasks            │                                 │                      │
│    │ Artifacts        │                                 │                      │
├────┴──────────────────┴─────────────────────────────────┴──────────────────────┤
│ TERMINAL │ PROBLEMS │ OUTPUT │ TESTS │ RUN LOG                                  │
├────────────────────────────────────────────────────────────────────────────────┤
│ branch │ sandbox │ provider │ task │ $0.17 │ 31k tokens │ connected │ strict    │
└────────────────────────────────────────────────────────────────────────────────┘
```

This would immediately make OpenMind feel like a **workbench** rather than a chatbot.

---

# 20. Left Activity Bar

Cursor/VS Code works because the permanent frame is predictable.

Recommended activity bar:

```text
Explorer
Search
Tasks
Agents
Source Control
Apps/MCP
Knowledge
History
```

Settings stays at bottom.

On mobile, collapse these into a drawer.

---

# 21. Explorer

Current `WorkbenchPanes` shows artifacts in a simple list.

Replace/upgrade to a true resource explorer:

```text
PROJECT
├── Workspace
│   ├── src/
│   ├── package.json
│   └── tests/
│
├── Artifacts
│   ├── research/
│   ├── analysis/
│   └── qa/
│
├── Tasks
│   ├── ✔ Research competitors
│   ├── ▶ Build page
│   └── ○ Verify
│
└── Memory
    ├── Decisions
    └── Constraints
```

Files must reflect the **real runtime filesystem**, not only artifact records.

---

# 22. Editor

Use Monaco Editor.

Official project:

`https://github.com/microsoft/monaco-editor`

Why:

- VS Code editor core
- syntax highlighting
- multiple models/tabs
- diff editor
- diagnostics
- familiar IDE feel

Required first features:

- editable tabs
- save
- dirty state
- diff view
- open task artifact
- open runtime file
- line numbers
- language detection
- jump to file from agent/tool event

Later:

- TypeScript language worker
- search
- symbols
- code actions

---

# 23. Terminal

This is a critical missing surface.

Use:

**xterm.js**

`https://github.com/xtermjs/xterm.js`

xterm.js is a terminal renderer, not a shell.

Architecture:

```text
xterm.js
   ↓
WebSocket
   ↓
Terminal Gateway
   ↓
PTY
   ↓
workspace / sandbox
```

Required features:

- real streamed stdout/stderr
- interactive stdin
- resize
- Ctrl+C
- multiple terminal tabs
- session resume
- reconnect
- terminal ownership by workspace
- kill/restart

If the selected E2B execution path does not expose a true PTY, do not fake a terminal with command-result cards.

Add a PTY-capable workspace gateway.

Possible runtime implementations:

- OpenHands Agent Server
- Docker + `node-pty`
- a dedicated terminal service
- local OpenMind Node later

---

# 24. OpenHands can save a large amount of coding-agent work

Project:

`https://github.com/OpenHands/software-agent-sdk`

OpenHands already has concepts for:

- agents
- terminal tool
- file editor
- task tracker
- local workspace
- remote workspace
- Agent Server
- REST APIs
- coding-agent execution

Recommended use:

**Do not replace OpenMind orchestration.**

Use OpenHands as one implementation of:

```text
CodingWorkerRuntime
```

OpenMind still owns:

- project planning
- task DAG
- acceptance
- artifacts
- budgets
- routing
- evolution

OpenHands provides:

- workspace
- terminal
- code agent execution

---

# 25. Eclipse Theia: tempting but use carefully

Project:

`https://github.com/eclipse-theia/theia`

Theia gives you:

- full browser IDE framework
- Monaco
- terminal
- source control
- command system
- keybindings
- VS Code extension compatibility
- desktop/browser targets

This could make OpenMind look like Cursor very quickly.

However:

- it is a major architectural commitment
- it can dominate the product shell
- integrating your existing React app into it may become more work than building the 20% of IDE functionality OpenMind actually needs

Recommendation:

### Do NOT migrate OpenMind to Theia immediately.

Start with:

```text
React
+ Monaco
+ xterm.js
+ resizable panels
+ your own explorer
+ your own Task/Agent panels
```

Re-evaluate Theia when users demand:

- extension marketplace
- debugging
- language-server richness
- serious source control UI

---

# 26. UI components worth using

Useful open-source pieces:

```text
monaco-editor        code/diff editor
@xterm/xterm         terminal
react-resizable-panels or Allotment
                     IDE pane layout
cmdk                 command palette
react-arborist       explorer/tree
```

Do not waste months recreating generic IDE widgets.

Spend your design work on what makes OpenMind unique:

- agent status
- task ledger
- artifact lineage
- approvals
- evolution history
- cost/budget
- worker handoffs

---

# 27. OpenMind needs one canonical event bus

Right now different systems expose:

- traces
- ledger events
- adapter events
- queued-run updates

These should converge.

Define:

```ts
type OpenMindEvent =
  | RunCreated
  | RunStarted
  | PlanCreated
  | TaskCreated
  | TaskStarted
  | TaskCompleted
  | TaskFailed
  | TaskBlocked
  | AgentStarted
  | AgentStopped
  | AgentDelegated
  | ToolStarted
  | ToolCompleted
  | ArtifactCreated
  | ArtifactUpdated
  | FileChanged
  | TerminalOutput
  | ApprovalRequested
  | ApprovalResolved
  | MemoryWritten
  | SkillSelected
  | EvolutionCandidateCreated
  | SkillPromoted
  | RunCompleted
```

Store events append-only.

Everything consumes them:

```text
UI
observability
analytics
replay
evolution
notifications
schedules
audit log
```

This is one of the most important system-level upgrades.

---

# 28. Add real ACP

OpenMind's adapter interface already uses ACP-like concepts.

Now make ACP real.

ACP becomes:

```text
OpenMind Orchestrator
       ↓
       ├── Claude Code adapter
       ├── Codex adapter
       ├── OpenCode
       ├── Goose
       ├── Gemini CLI
       └── Wayland Core
```

The orchestrator should not care which implementation runs the task.

Standardize:

```text
create session
capabilities
send task
stream events
cancel
resume
request approval
```

---

# 29. Wayland Core itself can be an OpenMind worker backend

This is worth serious consideration.

Wayland Core is published separately from the Wayland desktop product and describes headless/embedded interfaces including:

- JSON stream
- ACP
- REST/SSE
- built-in tools
- memory
- evolution
- browser/computer use
- multi-provider support

Its current repository describes an Apache-2.0 license, while the Wayland desktop repository uses AGPL-3.0.

That means an excellent experiment is:

```text
OpenMind
   ↓
CodingAgentAdapter / GeneralAgentAdapter
   ↓
wayland-core sidecar
```

Do not build OpenMind *on top of* Wayland Desktop.

Instead register Wayland Core as an optional worker runtime.

Benefits:

- learn from a mature engine immediately
- test evolution without waiting for your own version
- compare native OpenMind worker vs Wayland Core worker
- preserve OpenMind's web control plane and artifact model

Important:

Check the exact license/version again before shipping.

Do not copy AGPL desktop code into an MIT product without understanding the obligations.

---

# 30. Browser worker

OpenMind already has a well-designed `BrowserProvider` interface, but the README correctly says the live provider remains incomplete.

Finish this.

Recommended order:

```text
1. Playwright-compatible provider
2. hosted browser provider
3. Browser Use only for higher-level autonomy
```

The core browser worker should be deterministic first.

Operations:

```text
navigate
snapshot
click
fill
press
select
download
upload
screenshot
read text
network log
console log
```

Browser execution should emit events and artifacts.

The human preview pane must show the **same browser session** the agent is using when technically possible.

The current generic iframe is not enough.

Many pages block iframes, and it is disconnected from the actual agent browser session.

---

# 31. Computer use

Wayland goes farther than browser automation into actual desktop control.

Do not make this a V1 priority for OpenMind web.

First achieve:

```text
filesystem
terminal
git
browser
editor
```

Then add an optional local node for computer use:

```text
OpenMind Cloud
      ↓
OpenMind Local Node
      ↓
      ├── shell
      ├── filesystem
      ├── browser
      └── computer use
```

This can eventually be packaged using:

- Wails
- Tauri
- Electron

But keep the cloud/web control plane.

---

# 32. Permissions need to become a policy engine

Current approval UI is useful.

The next stage is policy.

Permission should depend on:

```text
actor
action
resource
environment
risk
```

Example:

```text
Research worker
web.read             allow
browser.click        allow
filesystem.read      allow
filesystem.write     deny

Coding worker
filesystem.write     allow in worktree
terminal.run         allow in sandbox
git.commit           allow
git.push             ask
git.merge            ask

Communication worker
gmail.read           allow
gmail.send           ask

All workers
production.delete    deny
payments             deny
```

Store policies separately from prompts.

Do not rely on the model to remember safety text.

---

# 33. Resources should be first-class

Instead of random path/URL strings, introduce resource references:

```text
file://workspace/src/App.tsx
artifact://proj-123/research/competitors.json
git://repo/openmind/branch/main
web://example.com/pricing
email://thread/abc
slack://channel/general
memory://project/decision/build-system
```

Then tools, agents, UI and events can refer to the same thing.

This simplifies:

- permissions
- provenance
- navigation
- artifact lineage
- previews
- drag/drop into prompts

---

# 34. Cross-audit / multi-model council

Wayland's Crucible-style multi-model cross-audit is useful, but should be selective.

Do not send every task to five models.

Use it for:

- high-value research synthesis
- architecture decisions
- final review
- ambiguous security decisions
- difficult planning
- benchmark generation

Architecture:

```text
proposal A
proposal B
proposal C
    ↓
read-only judge
    ↓
fused recommendation
```

The judge must have **no write/terminal permissions**.

This is a later quality multiplier, not the immediate foundation.

---

# 35. Native schedules / proactive agents

OpenMind currently exposes automations through things such as n8n/OpenClaw.

Keep those integrations.

But add a native trigger abstraction:

```text
Trigger
  ├── cron
  ├── webhook
  ├── connector event
  ├── GitHub event
  ├── email event
  └── manual
```

Then:

```text
Trigger
   ↓
Project/Task template
   ↓
Durable run
   ↓
Agent work
```

This is how OpenMind moves from reactive assistant to autonomous workforce.

---

# 36. Diagnostics / Doctor

Add `/settings/doctor` or command-palette action:

```text
OpenMind Doctor

Supabase             ✔
Run worker           ✔
E2B                  ✔
Browser provider     ✖
OpenAI               ✔
Anthropic            ✔
GitHub OAuth         ✔
MCP servers          7/8
ACP Claude Code      ✖ not installed
Evolution service    ✖
Eval dataset         146 cases
Memory consolidation ✔ last run 2h ago
```

Every complex agent platform needs this.

Without it, users interpret missing infrastructure as "the AI is stupid."

---

# 37. Evaluation must become a first-class product subsystem

Current agent benchmark testing is a good start.

Split evaluation into four levels.

## Level 1 — Unit

```text
schema parsing
tool routing
permission rules
memory rules
event transforms
```

## Level 2 — Task

```text
Does research output meet source requirements?
Does code actually pass tests?
Does browser extraction return required fields?
```

## Level 3 — End-to-end

Example:

```text
Research competitors
→ write comparison
→ build page
→ run tests
→ validate
```

## Level 4 — Evolution

Compare:

```text
skill v17
vs
skill candidate v18
```

on the same dataset.

This is the trust boundary for self-evolution.

---

# 38. Use deterministic evaluators before LLM judges

For evolution especially, avoid:

```text
LLM writes answer
LLM says its answer is good
```

Prefer:

```text
JSON schema
unit tests
exit code
source reachability
exact field match
content invariants
static analysis
Playwright assertions
```

LLM judges can be used only for things that genuinely require subjective assessment.

Examples:

- clarity
- persuasion
- writing style
- open-ended synthesis

And ideally use a different model/provider than the candidate.

---

# 39. Recommended open-source stack by gap

| Gap | Recommended project | Use |
|---|---|---|
| Prompt/skill evolution | GEPA | Main evolution engine |
| Later deep training | Agent Lightning | RL/APO once datasets mature |
| Memory consolidation | LangMem | Background extraction/refinement |
| Memory reference design | Letta / MemFS | Dreaming, git-backed memory |
| Coding runtime | OpenHands SDK/Agent Server | Real code workspace |
| Terminal frontend | xterm.js | Browser terminal |
| Code editor | Monaco Editor | Cursor-style editor |
| Full IDE alternative | Eclipse Theia | Only if full IDE/VS Code plugin support is needed |
| Durable runs | Hatchet | Recommended near-term |
| Enterprise durability | Temporal | Later / high scale |
| Browser | Playwright ecosystem | Deterministic browser worker |
| Prompt/eval framework | GEPA + custom eval harness | Evolution trust boundary |
| Observability | Langfuse/OpenTelemetry | Model/tool/run traces |
| Agent interop | ACP | External agent adapters |
| Tool interop | MCP | Continue current work |

---

# 40. Agent Lightning — when to use it

Project:

`https://github.com/microsoft/agent-lightning`

Agent Lightning can optimize arbitrary agents using:

- automatic prompt optimization
- reinforcement learning
- supervised fine-tuning
- trace/reward infrastructure

Do not start here.

First OpenMind needs:

```text
consistent task definitions
good traces
stable outcomes
real rewards
evaluation datasets
```

Then Agent Lightning becomes interesting for:

- planner optimization
- research worker training
- routing optimization
- search policy
- long-horizon behavior

Near-term:

**GEPA**

Longer-term:

**Agent Lightning**

---

# 41. The OpenMind evolution flywheel

The final design should be:

```text
USER TASK
   ↓
Task planner
   ↓
select worker + skill version
   ↓
run
   ↓
artifact
   ↓
validator
   ↓
outcome record
   ↓
──────────────────────────────
         LEARNING LAYER
──────────────────────────────
   ↓
memory consolidation
   ↓
routing observation
   ↓
eval dataset
   ↓
GEPA candidate search
   ↓
offline evaluation
   ↓
shadow/canary
   ↓
promotion
   ↓
better next run
```

That is real "evolving."

---

# 42. UX for evolution

Users should be able to see the system improve.

Add:

```text
Settings
└── Intelligence
    ├── Skills
    ├── Memory
    ├── Evolution
    ├── Evaluations
    └── Routing
```

## Skill page

```text
Deep Research

Active: v21
Success: 89%
Avg cost: $0.18
Avg time: 44s

v21  ACTIVE
v20  retired
v19  retired
v22  shadow candidate
```

## Evolution page

```text
Evolution job #31

Baseline v21     0.842
Candidate v22a   0.861
Candidate v22b   0.833
Candidate v22c   0.874  ← winner

Safety regression: none
Cost: -7%
Latency: +2%

[Promote to canary]
```

## Memory page

Users should see and edit:

- project facts
- decisions
- procedures
- preferences

Memory must be inspectable.

Invisible memory is impossible to trust.

---

# 43. UX for the task DAG

Do not bury TaskLedger inside an assistant message.

Make it a first-class panel.

Example:

```text
PROJECT: Competitor analysis

✔ 1 Research competitors
✔ 2 Collect pricing
▶ 3 Analyze differences
○ 4 Build landing page
○ 5 Run tests
○ 6 Final verification
```

Click a task:

```text
TASK-003

Worker: Analyst
Skill: Structured Analysis v8
Inputs:
  research/competitors.json
  research/pricing.json

Outputs:
  analysis/report.md

Acceptance:
  ✔ minimum body
  ✔ source attribution
  ▶ running

Cost:
$0.04 / $0.30
```

This is far more useful than showing animated workers.

---

# 44. UX for agents

Agents belong in the right-hand control panel.

A task should show:

```text
Agent: Claude Code
Session: cc-82992
Workspace: worktree/code-2
Status: running

Events:
14:32 read src/App.tsx
14:33 edit src/components/Hero.tsx
14:33 npm test
14:34 2 tests failed
14:34 edit Hero.test.tsx
14:35 npm test
14:35 passed
```

The user can:

```text
Pause
Stop
Open terminal
Open changed files
View diff
Approve push
```

That is Cursor-like agent UX.

---

# 45. Desktop `/app` should no longer be `MobileApp`

This is a concrete architectural recommendation.

Current source has one very large `MobileApp.tsx` that also contains desktop layout conditions.

Split it.

Suggested:

```text
src/pages/
  MobileApp.tsx
  WorkbenchApp.tsx

src/components/workbench/
  ActivityBar.tsx
  Explorer.tsx
  EditorArea.tsx
  AgentPanel.tsx
  TaskPanel.tsx
  TerminalPanel.tsx
  StatusBar.tsx
  BrowserPreview.tsx
  DiffViewer.tsx
  CommandPalette.tsx
```

Shared state should come from stores/hooks, not from one giant page component.

---

# 46. Recommended desktop state model

```ts
interface WorkbenchState {
  workspaceId: string

  activeResource?: ResourceRef
  openTabs: WorkbenchTab[]

  leftPanel: 'explorer' | 'tasks' | 'agents' | 'search' | 'apps'
  rightPanel: 'assistant' | 'run' | 'approvals'
  bottomPanel: 'terminal' | 'problems' | 'output' | 'tests'

  terminalSessions: TerminalSession[]
  selectedTaskId?: string
  selectedRunId?: string
}
```

Keep this separate from agent runtime state.

The UI should observe the runtime, not own it.

---

# 47. Status bar

Add a thin status bar.

Show:

```text
main
E2B
Claude
Strict
TASK-004
$0.19
33k tokens
6 tools
GitHub ✔
Browser ✖
```

This makes the system feel alive and gives users confidence that real infrastructure is running.

---

# 48. Command palette

A Cursor-like product needs command-first navigation.

Examples:

```text
> New agent task
> Open terminal
> Run tests
> Review changes
> Connect GitHub
> Switch model
> Open project memory
> Show evolution history
> Stop current run
> Create branch
> Run OpenMind Doctor
```

This is much faster than hunting through sheets/modals.

---

# 49. One major current UI anti-pattern

Current artifacts and tool calls are nested under assistant message bubbles.

That makes the unit of work look like:

```text
message
```

instead of:

```text
project
task
file
artifact
run
```

Move operational objects out of chat.

Chat should contain:

- explanation
- user questions
- approvals
- summaries

The workspace should contain:

- files
- terminal
- diffs
- tasks
- artifacts
- run status

---

# 50. Product modes

Recommended final navigation:

```text
OpenMind

Chat
Work
Research
Build
Workforce
Knowledge
Automations
Apps
```

But all of these should share the same runtime.

Do not build seven separate AI products.

They are views over:

```text
projects
tasks
agents
tools
artifacts
memory
```

---

# 51. Proposed backend architecture

```text
                         OPENMIND WEB

                              ↓
                         API / CONTROL
                              ↓
               ┌──────────────┼──────────────┐
               ↓              ↓              ↓
            Events        Projects        Secrets
               ↓              ↓              ↓
               └──────────────┼──────────────┘
                              ↓
                      DURABLE ORCHESTRATOR
                           Hatchet
                              ↓
                   ┌──────────┼───────────┐
                   ↓          ↓           ↓
                Workers     Agents      Evolution
                   ↓          ↓           ↓
                   ↓       ACP/native     ↓ GEPA
                   ↓          ↓           ↓
                   └──────────┼───────────┘
                              ↓
                         WORKSPACE LAYER
                       E2B / OpenHands
                              ↓
                  ┌───────────┼───────────┐
                  ↓           ↓           ↓
                files       terminal    browser
                  ↓           ↓           ↓
                  └───────────┼───────────┘
                              ↓
                       Artifact + Memory
                              ↓
                          Supabase
```

---

# 52. Proposed repository structure

```text
apps/
  web/
  worker/
  terminal-gateway/

services/
  evolution/
  browser/
  agents/

packages/
  orchestration/
    project/
    tasks/
    scheduler/
    validation/

  runtime/
    runtime.ts
    e2b/
    openhands/
    local/

  agents/
    registry/
    acp/
    builtin/
    wayland-core/
    claude-code/
    codex/

  memory/
    store/
    consolidation/
    retrieval/

  evolution/
    schema/
    client/
    routing/

  events/
    schema/
    store/

  ui-workbench/
    explorer/
    editor/
    terminal/
    tasks/
    agent-panel/
```

Your current repository does not need to become a monorepo immediately, but the conceptual boundaries should move this direction.

---

# 53. What to fix immediately in current code

Before large new features:

## Fix artifact fallback

Do not turn arbitrary prose into an artifact simply because it is longer than a threshold.

Required artifact must come from:

- explicit artifact submission
- verified runtime file
- validated structured output

## Harden runtime success detection

Unknown runtime envelopes must not default to successful execution.

Fail closed.

## Quote/validate runtime working directories

Never concatenate untrusted path text into shell commands without normalization/quoting.

## Replace `ls -l` parsing

Use structured directory data.

Filename spaces should not break the explorer.

## Persist WorkerSession store

Session interfaces exist, but durable provider session identity must survive browser/worker restart.

## Move TaskLedger out of message bubble

Make project/tasks a workspace-level concept.

---

# 54. What NOT to copy from Wayland

Do not copy everything blindly.

## Do not make OpenMind local-only

OpenMind's cloud/web nature is an advantage.

Use:

```text
cloud first
+ optional local node
```

## Do not prioritize computer-use before the workbench

A great shell/editor/browser experience will deliver more real value first.

## Do not create giant uncontrolled swarms

Your original experience already demonstrated why.

Keep:

- budget
- depth caps
- artifact contracts
- structured delegation

## Do not auto-promote evolved behavior directly from live runs

Wayland itself is cautious here.

OpenMind should be even stricter because you have better acceptance data.

---

# 55. A feature where OpenMind can be better than Wayland

OpenMind's artifact lineage can become a unique advantage.

Every output should answer:

```text
Who created this?
For which task?
From which inputs?
Using which skill version?
Using which model?
Using which sources?
Was it validated?
Which later artifacts depend on it?
```

Visualize:

```text
competitors.json
       ↓
       └────────► pricing-analysis.json
       ↓                 ↓
       ↓                 ↓
       └──────────► strategy.md
                         ↓
                         ↓
                    landing-page/
```

This is more useful than "agent A talked to agent B."

---

# 56. Recommended phased roadmap

## Phase A — Workbench foundation

**Goal:** Make `/app` feel like a real place to work.

Build:

- `WorkbenchApp`
- Activity bar
- Explorer
- Monaco Editor
- bottom panel
- xterm.js
- status bar
- command palette
- diff viewer
- Task panel
- right-side agent panel

Keep MobileApp for phone.

### Success test

User can:

```text
connect/open repo
open file
edit file
open terminal
run command
see output
ask agent to modify file
review diff
run tests
```

without leaving `/app`.

---

## Phase B — Real worker integrations

Build live adapters:

1. builtin OpenMind
2. Wayland Core sidecar
3. OpenHands
4. Claude Code / ACP
5. Codex / ACP

### Success test

Same TaskRecord can run through different backends without changing orchestration code.

---

## Phase C — Durable runtime

Add Hatchet.

Move:

- project run
- task execution
- approvals
- retries
- delegation
- schedules

into durable jobs.

### Success test

Kill the worker mid-project.

Restart.

No duplicated destructive action and project resumes.

---

## Phase D — Cognitive memory

Implement:

- episodic
- semantic
- procedural
- user model
- project/session/global scopes
- consolidation job
- memory UI

Study LangMem and Letta.

### Success test

A project resumed next week knows:

- repository conventions
- previous failed approach
- previous architectural decision

without dumping the entire chat history into context.

---

## Phase E — Evolution V1

Integrate GEPA service.

Start with one skill:

```text
deep-research
```

Create:

- 50–100 eval cases
- baseline skill
- candidate mutations
- deterministic checks
- cost/latency capture
- shadow runs
- manual promotion

### Success test

Candidate demonstrably beats baseline on held-out cases and is promoted with an auditable history.

---

## Phase F — Learned routing

Implement Thompson sampling over:

```text
worker
skill version
strategy
```

Do not include model choice initially.

### Success test

The system progressively chooses the highest-success skill variant for repeated classes of tasks.

---

## Phase G — Native proactive agents

Implement:

- cron
- webhook
- GitHub event
- connector event
- queued project templates

### Success test

A scheduled job completes without the user having an active browser session.

---

## Phase H — Advanced intelligence

Later:

- multi-model council
- computer use
- Agent Lightning
- local OpenMind Node
- workflow marketplace
- skill marketplace

---

# 57. The first benchmark OpenMind should optimize for

Use one hard end-to-end task as the product benchmark:

> Research the five strongest competitors to OpenMind, collect current pricing and major capabilities with sources, create a structured comparison, write a landing-page strategy, implement the page in a real repository, run the project's checks, fix failures, and return the final diff and artifacts.

Expected graph:

```text
Research
   ↓
competitors.json

Pricing
   ↓
pricing.json

Analysis
   ↓
strategy.md

Build
   ↓
real code files

Test
   ↓
test_results.json

Review
   ↓
validated diff
```

Measure:

```text
completion
source correctness
artifact validity
test status
retry count
token cost
wall time
human intervention
```

If OpenMind reliably does this, the architecture is real.

---

# 58. The first evolution benchmark

Use **Deep Research** first because it has objective signals.

Example cases:

```text
Find product pricing
Compare feature support
Find official API limits
Find latest release change
Research company integrations
```

Scoring:

```text
required fields
valid URLs
primary-source ratio
source diversity
claim/source consistency
latency
cost
```

Then evolve `deep-research` SOP versions.

Do not start self-evolution with creative writing.

You need tasks with measurable correctness.

---

# 59. Recommended immediate Cursor task list

Give Cursor these tasks in this order:

```text
1. Create WorkbenchApp separate from MobileApp.
2. Add resizable desktop pane shell.
3. Add Monaco Editor with file tabs.
4. Add true workspace file explorer using Runtime.
5. Add xterm.js terminal panel and TerminalGateway interface.
6. Add diff/review tab using Monaco DiffEditor.
7. Move TaskLedgerPanel into left/right workspace panel.
8. Add canonical OpenMindEvent schema.
9. Route current task/adapter/runtime events through event store.
10. Persist WorkerSession state to Supabase.
11. Implement first live ACP adapter.
12. Add Wayland Core optional adapter.
13. Add durable workflow proof-of-concept with Hatchet.
14. Add memory consolidation job.
15. Add evolution tables.
16. Add GEPA evolution microservice.
17. Evolve deep-research skill against fixed benchmark.
18. Add evolution UI and manual promotion.
19. Add Thompson routing for skill version.
20. Add OpenMind Doctor.
```

---

# 60. Architecture decision: use Wayland Core or only learn from it?

Recommendation:

## Use Wayland Core as an optional worker backend.

Do **not** make it the whole OpenMind backend.

This gives you:

```text
OpenMind-native worker
Wayland Core worker
OpenHands worker
Claude Code worker
Codex worker
```

and lets OpenMind compare them.

OpenMind then becomes a higher-level system:

```text
planner
routing
artifacts
validation
memory
evolution
UI
```

instead of a wrapper around Wayland.

That is strategically much stronger.

---

# 61. Final target

The target is not:

```text
Wayland in a browser.
```

It should be:

```text
                   OPENMIND

        Web-native AI Agent Operating System

                    CONTROL PLANE
               Projects · Tasks · Events
                         ↓
                    ORCHESTRATOR
                LangGraph + durability
                         ↓
           ┌─────────────┼─────────────┐
           ↓             ↓             ↓
      Native agents     ACP        External engines
           ↓             ↓             ↓
           └─────────────┼─────────────┘
                         ↓
                    REAL WORKSPACE
               Files · Git · Terminal
               Browser · Preview · Tests
                         ↓
                      ARTIFACTS
                         ↓
                  VALIDATION/EVAL
                         ↓
                ┌────────┴─────────┐
                ↓                  ↓
              MEMORY          EVOLUTION
                ↓                  ↓
                └────────┬─────────┘
                         ↓
                 BETTER NEXT RUN
```

And the desktop UX should look like a tool where someone works:

```text
Explorer | Editor | AI
         |        |
         |--------|
         Terminal
```

not:

```text
chat chat chat chat chat
     + some tools underneath
```

---

# 62. Recommended decisions

## Keep

- LangGraph
- Task DAG
- artifact-first architecture
- acceptance criteria
- budgets
- strict/mock distinction
- E2B abstraction
- Supabase persistence
- MCP
- current capability workers
- SOP concept

## Add now

- desktop WorkbenchApp
- Monaco
- xterm.js
- event bus
- durable session persistence
- live ACP adapter
- memory consolidation
- evaluation store

## Add immediately after

- Hatchet
- GEPA
- skill versioning
- evolution UI
- learned skill routing
- Wayland Core adapter
- OpenHands worker

## Add later

- computer use
- local desktop node
- multi-model council
- Agent Lightning
- extension marketplace
- full IDE plugin support

---

# 63. Research sources

## OpenMind

Repository:

`https://github.com/ifartrainbowsgames-sketch/openmind`

Primary reviewed branch:

`cursor/openmind-v2`

Important files reviewed:

- `README.md`
- `src/lib/task-ledger.ts`
- `src/lib/task-runner.ts`
- `src/lib/task-judge.ts`
- `src/lib/project-store.ts`
- `src/lib/run-queue.ts`
- `src/lib/workforce/runtime.ts`
- `src/lib/workforce/sandbox-runtime.ts`
- `src/lib/workforce/worktrees.ts`
- `src/lib/workforce/adapters.ts`
- `src/lib/workforce/sessions.ts`
- `src/lib/workforce/memory-layers.ts`
- `src/lib/workforce/browser-worker.ts`
- `src/lib/workforce/sop.ts`
- `src/lib/skills.ts`
- `src/pages/MobileApp.tsx`
- `src/components/mobile/WorkbenchPanes.tsx`

## Wayland

Desktop:

`https://github.com/FerroxLabs/wayland`

Core:

`https://github.com/FerroxLabs/wayland-core`

Key architecture studied:

- agent registry
- ACP agents
- process services
- memory partitions
- self-evolution/GEPA
- learned routing
- browser/computer-use
- persistent sessions
- scheduling/channels
- runtime security
- JSON-stream/ACP embedding
- resilience/replay

## Evolution / learning

GEPA:

`https://github.com/gepa-ai/gepa`

Agent Lightning:

`https://github.com/microsoft/agent-lightning`

LangMem:

`https://github.com/langchain-ai/langmem`

Letta:

`https://github.com/letta-ai/letta`

## Runtime / developer workspace

OpenHands SDK:

`https://github.com/OpenHands/software-agent-sdk`

xterm.js:

`https://github.com/xtermjs/xterm.js`

Eclipse Theia:

`https://github.com/eclipse-theia/theia`

Monaco Editor:

`https://github.com/microsoft/monaco-editor`

## Durable execution

Hatchet:

`https://github.com/hatchet-dev/hatchet`

Temporal:

`https://github.com/temporalio/temporal`

---

# 64. Bottom line

OpenMind no longer needs a total rewrite.

The core conceptual mistake from the first Workforce version has largely been corrected.

The next mistake to avoid is spending months adding more agents while the product still lacks a **real work surface and learning loop**.

The next era of OpenMind should focus on two things:

## 1. Work

Give the agent:

```text
files
editor
terminal
git
browser
tests
persistent sessions
```

Give the human:

```text
explorer
editor
diff
terminal
task graph
approvals
run trace
```

## 2. Learn

Capture:

```text
what succeeded
what failed
what it cost
what the user accepted
which skill version ran
```

Then use:

```text
memory consolidation
GEPA evolution
eval gates
shadow/canary promotion
learned routing
```

That is the path from:

> "an AI system that can perform tasks"

to:

> **"an AI system that becomes measurably better at performing your tasks over time."**

That is the most important part of the Wayland idea worth bringing into OpenMind.
