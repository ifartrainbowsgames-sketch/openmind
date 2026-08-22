# Routing evidence — schema research

**Date:** 2026-08-22 · before the Stage B migration

Changing a router is cheap. Discovering after 100,000 tasks that the context
needed to train a better one was never recorded is not. So this pass asks one
question of four projects: **which fields would be expensive to add after data
starts accumulating?**

Traced against source, not READMEs.

---

## 1. SAP `contextual-bandit-agent-router` — Apache-2.0, Python

Closest stated purpose to ours: *learn in production which agent in a
multi-agent system performs best for each request.* Four algorithms —
`thompson.py`, `linucb.py`, `kernel_ucb.py`, `neural.py` — and three deployment
modes (in-process, REST/MCP, learning proxy).

### The finding that matters

`src/bandit_router/router.py` correlates feedback through a **single mutable
field**:

```python
self.last_context = None          # "Track last decision for feedback loop"

def select_action(self, context): ...
    self.last_context = context

def update(self, action, reward=None, metrics=None, context=None):
    if context is None:
        context = self.last_context   # ← the correlation
```

**There is no decision id.** Consequences, all structural:

| | |
|---|---|
| Concurrency | Two decisions in flight: the second overwrites `last_context`, and the first's reward is attributed to the second's context. |
| Delayed feedback | A reward arriving after any other decision is misattributed unless the caller stores and passes the context back itself. |
| Retries | A task attempted three times has one `last_context`. |

For OpenMind this is disqualifying on its own: our reward *cannot* be
synchronous. A task's real outcome is known after the judge runs, sometimes
after a retry, sometimes after a human approves a `needs_user` block minutes
later. **A decision id is not a nice-to-have; it is the only thing that makes
our reward attributable at all.**

### Persistence

`save(path)` / `load(path)` **cloudpickle the algorithm's internal state**. The
raw observations are never stored. So the learned policy cannot be
re-derived — if the reward function turns out to be wrong, the history is gone
with it.

That is exactly the failure the approved rule prevents: *raw
`RoutingObservation` is canonical, `RoutingArmStats` is derived.* This project
is the counter-example that proves the rule.

### Worth taking

- **Reward as a `float`, computed by a pluggable `reward_function(metrics)`**
  rather than baked in. Our `success | failure | neutral` is the V1 *derivation*,
  not the stored truth.
- The three deployment modes are irrelevant to us — we are in-process by
  construction.

**Verdict: study, do not install.** Python, no decision id, no raw evidence.

---

## 2. Zeph — `bug-ops/zeph`, Rust

A memory-first agent with graph memory, self-learning skills, multi-model
routing, MCP/ACP/A2A. Routing strategies: EMA, Thompson Sampling, Cascade,
Complexity Triage, and **LinUCB contextual bandit**.

Two ideas worth recording now because they imply *fields*:

**Complexity tiers.** Providers are declared once and routed by tier
(Simple / Medium / Complex / Expert). This is a **context feature**, and it is
one we can compute cheaply and would regret not storing.

**Reputation that penalises malformed output.** Zeph penalises providers that
emit invalid tool calls — a signal distinct from "the task failed". A model
that produces unparseable tool calls is bad in a specific, fixable way. We
already have this signal (`ToolCall.error.kind`) and currently throw it away at
the routing layer.

**Skill variants routed by LinUCB.** `SkillOrchestra` selects which *variant* of
a skill to invoke, with per-skill weight vectors over a shared baseline. That is
the shape Stage J (evolution) wants, and it needs `skillVersion` recorded from
day one — a skill with three live variants is indistinguishable in the evidence
if only the skill *name* is stored.

**Verdict: study.** Rust, and its contextual routing is V2 territory. But three
schema requirements come from it.

---

## 3. Langfuse — TypeScript, OTel-compatible

The relevant part is not the product, it is **the shape of `Score`**:

```
Score { id, name, value, dataType, comment,
        traceId, observationId?, sessionId?, configId? }
```

- Scores attach to a **trace or a specific observation**.
- They can be ingested **after the trace completed** — *"it is not necessary to
  wait until the trace has been created."*
