-- Durable agent sessions and workspace records.
--
-- Two tables because they answer two different questions. A session says WHO
-- was working — which scope, which provider, which provider-side session id, and
-- what it has served. A workspace says WHERE, and crucially whether that place
-- still exists: `ProjectState.sandbox_id` surviving a restart proved only that
-- we remembered a pointer, not that the machine behind it was alive.
--
-- Neither table holds credentials. `provider_session_id` is runtime metadata
-- rather than a secret, but it is internal, and RLS keeps it to its owner.

create table if not exists public.agent_sessions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- { kind: 'project', projectId, worker } | { kind: 'conversation', conversationId }
  -- Stored whole rather than as columns: conversations and tasks share this
  -- lifecycle and have genuinely different ownership keys, and flattening both
  -- into project_id/worker is what let a chat turn collide with a task.
  scope jsonb not null,
  provider text not null,
  provider_session_id text,
  workspace_id text,
  status text not null check (
    status in ('idle', 'running', 'waiting', 'blocked', 'failed', 'closed')
  ),
  task_ids jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.agent_workspaces (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which Runtime implementation owns the machine: e2b, local, openhands…
  runtime text not null,
  -- The provider's own id. Null until a machine actually exists — a record
  -- that names a machine nobody has spoken to is the pointer problem again.
  external_id text,
  project_id text not null,
  kind text not null check (kind in ('shared', 'worktree', 'conversation')),
  path text not null,
  branch text,
  repo_url text,
  status text not null check (
    status in ('active', 'sleeping', 'missing', 'failed', 'closed')
  ),
  created_at timestamptz not null default now(),
  -- When the machine was last PROVEN reachable. Null means never. This is the
  -- column that separates "we have a sandbox id" from "we have a sandbox".
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists agent_sessions_user_activity_idx
  on public.agent_sessions (user_id, last_activity_at desc);
create index if not exists agent_sessions_workspace_idx
  on public.agent_sessions (workspace_id);
create index if not exists agent_workspaces_user_project_idx
  on public.agent_workspaces (user_id, project_id);
-- Reclaiming machines nobody has verified in a long time.
create index if not exists agent_workspaces_status_verified_idx
  on public.agent_workspaces (status, last_verified_at);

alter table public.agent_sessions enable row level security;
alter table public.agent_workspaces enable row level security;

-- Owner-only. A workspace row names a live sandbox belonging to one account;
-- another account learning that id learns where someone else's code is running.
create policy "agent_sessions_rw_own" on public.agent_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "agent_workspaces_rw_own" on public.agent_workspaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.agent_sessions to authenticated;
grant select, insert, update, delete on public.agent_workspaces to authenticated;

-- anon never reads these. Same posture as the project ledger.
revoke all on public.agent_sessions from anon;
revoke all on public.agent_workspaces from anon;
