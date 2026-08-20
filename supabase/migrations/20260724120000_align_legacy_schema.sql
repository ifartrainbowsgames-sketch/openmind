-- The hosted OpenMind project predates the canonical repository migration.
-- Normalize its original columns without dropping customer data so all later
-- chatbot, routing, and connector migrations can run on both old and new
-- projects.

create or replace function public._jsonb_text_array(value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(item), '{}'::text[])
  from jsonb_array_elements_text(coalesce(value, '[]'::jsonb)) as entries(item);
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'services'
      and data_type = 'jsonb'
  ) then
    alter table public.profiles alter column services drop default;
    alter table public.profiles
      alter column services type text[]
      using public._jsonb_text_array(services);
    alter table public.profiles
      alter column services set default array['chat']::text[];
  end if;
end;
$$;

drop function public._jsonb_text_array(jsonb);

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

alter table public.subscriptions
  add column if not exists current_period_end timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.sources
  add column if not exists source_url text,
  add column if not exists content text,
  add column if not exists error_message text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.sources alter column status set default 'stored';

alter table public.conversations
  add column if not exists location text,
  add column if not exists device text,
  add column if not exists unread boolean not null default true,
  add column if not exists started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'loc'
  ) then
    execute 'update public.conversations set location = coalesce(location, loc)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'created_at'
  ) then
    execute 'update public.conversations set started_at = coalesce(started_at, created_at)';
  end if;
end;
$$;

update public.conversations set started_at = now() where started_at is null;
alter table public.conversations
  alter column started_at set default now(),
  alter column started_at set not null;

alter table public.messages
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists text text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'body'
  ) then
    execute 'update public.messages set text = coalesce(text, body)';
  end if;
end;
$$;

update public.messages
set user_id = conversations.user_id
from public.conversations
where conversations.id = messages.conversation_id
  and messages.user_id is null;

update public.messages set text = '[empty message]' where text is null;
alter table public.messages
  alter column user_id set not null,
  alter column text set not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();
drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at before update on public.sources
for each row execute function public.set_updated_at();
drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at before update on public.conversations
for each row execute function public.set_updated_at();

grant select on public.profiles, public.subscriptions to authenticated;
grant select, insert, update, delete on public.sources, public.conversations, public.messages to authenticated;
