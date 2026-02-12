create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select (id, display_name, avatar_url, created_at) on table public.profiles to authenticated;
grant insert (id, email, display_name, avatar_url, created_at) on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

drop function if exists public.enforce_profile_email_integrity();
create function public.enforce_profile_email_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Authenticated user required.';
  end if;

  if new.id is distinct from auth.uid() then
    raise exception 'Profile id must match auth.uid().';
  end if;

  select u.email
  into auth_email
  from auth.users as u
  where u.id = new.id;

  if auth_email is null then
    raise exception 'No auth user email found for profile id %.', new.id;
  end if;

  if tg_op = 'INSERT' then
    if new.email is null then
      new.email := auth_email;
    elsif lower(new.email) <> lower(auth_email) then
      raise exception 'Profile email must match authenticated user email.';
    end if;

    return new;
  end if;

  if new.email is distinct from old.email then
    raise exception 'Profile email is immutable for clients.';
  end if;

  new.email := old.email;
  return new;
end;
$$;

drop trigger if exists trg_profiles_email_integrity on public.profiles;
create trigger trg_profiles_email_integrity
before insert or update on public.profiles
for each row
execute function public.enforce_profile_email_integrity();

create table if not exists public.user_contacts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id),
  constraint user_contacts_owner_contact_chk check (owner_id <> contact_id)
);

create index if not exists user_contacts_contact_owner_idx
  on public.user_contacts (contact_id, owner_id);

alter table public.user_contacts enable row level security;

drop policy if exists "user_contacts_select_own" on public.user_contacts;
create policy "user_contacts_select_own"
  on public.user_contacts
  for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "profiles_select_self_or_contacts" on public.profiles;
create policy "profiles_select_self_or_contacts"
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.user_contacts as uc
      where uc.owner_id = auth.uid()
        and uc.contact_id = profiles.id
    )
  );

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
  created_at timestamptz not null default now(),
  constraint messages_sender_receiver_chk check (sender_id <> receiver_id),
  constraint messages_room_key_consistency_chk check (
    room_key = least(sender_id::text, receiver_id::text) || '__' || greatest(sender_id::text, receiver_id::text)
  )
);

create index if not exists messages_room_key_created_at_idx
  on public.messages (room_key, created_at);

create index if not exists messages_sender_receiver_created_at_idx
  on public.messages (sender_id, receiver_id, created_at);

create table if not exists public.chat_threads (
  user_low_id uuid not null references auth.users (id) on delete cascade,
  user_high_id uuid not null references auth.users (id) on delete cascade,
  low_to_high_count bigint not null default 0 check (low_to_high_count >= 0),
  high_to_low_count bigint not null default 0 check (high_to_low_count >= 0),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_low_id, user_high_id),
  constraint chat_threads_pair_order_chk check (user_low_id::text < user_high_id::text)
);

create index if not exists chat_threads_user_low_last_message_idx
  on public.chat_threads (user_low_id, last_message_at desc);

create index if not exists chat_threads_user_high_last_message_idx
  on public.chat_threads (user_high_id, last_message_at desc);

alter table public.messages enable row level security;
alter table public.chat_threads enable row level security;

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_sender_only_contact" on public.messages;
create policy "messages_insert_sender_only_contact"
  on public.messages
  for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> receiver_id
    and room_key = least(sender_id::text, receiver_id::text) || '__' || greatest(sender_id::text, receiver_id::text)
    and exists (
      select 1
      from public.user_contacts as uc
      where uc.owner_id = sender_id
        and uc.contact_id = receiver_id
    )
  );

drop policy if exists "chat_threads_select_participants" on public.chat_threads;
create policy "chat_threads_select_participants"
  on public.chat_threads
  for select
  to authenticated
  using (auth.uid() = user_low_id or auth.uid() = user_high_id);

drop function if exists public.bump_chat_thread_counters();
create function public.bump_chat_thread_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  low_user uuid;
  high_user uuid;
  low_to_high_inc bigint := 0;
  high_to_low_inc bigint := 0;
