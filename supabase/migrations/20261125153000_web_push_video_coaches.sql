-- Correct player-upload routing without changing the capture trigger or queue.
create or replace function private.web_push_targets(event private.web_push_events)
returns table(user_id uuid, group_id uuid, player_id uuid, staff boolean)
language sql stable set search_path='' as $$
  with video_source as (
    select v.group_id,v.player_id from public.coaching_player_videos v
    where v.id=event.source_id
      and ((event.kind='video' and v.uploaded_by=event.actor
          and exists(select 1 from public.coaching_group_coaches c
            where c.group_id=v.group_id and c.user_id=event.actor))
        or (event.kind='analysis' and v.status='reviewed'))
    union all
    select v.group_id,v.player_id from public.coaching_player_video_notes n
    join public.coaching_player_videos v on v.id=n.video_id and v.group_id=n.group_id
    where event.kind='annotation' and n.id=event.source_id and v.status='reviewed'
      and n.author_user_id=event.actor
  ), message_source as (
    select h.* from public.coaching_player_message_history h
    where event.kind='message' and h.id=event.source_id and h.created_by=event.actor
  ), player_source as (
    select v.group_id,v.player_id from video_source v
    union all
    select h.group_id,h.player_id from message_source h
    join public.coaching_group_coaches c on c.group_id=h.group_id and c.user_id=event.actor
    where coalesce(h.sender_role,'coach')='coach'
  )
  select a.user_id,a.group_id,a.player_id,false
  from player_source s
  join public.coaching_player_accounts a using(group_id,player_id)
  join public.coaching_group_players gp using(group_id,player_id)
  where gp.active and a.user_id<>event.actor
    and (event.kind<>'message' or not exists(
      select 1 from public.coaching_player_message_reads r
      where r.message_id=event.source_id and r.user_id=a.user_id and r.viewer_role='player'))
  union all
  select distinct c.user_id,v.group_id,v.player_id,true
  from public.coaching_player_videos v
  join public.coaching_player_accounts a
    on a.group_id=v.group_id and a.player_id=v.player_id and a.user_id=event.actor
  join public.coaching_group_players gp on gp.group_id=v.group_id and gp.player_id=v.player_id and gp.active
  join public.coaching_group_coaches c on c.group_id=v.group_id and c.user_id<>event.actor
  where event.kind='video' and v.id=event.source_id and v.uploaded_by=event.actor
  union all
  select c.user_id,h.group_id,h.player_id,true
  from message_source h
  join public.coaching_player_accounts a on a.group_id=h.group_id and a.player_id=h.player_id and a.user_id=event.actor
  join public.coaching_group_players gp on gp.group_id=h.group_id and gp.player_id=h.player_id and gp.active
  join public.coaching_group_coaches c on c.group_id=h.group_id and c.user_id<>event.actor
  where h.sender_role='player' and not exists(
    select 1 from public.coaching_player_message_reads r
    where r.message_id=h.id and r.user_id=c.user_id and r.viewer_role='coach')
  union all
  select cp.user_id,s.group_id,cp.player_id,false
  from public.training_player_collections c
  join public.training_sessions s on s.id=c.session_id
  join public.training_exercise_occurrences o on o.session_id=s.id and o.id=c.occurrence_id and o.active
  join public.exercises x on x.id=o.exercise_id and x.measurement_type=c.measurement_type
  join public.training_player_collection_players cp on cp.session_id=c.session_id and cp.occurrence_id=c.occurrence_id
  join public.training_attendance ta on ta.session_id=s.id and ta.player_id=cp.player_id and ta.present
  join public.coaching_player_accounts a on a.group_id=s.group_id and a.player_id=cp.player_id and a.user_id=cp.user_id
  join public.coaching_group_players gp on gp.group_id=s.group_id and gp.player_id=cp.player_id and gp.active
  where event.kind='collection' and c.occurrence_id=event.source_id and c.opened_by=event.actor
    and c.state='open' and cp.user_id<>event.actor
  union all
  select event.actor,null::uuid,null::uuid,false where event.kind='test'
$$;

revoke all on function private.web_push_targets(private.web_push_events) from public,anon,authenticated;
