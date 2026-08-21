# Subsystem boundaries — architecture trace

**Date:** 2026-08-21 · against `cursor/openmind-v2` @ `855b7d3`

Traces 6–10 from the graph pass, answered against the **code** rather than the
graph. The graph was built from documents that predate the AgentRuntime
consolidation, so it describes intent; reachability describes reality. That
distinction is the whole lesson of the previous pass — eight modules were
"working" and unreachable.

Each component is classified as one of:

| Class | Meaning |
|---|---|
| **Execution infrastructure** | The typed edge to a machine. Interface, not policy. |
| **Runtime implementation** | One concrete backing for that interface. |
| **Owned by AgentRuntime** | Lifecycle belongs to a session. |
| **Kernel service** | Orchestrator-owned, shared across all runtimes. |
| **Orchestrator policy** | Decides *what* runs and *where*; never executes. |
| **UI projection** | Read-only view over runtime state. |

---

## Verdict table

| Component | Class | Reachable | Notes |
|---|---|---|---|
| `runtime.ts` | Execution infrastructure | yes | Interface only. No implementation detail leaks into it. |
| `sandbox-runtime.ts` | Runtime implementation | yes | E2B. Constructed by BuiltinRuntime; see debt below. |
| `worktrees.ts` | Owned by AgentRuntime | yes | Pure consumer of `Runtime` — takes it as a parameter, owns nothing. Correct shape. |
| `sessions.ts` | Owned by AgentRuntime | yes | Reached only through the runtime. |
| `agent-runtime.ts` | Kernel contract | yes | The boundary itself. |
| `builtin-runtime.ts` | Runtime implementation | yes | The only module permitted to import `runEmployee`. |
| `events.ts` | Kernel infrastructure | yes | Canonical stream. Currently emitted by runtimes only. |
| `capabilities.ts` | Orchestrator policy | yes | **Half-built as a bridge — see Q7.** |
| `sop.ts` | Orchestrator intelligence | yes | Supplies acceptance criteria to the judge. |
| `constitution.ts` | Policy/context service | yes | Composed into every worker prompt. |
| `memory-layers.ts` | Kernel service | **no** | **Inverted today — see Q9.** |
| `browser-worker.ts` | Confused — two layers in one file | **no** | **See Q10.** |
| `map-overlay.ts` | UI projection | yes* | *Reached via `lazy(() => import('./pages/Dashboard'))`; a static-import walk reports it orphaned. |

---

## Q6 — Runtime Abstraction: which edges are ownership, which are use?

**Ownership is narrow and correct.** In production, exactly one module
constructs a `Runtime`: `builtin-runtime.ts`, at two call sites. Nothing else
owns one.

**Use is by parameter.** `worktrees.ts` takes `runtime: Runtime` in all three
exported functions and holds no instance. That is the right shape for a
workspace lifecycle service: it operates on a machine it does not own.

The graph's two INFERRED edges on Runtime Abstraction resolve as:

- `runtime → openhands` — **implements**, not owns. A sibling implementation
  alongside `sandbox-runtime`, not something Runtime contains.
- `runtime → terminal-gateway` — **uses**. A PTY gateway would sit *below* the
  Runtime interface as another backing, not above it.

Both were correctly marked INFERRED. Neither implies ownership.

**Residual debt:** `sandboxRuntime()` is constructed inline at each call site
rather than held on the session. It is a stateless factory today so this is
harmless, but it is the same shape as the binding debt below — the runtime
instance is not yet part of a session's context.

---

## Q7 — Capabilities: is it the Task → Worker bridge yet?

**Half. And the halves do not connect.**

`assignWorker` is called exactly once, in `task-planner.ts`, at **plan time**.
It selects a worker kind for a task type. It is never consulted at dispatch
time, so there is no candidate-set filtering when a runtime is chosen.

The blocking problem is vocabulary. There are two, and nothing translates
between them:

```
WorkerCapability          (capabilities.ts)     describes WORKERS
  web_search, browser, coding, filesystem, terminal, git,
  data_analysis, writing, testing, mcp, document_creation

CapabilitySet             (agent-runtime.ts)    describes RUNTIMES
  resumable, writesFiles, runsCommands, checkpointable
```

So the intended chain breaks in the middle:

```
Task requirements → Capabilities → Agent Registry → runtimes → skill
                                 ↑
                          breaks here: capabilities cannot
                          express "this runtime can filesystem.write"
```

`capabilities.ts` contains zero references to any runtime type. Until one
vocabulary covers both, learned routing cannot establish a valid candidate set —
it would have to choose among all workers blindly, which is the thing capability
routing exists to prevent.

**Home is right, scope is too narrow.** Orchestrator policy, correctly. It needs
to become the shared vocabulary for workers *and* runtimes.

