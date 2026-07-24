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

create or replace function public.claim_connector_oauth_pending(p_state_hash text)
returns setof public.connector_oauth_pending
language sql
security definer
set search_path = ''
as $$
  delete from public.connector_oauth_pending
  where state_hash = p_state_hash
    and expires_at > now()
  returning *;
$$;

create or replace function public.store_connector_oauth_installation(
  p_user_id uuid,
  p_plugin_id text,
  p_account_label text,
  p_scopes text[],
  p_server_url text,
  p_token_expires_at timestamptz,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_token_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installation_id uuid;
begin
  insert into public.connector_installations (
    user_id, plugin_id, status, account_label, scopes, server_url,
    tool_names, tool_schemas, token_expires_at, last_error
  )
  values (
    p_user_id, p_plugin_id, 'authorized', p_account_label, p_scopes, p_server_url,
    '{}', '{}'::jsonb, p_token_expires_at, null
  )
  on conflict (user_id, plugin_id) do update set
    status = 'authorized',
    account_label = excluded.account_label,
    scopes = excluded.scopes,
    server_url = excluded.server_url,
    tool_names = '{}',
    tool_schemas = '{}'::jsonb,
    token_expires_at = excluded.token_expires_at,
    last_probed_at = null,
    last_error = null
  returning id into v_installation_id;

  insert into public.connector_secrets (
    installation_id, access_token_ciphertext, refresh_token_ciphertext, token_type, key_version
  )
  values (
    v_installation_id, p_access_token_ciphertext, p_refresh_token_ciphertext,
    coalesce(nullif(p_token_type, ''), 'Bearer'), 1
  )
  on conflict (installation_id) do update set
    access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    token_type = excluded.token_type,
    key_version = excluded.key_version;

  return v_installation_id;
end;
$$;

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

revoke all on public.connector_installations, public.connector_secrets, public.connector_oauth_pending from anon;
revoke all on public.connector_secrets, public.connector_oauth_pending from authenticated;
revoke all on public.connector_installations from authenticated;
grant select on public.connector_installations to authenticated;

revoke all on function public.claim_connector_oauth_pending(text) from public, anon, authenticated;
revoke all on function public.store_connector_oauth_installation(
  uuid, text, text, text[], text, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_connector_oauth_pending(text) to service_role;
grant execute on function public.store_connector_oauth_installation(
  uuid, text, text, text[], text, timestamptz, text, text, text
) to service_role;

comment on table public.connector_secrets is
  'Service-role-only encrypted OAuth credentials. Ciphertext and refresh tokens are never exposed to browser roles.';
comment on column public.connector_installations.status is
  'authorized means OAuth exchange succeeded; live requires a successful server-injected tool probe.';
