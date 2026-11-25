-- Web Push is a delivery channel for existing business records.
create table private.web_push_configuration (
  singleton boolean primary key default true check (singleton),
  vapid_public_key text not null check (vapid_public_key ~ '^B[A-Za-z0-9_-]{86}$'),
  enabled boolean not null default false,
  pilot_only boolean not null default true,
  enabled_since timestamptz not null default statement_timestamp()
);
alter table private.web_push_configuration enable row level security;
revoke all on private.web_push_configuration from public,anon,authenticated;

create table private.web_push_pilots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default statement_timestamp()
);
alter table private.web_push_pilots enable row level security;
revoke all on private.web_push_pilots from public,anon,authenticated;

create function private.set_web_push_cutover()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.enabled is distinct from old.enabled or new.pilot_only is distinct from old.pilot_only
    or new.vapid_public_key is distinct from old.vapid_public_key then
    new.enabled_since := statement_timestamp();
  end if;
  return new;
end $$;
revoke all on function private.set_web_push_cutover() from public,anon,authenticated;
create trigger web_push_cutover before update on private.web_push_configuration
  for each row execute function private.set_web_push_cutover();

create function private.web_push_rollout_allows(p_user uuid,p_created_at timestamptz)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from private.web_push_configuration c
    where c.enabled and p_created_at>=c.enabled_since
      and (not c.pilot_only or exists (
        select 1 from private.web_push_pilots p where p.user_id=p_user and p.added_at<=p_created_at
      ))
  )
$$;
revoke all on function private.web_push_rollout_allows(uuid,timestamptz) from public,anon,authenticated;

create function public.web_push_public_key()
returns text language sql stable security definer set search_path='' as $$
  select vapid_public_key from private.web_push_configuration where auth.uid() is not null and private.web_push_rollout_allows(auth.uid(),statement_timestamp())
$$;
revoke all on function public.web_push_public_key() from public,anon,authenticated;
grant execute on function public.web_push_public_key() to authenticated;

create table private.web_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proof uuid not null unique,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  disabled_at timestamptz,
  tested_at timestamptz
);
create index web_push_devices_user on private.web_push_devices(user_id) where disabled_at is null;

create table public.web_push_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  videos boolean not null default true,
  messages boolean not null default true,
  training boolean not null default true
);
alter table public.web_push_preferences enable row level security;
revoke all on public.web_push_preferences from public, anon, authenticated;
grant select, insert, update on public.web_push_preferences to authenticated;
create policy "Own push preferences" on public.web_push_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table private.web_push_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('video','annotation','analysis','message','collection','test')),
  source_id uuid not null,
  actor uuid not null,
  created_at timestamptz not null default now(),
  expanded boolean not null default false
);
create unique index web_push_event_source on private.web_push_events(kind,source_id) where kind <> 'test';
create index web_push_events_ready on private.web_push_events(created_at) where not expanded;
create index web_push_events_actor on private.web_push_events(actor,created_at);
create table private.web_push_deliveries (
  event_id uuid not null references private.web_push_events(id) on delete cascade,
  device_id uuid not null references private.web_push_devices(id) on delete cascade,
  attempts integer not null default 0,
  next_at timestamptz not null default now(),
  lease uuid,
  done boolean not null default false,
  primary key(event_id,device_id)
);
create index web_push_delivery_ready on private.web_push_deliveries(next_at) where not done;
create index web_push_delivery_device on private.web_push_deliveries(device_id);

alter table private.web_push_devices enable row level security;
alter table private.web_push_events enable row level security;
alter table private.web_push_deliveries enable row level security;
revoke all on private.web_push_devices,private.web_push_events,private.web_push_deliveries
  from public,anon,authenticated;

-- Only the holder of an installation secret can claim its subscription.
-- Switching accounts rotates the browser subscription instead of transferring its endpoint.
create function public.register_web_push(
  p_owner uuid,p_proof uuid,p_endpoint text,p_p256dh text,p_auth text
) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); result uuid;
begin
  if uid is null or uid is distinct from p_owner then raise exception 'Connexion requise' using errcode='42501'; end if;
  if not private.web_push_rollout_allows(uid,statement_timestamp()) then
    raise exception 'Notifications indisponibles' using errcode='55000';
  end if;
  if p_proof is null or p_endpoint is null or length(p_endpoint)>2048 or
     p_endpoint !~ '^https://(fcm[.]googleapis[.]com|([a-z0-9-]+[.])?push[.]services[.]mozilla[.]com|[a-z0-9-]+[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com|android[.]googleapis[.]com)/[A-Za-z0-9_/?=%.&:+~-]+$' or
     p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$' or
     p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'Abonnement invalide' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,7239));
  update private.web_push_devices set refreshed_at=now(),p256dh=p_p256dh,auth_key=p_auth
  where proof=p_proof and user_id=uid and endpoint=p_endpoint and disabled_at is null
  returning id into result;
  if found then return result; end if;
  if (select count(*) from private.web_push_devices where user_id=uid and disabled_at is null)>=10 then
    raise exception 'Limite de dix appareils atteinte' using errcode='54000';
  end if;
  insert into private.web_push_devices(user_id,proof,endpoint,p256dh,auth_key)
    values(uid,p_proof,p_endpoint,p_p256dh,p_auth) returning id into result;
  return result;
