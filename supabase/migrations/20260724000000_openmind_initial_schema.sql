create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  services text[] not null default array['chat']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'inactive',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sources (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 500),
  type text not null check (type in ('file', 'url', 'text')),
  size text not null default '—',
  status text not null default 'stored' check (status in ('stored', 'indexing', 'indexed', 'error')),
  chunks integer not null default 0 check (chunks >= 0),
  attached text[] not null default '{}',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  file_path text,
  source_url text,
  content text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sources_user_created_idx on public.sources (user_id, created_at desc);

create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  visitor text not null default 'Anonymous visitor',
  location text,
  device text,
  page text,
  status text not null default 'ai' check (status in ('ai', 'human', 'resolved')),
  unread boolean not null default true,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_started_idx on public.conversations (user_id, started_at desc);

create table public.messages (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('visitor', 'ai', 'user')),
  text text not null check (char_length(text) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

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

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before update on public.sources
for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
for each row execute function public.set_updated_at();

create or replace function public.sync_subscription_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set plan = new.plan where id = new.user_id;
  return new;
end;
$$;

create trigger subscriptions_sync_plan
after insert or update of plan on public.subscriptions
for each row execute function public.sync_subscription_plan();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.subscriptions (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.sources enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy profiles_select_own on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy subscriptions_select_own on public.subscriptions
for select to authenticated using ((select auth.uid()) = user_id);

create policy sources_select_own on public.sources
for select to authenticated using ((select auth.uid()) = user_id);
create policy sources_insert_own on public.sources
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sources_update_own on public.sources
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy sources_delete_own on public.sources
for delete to authenticated using ((select auth.uid()) = user_id);

create policy conversations_own on public.conversations
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy messages_own on public.messages
for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.conversations
    where conversations.id = conversation_id
      and conversations.user_id = (select auth.uid())
  )
);

revoke all on public.profiles from anon;
revoke insert, delete, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (services) on public.profiles to authenticated;

revoke all on public.subscriptions from anon;
revoke insert, delete, update on public.subscriptions from authenticated;
grant select on public.subscriptions to authenticated;

revoke all on public.sources, public.conversations, public.messages from anon;
grant select, insert, update, delete on public.sources, public.conversations, public.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources',
  'sources',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy sources_storage_select_own on storage.objects
for select to authenticated
using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy sources_storage_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy sources_storage_delete_own on storage.objects
for delete to authenticated
using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

comment on column public.profiles.plan is
  'Billing-controlled. Authenticated clients have SELECT but no UPDATE privilege on this column.';
comment on column public.sources.status is
  'stored means safely persisted but not yet indexed; indexing requires a separate worker.';
