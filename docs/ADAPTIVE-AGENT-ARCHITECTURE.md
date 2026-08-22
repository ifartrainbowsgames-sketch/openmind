# Adaptive agent architecture — research

**Date:** 2026-08-22 · traced against `FerroxLabs/wayland-core@main`

The brief said: *if tracing Wayland's actual code contradicts assumptions in
this prompt, STOP, document the contradiction, recommend the better
architecture.*

It does. Section 1 is the contradiction. Everything after it is what the code
actually shows.

---

## 1. CONTRADICTION — `AgentRouter` is an orphan

The brief's **Finding 1** states that Wayland's `AgentRouter` selects
specialists from `AgentPack`, and that OpenMind should adopt that separation.

The module exists. It is not integrated.

```
$ gh search code "AgentRouter" --repo FerroxLabs/wayland-core
crates/wcore-dispatch/src/agent_router.rs:  pub struct AgentRouter {
crates/wcore-dispatch/src/agent_router.rs:  impl AgentRouter {
crates/wcore-dispatch/src/lib.rs:           pub use agent_router::AgentRouter;
```

Three hits: its own definition, its own impl, and the re-export. **Nothing in
Wayland calls it.** No orchestrator, no CLI, no agent loop, no test outside the
crate.

Specialist selection by Thompson sampling is not something Wayland does in
production. It is something Wayland has written down.

This is precisely the failure class OpenMind has spent this whole project
removing — a module that is real, tested, and reachable from nothing. We found
eight of them in our own tree. It would be a poor outcome to import the ninth
from someone else's, and worse to import it *believing* it was proven.

### What Wayland actually routes

Two Thompson routers are wired, and neither picks a specialist:

| Router | Chooses among | Wired at |
|---|---|---|
| `TemplateRouter` | `Direct`, `Consensus`, `SelfCritique`, `Adaptive`, `Hierarchical` | `wcore-agent/src/bootstrap.rs` → `orchestration/template_routing.rs` |
| `SkillRouter` | skill names | `wcore-skills/src/router.rs` |

`bootstrap.rs` carries the comment *"F-024 (HIGH, Aud-4): install the
TemplateRouter so Thompson-sampled..."*, and a captured debug log in the repo
shows it firing:

```
DEBUG F-024: TemplateRouter installed (Thompson-sampled orchestration active)
```

So the learned decision in production Wayland is **how to think**, not **who
thinks**:

```
Wayland (real)                    the brief assumed
──────────────                    ─────────────────
task                              task
  ↓                                 ↓
TemplateRouter                    AgentRouter
  ↓                                 ↓
Direct / Consensus /              architect / deep-researcher /
SelfCritique / Adaptive /         debugger / security-auditor
Hierarchical                        ↓
  ↓                               orchestrator executes specialist
one reasoning strategy
```

### How specialists are actually chosen

`AgentPack` **is** used — by `wcore-cli/src/agent_cmd.rs` (the `--agent=<name>`
flag) and `wcore-cli/src/acp_roster.rs`. That is **manual selection by a human
typing a name.** There is no learned specialist selection.

### Three more things the code contradicts

**No capability filtering.** `AgentRouter::choose` runs Thompson over every arm
in the pack. There is no eligibility gate. The brief's "capability filter before
learning" is *better than Wayland*, not a copy of it — and it matters: without
it, a historically strong candidate that cannot write files can win a task that
requires writing files.

**No persistence.** `scorer.rs` exposes `pub fn stats(&self, key: &TKey)`
documented as *"handy for debugging and persistence"* — and nothing in the
repository persists it. Wayland's routing learning **dies with the process**.
The brief's instruction to persist is right, and again exceeds the source.

**Magic prompt override.** `AgentRouter::choose` parses `@@agent=<name>` out of
the user's input string. The brief already rejects this as a primary interface.
Confirmed: it is what the code does.

---

## 2. What is worth taking: the scorer

`wcore-dispatch/src/scorer.rs`, Apache-2.0, and small enough that the honest
move is to reimplement rather than vendor.

```rust
pub struct Stats { pub success: u64, pub failure: u64 }
```

- Posterior per arm: **`Beta(success + 1, failure + 1)`**
- Selection: draw one sample per arm, take the argmax. All samples are computed
  before comparison, so no arm is re-randomised mid-scan.
- `record(key, outcome)`: `Success` → `success += 1`; `Failure` →
  `failure += 1`; **`Neutral` is a deliberate no-op.**
- Ties: continuous samples, so exact ties are negligible; first strictly
  greater wins.
- `Beta::new` returning `Err` on non-finite parameters falls back to `0.5`.
- **No decay, no floor, no priors beyond (1,1).**
- `BetaScorer::with_seed(seed)` exists for deterministic tests.

Cold start falls out for free: an unseen arm is `Beta(1,1)`, uniform on [0,1],
so it draws a competitive sample often enough to get tried.

This is the piece the brief describes accurately, and it is about 100 lines.
**Recommendation: implement it in TypeScript. Do not add a dependency.** A
bandit library would own less than we would write around it, and would not know
about our eligibility filter or our persistence.

---

## 3. GEPA

