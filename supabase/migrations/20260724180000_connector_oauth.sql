create table public.connector_installations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plugin_id text not null check (plugin_id in ('github')),
  status text not null default 'authorized'
    check (status in ('pending', 'authorized', 'live', 'needs_reauth', 'error')),
  account_label text,
  scopes text[] not null default '{}',
  server_url text not null,
  tool_names text[] not null default '{}',
  tool_schemas jsonb not null default '{}'::jsonb,
  token_expires_at timestamptz,
  last_probed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plugin_id)
);
create index connector_installations_user_idx
  on public.connector_installations (user_id, updated_at desc);

create table public.connector_secrets (
  installation_id uuid primary key references public.connector_installations(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_type text not null default 'Bearer',
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.connector_oauth_pending (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plugin_id text not null check (plugin_id in ('github')),
  code_verifier_ciphertext text not null,
  return_origin text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index connector_oauth_pending_expiry_idx
  on public.connector_oauth_pending (expires_at);

create trigger connector_installations_set_updated_at
before update on public.connector_installations
for each row execute function public.set_updated_at();

create trigger connector_secrets_set_updated_at
before update on public.connector_secrets
for each row execute function public.set_updated_at();

alter table public.connector_installations enable row level security;
alter table public.connector_secrets enable row level security;
alter table public.connector_oauth_pending enable row level security;

create policy connector_installations_read_own on public.connector_installations
for select to authenticated
using ((select auth.uid()) = user_id);

create policy connector_installations_delete_own on public.connector_installations
for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.connector_installations, public.connector_secrets, public.connector_oauth_pending from anon;
revoke all on public.connector_secrets, public.connector_oauth_pending from authenticated;
revoke insert, update on public.connector_installations from authenticated;
grant select, delete on public.connector_installations to authenticated;

comment on table public.connector_secrets is
  'Service-role-only encrypted OAuth credentials. Ciphertext and refresh tokens are never exposed to browser roles.';
comment on column public.connector_installations.status is
  'authorized means OAuth exchange succeeded; live requires a successful server-injected tool probe.';
