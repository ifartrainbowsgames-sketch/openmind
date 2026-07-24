create table public.chatbot_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key text not null unique default ('om_pk_' || replace(extensions.gen_random_uuid()::text, '-', '')),
  enabled boolean not null default true,
  system_prompt text not null default 'You are a helpful customer support assistant. Be concise, factual, and escalate when a human is needed.',
  greeting text not null default 'Hi! How can I help?',
  offline_message text not null default 'We are offline right now. Leave a message and our team will follow up.',
  agent_name text not null default 'Support Assistant',
  selected_employee_id text,
  selected_employee_name text,
  selected_employee_prompt text,
  appearance jsonb not null default '{"accent":"#ff4d00","theme":"light","radius":"soft","preset":"openmind","font":"system"}'::jsonb,
  features jsonb not null default '{"voice":true,"video":false,"images":false,"aiFix":false}'::jsonb,
  allowed_origins text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_members (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 320),
  role text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  available boolean not null default true,
  accept_texts boolean not null default true,
  accept_calls boolean not null default false,
  notify_dashboard boolean not null default true,
  notify_telegram boolean not null default false,
  notify_whatsapp boolean not null default false,
  telegram_chat_id text,
  telegram_link_code text not null unique default ('staff_' || replace(extensions.gen_random_uuid()::text, '-', '')),
  whatsapp_phone text,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index staff_members_owner_email_idx on public.staff_members (owner_id, lower(email));
create unique index staff_members_telegram_chat_idx on public.staff_members (telegram_chat_id)
where telegram_chat_id is not null;
create index staff_members_routing_idx
  on public.staff_members (owner_id, status, available, last_assigned_at nulls first);

alter table public.conversations
  add column channel text not null default 'widget' check (channel in ('widget', 'telegram', 'whatsapp')),
  add column employee_id text,
  add column assigned_staff_id uuid references public.staff_members(id) on delete set null,
  add column visitor_token text;
create index conversations_assigned_staff_idx
  on public.conversations (assigned_staff_id, updated_at desc);

alter table public.messages
  add column staff_user_id uuid references auth.users(id) on delete set null;

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  staff_id uuid references public.staff_members(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  event_kind text not null check (event_kind in ('message', 'call_request', 'assignment')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 2000),
  read boolean not null default false,
  dashboard_enabled boolean not null default true,
  telegram_status text not null default 'not_requested'
    check (telegram_status in ('not_requested', 'pending', 'sent', 'failed', 'not_configured')),
  whatsapp_status text not null default 'not_requested'
    check (whatsapp_status in ('not_requested', 'pending', 'sent', 'failed', 'not_configured')),
  delivery_error text,
  created_at timestamptz not null default now()
);
create index notifications_owner_created_idx on public.notifications (owner_id, created_at desc);
create index notifications_staff_created_idx on public.notifications (staff_id, created_at desc);

create table public.telegram_delivery_threads (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  staff_id uuid not null references public.staff_members(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  telegram_chat_id text not null,
  telegram_message_id bigint not null,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_message_id)
);

create table public.chatbot_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  primary key (bucket_key, window_start)
);

