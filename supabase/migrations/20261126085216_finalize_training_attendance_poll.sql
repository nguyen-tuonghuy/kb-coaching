-- Keep saved forecasts and overrides from earlier versions.
update public.training_attendance_polls p set is_open=false,initialized_at=coalesce(p.initialized_at,s.attendance_started_at)
from public.training_sessions s where s.id=p.session_id and s.attendance_started_at is not null
  and (p.is_open or p.initialized_at is null);

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
    end if;
    -- The same poll lock serializes incoming answers and Discord reservations.
    update public.training_attendance_polls
      set is_open=false,initialized_at=coalesce(initialized_at,v_now) where session_id=p_session;
    update public.training_sessions set attendance_started_at=v_now where id=p_session returning * into v_session;
  end if;
  return jsonb_build_object('version',v_session.version,'updated_at',v_session.updated_at,'started_at',v_session.attendance_started_at,
    'present',coalesce((select jsonb_agg(a.player_id) from public.training_attendance a
      where a.session_id=p_session and a.present),'[]'::jsonb));
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
    insert into public.training_attendance_polls(session_id,deadline,initialized_at)
    values (p_session,p_deadline,case when not v_session.attendance_planned and (exists (select 1 from public.training_attendance a where a.session_id=p_session and a.present)
      or exists (select 1 from public.training_results r where r.session_id=p_session))
      then clock_timestamp() end)
    on conflict (session_id) do update set is_open=true,deadline=excluded.deadline;
  else
    update public.training_attendance_polls set is_open=false where session_id=p_session;
  end if;
end $$;

create or replace function public.answer_training_attendance_poll(p_session uuid, p_availability text, p_player uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_group uuid; v_player uuid; v_poll public.training_attendance_polls;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if p_availability is not null and p_availability not in ('present','absent','unsure') then
    raise exception 'Réponse invalide' using errcode='22023';
  end if;
  select s.group_id into v_group from public.training_sessions s where s.id=p_session;
  if p_player is null then
    select a.player_id into v_player from public.coaching_player_accounts a
      where a.group_id=v_group and a.user_id=auth.uid();
  elsif private.training_poll_is_coach(v_group,auth.uid()) then
    v_player:=p_player;
  end if;
  if not exists (select 1 from public.coaching_group_players gp
      where gp.group_id=v_group and gp.player_id=v_player and gp.active) then
    raise exception 'Accès au groupe refusé' using errcode='42501';
  end if;
  select p.* into v_poll from public.training_attendance_polls p where p.session_id=p_session for update;
  if not found or exists (select 1 from public.training_sessions s
    where s.id=p_session and s.attendance_started_at is not null) or (p_player is null and (not v_poll.is_open
      or v_poll.deadline<=clock_timestamp())) then
    raise exception 'Ce sondage est fermé' using errcode='55000';
  end if;
  if p_availability is null then
    if p_player is null then raise exception 'Réponse requise' using errcode='22023'; end if;
    update public.training_attendance_responses set availability=null,changed_at=clock_timestamp()
      where session_id=p_session and player_id=v_player and availability is not null;
  else
    insert into public.training_attendance_responses(session_id,player_id,availability)
    values(p_session,v_player,p_availability)
    on conflict (session_id,player_id) do update set availability=excluded.availability,changed_at=clock_timestamp()
      where training_attendance_responses.availability is distinct from excluded.availability;
  end if;
end $$;

create or replace function public.get_training_attendance_poll(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_group uuid; v_started_at timestamptz;
begin
  select s.group_id,s.attendance_started_at into v_group,v_started_at from public.training_sessions s where s.id=p_session;
  if not private.training_poll_is_coach(v_group,auth.uid()) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  return (select jsonb_build_object(
    'is_open',v_started_at is null and p.is_open and (p.deadline is null or p.deadline>statement_timestamp()),
    'deadline',p.deadline,'initialized_at',p.initialized_at,'started_at',v_started_at,
    'players',coalesce((select jsonb_agg(jsonb_build_object(
      'id',roster.player_id,'name',pl.display_name,'availability',r.availability,
      'active',gp.active is true) order by pl.display_name,roster.player_id)
      from (
        select member.player_id from public.coaching_group_players member where member.group_id=v_group and member.active
        union select response.player_id from public.training_attendance_responses response where response.session_id=p.session_id
      ) roster
      join public.players pl on pl.id=roster.player_id
      left join public.coaching_group_players gp on gp.group_id=v_group and gp.player_id=roster.player_id
      left join public.training_attendance_responses r on r.session_id=p.session_id and r.player_id=roster.player_id),'[]'::jsonb))
    from public.training_attendance_polls p where p.session_id=p_session);
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
    where s.id=coalesce(new.session_id,old.session_id) and s.attendance_started_at is null and (
      s.attendance_planned or current_setting('kinball.attendance_preparing',true)='true'
      or exists (select 1 from public.training_attendance_polls p where p.session_id=s.id))
    on conflict do nothing;
  end if;
  return null;
end $$;

-- The previous late-reconciliation RPC is no longer part of the public workflow.
revoke execute on function public.dismiss_training_attendance_change(uuid,uuid,timestamptz) from authenticated;