end $$;

create function public.disable_web_push(p_proof uuid)
returns void language sql security definer set search_path='' as $$
  update private.web_push_devices set disabled_at=now()
  where user_id=auth.uid() and proof=p_proof and disabled_at is null
$$;

create function public.web_push_device_active(p_proof uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.web_push_devices
                where user_id=auth.uid() and proof=p_proof and disabled_at is null)
$$;

create function public.test_web_push(p_proof uuid)
returns void language plpgsql security definer set search_path='' as $$
declare device uuid;
begin
  if not private.web_push_rollout_allows(auth.uid(),statement_timestamp()) then
    raise exception 'Notifications indisponibles' using errcode='55000';
  end if;
  update private.web_push_devices set tested_at=now()
  where user_id=auth.uid() and proof=p_proof and disabled_at is null
    and (tested_at is null or tested_at < now()-interval '2 minutes')
  returning id into device;
  if not found then raise exception 'Appareil inactif ou test trop récent' using errcode='22023'; end if;
  insert into private.web_push_events(kind,source_id,actor) values('test',device,auth.uid());
end $$;

revoke all on function public.register_web_push(uuid,uuid,text,text,text),public.disable_web_push(uuid),
  public.web_push_device_active(uuid),public.test_web_push(uuid) from public,anon,authenticated;
grant execute on function public.register_web_push(uuid,uuid,text,text,text),public.disable_web_push(uuid),
  public.web_push_device_active(uuid),public.test_web_push(uuid) to authenticated;

-- No HTTP or recipient enumeration in the write transaction. A push-specific
-- failure is logged without cancelling the business transaction.
create function private.capture_web_push_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; source uuid; actor_id uuid;
begin
  if not exists(select 1 from private.web_push_configuration where enabled) then return null; end if;
  case tg_table_name
    when 'coaching_player_message_history' then
      kind:='message'; source:=new.id; actor_id:=new.created_by;
      if actor_id is distinct from auth.uid() then return null; end if;
    when 'coaching_player_videos' then
      source:=new.id;
      if tg_op='INSERT' then
        kind:='video'; actor_id:=new.uploaded_by;
      elsif new.status='reviewed' and old.status is distinct from 'reviewed' and exists(
        select 1 from public.coaching_player_video_notes n where n.video_id=new.id and n.group_id=new.group_id
      ) then
        kind:='analysis'; actor_id:=new.reviewed_by;
      end if;
    when 'coaching_player_video_notes' then
      if exists(select 1 from public.coaching_player_videos v
                where v.id=new.video_id and v.group_id=new.group_id and v.status='reviewed') then
        kind:='annotation'; source:=new.id; actor_id:=new.author_user_id;
      end if;
    when 'training_player_collections' then
      if new.state='open' then
        kind:='collection'; source:=new.occurrence_id; actor_id:=new.opened_by;
      end if;
  end case;
  if kind is not null and actor_id is not null and
     (auth.uid() is null or actor_id=auth.uid()) and
     (select count(*) from
        (select 1 from private.web_push_events e where e.actor=actor_id
         and e.created_at >= now()-interval '5 minutes' limit 60) recent) < 60 then
    insert into private.web_push_events(kind,source_id,actor)
      values(kind,source,actor_id) on conflict do nothing;
  end if;
  return null;
exception when others then
  raise warning 'web push capture failed (%): %',tg_table_name,sqlstate;
  return null;
end $$;

revoke all on function private.capture_web_push_event() from public,anon,authenticated;
create trigger web_push_message after insert on public.coaching_player_message_history
  for each row execute function private.capture_web_push_event();
create trigger web_push_video after insert or update of status on public.coaching_player_videos
  for each row execute function private.capture_web_push_event();
create trigger web_push_annotation after insert on public.coaching_player_video_notes
  for each row execute function private.capture_web_push_event();
create trigger web_push_collection after insert on public.training_player_collections
  for each row execute function private.capture_web_push_event();