begin
  low_user := least(new.sender_id, new.receiver_id);
  high_user := greatest(new.sender_id, new.receiver_id);

  if new.sender_id = low_user then
    low_to_high_inc := 1;
  else
    high_to_low_inc := 1;
  end if;

  insert into public.chat_threads (
    user_low_id,
    user_high_id,
    low_to_high_count,
    high_to_low_count,
    last_message_at,
    created_at,
    updated_at
  )
  values (
    low_user,
    high_user,
    low_to_high_inc,
    high_to_low_inc,
    new.created_at,
    now(),
    now()
  )
  on conflict (user_low_id, user_high_id)
  do update
    set low_to_high_count = public.chat_threads.low_to_high_count + excluded.low_to_high_count,
        high_to_low_count = public.chat_threads.high_to_low_count + excluded.high_to_low_count,
        last_message_at = greatest(coalesce(public.chat_threads.last_message_at, '-infinity'::timestamptz), excluded.last_message_at),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_messages_bump_chat_thread on public.messages;
create trigger trg_messages_bump_chat_thread
after insert on public.messages
for each row
execute function public.bump_chat_thread_counters();

insert into public.chat_threads (
  user_low_id,
  user_high_id,
  low_to_high_count,
  high_to_low_count,
  last_message_at,
  created_at,
  updated_at
)
select
  least(m.sender_id, m.receiver_id) as user_low_id,
  greatest(m.sender_id, m.receiver_id) as user_high_id,
  sum(case when m.sender_id = least(m.sender_id, m.receiver_id) then 1 else 0 end)::bigint as low_to_high_count,
  sum(case when m.sender_id = greatest(m.sender_id, m.receiver_id) then 1 else 0 end)::bigint as high_to_low_count,
  max(m.created_at) as last_message_at,
  now(),
  now()
from public.messages as m
group by least(m.sender_id, m.receiver_id), greatest(m.sender_id, m.receiver_id)
on conflict (user_low_id, user_high_id)
do update
  set low_to_high_count = excluded.low_to_high_count,
      high_to_low_count = excluded.high_to_low_count,
      last_message_at = excluded.last_message_at,
      updated_at = now();

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

drop function if exists public.has_mutual_message_threshold(uuid, uuid, integer);
create function public.has_mutual_message_threshold(
  viewer_id uuid,
  target_id uuid,
  threshold integer
)
returns boolean
language sql
stable
set search_path = public
as $$
  with effective_viewer as (
    select
      case
        when auth.role() = 'service_role' then viewer_id
        else auth.uid()
      end as id
  ),
  pair as (
    select
      effective_viewer.id as viewer,
      least(effective_viewer.id, target_id) as low_id,
      greatest(effective_viewer.id, target_id) as high_id
    from effective_viewer
  ),
  counts as (
    select
      pair.viewer,
      coalesce(
        case
          when pair.viewer = pair.low_id then ct.low_to_high_count
          else ct.high_to_low_count
        end,
        0
      )::bigint as viewer_sent,
      coalesce(
        case
          when pair.viewer = pair.low_id then ct.high_to_low_count
          else ct.low_to_high_count
        end,
        0
      )::bigint as target_sent
    from pair
    left join public.chat_threads as ct
      on ct.user_low_id = pair.low_id
     and ct.user_high_id = pair.high_id
  )
  select
    case
      when threshold <= 0 then true
      when target_id is null then false
      when viewer is null then false
      when viewer = target_id then true
      else viewer_sent >= threshold and target_sent >= threshold
    end
  from counts;
$$;

revoke execute on function public.has_mutual_message_threshold(uuid, uuid, integer) from public, anon;
grant execute on function public.has_mutual_message_threshold(uuid, uuid, integer) to authenticated;

drop function if exists public.get_chat_progress(uuid, uuid);
create function public.get_chat_progress(viewer_id uuid, target_id uuid)
returns table (
  viewer_sent bigint,
  target_sent bigint,
  unlocked boolean
)
language sql
stable
set search_path = public
as $$
  with effective_viewer as (
    select
      case
        when auth.role() = 'service_role' then viewer_id
        else auth.uid()
      end as id
  ),
  pair as (
    select
      effective_viewer.id as viewer,
      least(effective_viewer.id, target_id) as low_id,
      greatest(effective_viewer.id, target_id) as high_id
    from effective_viewer
  ),
  counts as (
    select
      pair.viewer,
      coalesce(
        case
          when pair.viewer = pair.low_id then ct.low_to_high_count
          else ct.high_to_low_count
        end,
        0
      )::bigint as viewer_sent,
      coalesce(
        case
          when pair.viewer = pair.low_id then ct.high_to_low_count
          else ct.low_to_high_count
        end,
        0
      )::bigint as target_sent
    from pair
    left join public.chat_threads as ct
      on ct.user_low_id = pair.low_id
     and ct.user_high_id = pair.high_id
  )
  select
    case when viewer is null or target_id is null then 0 else viewer_sent end as viewer_sent,
    case when viewer is null or target_id is null then 0 else target_sent end as target_sent,
    case
      when viewer is null or target_id is null then false
      else viewer_sent >= 3 and target_sent >= 3
    end as unlocked
  from counts;
