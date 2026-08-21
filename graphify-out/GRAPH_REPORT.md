# Graph Report - docs  (2026-08-21)

## Corpus Check
- Corpus is ~13,885 words - fits in a single context window. You may not need a graph.

## Summary
- 69 nodes · 76 edges · 9 communities (8 shown, 1 thin omitted)
- Extraction: 61% EXTRACTED · 39% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Memory and Evolution Loop
- Durable Runtime and Observability
- Workspace Runtime and Workbench
- Artifact-First Orchestration Core
- Merge Debt and Session Lifecycle
- Evolution Trust Boundary
- Chat Theater Anti-Patterns
- Agent Interop and Adapters
- Cloud versus Local Execution

## God Nodes (most connected - your core abstractions)
1. `WorkbenchApp Desktop Shell` - 6 edges
2. `Evolution Learning Loop` - 5 edges
3. `Task DAG` - 4 edges
4. `Acceptance Criteria` - 4 edges
5. `Runtime Abstraction` - 4 edges
6. `Persistent Worker Sessions` - 4 edges
7. `GEPA Prompt Evolution` - 4 edges
8. `Cognitive Memory Model` - 4 edges
9. `Durable Execution & Replay` - 4 edges
10. `Canonical Event Bus` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Task Ledger Blackboard` --semantically_similar_to--> `Shared Project Ledger`  [INFERRED] [semantically similar]
  artifact-first.md → NORTH-STAR.md
- `Artifact Contract` --semantically_similar_to--> `Acceptance Criteria`  [INFERRED] [semantically similar]
  artifact-first.md → NORTH-STAR.md
- `Memory ≠ Knowledge` --semantically_similar_to--> `Cognitive Memory Model`  [INFERRED] [semantically similar]
  open-source-product-map.md → NORTH-STAR.md
- `OpenMind Code Surface` --conceptually_related_to--> `WorkbenchApp Desktop Shell`  [INFERRED]
  open-source-product-map.md → NORTH-STAR.md
- `Kernel vs Apps` --conceptually_related_to--> `Artifact-First Orchestration`  [INFERRED]
  super-agent.md → NORTH-STAR.md

## Hyperedges (group relationships)
- **Evolution Flywheel** — docs_north_star_outcome_record, docs_north_star_eval_levels, docs_north_star_gepa, docs_north_star_promotion_policy, docs_north_star_learned_routing [EXTRACTED 1.00]
- **Real Work Surface** — docs_north_star_workbench_app, docs_north_star_monaco, docs_north_star_xterm, docs_north_star_terminal_gateway, docs_north_star_browser_worker [EXTRACTED 1.00]
- **Keep — Do Not Rebuild** — docs_north_star_task_dag, docs_north_star_acceptance_criteria, docs_north_star_capability_workers, docs_north_star_sop_layer, docs_north_star_runtime_abstraction [EXTRACTED 1.00]

## Communities (9 total, 1 thin omitted)

### Community 0 - "Memory and Evolution Loop"
Cohesion: 0.15
Nodes (16): Artifact Contract, Acceptance Criteria, Cognitive Memory Model, Deep Research Evolution Benchmark, Dream / Consolidation Cycle, Evolution Learning Loop, LangMem, Learned Routing (Thompson Sampling) (+8 more)

### Community 1 - "Durable Runtime and Observability"
Cohesion: 0.17
Nodes (12): Cancel Does Not Cancel, Crashing Run Is a Poison Pill, Artifact Lineage, OpenMind Doctor, Durable Execution & Replay, Canonical Event Bus, Hatchet Durable Workflows, Permission Policy Engine (+4 more)

### Community 2 - "Workspace Runtime and Workbench"
Cohesion: 0.25
Nodes (9): Deterministic Browser Worker, E2B Runtime Adapter, Monaco Editor, OpenHands Coding Runtime, Runtime Abstraction, PTY Terminal Gateway, WorkbenchApp Desktop Shell, xterm.js Terminal (+1 more)

### Community 3 - "Artifact-First Orchestration Core"
Cohesion: 0.38
Nodes (7): Task Ledger Blackboard, Artifact-First Orchestration, Capability Workers, Shared Project Ledger, Task DAG, Universal Tasks (Do Anything), Kernel vs Apps

### Community 4 - "Merge Debt and Session Lifecycle"
Cohesion: 0.33
Nodes (7): Merge Seams, Sessions and Worktrees Never Reaped, RunOptions.toolKeys Silently Dropped, Two Key Stores, One Declared Dead, Immediate Code Fixes, Persistent Worker Sessions, Git Worktree Isolation

### Community 5 - "Evolution Trust Boundary"
Cohesion: 0.33
Nodes (6): Deterministic Evaluators Before LLM Judges, Four Evaluation Levels, GEPA Prompt Evolution, Shadow/Canary Promotion Policy, Wayland Core as Worker Backend, Build With Open Source, Don't Become It

### Community 6 - "Chat Theater Anti-Patterns"
Cohesion: 0.40
Nodes (5): Agent Actions Are Schema, Not Chat, Agent Chat Theater Failure Mode, Global Pending/Trace State, Chat-First UI Anti-Pattern, No Uncontrolled Agent Swarms

### Community 7 - "Agent Interop and Adapters"
Cohesion: 0.40
Nodes (5): ACP (Agent Client Protocol), External Agent Adapter Interface, Phase A — Workbench Foundation, Phase B — Real Worker Integrations, MCP vs A2A Split

## Knowledge Gaps
- **17 isolated node(s):** `Capability Workers`, `E2B Runtime Adapter`, `LangMem`, `Permission Policy Engine`, `Monaco Editor` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `External Agent Adapter Interface` connect `Agent Interop and Adapters` to `Merge Debt and Session Lifecycle`?**
  _High betweenness centrality (0.442) - this node is a cross-community bridge._
- **Why does `Phase B — Real Worker Integrations` connect `Agent Interop and Adapters` to `Durable Runtime and Observability`?**
  _High betweenness centrality (0.390) - this node is a cross-community bridge._
- **Why does `ACP (Agent Client Protocol)` connect `Agent Interop and Adapters` to `Evolution Trust Boundary`?**
  _High betweenness centrality (0.373) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Runtime Abstraction` (e.g. with `OpenHands Coding Runtime` and `PTY Terminal Gateway`) actually correct?**
  _`Runtime Abstraction` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Capability Workers`, `E2B Runtime Adapter`, `LangMem` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._