Python, MIT, `gepa-ai/gepa`. Optimises any text parameter — prompts, agent
instructions, configs — by LLM reflection over execution traces plus
Pareto-efficient evolutionary search. It is a **library with a `GEPAAdapter`
interface**, not a service, and there is **no TypeScript port**.

Wayland's `wcore-evolve` is a **separate CLI binary** (`wcore-evolve`,
`wcore-evolve-bench`) implementing a GEPA-style loop offline — not inside the
agent turn.

**Recommendation: option C from the brief.** Build the evolution *boundary*
now — `SkillDefinition` with versions, parent, status, and a deterministic
evaluator — and keep GEPA out of process. When we integrate, the offline
binary/service pattern Wayland uses is the right shape, because evolution
should never be able to stall a customer's task.

Do **not** introduce a Python service in this pass.

---

## 4. Mapping onto OpenMind

### The shared blackboard already exists

The brief asks whether OpenMind's ledger is sufficient before adding state. It
is. Verified against the code:

| Wayland concept | OpenMind equivalent | Status |
|---|---|---|
| shared blackboard | `ProjectState.artifacts` + `decisions` + `evidence` | exists |
| durable task ledger | `ProjectState.tasks` (DAG with `dependsOn`) | exists |
| agent memory | `MemoryBook` on the ledger, kernel service | exists |
| acceptance/eval | `JudgeVerdict` + `sop.ts` acceptance criteria | exists |
| dispatch | `AgentRuntime` + capability vocabulary | exists |

**No second blackboard.** The one missing piece is routing *evidence*, which is
new data, not a new blackboard.

### What OpenMind already has that Wayland does not

- **Capability eligibility** (`runtimeShortfall`, `TASK_REQUIREMENTS`) — the
  filter Wayland's agent router lacks entirely.
- **Durable sessions and workspaces**, with verified identity.
- **Canonical memory reaching every runtime** through `TaskContext`.
- **A judge that is not the worker**, with deterministic acceptance criteria.

### Where OpenMind is behind

- No routing evidence is recorded at all. Nothing anywhere stores which
  specialist/model/runtime was used against whether it worked.
- No specialist registry. Worker "kinds" are eight hard-coded strings.
- `assignWorker` is capability matching with no learning and, until recently,
  was not consulted at dispatch.

---

## 5. Recommended architecture

Take the scorer. Reject the specialist router's *implementation* (it has none
worth copying) but keep the *idea*, implemented properly:

```
task
  ↓
required capabilities            ← OpenMind has this; Wayland does not
  ↓
candidate registry
  ↓
HARD capability filter
  ↓
customer eligibility filter      ← credentials this customer owns
  ↓
eligible candidates
  ↓
Thompson router (persisted)      ← Wayland's algorithm, our persistence
  ↓
choice
  ↓
execution → artifacts → acceptance → RoutingObservation → posterior update
```

Two rules from the contradiction:

1. **Eligibility is a filter, never a prior.** A candidate that cannot do the
   work must not be reachable by sampling, however well it has scored.
2. **Evidence is persisted before the router uses it.** A router whose learning
   dies with the process is a random chooser with extra steps — and it would
   *look* like it was learning.

### Decision dimensions, kept separate

| Router | Chooses | Depends on |
|---|---|---|
| `SpecialistRouter` | who | capability match |
| `SkillRouter` | how it is done | task type |
| `RuntimeRouter` | where | runtime capability + availability + credential |
| `ModelRouter` | which model | provider registry + credential + model capability |

`ModelGateway` stays underneath and is **not** a router. Wayland separates
dispatch from model routing; so should we, and for the same reason.

---

## 6. Staged plan

The brief's A–J stands, with one change: **the specialist registry (H) should
come before the Thompson router (D)**, because there is currently nothing to
route between. Routing among eight hard-coded worker kinds would produce a
posterior over a vocabulary we intend to replace.

| | Stage | Notes |
|---|---|---|
| A | Customer fixtures | eligibility must be per-customer before routing exists |
| B | Routing evidence | persist first; a router with no memory is not learning |
| C | Capability eligibility | mostly exists; extend to specialists |
| H | Specialist registry | **moved earlier** — gives the router a candidate set |
| D | Thompson router | ~100 lines, ours, persisted, seedable |
| E/F/G | Provider → ModelGateway → ModelRouter | previously approved |
| I | Artifact-first team execution | the critical test below |
| J | Evolution boundary | GEPA out of process |

---

## 7. The critical test, stated as a claim

The brief asks to recreate OpenMind's original failure. The test must fail if
agents produce conversational text without the artifact:

```
task created
  → specialist selected from an eligible set
  → ARTIFACT PRODUCED (on disk / in the ledger, read back, not described)
  → next specialist CONSUMES THAT ARTIFACT (proven by content, not by order)
  → new artifact produced
  → acceptance criteria checked deterministically
  → task completes
```

The load-bearing word is *consumes*. A test that only checks task ordering
passes when the second specialist ignored the first and started over — which is
the failure being tested for. The second artifact must contain something that
could only have come from the first.

---

## 8. What I did not do

Per the brief: stopped before implementing. No routing code, no specialist
registry, no evolution.

Also not done, and flagged: the **customer fixture work (Stage A)** is a
prerequisite I have not started, and the brief puts it first. Routing must never
select a model or runtime whose credential belongs to another customer, and that
is only testable with real authenticated customer states.
