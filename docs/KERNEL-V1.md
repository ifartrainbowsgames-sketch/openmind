# Kernel v1 — boundary complete

**Date:** 2026-08-22 · `cursor/openmind-v2`

The point at which OpenMind stopped being a single agent engine with adapter
interfaces drawn around it. Every line below was verified against code and,
where a machine is involved, against a real one.

---

## The rule that came out of it

Two invariants generalise well beyond the code that produced them. Both were
discovered by a test failing, not by design.

### 1. When resuming an external resource, verify identity, not availability

The restart harness pointed a stored workspace record at a sandbox that did not
exist. The probe returned **exit 0**, and recovery reported `resumed`.

The tool backend provisions a fresh sandbox when the id it is given no longer
exists. So the command ran, on a machine holding none of the previous task's
files. *Successful execution is not proof of identity.* A backend can hand you
something that works while handing you the wrong thing.

`verifyWorkspace` now compares the sandbox that **served** the call against the
one we **asked for**. That distinction applies to everything coming next —
browser sessions, git worktrees, ACP sessions, Claude Code sessions, OpenHands
workspaces, remote machines.

The eventual shape:

```ts
interface RecoverableResource {
  expectedId: string
  actualId?: string
  state: 'verified' | 'substituted' | 'missing' | 'restored'
}
```

### 2. Method arguments are snapshots; repositories own durable mutable state

Two regressions, one shape. `runTask` touched the `session` **parameter** for
each update, so the second write discarded the first and a session's task
history came back empty. The caller's copy is a snapshot taken at
`createSession`; the store is the truth.

Any future adapter — ACP, Claude Code, Codex — must resolve the latest record
before committing a lifecycle change rather than mutating the object it was
handed.

---

## What exists

| | |
|---|---|
| Single `AgentRuntime` execution boundary | `runEmployee` importable by one module, enforced |
| Explicit `ExecutionContext` | the machine is an argument, not a global |
| `ToolContext` / `ExecutionContext` split | web tools do not require a sandbox |
| Canonical memory service | built before dispatch, recorded after, for every runtime |
| Unified capability vocabulary | one language for tasks, workers and runtimes |
| Browser provider architecture | one production path, enforced |
| Durable session repository | survives the process, shared across concurrent runs |
| Durable workspace repository | with status and last-verified time |
| Verified recovery identity | substitution detected, never silently replaced |
| Persistent conversation sessions | same lifecycle, different ownership key |
| Isolated worktrees | own record per worker, not one mutable project record |
| Real-time events | emitted by the actor as calls happen |
| **No implicit active machine** | `setActiveSandbox`/`getActiveSandbox` deleted |

Five boundary tests hold the lines, and each was written because something
silently broke first:

- `runtime-boundary` — one execution path; zero ambient-machine writers; the
  browser split
- `workspace-identity` — one session, one machine
- `memory-boundary` — every runtime receives project memory
- `browser-boundary` — one production browser path
- `durability` — sessions outlive their runtime instance; recovery is honest

Three live harnesses, all passing against real E2B:

- `verify-session-workspace` — task B reads task A's file
- `verify-restart` — three OS processes; a new one reads what the old one
  wrote; a dead machine is reported, not replaced
- `verify-worktrees` — parallel coders do not see each other's edits

---

## Debt, recorded

### Optimistic concurrency on sessions and workspaces

`agent_sessions` and `agent_workspaces` are last-write-wins. Two concurrent
runtimes can interleave:

```
Task A: read session → set providerSessionId → write
Task B: read session → set workspace status  → write   (discards A)
```

Repository-level reads fixed the *in-process* version of this. It survives
across processes. Before a second concurrent runtime lands, both tables need a
`version` column or an `updated_at` compare-and-set, and `save()` needs to
reject a stale write rather than apply it.

Not urgent today because there is one runtime. It stops being optional the
moment there are two.

### Workspace ownership as a type

Ownership is currently encoded in the record id (`ws-worktree-p1:code`). It
should be a value:

```ts
type WorkspaceOwner =
  | { kind: 'project'; projectId: string }
  | { kind: 'worker'; projectId: string; worker: WorkerKind }
  | { kind: 'conversation'; conversationId: string }
```

Cleanup ("release every workspace this project owns") and permissions
("who may attach to this machine") both need to ask that question, and parsing
an id to answer it is how the id becomes load-bearing.

### Cold-cache conversation attachment

`conversationContext` is synchronous — chat latency and task-execution latency
are different problems, and 100 ms on every turn is worse than occasionally
forgetting a sandbox. The invariant that must hold: **a cold cache must never
attach to another conversation's workspace.** The scope key makes that
enforceable; it is not yet asserted under a cold-cache race.

### `checkpoint()` is honest and empty

The builtin runtime reports `checkpointable: false`, and `recoverWorkspace`
returns `recreated` only when a restore function is injected — which nothing
does. For coding projects the first checkpoint mechanism is probably git
(branch, commit, uncommitted diff, artifact files) rather than a machine
snapshot. Until then, a lost machine is a blocked task, which is the truthful
answer.

---

## Not green

**Browser** stays *partial*. `BROWSERLESS_API_KEY` is not set on the
`agent-tools` function, so `verify-browser` passes every refusal check and then
stops at the transport. The full chain — real hosted Chrome → navigate → DOM
extraction → actual visited URL → `BrowserSessionResult` → tool artifact →
ledger → judge — has not run. No green label before it does.

---

## Next

The first real external runtime. The test that matters is the one that proves
the abstractions rather than the adapter:

```
Task A → external runtime → receives TaskContext memory
       → assigned workspace → edits a real file → streams events → session persists
                              [ process restart ]
Task B → same provider session if resumable → same verified workspace
       → sees Task A's file
```

Evolution stays last. It learns from execution paths, and the value of removing
the parallel ones is that there is now a single path worth learning from.