---

## Q8 — E2B: is sandbox lifecycle entirely below AgentRuntime?

**For the task graph, yes. For the other surfaces, no.**

`setActiveSandbox` / `getActiveSandbox` appear in exactly one module outside
`crew-tools.ts` itself: `builtin-runtime.ts`. `task-runner` no longer touches
them. That is the containment the consolidation bought.

But `invokeCrewTool` — the tool transport that reaches the sandbox — has four
consumers:

| Consumer | Reaches sandbox? | Through AgentRuntime? |
|---|---|---|
| `agent/tools.ts` | yes (workspace tools) | only because the runtime binds first — **debt** |
| `sandbox-runtime.ts` | yes | yes |
| `crew-tools.ts` | itself | n/a |
| `deep-research.ts` | no (web only) | **no** — reached from `crew.ts` |

`deep-research.ts` is a second tool path, entered from the crew surface, which
is one of the four allowlisted `runEmployee` bypasses. It only calls
`web_search` and `browse_url`, so it cannot corrupt a workspace — but it is a
real execution path around the kernel, and it should be counted as one.

---

## Q9 — Memory: who owns reads, writes and consolidation?

**There are two memory systems, and the wired one is owned by the agent, not
the orchestrator — the inverse of the target.**

```
memory.ts            WIRED     reached as memory_search / memory_save TOOLS
                               the worker decides when to read and write
                               scopes: user | project | ephemeral

memory-layers.ts     ORPHAN    structured: task | project | user
                               kinds: finding | decision | constraint |
                                      failure | preference
                               supersession, recall budgets, render order
```

`task-runner` and `task-planner` never touch memory at all. Neither reads
context before a task nor records anything after one.

So the current shape is:

```
AgentRuntime → Worker → memory tool → memory.ts
```

not the target:

```
        Orchestrator
        /     |     \
   Memory  Runtime  Events
       \      |      /
        └─ Worker ─┘
```

This matters exactly as predicted. Memory is currently *a capability a worker
may choose to use*. Add Claude Code, Wayland Core and Codex and each brings its
own — OpenMind has no authoritative project memory to hand them, because it has
a tool rather than a service. Switching workers would lose continuity, and the
evolution loop would have no stable substrate to learn from.

**`memory-layers.ts` is the right design in the wrong position.** It should
become the kernel service; `memory.ts` should become its storage backend, not
its interface.

---

## Q10 — Browser: worker, runtime capability, or confused?

**Confused, and the file itself shows it.**

The live path is a tool: `web_act` → `agent-tools` → Browserless. That is a
runtime capability.

`browser-worker.ts` — unreachable — contains **both** layers in one file:

| In the file | Really belongs to |
|---|---|
| `BrowserProvider`, `BrowserAction`, `VisitRecord`, `BrowserSessionResult` | **BrowserSession** — where/how. Playwright, DOM, screenshots. |
| `browserArtifacts`, `needsVision`, `orderActions`, `distinctHosts` | **BrowserWorker** — who. AI strategy over a session. |

The same separation the kernel already established applies:

```
AgentRuntime = WHO        Runtime       = WHERE
BrowserWorker = WHO       BrowserSession = WHERE/HOW
```

The halves are already written; they need splitting, not designing. Playwright
must not end up buried inside a browser agent.

---

## Recorded debt: ExecutionContext

**Status: transitional. Not solved.**

Today the runtime binds a module-global before the agent's tools run:

```
BuiltinRuntime
   ↓  setActiveSandbox(session.workspace.sandboxId)
runEmployee()
   ↓
tools read module state
```

`workspace-identity.test.ts` asserts this holds. But it holds because the
runtime *remembers to bind*, not because divergence is impossible. The target
makes it structural:

```ts
interface ExecutionContext {
  session: WorkerSession
  runtime: Runtime
  workspace: Workspace
  permissions: PermissionContext
}

createTools(context)   // instead of tools deciding where to execute
```

Naming it `ExecutionContext` rather than threading `runtime` and `workspace`
separately leaves room for `resources`, `secrets`, `eventSink` and
`abortSignal` without turning every tool constructor into argument soup.

Until this lands, `tool workspace ≠ session workspace` is prevented by a test
rather than by the type system.

---

## What this changes about the order

1. **ExecutionContext** — turns the identity invariant from a test into a type.
2. **Capability vocabulary unification** — required before learned routing;
   currently two disjoint sets.
3. **Memory as a kernel service** — required before external runtimes, or
   continuity breaks on the first worker switch.
4. **Browser split** — mechanical; the halves already exist.

Evolution, ACP, terminal and the workbench all sit above these. Attaching them
first would attach them to boundaries that are still moving.
