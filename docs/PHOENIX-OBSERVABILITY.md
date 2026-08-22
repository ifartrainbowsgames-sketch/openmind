# Phoenix observability

**Date:** 2026-08-22 · `cursor/openmind-v2`

Phoenix is a microscope, not an organ. OpenMind stays authoritative for tasks,
the task DAG, artifacts, memory, sessions, workspaces, credentials,
permissions, routing, runtime outcomes, evaluation and customer ownership.
Phoenix receives OTLP and nothing else — it has no database access, and it is
never consulted to decide anything.

The point is not that telemetry was emitted. It is that **the trace tells the
truth about what actually happened.**

---

## Packages

Checked against the live registry, not against examples.

| Package | Version | Licence |
|---|---|---|
| `@arizeai/phoenix-otel` | 2.2.0 | Apache-2.0 |
| `@arizeai/openinference-semantic-conventions` | 2.7.0 | Apache-2.0 |
| `@opentelemetry/api` | 1.9.1 | Apache-2.0 |

`@arizeai/phoenix-otel` bundles `register()`, the OpenInference semantic
conventions, the OTLP/proto exporter and the tracer helpers, so it replaces
what would otherwise be six direct OpenTelemetry dependencies. It is loaded
**dynamically**, so the browser bundle never pulls in
`@opentelemetry/sdk-trace-node` and a missing optional dependency degrades to a
no-op rather than a build failure.

## Configuration

```
PHOENIX_ENABLED=true                              # opt-in; default off
PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006  # /v1/traces appended
PHOENIX_PROJECT=openmind
PHOENIX_API_KEY=                                  # self-hosted local: unset
PHOENIX_CONTENT_POLICY=metadata_only              # default
```

Opt-in on purpose. Observability that turns itself on is observability nobody
decided to send.

### Content policy

| Mode | Meaning |
|---|---|
| `metadata_only` | **default.** Counts, sizes, ids, outcomes. No prompts, no completions, no memory text. |
| `redacted_content` | content, through the sanitiser |
| `full_content_dev_only` | never for production |

A customer's prompts are their business, and a tracing backend is a second
place they can leak from.

## Trace shape

```
task.outcome                     ← the run, emitted when the outcome is known
  memory.load                    entries, layers, bytes — never the book
  eligibility.evaluate           eligible? and every exclusion reason by kind
  routing.select                 selected, candidate count, policy, override
  runtime.execute                outcome, tool calls, approvals, has_result
  artifact.adopt                 count, provenance, paths, bytes, sources
  task.evaluate                  deterministic?, llm_judge?, score, criteria
```

Names are a fixed union (`SpanName`), not free-form, so a missing stage shows
up as a **missing span** rather than as a differently-worded one.

### Correlation

Every span carries OpenMind's own ids: `user_id`, `project_id`, `task_id`,
`session_id`, `workspace_id`, `runtime_id`, `specialist_id`, `skill_id`,
`skill_version`, `model_id`, `provider_id`, `routing_decision_id`.

Never an email address. Stable internal ids only.

### Outcomes stay distinct

`completed`, `failed`, `cancelled`, `needs_user` and `blocked` are separate
counts on `task.outcome`, never flattened to success/failure. Three of the
false-success cases this project has already found are visible directly:

| Case | Where it shows |
|---|---|
| runtime exited with no result | `runtime.has_result: false` beside a `failed` count |
| permission denial alongside provider "success" | `runtime.outcome: needs_user`, `runtime.approvals_requested > 0` |
| candidate absent rather than merely unlucky | `eligibility.reasons: missing_provider_credential` |

## Redaction

One sanitiser (`src/lib/telemetry/sanitize.ts`), three rules, applied in this
order:

1. **Key names** — `apiKey`, `authorization`, `ciphertext`, `iv`,
   `service_role`, `providerSessionId`… redacted whatever the value is.
2. **Value shapes** — `sk-…`, `sk-ant-…`, GitHub/Slack tokens, JWTs, AWS keys,
   `Bearer …`. This is the rule that matters: a `Bash` tool input is a plain
   string, and provider errors sometimes echo the submitted key.
3. **Size** — strings truncated at 4 000 chars, arrays at 50, depth at 8. A
   4 MB stdout in a span attribute is a denial-of-service against your own
   tracing backend.

Sanitising happens **before** JSON encoding. Encoding first would bury a secret
inside a string the key-name rule can no longer see.

A process environment is never recorded — only `env.count` and
`env.secret_names`. "We only logged the names" is one refactor from being false.

`ProviderCredential.toJSON()` is not relied on: the sanitiser is tested against
the credential object walked field by field, which is what a telemetry helper
actually does.

## Failure behaviour

Non-negotiable, and tested:

- telemetry **off** → a run behaves normally
- collector **unreachable** → the run produces *the same task statuses and the
  same artifact count* as a run with telemetry disabled
- exporter throws mid-span → the run completes
- the **work's** error still propagates; a telemetry error never does

The mechanism is a `started` flag inside `traced()`: anything that fails before
the work begins is ours and is swallowed; anything after is the caller's and is
rethrown. Without that distinction a collector that throws on `startActiveSpan`
is indistinguishable from a failing task.

Export is batched. Nothing in the hot path waits on a remote collector.

## Local setup

```bash
docker compose -f docker-compose.phoenix.yml up -d
open http://localhost:6006

PHOENIX_ENABLED=true npx tsx scripts/verify-agent-live.ts
```

Phoenix is a separate compose file, never part of the default dev stack.

## Production

- Self-host Phoenix as its own service. It gets **no** database credentials and
  no network path to Supabase.
- The worker exports OTLP over HTTP to it.
- **Do not expose it publicly without authentication.** Traces describe a
  customer's work even with every secret redacted.
- `PHOENIX_API_KEY` for an authenticated collector; never a `VITE_` variable,
  and never in frontend code.

## Verification

`scripts/verify-telemetry.ts` stands up a real OTLP receiver, runs a real task
graph with a canary key in the run options, and inspects **the bytes that went
on the wire** — span attribute names and string values travel as UTF-8 inside
protobuf, so a substring search is a genuine leak check rather than a proxy.

Current result: 16 449 bytes exported, all seven spans present, correlation ids
present, canary key absent, no key- or JWT-shaped string anywhere, no memory
text.

## Not done

- **Phoenix UI not yet exercised.** Docker was not running on this machine, so
  the container has never been started and no trace has been seen rendered. The
  export path is proven against a real collector; "visible in Phoenix" is not.
- **No Claude Code trace yet.** `ClaudeCodeRuntime` is not instrumented, so the
  external-runtime spans (session resume, workspace verify, permission denial)
  do not exist.
- **No tool-level spans.** `tool.call` is in the vocabulary and nothing emits
  it; instrumenting the tool transport centrally is the next step.
- **No Test Lab UI.** No `/console/system` page, no system-status probes, no
  customer-state inspector, no trace links.
- **`trace_id` is not written to `agent_runs`,** so a run row cannot yet link
  to its trace.
