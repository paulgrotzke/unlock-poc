drop function if exists public.list_target_media_with_state(uuid);
create function public.list_target_media_with_state(target_id uuid)
returns table (
  id bigint,
  kind text,
  label text,
  unlock_min_messages integer,
  viewer_sent bigint,
  target_sent bigint,
  remaining_viewer_messages integer,
  remaining_target_messages integer,
  unlocked boolean,
  url text,
  text_content text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authenticated user required.';
  end if;

  if target_id is null then
    raise exception 'target_id is required.';
  end if;

  if target_id <> current_user_id
    and not exists (
      select 1
      from public.user_contacts as uc
      where uc.owner_id = current_user_id
        and uc.contact_id = target_id
    ) then
    raise exception 'Access denied for target %.', target_id;
  end if;

  return query
  with thread_counts as (
    select
      coalesce(
        case
          when current_user_id = least(current_user_id, target_id) then ct.low_to_high_count
          else ct.high_to_low_count
        end,
        0
      )::bigint as viewer_sent,
      coalesce(
        case
          when current_user_id = least(current_user_id, target_id) then ct.high_to_low_count
          else ct.low_to_high_count
        end,
        0
      )::bigint as target_sent
    from (select 1) as s
    left join public.chat_threads as ct
      on ct.user_low_id = least(current_user_id, target_id)
     and ct.user_high_id = greatest(current_user_id, target_id)
  ),
  media_with_state as (
    select
      m.id,
      m.kind,
      m.label,
      m.unlock_min_messages,
      tc.viewer_sent,
      tc.target_sent,
      greatest(m.unlock_min_messages - tc.viewer_sent, 0)::integer as remaining_viewer_messages,
      greatest(m.unlock_min_messages - tc.target_sent, 0)::integer as remaining_target_messages,
      (tc.viewer_sent >= m.unlock_min_messages and tc.target_sent >= m.unlock_min_messages) as unlocked,
      m.url,
      m.text_content
    from public.media_items as m
    cross join thread_counts as tc
    where m.owner_id = target_id
  )
  select
    mws.id,
    mws.kind,
    mws.label,
    mws.unlock_min_messages,
    mws.viewer_sent,
    mws.target_sent,
    mws.remaining_viewer_messages,
    mws.remaining_target_messages,
    mws.unlocked,
    case when mws.unlocked then mws.url else null end as url,
    case when mws.unlocked then mws.text_content else null end as text_content
  from media_with_state as mws
  order by mws.id asc;
end;
$$;

revoke execute on function public.list_target_media_with_state(uuid) from public, anon;
grant execute on function public.list_target_media_with_state(uuid) to authenticated;