create or replace function public.consume_chatbot_rate_limit(bucket text, request_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  current_window timestamptz := date_trunc('minute', now());
begin
  if random() < 0.01 then
    delete from public.chatbot_rate_limits where window_start < now() - interval '1 day';
  end if;
  insert into public.chatbot_rate_limits (bucket_key, window_start, request_count)
  values (bucket, current_window, 1)
  on conflict (bucket_key, window_start)
  do update set request_count = public.chatbot_rate_limits.request_count + 1
  returning request_count into current_count;
  return current_count <= greatest(request_limit, 1);
end;
$$;
revoke all on function public.consume_chatbot_rate_limit(text, integer) from public;
grant execute on function public.consume_chatbot_rate_limit(text, integer) to service_role;

create trigger chatbot_configs_set_updated_at before update on public.chatbot_configs
for each row execute function public.set_updated_at();
create trigger staff_members_set_updated_at before update on public.staff_members
for each row execute function public.set_updated_at();

create or replace function public.provision_chatbot_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  owner_email text;
begin
  select coalesce(email, 'owner@workspace.local') into owner_email
  from auth.users where id = new.id;

  insert into public.chatbot_configs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.staff_members (
    owner_id, member_user_id, name, email, role, status,
    available, accept_texts, accept_calls
  )
  values (
    new.id,
    new.id,
    split_part(owner_email, '@', 1),
    owner_email,
    'owner',
    'active',
    true,
    true,
    false
  )
  on conflict (owner_id, lower(email)) do nothing;
  return new;
end;
$$;

insert into public.chatbot_configs (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

insert into public.staff_members (
  owner_id, member_user_id, name, email, role, status,
  available, accept_texts, accept_calls
)
select
  profiles.id,
  profiles.id,
  split_part(coalesce(users.email, 'owner@workspace.local'), '@', 1),
  coalesce(users.email, 'owner@workspace.local'),
  'owner',
  'active',
  true,
  true,
  false
from public.profiles
join auth.users on users.id = profiles.id
on conflict (owner_id, lower(email)) do nothing;

create trigger profiles_provision_chatbot_workspace
after insert on public.profiles
for each row execute function public.provision_chatbot_workspace();

create or replace function public.is_active_staff(workspace_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_members
    where owner_id = workspace_owner
      and member_user_id = (select auth.uid())
      and status = 'active'
  );
$$;
revoke all on function public.is_active_staff(uuid) from public;
grant execute on function public.is_active_staff(uuid) to authenticated;

create or replace function public.is_workspace_admin(workspace_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_members
    where owner_id = workspace_owner
      and member_user_id = (select auth.uid())
      and status = 'active'
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.current_staff_id(workspace_owner uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.staff_members
  where owner_id = workspace_owner
    and member_user_id = (select auth.uid())
    and status = 'active'
  limit 1;
$$;

revoke all on function public.is_workspace_admin(uuid) from public;
revoke all on function public.current_staff_id(uuid) from public;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.current_staff_id(uuid) to authenticated;

create or replace function public.enforce_staff_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seat_limit integer;
  seat_count integer;
begin
  select case when plan = 'pro' then 3 else 1 end
  into seat_limit
  from public.profiles
  where id = new.owner_id;

  select count(*) into seat_count
  from public.staff_members
  where owner_id = new.owner_id
    and status <> 'disabled';

  if seat_count >= coalesce(seat_limit, 1) then
    raise exception 'staff seat limit reached for this plan';
  end if;
  return new;
end;
$$;

create trigger staff_members_enforce_seat_limit
before insert on public.staff_members
for each row execute function public.enforce_staff_seat_limit();

alter table public.chatbot_configs enable row level security;
alter table public.staff_members enable row level security;
alter table public.notifications enable row level security;
alter table public.telegram_delivery_threads enable row level security;
alter table public.chatbot_rate_limits enable row level security;

create policy chatbot_configs_owner on public.chatbot_configs
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy staff_members_owner on public.staff_members
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy staff_members_self_read on public.staff_members
for select to authenticated
using (member_user_id = (select auth.uid()) and status = 'active');

create policy conversations_staff_read on public.conversations
for select to authenticated using (
  public.is_workspace_admin(user_id)
  or assigned_staff_id = public.current_staff_id(user_id)
);
create policy conversations_staff_update on public.conversations
for update to authenticated
using (
  public.is_workspace_admin(user_id)
  or assigned_staff_id = public.current_staff_id(user_id)
)
with check (
  public.is_workspace_admin(user_id)
  or assigned_staff_id = public.current_staff_id(user_id)
);

create policy messages_staff_read on public.messages
for select to authenticated using (
  exists (
    select 1 from public.conversations
    where conversations.id = messages.conversation_id
      and (
        public.is_workspace_admin(conversations.user_id)
        or conversations.assigned_staff_id = public.current_staff_id(conversations.user_id)
      )
  )
);
create policy messages_staff_insert on public.messages
for insert to authenticated
with check (
  staff_user_id = (select auth.uid())
  and exists (
    select 1 from public.conversations
    where conversations.id = conversation_id
      and conversations.user_id = messages.user_id
      and (
        public.is_workspace_admin(conversations.user_id)
        or conversations.assigned_staff_id = public.current_staff_id(conversations.user_id)
      )
  )
);

create policy notifications_owner on public.notifications
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy notifications_staff_read on public.notifications
for select to authenticated
using (
  exists (
    select 1 from public.staff_members
    where staff_members.id = notifications.staff_id
      and staff_members.member_user_id = (select auth.uid())
      and staff_members.status = 'active'
  )
);

revoke all on public.chatbot_configs, public.staff_members, public.notifications, public.telegram_delivery_threads from anon;
revoke all on public.telegram_delivery_threads from authenticated;
revoke all on public.chatbot_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.chatbot_configs, public.staff_members to authenticated;
grant select, update on public.notifications to authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array['notifications', 'conversations', 'messages', 'staff_members']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;

comment on column public.chatbot_configs.public_key is
  'Publishable widget identifier. It is not a secret and must resolve only through the rate-limited chat gateway.';
comment on column public.chatbot_configs.selected_employee_prompt is
  'Published snapshot of the selected AI employee prompt used by the public chat gateway.';
comment on column public.staff_members.accept_calls is
  'Eligible for callback/call-request notifications; media transport requires a separate telephony provider.';
