-- Existing rows are not inferred to be drafts. Previously planned sessions
-- already carry their own marker. New rows can be moved while still untouched.
alter table public.training_sessions add column group_transfer_preparation boolean not null default false;
alter table public.training_sessions alter column group_transfer_preparation set default true;

create function private.training_group_transfer_blocker(p_session public.training_sessions)
returns text language plpgsql stable set search_path='' as $$
begin
  if exists (select 1 from public.training_attendance_polls p where p.session_id=p_session.id) then
    return 'Le groupe est verrouillé : un sondage a déjà été déclenché.';
  end if;
  if p_session.attendance_started_at is not null then
    return 'Le groupe est verrouillé : la séance a démarré.';
  end if;
  if exists (select 1 from public.training_results r where r.session_id=p_session.id) then
    return 'Le groupe est verrouillé : des résultats sont enregistrés.';
  end if;
  if exists (select 1 from public.training_player_collections c where c.session_id=p_session.id)
    or exists (select 1 from public.training_live_periods l where l.session_id=p_session.id)
    or exists (select 1 from public.training_live_events e where e.session_id=p_session.id) then
    return 'Le groupe est verrouillé : une collecte existe pour cette séance.';
  end if;
  if not (p_session.group_transfer_preparation or p_session.attendance_planned) then
    return 'Le groupe est verrouillé : cette séance historique n’est pas identifiée comme une préparation.';
  end if;
  return null;
end $$;
revoke all on function private.training_group_transfer_blocker(public.training_sessions) from public,anon,authenticated;

create function public.get_training_group_transfer_blocker(p_session uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_session public.training_sessions;
begin
  select s.* into v_session from public.training_sessions s where s.id=p_session;
  if not found or not private.training_session_user_authorized(p_session,auth.uid()) then
    raise exception 'Accès à la séance refusé' using errcode='42501';
  end if;
  if not private.training_poll_is_coach(v_session.group_id,auth.uid()) then
    return 'Le changement de groupe est réservé aux entraîneurs du groupe actuel.';
  end if;
  return private.training_group_transfer_blocker(v_session);
end $$;
revoke all on function public.get_training_group_transfer_blocker(uuid) from public,anon,authenticated;
grant execute on function public.get_training_group_transfer_blocker(uuid) to authenticated;

-- The parent row is locked by the transfer RPC before this trigger runs.
-- The normal lease trigger still guards the same update and its child writes.
create function private.transfer_training_group()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text; v_team uuid; v_reason text; v_members integer;
begin
  if new.group_id is not distinct from old.group_id then return new; end if;
  if nullif(current_setting('kinball.training_group_transfer',true),'') is distinct from old.id::text then
    raise exception 'Utilise le transfert de préparation pour changer de groupe' using errcode='42501';
  end if;
  perform 1 from public.coaching_group_coaches c
    where c.user_id=auth.uid() and c.group_id in (old.group_id,new.group_id)
    order by c.group_id for share;
  get diagnostics v_members = row_count;
  if v_members<>2 then raise exception 'Droits entraîneur requis dans les deux groupes' using errcode='42501'; end if;

  v_reason:=private.training_group_transfer_blocker(old);
  if v_reason is not null then raise exception '%',v_reason using errcode='23514'; end if;
  select g.name into v_name from public.coaching_groups g where g.id=new.group_id for share;
  if not found or nullif(btrim(v_name),'') is null then
    raise exception 'Le groupe de destination ne possède pas de nom d’équipe utilisable' using errcode='23514';
  end if;

  -- Groups have no workspace of their own. Keep the session workspace, its
  -- season and globally shared exercises. Resolve the team in that workspace.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.workspace_id::text||':'||v_name,0));
  select t.id into v_team from public.teams t where t.workspace_id=old.workspace_id and t.name=v_name order by t.id limit 1;
  if not found then
    insert into public.teams(workspace_id,name) values(old.workspace_id,v_name) returning id into v_team;
  end if;
  delete from public.training_attendance where session_id=old.id;
  delete from private.training_attendance_manual_overrides where session_id=old.id;
  new.team_id:=v_team;
  return new;
end $$;
revoke all on function private.transfer_training_group() from public,anon,authenticated;
create trigger trg_training_preparation_group_transfer
before update of group_id on public.training_sessions
for each row execute function private.transfer_training_group();

create function public.save_training_preparation_group_transfer(p_save jsonb,p_source_group uuid)
returns table(status text,session_id uuid,version integer,updated_at timestamptz,
  remote_version integer,lease_token uuid,lease_expires_at timestamptz,team_id uuid)
language plpgsql security invoker set search_path='' as $$
declare
  v_session public.training_sessions;
  v_id uuid:=(p_save->>'p_session_id')::uuid;
  v_target uuid:=(p_save->>'p_group_id')::uuid;
  v_save jsonb; v_result record;
