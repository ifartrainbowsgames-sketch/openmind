-- Super Agent memory: per-user notes with FTS now; vector column for later embeddings.
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null default 'user' check (scope in ('user', 'project', 'ephemeral')),
  thread_id text,
  content text not null,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists agent_memories_user_created_idx
  on public.agent_memories (user_id, created_at desc);

create index if not exists agent_memories_content_fts_idx
  on public.agent_memories using gin (to_tsvector('english', content));

alter table public.agent_memories enable row level security;

create policy "agent_memories_select_own"
  on public.agent_memories for select
  using (auth.uid() = user_id);

create policy "agent_memories_insert_own"
  on public.agent_memories for insert
  with check (auth.uid() = user_id);

create policy "agent_memories_delete_own"
  on public.agent_memories for delete
  using (auth.uid() = user_id);

grant select, insert, delete on public.agent_memories to authenticated;
