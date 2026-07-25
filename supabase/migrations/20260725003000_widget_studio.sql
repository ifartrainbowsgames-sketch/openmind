alter table public.chatbot_configs
  add column draft_appearance jsonb,
  add column draft_features jsonb,
  add column draft_greeting text,
  add column draft_agent_name text,
  add column appearance_version integer not null default 0,
  add column published_at timestamptz;

update public.chatbot_configs
set
  draft_appearance = appearance,
  draft_features = features,
  draft_greeting = greeting,
  draft_agent_name = agent_name
where draft_appearance is null;

alter table public.chatbot_configs
  alter column draft_appearance set default
    '{"accent":"#ff4d00","theme":"light","radius":"soft","preset":"openmind","font":"system"}'::jsonb,
  alter column draft_features set default
    '{"voice":true,"video":false,"images":false,"aiFix":false}'::jsonb;

create table public.chatbot_config_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);
create index chatbot_config_versions_user_idx
  on public.chatbot_config_versions (user_id, version desc);

alter table public.chatbot_config_versions enable row level security;
create policy chatbot_config_versions_read_own
on public.chatbot_config_versions for select to authenticated
using ((select auth.uid()) = user_id);
revoke all on public.chatbot_config_versions from anon;
revoke all on public.chatbot_config_versions from authenticated;
grant select on public.chatbot_config_versions to authenticated;

create or replace function public.publish_chatbot_config()
returns public.chatbot_configs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_config public.chatbot_configs;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  update public.chatbot_configs
  set
    appearance = coalesce(draft_appearance, appearance),
    features = coalesce(draft_features, features),
    greeting = coalesce(nullif(trim(draft_greeting), ''), greeting),
    agent_name = coalesce(nullif(trim(draft_agent_name), ''), agent_name),
    appearance_version = appearance_version + 1,
    published_at = now()
  where user_id = v_user_id
  returning * into v_config;

  if v_config.user_id is null then
    raise exception 'chatbot configuration not found';
  end if;

  insert into public.chatbot_config_versions (user_id, version, snapshot)
  values (
    v_user_id,
    v_config.appearance_version,
    jsonb_build_object(
      'appearance', v_config.appearance,
      'features', v_config.features,
      'greeting', v_config.greeting,
      'agent_name', v_config.agent_name
    )
  );

  return v_config;
end;
$$;

revoke all on function public.publish_chatbot_config() from public, anon;
grant execute on function public.publish_chatbot_config() to authenticated;
