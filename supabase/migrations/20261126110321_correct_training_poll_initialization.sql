-- Existing public save RPCs stay usable by cached clients and training-live.
-- The editor provides provenance for the validated attendance rows it saves.
create function public.save_training_session_with_attendance_choices(p_save jsonb,p_planned boolean)
returns table(status text,session_id uuid,version integer,updated_at timestamptz,
  remote_version integer,lease_token uuid,lease_expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_save->'p_attendance') is distinct from 'array' or p_planned is null
    or (p_planned and p_save->>'p_session_id' is not null) then
    raise exception 'Document de séance invalide' using errcode='22023';
  end if;
  perform set_config('kinball.attendance_choices',(
    select coalesce(jsonb_agg(a->>'player_id'),'[]'::jsonb)::text
    from jsonb_array_elements(p_save->'p_attendance') a where a->'coach_choice'='true'::jsonb
  ),true);
  if p_planned then
    return query select * from public.save_planned_training_session(p_save);
  else
    return query select * from public.save_training_session_player_results(
      (p_save->>'p_session_id')::uuid,(p_save->>'p_expected_version')::integer,
      (p_save->>'p_editor_instance_id')::uuid,(p_save->>'p_lease_token')::uuid,
      (p_save->>'p_workspace_id')::uuid,(p_save->>'p_group_id')::uuid,(p_save->>'p_team_id')::uuid,
      (p_save->>'p_trained_on')::date,p_save->>'p_label',p_save->>'p_theme',
      (p_save->>'p_duration_minutes')::integer,p_save->>'p_notes',p_save->'p_attendance',
      p_save->'p_exercises',p_save->'p_results',(p_save->>'p_force')::boolean,p_save->'p_occurrences');
  end if;
  perform set_config('kinball.attendance_choices','',true);
end $$;

revoke all on function public.save_training_session_with_attendance_choices(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_training_session_with_attendance_choices(jsonb,boolean) to authenticated;

create or replace function private.mark_training_attendance_initialized()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_session uuid:=coalesce(new.session_id,old.session_id);
  v_player uuid:=coalesce(new.player_id,old.player_id);
  v_choices text:=nullif(current_setting('kinball.attendance_choices',true),'');
begin
  if current_setting('kinball.attendance_prefill',true)=v_session::text then return null; end if;
  if v_choices is not null then
    if tg_op='DELETE' or not (v_choices::jsonb ? v_player::text) then return null; end if;
  else
    -- For cached clients, an inserted positive may be merely a default.
    -- Preserve their edits of existing values when a poll or plan is known.
    if not ((tg_op='UPDATE' and new.present is distinct from old.present)
         or (tg_op='DELETE' and old.present)) then return null; end if;
    if not exists (select 1 from public.training_sessions s where s.id=v_session and
        (s.attendance_planned or exists (select 1 from public.training_attendance_polls p where p.session_id=s.id))) then
      return null;
    end if;
  end if;
  insert into private.training_attendance_manual_overrides(session_id,player_id)
  select s.id,v_player from public.training_sessions s where s.id=v_session and s.attendance_started_at is null
  on conflict do nothing;
  return null;
end $$;

create or replace function public.manage_training_attendance_poll(p_session uuid, p_open boolean, p_deadline timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_session public.training_sessions;
begin
  select s.* into v_session from public.training_sessions s where s.id=p_session for no key update;
  if not private.training_poll_is_coach(v_session.group_id,auth.uid()) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  if p_open and v_session.attendance_started_at is not null then
    raise exception 'Le sondage est définitivement fermé : la séance a démarré' using errcode='55000';
  end if;
  if p_open is null or (p_open and (not isfinite(p_deadline) or p_deadline <= clock_timestamp())) then
    raise exception 'Choisis une échéance future' using errcode='22023';
  end if;
  if p_open then
    insert into public.training_attendance_polls(session_id,deadline) values (p_session,p_deadline)
    on conflict (session_id) do update set is_open=true,deadline=excluded.deadline;
  else
    update public.training_attendance_polls set is_open=false where session_id=p_session;
  end if;
end $$;

create or replace function public.start_training_attendance_session(
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
    -- Earlier clients could set initialized_at at opening. Only a recorded
    -- start is authoritative. Preserve rosters already used by a collection.
    if v_poll.session_id is not null
      and not exists (select 1 from public.training_results r where r.session_id=p_session)
      and not exists (select 1 from public.training_live_periods l where l.session_id=p_session)
      and not exists (select 1 from public.training_player_collections c where c.session_id=p_session) then
      perform set_config('kinball.attendance_prefill',p_session::text,true);
      with predicted as (
        select r.player_id from public.training_attendance_responses r
        join public.coaching_group_players gp
          on gp.group_id=v_session.group_id and gp.player_id=r.player_id and gp.active
        where r.session_id=p_session and r.availability='present'
      ), clear_defaults as (
        update public.training_attendance a set present=false
        where a.session_id=p_session and a.present
          and not exists (select 1 from predicted r where r.player_id=a.player_id)
          and not exists (select 1 from private.training_attendance_manual_overrides m
            where m.session_id=p_session and m.player_id=a.player_id)
      )
      insert into public.training_attendance(session_id,player_id,present)
      select p_session,r.player_id,true from predicted r
      where not exists (select 1 from private.training_attendance_manual_overrides m
        where m.session_id=p_session and m.player_id=r.player_id)
      on conflict (session_id,player_id) do update set present=true
        where not training_attendance.present;
      perform set_config('kinball.attendance_prefill','',true);
    end if;
    -- The same poll lock serializes incoming answers and Discord reservations.
    update public.training_attendance_polls
      set is_open=false,initialized_at=v_now where session_id=p_session;
    update public.training_sessions set attendance_started_at=v_now where id=p_session returning * into v_session;
  end if;
  return jsonb_build_object('version',v_session.version,'updated_at',v_session.updated_at,'started_at',v_session.attendance_started_at,
    'present',coalesce((select jsonb_agg(a.player_id) from public.training_attendance a
      where a.session_id=p_session and a.present),'[]'::jsonb));
end $$;

