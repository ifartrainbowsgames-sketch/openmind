-- Onboarding / chatbot setup wizard state.
-- One row per user, holding the wizard step, a completed flag, and the chatbot
-- config as JSON. Secrets (provider API keys) are NEVER stored here — only
-- non-secret metadata (which provider, a masked hint, a "connected" flag). The
-- raw key stays in the browser session and, later, in the server-side vault.

create table if not exists public.onboarding (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  step        integer     not null default 0,
  completed   boolean     not null default false,
  config      jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.onboarding enable row level security;

-- A user can only see and write their own onboarding row.
drop policy if exists "onboarding is private to its owner" on public.onboarding;
create policy "onboarding is private to its owner"
  on public.onboarding
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
