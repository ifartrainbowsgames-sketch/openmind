-- Task-graph persistence: the project ledger survives a page reload.
-- Three tables mirror the in-memory ProjectState: the project itself, its task
-- DAG, and the artifacts workers produced. Artifacts are the deliverable, so
-- they are stored whole rather than summarised.

create table if not exists public.agent_projects (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null,
  requirements jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  spend jsonb not null default '{}'::jsonb,
  final_output text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_tasks (
  id text not null,
  project_id text not null references public.agent_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null,
  worker text not null,
  status text not null check (
    status in ('pending', 'running', 'completed', 'failed', 'blocked', 'needs_user')
  ),
  depends_on jsonb not null default '[]'::jsonb,
  outputs jsonb not null default '[]'::jsonb,
  acceptance jsonb,
  verdict jsonb,
  blocker text,
  retries int not null default 0,
  steps_used int not null default 0,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.agent_artifacts (
  id text not null,
  project_id text not null references public.agent_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null,
  path text not null,
  kind text not null check (kind in ('markdown', 'html', 'json', 'csv')),
  title text not null,
  body text not null,
  worker text not null,
  sources int,
  confidence numeric,
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists agent_projects_user_started_idx
  on public.agent_projects (user_id, started_at desc);
create index if not exists agent_tasks_project_idx
  on public.agent_tasks (project_id);
create index if not exists agent_artifacts_project_idx
  on public.agent_artifacts (project_id);
create index if not exists agent_artifacts_path_idx
  on public.agent_artifacts (project_id, path);

alter table public.agent_projects enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_artifacts enable row level security;

-- Owner-only across all three. Artifacts can contain scraped content and
-- repository code, so they get the same treatment as the project row.
create policy "agent_projects_rw_own" on public.agent_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "agent_tasks_rw_own" on public.agent_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "agent_artifacts_rw_own" on public.agent_artifacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.agent_projects to authenticated;
grant select, insert, update, delete on public.agent_tasks to authenticated;
grant select, insert, update, delete on public.agent_artifacts to authenticated;