$$;

revoke execute on function public.get_chat_progress(uuid, uuid) from public, anon;
grant execute on function public.get_chat_progress(uuid, uuid) to authenticated;

drop function if exists public.can_view_avatar(uuid, uuid);
create function public.can_view_avatar(viewer_id uuid, target_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select unlocked
  from public.get_chat_progress(viewer_id, target_id)
  limit 1;
$$;

revoke execute on function public.can_view_avatar(uuid, uuid) from public, anon;
grant execute on function public.can_view_avatar(uuid, uuid) to authenticated;

drop function if exists public.list_chat_targets_with_progress();
create function public.list_chat_targets_with_progress()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  viewer_sent bigint,
  target_sent bigint,
  unlocked boolean,
  last_message_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with base as (
    select
      p.id,
      p.display_name,
      p.avatar_url,
      auth.uid() as viewer_id,
      ct.low_to_high_count,
      ct.high_to_low_count,
      ct.last_message_at
    from public.user_contacts as uc
    join public.profiles as p
      on p.id = uc.contact_id
    left join public.chat_threads as ct
      on ct.user_low_id = least(uc.owner_id, uc.contact_id)
     and ct.user_high_id = greatest(uc.owner_id, uc.contact_id)
    where uc.owner_id = auth.uid()
  ),
  projected as (
    select
      id,
      display_name,
      avatar_url,
      coalesce(
        case
          when viewer_id = least(viewer_id, id) then low_to_high_count
          else high_to_low_count
        end,
        0
      )::bigint as viewer_sent,
      coalesce(
        case
          when viewer_id = least(viewer_id, id) then high_to_low_count
          else low_to_high_count
        end,
        0
      )::bigint as target_sent,
      last_message_at
    from base
  )
  select
    id,
    display_name,
    avatar_url,
    viewer_sent,
    target_sent,
    (viewer_sent >= 3 and target_sent >= 3) as unlocked,
    last_message_at
  from projected
  order by coalesce(last_message_at, '-infinity'::timestamptz) desc, display_name asc;
$$;

revoke execute on function public.list_chat_targets_with_progress() from public, anon;
grant execute on function public.list_chat_targets_with_progress() to authenticated;

create table if not exists public.media_items (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  seed_key text not null default (gen_random_uuid())::text,
  kind text not null default 'image' check (kind in ('image', 'text')),
  url text,
  text_content text,
  label text,
  unlock_min_messages integer not null default 3 check (unlock_min_messages >= 0 and unlock_min_messages <= 1000),
  created_at timestamptz not null default now(),
  constraint media_items_kind_content_chk check (
    (kind = 'image' and url is not null and text_content is null)
    or (kind = 'text' and url is null and text_content is not null and char_length(text_content) > 0 and char_length(text_content) <= 4000)
  )
);

create index if not exists media_items_owner_id_idx
  on public.media_items (owner_id);

create unique index if not exists media_items_owner_seed_key_uidx
  on public.media_items (owner_id, seed_key);

alter table public.media_items enable row level security;

drop policy if exists "media_items_select_owner_or_unlocked" on public.media_items;
create policy "media_items_select_owner_or_unlocked"
  on public.media_items
  for select
  to authenticated
  using (
    auth.uid() = owner_id
    or public.has_mutual_message_threshold(auth.uid(), owner_id, unlock_min_messages)
  );

drop policy if exists "media_items_insert_own" on public.media_items;
create policy "media_items_insert_own"
  on public.media_items
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "media_items_update_own" on public.media_items;
create policy "media_items_update_own"
  on public.media_items
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
