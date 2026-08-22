-- Routing evidence: what was chosen, and what actually happened.
--
-- Three tables, and the split is the point.
--
--   routing_decisions     written WHEN THE CHOICE IS MADE
--   routing_observations  written WHEN THE TRUTH IS KNOWN
--   routing_arm_stats     DERIVED, and rebuildable from the two above
--
-- SAP's contextual-bandit-agent-router correlates feedback through a single
-- mutable `last_context` field with no decision id. Two decisions in flight and
-- the second overwrites the first, so the first's reward lands on the wrong
-- one. Our reward can never be synchronous — the real outcome is known after
-- the judge, sometimes after a retry, sometimes after a human approves a
-- needs_user block minutes later. So the decision gets a durable id and the
-- outcome points back at it.
--
-- That same project cloudpickles its algorithm state and keeps no raw
-- observations, which means a wrong reward function destroys the history with
-- it. Here the raw row is canonical and the counters are a projection.

create table if not exists public.routing_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  project_id text,
  task_id text,

  -- specialist | skill | runtime | model. Kept separate on purpose: dispatch
  -- and model routing are different questions with different candidate sets.
  decision_type text not null check (
    decision_type in ('specialist', 'skill', 'runtime', 'model')
  ),
  -- What the posterior is grouped by — usually the task type. Learning "code
  -- tasks go well on X" is useful; learning "everything goes well on X" is not.
  scope text not null,

  chosen_candidate_id text not null,

  -- The arms that were ELIGIBLE when the choice was made.
  --
  -- Without this we cannot tell "chosen from three" from "the only option
  -- available", and no counterfactual analysis is possible after the fact. It
  -- is also the audit trail for the eligibility-precedes-sampling rule: an
  -- ineligible candidate must never appear here.
  candidate_set jsonb not null default '[]'::jsonb,

  -- Features AS THEY WERE. Recomputing them from the task record later gives
  -- today's features for yesterday's decision, which is worse than nothing
  -- because it looks like data.
  context_features jsonb not null default '{}'::jsonb,

  -- 'thompson-v1' | 'manual' | 'sole-candidate' | 'default'. A decision made
  -- because there was only one option is not evidence about that option.
  policy text not null,

  -- Correlates with an OpenTelemetry/Langfuse trace. Free to add now; a
  -- backfill later. Nothing reads it yet.
  trace_id text,

  created_at timestamptz not null default now()
);

create table if not exists public.routing_observations (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.routing_decisions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The V1 projection. Deliberately NOT the only truth stored: `metrics` keeps
  -- what produced it, so a better reward function can be applied to history
  -- rather than starting from zero.
  outcome text not null check (outcome in ('success', 'failure', 'neutral')),

  -- What the task actually did. All nullable: an observation written when a run
  -- is cancelled knows less than one written after a judge.
  acceptance_score numeric,
  cost_usd numeric,
  latency_ms integer,
  retries integer,
  needed_user boolean,
  -- Distinct from failure. A model that emits unparseable tool calls is bad in
  -- a specific, fixable way — Zeph penalises exactly this, and we already have
  -- the signal in ToolCall.error.kind and were discarding it.
  invalid_tool_calls integer,

  -- The full dimension set, so evidence survives a vocabulary change. A
  -- specialist registry that renames its ids must not orphan the history.
  specialist_id text,
  skill_id text,
  -- Three variants of one skill are indistinguishable without this, which is
  -- exactly what skill evolution needs to compare.
  skill_version text,
  runtime_id text,
  model_id text,
  provider_id text,

  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Derived. Truncating this table must be safe: it is rebuildable by replaying
-- routing_observations. If that ever stops being true, the split has been lost.
create table if not exists public.routing_arm_stats (
  scope text not null,
  decision_type text not null,
  candidate_id text not null,
  successes bigint not null default 0,
  failures bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, decision_type, candidate_id)
);

create index if not exists routing_decisions_user_created_idx
  on public.routing_decisions (user_id, created_at desc);
create index if not exists routing_decisions_task_idx
  on public.routing_decisions (project_id, task_id);
create index if not exists routing_observations_decision_idx
  on public.routing_observations (decision_id);
create index if not exists routing_observations_user_created_idx
  on public.routing_observations (user_id, created_at desc);

alter table public.routing_decisions enable row level security;
alter table public.routing_observations enable row level security;
alter table public.routing_arm_stats enable row level security;

-- A customer may read their own routing history: it says which model and
-- runtime ran their work, and what it cost. They may not write it — evidence a
-- customer can forge is not evidence.
create policy "routing_decisions_read_own" on public.routing_decisions
  for select using (auth.uid() = user_id);
create policy "routing_observations_read_own" on public.routing_observations
  for select using (auth.uid() = user_id);

grant select on public.routing_decisions to authenticated;
grant select on public.routing_observations to authenticated;
revoke all on public.routing_decisions from anon;
revoke all on public.routing_observations from anon;

-- Aggregate posteriors are NOT customer data and are not exposed to any
-- customer. They span accounts by design — one customer's outcomes inform
-- everyone's routing — so no policy grants access and only the service role
-- reads or writes them.
revoke all on public.routing_arm_stats from anon, authenticated;

comment on table public.routing_decisions is
  'One row per routed choice, written when the choice is made. candidate_set records what was eligible, so eligibility-precedes-sampling is auditable.';
comment on table public.routing_observations is
  'Outcomes pointing back at a decision. Several per decision is normal: judged, retried, then approved by a human.';
comment on table public.routing_arm_stats is
  'Derived Thompson counters. Rebuildable from routing_observations; never the canonical record.';