-- Resolve current access from the same source rows and account/group links as
-- the existing read RPCs. Nothing here grants access to the target resource.
create function private.web_push_targets(event private.web_push_events)
returns table(user_id uuid, group_id uuid, player_id uuid, staff boolean)
language sql stable set search_path='' as $$
  with video_source as (
    select v.group_id,v.player_id from public.coaching_player_videos v
    where v.id=event.source_id
      and ((event.kind='video' and v.uploaded_by=event.actor)
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

create function private.web_push_allowed(kind text,prefs public.web_push_preferences)
returns boolean language sql immutable set search_path='' as $$
  select case kind when 'test' then true when 'message' then coalesce(prefs.messages,true)
    when 'collection' then coalesce(prefs.training,true) else coalesce(prefs.videos,true) end
$$;
revoke all on function private.web_push_targets(private.web_push_events),
  private.web_push_allowed(text,public.web_push_preferences) from public,anon,authenticated;

-- The scheduler calls this only with pending work. Leases prevent workers
-- from claiming the same delivery concurrently. A lost response can retry.
create function public.claim_web_push()
returns jsonb language plpgsql security definer set search_path='' as $$
declare item private.web_push_events; result jsonb; claim uuid:=gen_random_uuid(); cutoff timestamptz;
begin
  select greatest(enabled_since,now()-interval '2 hours') into cutoff
  from private.web_push_configuration where enabled;
  if not found then return '[]'::jsonb; end if;
  for item in select * from private.web_push_events
    where not expanded and created_at>=cutoff
    order by created_at limit 30 for update skip locked
  loop
    insert into private.web_push_deliveries(event_id,device_id)
    select item.id,d.id from private.web_push_targets(item) t
    join private.web_push_devices d on d.user_id=t.user_id and d.disabled_at is null
    left join public.web_push_preferences p on p.user_id=t.user_id
    where (item.kind<>'test' or d.id=item.source_id)
      and d.created_at<=item.created_at and private.web_push_allowed(item.kind,p)
      and private.web_push_rollout_allows(t.user_id,item.created_at)
    on conflict do nothing;
    update private.web_push_events set expanded=true where id=item.id;
  end loop;
  with ready as (
    select q.event_id,q.device_id from private.web_push_deliveries q
    join private.web_push_events e on e.id=q.event_id
    where not q.done and q.next_at<=now() and e.created_at>=cutoff
    order by q.next_at limit 15 for update of q skip locked
  ), picked as (
    update private.web_push_deliveries q set lease=claim,next_at=now()+interval '2 minutes',attempts=q.attempts+1
    from ready r where q.event_id=r.event_id and q.device_id=r.device_id
    returning q.event_id,q.device_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('event',event_id,'device',device_id,'lease',claim)), '[]'::jsonb)
  into result from picked;
  return result;
end $$;

-- Return current endpoint and routing metadata only immediately before dispatch.
-- A rejected or obsolete lease still gets a skip result so the worker can settle it.
create function public.prepare_web_push(p_jobs jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('event',r.event,'device',r.device,'lease',r.lease,'send',v.kind is not null)
      || case when v.kind is null then '{}'::jsonb else to_jsonb(v) end
  ),'[]'::jsonb)
  from jsonb_to_recordset(p_jobs) as r(event uuid,device uuid,lease uuid)
  left join lateral (
    select e.kind,d.endpoint,d.p256dh,d.auth_key as auth,t.group_id as "group",
      t.player_id as player,t.staff
    from private.web_push_deliveries q
    join private.web_push_events e on e.id=q.event_id
    join private.web_push_devices d on d.id=q.device_id
    join lateral (
      select * from private.web_push_targets(e) t where t.user_id=d.user_id
      order by t.group_id,t.player_id limit 1
    ) t on true
    left join public.web_push_preferences p on p.user_id=d.user_id
    where q.event_id=r.event and q.device_id=r.device and q.lease=r.lease
      and not q.done and q.next_at>now() and q.attempts<=4
      and d.disabled_at is null and e.created_at>now()-interval '2 hours'
      and private.web_push_allowed(e.kind,p)
      and private.web_push_rollout_allows(d.user_id,e.created_at)
  ) v on true
$$;

-- One inexpensive queue check per cron tick. This function never calls HTTP.
create function private.web_push_work_due()
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from private.web_push_configuration c
    where c.enabled and (
      exists (
        select 1 from private.web_push_events e
        where not e.expanded and e.created_at>=greatest(c.enabled_since,now()-interval '2 hours')
      ) or exists (
        select 1 from private.web_push_deliveries q join private.web_push_events e on e.id=q.event_id
        where not q.done and q.next_at<=now() and e.created_at>=greatest(c.enabled_since,now()-interval '2 hours')
      )
    )
  )
$$;
revoke all on function private.web_push_work_due() from public,anon,authenticated;

create function public.finish_web_push(p_results jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
  for item in select * from jsonb_to_recordset(p_results)
    as r(event uuid,device uuid,lease uuid,outcome text,retry_after integer)
  loop
    update private.web_push_deliveries
    set done=item.outcome<>'retry' or attempts>=4,lease=null,
        next_at=now()+make_interval(secs=>greatest(60*(2^attempts)::integer,
          least(1800,coalesce(item.retry_after,0))))
    where event_id=item.event and device_id=item.device and lease=item.lease;
    if found and item.outcome='expired' then
      delete from private.web_push_devices where id=item.device;
    end if;
  end loop;
end $$;
revoke all on function public.claim_web_push(),public.prepare_web_push(jsonb),public.finish_web_push(jsonb) from public,anon,authenticated;
grant execute on function public.claim_web_push(),public.prepare_web_push(jsonb),public.finish_web_push(jsonb) to service_role;