begin
  if v_id is null or p_source_group is null or v_target is null or v_target=p_source_group then
    raise exception 'Groupes de transfert invalides' using errcode='22023';
  end if;
  if (p_save->'p_results') is distinct from '[]'::jsonb then
    raise exception 'Conserve les résultats saisis dans le groupe d’origine avant de déplacer la préparation' using errcode='23514';
  end if;
  if jsonb_typeof(p_save->'p_attendance') is distinct from 'array' then
    raise exception 'Liste de présences invalide' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_save->'p_attendance') a
    where a->'present'='true'::jsonb or a->'coach_choice'='true'::jsonb) then
    raise exception 'Enregistre le changement de groupe avant de choisir les présences' using errcode='23514';
  end if;
  perform public.activate_training_session_lease(v_id,(p_save->>'p_editor_instance_id')::uuid,(p_save->>'p_lease_token')::uuid);
  select s.* into v_session from public.training_sessions s where s.id=v_id for update;
  if not found then raise exception 'Séance introuvable' using errcode='P0002'; end if;
  if v_session.group_id is distinct from p_source_group or v_session.version is distinct from (p_save->>'p_expected_version')::int then
    return query select 'conflict'::text,v_id,null::int,v_session.updated_at,v_session.version,null::uuid,null::timestamptz,null::uuid;
    return;
  end if;
  perform set_config('kinball.training_group_transfer',v_id::text,true);
  update public.training_sessions s set group_id=v_target where s.id=v_id returning s.* into v_session;
  if not found then raise exception 'Transfert de séance refusé' using errcode='42501'; end if;
  perform set_config('kinball.training_group_transfer','',true);

  v_save:=p_save||jsonb_build_object('p_team_id',v_session.team_id,'p_expected_version',v_session.version,
    'p_force',false,'p_attendance','[]'::jsonb);
  select r.* into v_result from public.save_training_session_with_attendance_choices(v_save,false) r;
  if not found or v_result.status is distinct from 'saved' then
    raise exception 'La préparation n’a pas été enregistrée avec le transfert' using errcode='23514';
  end if;
  return query select v_result.status,v_result.session_id,v_result.version,v_result.updated_at,
    v_result.remote_version,v_result.lease_token,v_result.lease_expires_at,v_session.team_id;
end $$;
revoke all on function public.save_training_preparation_group_transfer(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_training_preparation_group_transfer(jsonb,uuid) to authenticated;

-- Attach the group observed by the editor to a poll action. Cached clients
-- still use the existing RPC. Both paths serialize with transfers on the parent.
create function public.manage_training_attendance_poll_for_group(p_session uuid,p_open boolean,p_deadline timestamptz,p_group uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_group uuid;
begin
  if not private.training_poll_is_coach(p_group,auth.uid()) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  select s.group_id into v_group from public.training_sessions s where s.id=p_session for no key update;
  if not found or v_group is distinct from p_group then
    raise exception 'Le groupe de la séance a changé. Recharge la séance.' using errcode='40001';
  end if;
  perform public.manage_training_attendance_poll(p_session,p_open,p_deadline);
end $$;
revoke all on function public.manage_training_attendance_poll_for_group(uuid,boolean,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.manage_training_attendance_poll_for_group(uuid,boolean,timestamptz,uuid) to authenticated;

create or replace function public.open_training_player_collection(
  p_session_id uuid,p_occurrence_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_measure text;v_state text;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  -- Serialize with group transfer, then check the current group.
  perform 1 from public.training_sessions s where s.id=p_session_id for no key update;
  if not exists (
    select 1 from public.training_sessions s
    join public.coaching_group_coaches c on c.group_id=s.group_id and c.user_id=v_uid
    where s.id=p_session_id
  ) then raise exception 'Acces entraineur requis' using errcode='42501'; end if;
  select e.measurement_type into v_measure
  from public.training_exercise_occurrences o
  join public.exercises e on e.id=o.exercise_id
  join public.training_session_exercises tse
    on tse.session_id=o.session_id and tse.occurrence_id=o.id and tse.exercise_id=o.exercise_id
  where o.session_id=p_session_id and o.id=p_occurrence_id and o.active and o.collects_stats;
  if not found then raise exception 'Occurrence statistique introuvable' using errcode='P0002'; end if;
  insert into public.training_player_collections(session_id,occurrence_id,measurement_type,opened_by)
  values (p_session_id,p_occurrence_id,v_measure,v_uid)
  on conflict (session_id,occurrence_id) do nothing;
  insert into public.training_player_collection_players(session_id,occurrence_id,player_id,user_id)
  select p_session_id,p_occurrence_id,ta.player_id,case when gp.player_id is not null then a.user_id end
  from public.training_attendance ta
  join public.training_sessions s on s.id=ta.session_id
  left join public.coaching_player_accounts a on a.group_id=s.group_id and a.player_id=ta.player_id
  left join public.coaching_group_players gp on gp.group_id=s.group_id and gp.player_id=ta.player_id and gp.active
  where ta.session_id=p_session_id and ta.present
  on conflict (session_id,occurrence_id,player_id) do nothing;
  select state into v_state from public.training_player_collections
  where session_id=p_session_id and occurrence_id=p_occurrence_id;
  return jsonb_build_object('state',v_state,'measurement_type',v_measure);
end $$;

-- A cached live client may still be looking at the source group. The existing
-- lease serializes live writes with transfers; reject stale group metadata.
create function private.check_training_live_session_group()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.training_sessions s where s.id=new.session_id and s.group_id=new.group_id
  ) then
    raise exception 'Le groupe de la séance a changé. Recharge la collecte.' using errcode='40001';
  end if;
  return new;
end $$;
revoke all on function private.check_training_live_session_group() from public,anon,authenticated;
create trigger trg_training_live_period_group
before insert on public.training_live_periods
for each row execute function private.check_training_live_session_group();
create trigger trg_training_live_event_group
before insert on public.training_live_events
for each row execute function private.check_training_live_session_group();
