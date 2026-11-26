alter table public.training_sessions
  add column attendance_planned boolean not null default false,
  add column attendance_started_at timestamptz;

alter table public.training_attendance_responses add column dismissed_revision timestamptz;

create table private.training_attendance_manual_overrides (
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (session_id,player_id)
);
create index on private.training_attendance_manual_overrides(player_id);
alter table private.training_attendance_manual_overrides enable row level security;
revoke all on private.training_attendance_manual_overrides from public,anon,authenticated;

-- The existing save validates the full document and acquires the lease.
-- Mark preparation in the same transaction as creation and return the final version.
create function public.save_planned_training_session(p_save jsonb)
returns table(status text,session_id uuid,version integer,updated_at timestamptz,
  remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare v record;
begin
  perform set_config('kinball.attendance_preparing','true',true);
  select * into v from public.save_training_session_player_results(
    null,null,(p_save->>'p_editor_instance_id')::uuid,null,
    (p_save->>'p_workspace_id')::uuid,(p_save->>'p_group_id')::uuid,(p_save->>'p_team_id')::uuid,
    (p_save->>'p_trained_on')::date,p_save->>'p_label',p_save->>'p_theme',
    (p_save->>'p_duration_minutes')::int,p_save->>'p_notes',p_save->'p_attendance',
    p_save->'p_exercises',p_save->'p_results',false,p_save->'p_occurrences');
  perform set_config('kinball.attendance_preparing','',true);
  return query update public.training_sessions s set attendance_planned=true where s.id=v.session_id
    returning v.status,s.id,s.version,s.updated_at,v.remote_version,v.lease_token,v.lease_expires_at;
end $$;

create or replace function private.mark_training_attendance_initialized()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('kinball.attendance_prefill',true) = coalesce(new.session_id,old.session_id)::text then
    return null;
  end if;
  if (tg_op='INSERT' and new.present) or
     (tg_op='UPDATE' and new.present is distinct from old.present) or
     (tg_op='DELETE' and old.present) then
    insert into private.training_attendance_manual_overrides(session_id,player_id)
    select s.id,coalesce(new.player_id,old.player_id)
    from public.training_sessions s
    where s.id=coalesce(new.session_id,old.session_id) and (
      s.attendance_planned or current_setting('kinball.attendance_preparing',true)='true'
      or exists (select 1 from public.training_attendance_polls p where p.session_id=s.id))
    on conflict do nothing;
  end if;
  return null;
end $$;

create function public.start_training_attendance_session(
  p_session uuid,p_instance uuid,p_token uuid,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.training_sessions; v_poll public.training_attendance_polls; v_now timestamptz;
begin
  if not exists (select 1 from public.training_sessions s where s.id=p_session
    and private.training_poll_is_coach(s.group_id,auth.uid())) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  perform public.activate_training_session_lease(p_session,p_instance,p_token);
  select s.* into v_session from public.training_sessions s where s.id=p_session for update;
  if v_session.version is distinct from p_expected_version then
    raise exception 'La séance a changé. Recharge-la avant de démarrer.' using errcode='40001';
  end if;
  if v_session.trained_on > (clock_timestamp() at time zone 'Europe/Paris')::date then
    raise exception 'Le démarrage est disponible à partir du jour de la séance.' using errcode='22023';
  end if;
  if v_session.attendance_started_at is null then
    select p.* into v_poll from public.training_attendance_polls p where p.session_id=p_session for update;
    v_now:=clock_timestamp();
    if v_poll.session_id is not null and v_poll.initialized_at is null then
      if not exists (select 1 from public.training_results r where r.session_id=p_session) then
        perform set_config('kinball.attendance_prefill',p_session::text,true);
        insert into public.training_attendance(session_id,player_id,present)
        select p_session,r.player_id,true from public.training_attendance_responses r
        join public.coaching_group_players gp on gp.group_id=v_session.group_id and gp.player_id=r.player_id and gp.active
        where r.session_id=p_session and r.availability='present' and not exists (
          select 1 from private.training_attendance_manual_overrides m
          where m.session_id=p_session and m.player_id=r.player_id)
        on conflict (session_id,player_id) do update set present=true;
        perform set_config('kinball.attendance_prefill','',true);
      end if;
      update public.training_attendance_polls set initialized_at=v_now where session_id=p_session;
    end if;
    update public.training_sessions set attendance_started_at=v_now where id=p_session returning * into v_session;
  end if;
  return jsonb_build_object('version',v_session.version,'updated_at',v_session.updated_at,'started_at',v_session.attendance_started_at,
    'present',coalesce((select jsonb_agg(a.player_id) from public.training_attendance a
      where a.session_id=p_session and a.present),'[]'::jsonb));
end $$;

create function public.dismiss_training_attendance_change(p_session uuid,p_player uuid,p_revision timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.training_sessions s where s.id=p_session
      and private.training_poll_is_coach(s.group_id,auth.uid())) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  update public.training_attendance_responses r set dismissed_revision=r.changed_at
  where (r.session_id,r.player_id,r.changed_at)=(p_session,p_player,p_revision);
  if not found then
    raise exception 'La réponse a changé. Actualise le sondage.' using errcode='40001';
  end if;
end $$;

revoke execute on function public.initialize_training_attendance_poll(uuid,uuid,uuid,integer) from authenticated;
revoke all on function public.save_planned_training_session(jsonb),
  public.start_training_attendance_session(uuid,uuid,uuid,integer),
  public.dismiss_training_attendance_change(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_planned_training_session(jsonb),
  public.start_training_attendance_session(uuid,uuid,uuid,integer),
  public.dismiss_training_attendance_change(uuid,uuid,timestamptz) to authenticated;

create or replace function public.manage_training_attendance_poll(p_session uuid, p_open boolean, p_deadline timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_session public.training_sessions;
begin
  select s.* into v_session from public.training_sessions s where s.id=p_session for no key update;
  if not private.training_poll_is_coach(v_session.group_id,auth.uid()) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  if p_open is null or (p_open and (not isfinite(p_deadline) or p_deadline <= clock_timestamp())) then
    raise exception 'Choisis une échéance future' using errcode='22023';
  end if;
  if p_open then
    insert into public.training_attendance_polls(session_id,deadline,initialized_at)
    values (p_session,p_deadline,case when v_session.attendance_started_at is not null then v_session.attendance_started_at
      when not v_session.attendance_planned and (exists (select 1 from public.training_attendance a where a.session_id=p_session and a.present)
      or exists (select 1 from public.training_results r where r.session_id=p_session))
      then clock_timestamp() end)
    on conflict (session_id) do update set is_open=true,deadline=excluded.deadline;
  else
    update public.training_attendance_polls set is_open=false where session_id=p_session;
  end if;
end $$;

create or replace function public.get_training_attendance_poll(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_group uuid;
begin
  select s.group_id into v_group from public.training_sessions s where s.id=p_session;
  if not private.training_poll_is_coach(v_group,auth.uid()) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  return (select jsonb_build_object(
    'is_open',p.is_open and (p.deadline is null or p.deadline>statement_timestamp()),
    'deadline',p.deadline,'initialized_at',p.initialized_at,
    'players',coalesce((select jsonb_agg(jsonb_build_object(
      'id',gp.player_id,'name',pl.display_name,'availability',r.availability,
      'late',r.changed_at>p.initialized_at,
      'revision',r.changed_at,'dismissed',coalesce(r.dismissed_revision=r.changed_at,false),
      'manual',exists (select 1 from private.training_attendance_manual_overrides m
        where m.session_id=p.session_id and m.player_id=gp.player_id)) order by pl.display_name,gp.player_id)
      from public.coaching_group_players gp
      join public.players pl on pl.id=gp.player_id
      left join public.training_attendance_responses r on (r.session_id,r.player_id)=(p.session_id,gp.player_id)
      where gp.group_id=v_group and gp.active),'[]'::jsonb))
    from public.training_attendance_polls p where p.session_id=p_session);
end $$;

-- Keep the two existing views and aliases. Occurrence references are scoped to
-- this payload, like its session and result references, and never expose UUIDs.
create or replace function public.get_training_statistics_dataset(p_group_id uuid,p_view text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_view text:=lower(btrim(coalesce(p_view,'')));
  v_self uuid; v_self_name text; v_dataset jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if v_view not in ('player','staff') then raise exception 'Vue de statistiques invalide' using errcode='22023'; end if;
  if v_view='staff' then
    if not exists (select 1 from public.coaching_group_coaches c where c.group_id=p_group_id and c.user_id=v_uid) then
      raise exception 'Acces entraineur aux statistiques refuse' using errcode='42501';
    end if;
  else
    select a.player_id,p.display_name into v_self,v_self_name
    from public.coaching_player_accounts a
    join public.coaching_group_players gp on (gp.group_id,gp.player_id)=(a.group_id,a.player_id)
    join public.players p on p.id=a.player_id
    where a.group_id=p_group_id and a.user_id=v_uid and gp.active and gp.stats_access='group';
    if v_self is null then raise exception 'Acces aux statistiques du groupe refuse' using errcode='42501'; end if;
  end if;
  if not exists (select 1 from public.coaching_groups g where g.id=p_group_id) then
    raise exception 'Groupe introuvable' using errcode='P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_id::text,0));

  with sessions as (
    select s.id from public.training_sessions s
    where s.group_id=p_group_id
      and s.trained_on <= (statement_timestamp() at time zone 'Europe/Paris')::date
      and (not s.attendance_planned or s.attendance_started_at is not null)
  ), candidates as (
    select gp.player_id from public.coaching_group_players gp where gp.group_id=p_group_id and gp.active
    union select a.player_id from public.training_attendance a join sessions s on s.id=a.session_id
    union select r.player_id from public.training_results r join sessions s on s.id=r.session_id
  ), missing as (
    select c.player_id,row_number() over(order by c.player_id) offset_number from candidates c
    where not exists (select 1 from private.training_stats_player_aliases a where a.group_id=p_group_id and a.player_id=c.player_id)
  ), current_max as (
    select coalesce(max(a.alias_number),0) value from private.training_stats_player_aliases a where a.group_id=p_group_id
  )
  insert into private.training_stats_player_aliases(group_id,player_id,alias_number)
  select p_group_id,m.player_id,cm.value+m.offset_number from missing m cross join current_max cm
  on conflict (group_id,player_id) do nothing;

  with sessions as (
    select s.id,s.trained_on,'session-'||row_number() over(order by s.trained_on,s.id) public_id
    from public.training_sessions s where s.group_id=p_group_id
      and s.trained_on <= (statement_timestamp() at time zone 'Europe/Paris')::date
      and (not s.attendance_planned or s.attendance_started_at is not null)
  ), results as (
    select r.*,row_number() over(order by r.id) public_number from public.training_results r join sessions s on s.id=r.session_id
  ), candidates as (
    select gp.player_id from public.coaching_group_players gp where gp.group_id=p_group_id and gp.active
    union select a.player_id from public.training_attendance a join sessions s on s.id=a.session_id
    union select r.player_id from results r
  ), participants as (
    select a.player_id,a.alias_number,'participant-'||a.alias_number public_id,
      case when v_view='staff' then p.display_name when a.player_id=v_self then v_self_name
        else private.training_stats_alias_label(a.alias_number) end display_name,
      a.player_id=v_self is_me
    from private.training_stats_player_aliases a join candidates c on c.player_id=a.player_id
    join public.players p on p.id=a.player_id where a.group_id=p_group_id
  ), occurrence_ids as (
    select x.session_id,x.occurrence_id from public.training_session_exercises x join sessions s on s.id=x.session_id where x.occurrence_id is not null
    union select r.session_id,r.occurrence_id from results r where r.occurrence_id is not null
  ), occurrences as (
    select o.*,'occurrence-'||row_number() over(order by o.session_id,o.occurrence_id) public_id from occurrence_ids o
  )
  select jsonb_build_object(
    'viewer_role',v_view,
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.public_id,'trained_on',s.trained_on) order by s.trained_on,s.public_id) from sessions s),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.public_id,'display_name',p.display_name,
      'is_me',p.is_me,'ranking_order',p.alias_number) order by p.alias_number) from participants p),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(jsonb_build_object('session_id',s.public_id,'player_id',p.public_id,
      'present',a.present) order by s.public_id,p.alias_number)
      from public.training_attendance a join sessions s on s.id=a.session_id join participants p on p.player_id=a.player_id),'[]'::jsonb),
    'session_exercises',coalesce((select jsonb_agg(jsonb_build_object('session_id',s.public_id,'occurrence_id',o.public_id,
      'exercise_id',e.id,'focus',x.focus,'position',x.position,'exercise',jsonb_build_object('id',e.id,'name',e.name,
        'category',e.category,'category_id',e.category_id,'copied_from_exercise_id',e.copied_from_exercise_id,
        'measurement_type',e.measurement_type)) order by s.public_id,x.position)
      from public.training_session_exercises x join sessions s on s.id=x.session_id join public.exercises e on e.id=x.exercise_id
      left join occurrences o on (o.session_id,o.occurrence_id)=(x.session_id,x.occurrence_id)),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('id','result-'||r.public_number,'session_id',s.public_id,
      'occurrence_id',o.public_id,'exercise_id',r.exercise_id,'player_id',p.public_id,'successes',r.successes,
      'attempts',r.attempts,'numeric_value',r.numeric_value,'created_at',null) order by r.public_number)
      from results r join sessions s on s.id=r.session_id join participants p on p.player_id=r.player_id
      left join occurrences o on (o.session_id,o.occurrence_id)=(r.session_id,r.occurrence_id)),'[]'::jsonb)
  ) into v_dataset;
  return v_dataset;
end $$;
