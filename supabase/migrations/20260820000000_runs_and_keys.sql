-- Background runs + server-held provider keys.
--
-- Runs used to die with the browser tab because orchestration lived in the
-- client. A queued run executes on a worker instead, which means the worker
-- needs the customer's provider key without a browser to ask. Keys are
-- therefore stored server-side, encrypted with AES-GCM by the application
-- layer (KEY_ENCRYPTION_SECRET) before they ever reach Postgres.
--
-- The browser can never read a key back. `ciphertext` and `iv` are excluded
-- from the column grants below, so a SELECT that touches them fails even with
-- a valid session — RLS alone would not stop the owner reading their own row.

create table if not exists public.provider_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('worker', 'planner', 'judge')),
  provider_id text not null,
  -- AES-GCM output, base64. Never selectable by `authenticated`.
  ciphertext text not null,
  iv text not null,
  -- Last four characters, so the UI can show which key is stored.
  hint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.provider_keys enable row level security;

create policy "provider_keys_rw_own" on public.provider_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Column-level grants: the owner may see WHICH key is stored, never the key.
-- Deliberately omits ciphertext and iv. The worker uses the service role,
-- which bypasses both RLS and these grants.
revoke all on public.provider_keys from authenticated;
grant select (user_id, role, provider_id, hint, created_at, updated_at)
  on public.provider_keys to authenticated;
grant delete on public.provider_keys to authenticated;

-- ── Run queue ───────────────────────────────────────────────────────────────
-- A row here is a request for work. The worker claims one atomically, runs the
-- task graph, and writes progress back. The browser subscribes via Realtime
-- rather than holding the execution itself.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text,
  goal text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'blocked', 'needs_user', 'cancelled')),
  -- Non-secret run configuration: workspace, skill, strict mode, budget.
  options jsonb not null default '{}'::jsonb,
  -- Latest ProjectSnapshot, so a reconnecting browser can render immediately.
  snapshot jsonb,
  answer text,
  error text,
  attempts int not null default 0,
  -- Set when a worker claims the row; lets a stalled run be reclaimed.
  claimed_at timestamptz,
  claimed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_user_created_idx
  on public.agent_runs (user_id, created_at desc);
-- Partial index: the claim query only ever looks at queued rows.
create index if not exists agent_runs_queued_idx
  on public.agent_runs (created_at) where status = 'queued';

alter table public.agent_runs enable row level security;

create policy "agent_runs_select_own" on public.agent_runs
  for select using (auth.uid() = user_id);

-- Clients may only enqueue and cancel. Everything else is the worker's job,
-- so status transitions cannot be forged from the browser.
create policy "agent_runs_insert_own" on public.agent_runs
  for insert with check (auth.uid() = user_id and status = 'queued');

create policy "agent_runs_cancel_own" on public.agent_runs
  for update using (auth.uid() = user_id and status in ('queued', 'running'))
  with check (auth.uid() = user_id and status = 'cancelled');

grant select, insert, update on public.agent_runs to authenticated;

/**
 * Claim one queued run atomically.
 *
 * SKIP LOCKED means two workers racing take different rows instead of both
 * taking the same one. Runs claimed longer than `stale_after` are reclaimed,
 * so a worker that dies mid-run does not strand the job forever.
 */
create or replace function public.claim_agent_run(
  worker_id text,
  stale_after interval default interval '10 minutes'
)
returns setof public.agent_runs
language sql
security definer
set search_path = public
as $$
  update public.agent_runs
  set status = 'running',
      claimed_at = now(),
      claimed_by = worker_id,
      attempts = attempts + 1,
      updated_at = now()
  where id = (
    select id from public.agent_runs
    where status = 'queued'
       or (status = 'running' and claimed_at < now() - stale_after)
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

-- Only the worker (service role) may claim.
revoke all on function public.claim_agent_run(text, interval) from public, authenticated;

alter publication supabase_realtime add table public.agent_runs;

-- ── Grant hardening (applied 2026-08-20) ────────────────────────────────────
-- `revoke ... from public` does NOT remove Supabase's default EXECUTE grant to
-- `anon`, so claim_agent_run was reachable unauthenticated via /rest/v1/rpc as
-- a SECURITY DEFINER returning any user's run rows. Revoke each API role by
-- name. Likewise, anon holds default table grants that only RLS was blocking —
-- these tables are never anon-facing and one holds encrypted API keys.
revoke execute on function public.claim_agent_run(text, interval) from public;
revoke execute on function public.claim_agent_run(text, interval) from anon;
revoke execute on function public.claim_agent_run(text, interval) from authenticated;
grant  execute on function public.claim_agent_run(text, interval) to service_role;

revoke all on public.provider_keys   from anon;
revoke all on public.agent_runs      from anon;
revoke all on public.agent_projects  from anon;
revoke all on public.agent_tasks     from anon;
revoke all on public.agent_artifacts from anon;
