create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  room_key text not null,
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) > 0 and char_length(body) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_key_created_at_idx
  on public.messages (room_key, created_at);

create index if not exists messages_sender_receiver_idx
  on public.messages (sender_id, receiver_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

alter table public.messages enable row level security;

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_sender_only" on public.messages;
create policy "messages_insert_sender_only"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() = sender_id and sender_id <> receiver_id);

drop function if exists public.get_chat_progress(uuid, uuid);
create function public.get_chat_progress(viewer_id uuid, target_id uuid)
returns table (
  viewer_sent bigint,
  target_sent bigint,
  unlocked boolean
)
language sql
stable
as $$
  with viewer_to_target as (
    select count(*)::bigint as total
    from public.messages
    where sender_id = viewer_id and receiver_id = target_id
  ),
  target_to_viewer as (
    select count(*)::bigint as total
    from public.messages
    where sender_id = target_id and receiver_id = viewer_id
  )
  select
    viewer_to_target.total as viewer_sent,
    target_to_viewer.total as target_sent,
    (viewer_to_target.total >= 3 and target_to_viewer.total >= 3) as unlocked
  from viewer_to_target, target_to_viewer;
$$;

grant execute on function public.get_chat_progress(uuid, uuid) to authenticated;

drop function if exists public.can_view_avatar(uuid, uuid);
create function public.can_view_avatar(viewer_id uuid, target_id uuid)
returns boolean
language sql
stable
as $$
  select unlocked
  from public.get_chat_progress(viewer_id, target_id)
  limit 1;
$$;

grant execute on function public.can_view_avatar(uuid, uuid) to authenticated;