- **Multiple scores of the same name** can attach to one trace, deliberately, to
  track evolution over time.
- Types: numeric, categorical, boolean, text.

That is delayed feedback done correctly, and it is the direct answer to SAP's
`last_context` problem: **the evaluation is a separate row that points back at a
durable decision id, not a mutable pointer to "the last thing".**

Its trace → observation → session hierarchy also matches what we already have:
`agent_runs` → task → `agent_sessions`. We should record a **`traceId`** on the
observation so a routing decision can be correlated with a telemetry trace later
without a migration.

**Verdict: adopt the *shape*; do not make it canonical.** Per the brief:
Supabase holds routing truth; Langfuse, if added, is the microscope. Emitting
OTel later costs nothing if `traceId` exists now and costs a backfill if it does
not.

---

## 4. ParetoBandit — cost-aware, non-stationary

Cost-aware contextual bandit with **geometric forgetting** and a hot-swappable
model registry.

The important observation is about our own V1: Wayland-style `Beta(s+1, f+1)`
uses **lifetime** counts. If a model improves, or a price drops 70%, old
evidence dominates forever. The posterior has no concept of *when*.

We do not need forgetting in V1. We *do* need the raw observation to carry
`createdAt`, `costUsd` and `latencyMs`, because a time-decayed or cost-aware
policy can be re-derived from timestamped raw evidence and **cannot** be
re-derived from lifetime counters.

**Verdict: V2/V3 research.** One schema consequence: timestamps and cost are not
optional.

---

## 5. Generic bandit libraries

Several exist (LinUCB, Top-Two Thompson, KernelUCB…). None knows about
customers, credentials, specialists, skills, runtimes, capabilities, artifacts
or acceptance criteria — so each would own less than we would write around it.

**Verdict: reject**, consistent with the Wayland conclusion. ~100 lines of our
own Thompson sampler, with our eligibility filter and our persistence.

---

## 6. What this changes about the Stage B schema

The approved split stands: **raw observation canonical, arm stats derived.**
Six additions, each because omitting it is expensive later:

| Field | Why it cannot be added later |
|---|---|
| `decisionId` | Reward attribution. SAP's `last_context` is the proof — without an id, a delayed or concurrent reward lands on the wrong decision, and no backfill can recover which. |
| `candidateSet` | The arms that *were eligible* at decision time. Without it we cannot tell "chosen from three" from "the only option", and every counterfactual analysis is impossible retroactively. |
| `contextFeatures` | Any contextual policy (LinUCB, Zeph-style tiers) needs the features **as they were**. Recomputing them from a task record later gives today's features for yesterday's decision. |
| `skillVersion` | Three variants of one skill are indistinguishable if only the name is stored — which is exactly what Stage J needs to compare. |
| `traceId` | Correlating with OTel/Langfuse later. Free now, a backfill otherwise. |
| `createdAt`, `costUsd`, `latencyMs` | Non-stationarity and cost-awareness. Derivable from raw evidence; not derivable from counters. |

And one shape, from Langfuse: **the outcome is a separate row from the decision.**
A decision is written when it is made; an observation is written when the truth
is known, pointing back at `decisionId`. A task that is judged, retried, and
then approved by a human produces several observations against one decision —
which is a fact about our system, not an edge case.

### Rules restated as invariants

1. **Eligibility precedes sampling.** An ineligible candidate has probability
   zero, not a lower score. The `candidateSet` column is what makes this
   auditable after the fact.
2. **Evidence is persisted before it can influence routing.** No
   process-local-only learning. A router whose stats die on restart would look
   adaptive while relearning from scratch every boot.
3. **Reward is derived, never stored as the only truth.** `success | failure |
   neutral` is a V1 *projection* of the observation. The observation keeps the
   metrics that produced it.

---

## 7. Not doing

No Langfuse dependency in this pass — only a `traceId` column so adding it later
is free. No contextual features consumed by the router yet, only recorded. No
forgetting, no cost-awareness in V1. No second orchestrator, no second
credential store, and telemetry never becomes canonical state.
