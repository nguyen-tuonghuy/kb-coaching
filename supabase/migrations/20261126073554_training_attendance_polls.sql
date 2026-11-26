create table public.training_attendance_polls (
  session_id uuid primary key references public.training_sessions(id) on delete cascade,
  is_open boolean not null default true,
  deadline timestamptz,
  initialized_at timestamptz
);

create table public.training_attendance_responses (
  session_id uuid not null references public.training_attendance_polls(session_id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  availability text check (availability in ('present','absent','unsure')),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (session_id, player_id)
);
create index on public.training_attendance_responses(player_id);

create table private.training_attendance_discord_deliveries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_attendance_polls(session_id) on delete cascade,
  reminder boolean not null,
  state text not null default 'pending' check (state in ('pending','sent','unknown','rejected')),
  created_at timestamptz not null default clock_timestamp()
);
create index on private.training_attendance_discord_deliveries(session_id, created_at desc);

alter table public.training_attendance_polls enable row level security;
alter table public.training_attendance_responses enable row level security;
alter table private.training_attendance_discord_deliveries enable row level security;
revoke all on public.training_attendance_polls, public.training_attendance_responses from public, anon, authenticated;
revoke all on private.training_attendance_discord_deliveries from public, anon, authenticated;

create function private.training_poll_is_coach(p_group uuid, p_user uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (select 1 from public.coaching_group_coaches c
    where c.group_id=p_group and c.user_id=p_user)
$$;
revoke all on function private.training_poll_is_coach(uuid,uuid) from public, anon, authenticated;

create function public.manage_training_attendance_poll(p_session uuid, p_open boolean, p_deadline timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_group uuid;
begin
  select s.group_id into v_group from public.training_sessions s where s.id=p_session for no key update;
  if not private.training_poll_is_coach(v_group,auth.uid()) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  if p_open is null or (p_open and (not isfinite(p_deadline) or p_deadline <= clock_timestamp())) then
    raise exception 'Choisis une échéance future' using errcode='22023';
  end if;
  if p_open then
    insert into public.training_attendance_polls(session_id,deadline,initialized_at)
    values (p_session,p_deadline,case when
      exists (select 1 from public.training_attendance a where a.session_id=p_session and a.present)
      or exists (select 1 from public.training_results r where r.session_id=p_session)
      then clock_timestamp() end)
    on conflict (session_id) do update set is_open=true,deadline=excluded.deadline;
  else
    update public.training_attendance_polls set is_open=false where session_id=p_session;
  end if;
end $$;

create function public.get_training_attendance_poll(p_session uuid)
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
      'late',r.changed_at>p.initialized_at) order by pl.display_name,gp.player_id)
      from public.coaching_group_players gp
      join public.players pl on pl.id=gp.player_id
      left join public.training_attendance_responses r on (r.session_id,r.player_id)=(p.session_id,gp.player_id)
      where gp.group_id=v_group and gp.active),'[]'::jsonb))
    from public.training_attendance_polls p where p.session_id=p_session);
end $$;

create function public.list_my_training_attendance_polls(p_group uuid, p_session uuid default null)
returns table(session_id uuid, trained_on date, label text, is_open boolean, deadline timestamptz, availability text)
language sql stable security definer set search_path='' as $$
  select s.id,s.trained_on,s.label,p.is_open and (p.deadline is null or p.deadline>statement_timestamp()),
    p.deadline,r.availability
  from public.coaching_player_accounts a
  join public.coaching_group_players gp on (gp.group_id,gp.player_id)=(a.group_id,a.player_id) and gp.active
  join public.training_sessions s on s.group_id=a.group_id
  join public.training_attendance_polls p on p.session_id=s.id
  left join public.training_attendance_responses r on (r.session_id,r.player_id)=(p.session_id,a.player_id)
  where a.user_id=auth.uid() and a.group_id=p_group
    and (s.trained_on >= current_date or s.id=p_session)
  order by (s.id is not distinct from p_session) desc,s.trained_on,s.id
  limit 50
$$;

create function public.answer_training_attendance_poll(p_session uuid, p_availability text, p_player uuid default null)
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
  if not found or (p_player is null and (not v_poll.is_open
      or v_poll.deadline<=clock_timestamp())) then
    raise exception 'Ce sondage est fermé' using errcode='55000';
  end if;
  if p_availability is null then
    if p_player is null then raise exception 'Réponse requise' using errcode='22023'; end if;
    -- Conserve la date de retrait pour signaler un écart après initialisation.
    update public.training_attendance_responses set availability=null,changed_at=clock_timestamp()
      where session_id=p_session and player_id=v_player and availability is not null;
  else
    insert into public.training_attendance_responses(session_id,player_id,availability)
    values(p_session,v_player,p_availability)
    on conflict (session_id,player_id) do update set availability=excluded.availability,changed_at=clock_timestamp()
      where training_attendance_responses.availability is distinct from excluded.availability;
  end if;
end $$;

-- Toute modification effective existante prend le pas sur un préremplissage.
-- Les insertions de cases non cochées lors de la création ne comptent pas.
create function private.mark_training_attendance_initialized()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (tg_op='INSERT' and new.present) or
     (tg_op='UPDATE' and new.present is distinct from old.present) or
     (tg_op='DELETE' and old.present) then
    update public.training_attendance_polls set initialized_at=clock_timestamp()
      where session_id=coalesce(new.session_id,old.session_id) and initialized_at is null;
  end if;
  return null;
end $$;
revoke all on function private.mark_training_attendance_initialized() from public, anon, authenticated;
create trigger training_attendance_mark_initialized after insert or update or delete on public.training_attendance
  for each row execute function private.mark_training_attendance_initialized();

create function public.initialize_training_attendance_poll(
  p_session uuid, p_instance uuid, p_token uuid, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.training_sessions; v_initialized timestamptz;
begin
  if not exists (select 1 from public.training_sessions s where s.id=p_session
      and private.training_poll_is_coach(s.group_id,auth.uid())) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  perform public.activate_training_session_lease(p_session,p_instance,p_token);
  select s.* into v_session from public.training_sessions s where s.id=p_session for update;
  if not found or v_session.version is distinct from p_expected_version then
    raise exception 'La séance a changé. Recharge-la avant de préremplir les présences.' using errcode='40001';
  end if;
  select p.initialized_at into v_initialized from public.training_attendance_polls p
    where p.session_id=p_session for update;
  if not found then raise exception 'Sondage introuvable' using errcode='22023'; end if;
  if v_initialized is null then
    update public.training_attendance_polls set initialized_at=clock_timestamp() where session_id=p_session;
    if not exists (select 1 from public.training_attendance a where a.session_id=p_session and a.present)
       and not exists (select 1 from public.training_results r where r.session_id=p_session) then
      insert into public.training_attendance(session_id,player_id,present)
      select p_session,r.player_id,true from public.training_attendance_responses r
      join public.coaching_group_players gp on gp.group_id=v_session.group_id and gp.player_id=r.player_id and gp.active
      where r.session_id=p_session and r.availability='present'
      on conflict (session_id,player_id) do update set present=true;
    end if;
    -- Même une initialisation vide invalide les snapshots antérieurs.
    update public.training_sessions set updated_at=clock_timestamp() where id=p_session returning * into v_session;
  end if;
  return jsonb_build_object('version',v_session.version,'updated_at',v_session.updated_at,
    'present',coalesce((select jsonb_agg(a.player_id) from public.training_attendance a
      where a.session_id=p_session and a.present),'[]'::jsonb));
end $$;

revoke all on function public.manage_training_attendance_poll(uuid,boolean,timestamptz),
  public.get_training_attendance_poll(uuid), public.list_my_training_attendance_polls(uuid,uuid),
  public.answer_training_attendance_poll(uuid,text,uuid),
  public.initialize_training_attendance_poll(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.manage_training_attendance_poll(uuid,boolean,timestamptz),
  public.get_training_attendance_poll(uuid), public.list_my_training_attendance_polls(uuid,uuid),
  public.answer_training_attendance_poll(uuid,text,uuid),
  public.initialize_training_attendance_poll(uuid,uuid,uuid,integer) to authenticated;

-- Le verrou du sondage sérialise les demandes Discord et la fermeture.
create function public.reserve_training_attendance_discord(
  p_session uuid, p_group uuid, p_user uuid, p_reminder boolean, p_configured boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_poll public.training_attendance_polls; v_session public.training_sessions; v_id uuid;
begin
  select s.* into v_session from public.training_sessions s where s.id=p_session and s.group_id=p_group;
  if not found or not private.training_poll_is_coach(p_group,p_user) then
    raise exception 'Accès entraîneur requis' using errcode='42501';
  end if;
  if p_configured is distinct from true then
    raise exception 'Aucun webhook Discord valide n’est configuré pour ce groupe' using errcode='55000';
  end if;
  select p.* into v_poll from public.training_attendance_polls p where p.session_id=p_session for update;
  if not found or not v_poll.is_open or v_poll.deadline<=clock_timestamp() then
    raise exception 'Ce sondage est fermé' using errcode='55000';
  end if;
  if p_reminder and not exists (
    select 1 from private.training_attendance_discord_deliveries d where d.session_id=p_session
      and not d.reminder and d.state='sent'
  ) then raise exception 'Publie le sondage avant de le relancer' using errcode='55000'; end if;
  if exists (select 1 from private.training_attendance_discord_deliveries d where d.session_id=p_session
    and d.state<>'rejected' and (d.state in ('pending','unknown')
      or (not p_reminder and not d.reminder)
      or (p_reminder and d.reminder and d.created_at>clock_timestamp()-interval '10 minutes'))
  ) then return null; end if;
  insert into private.training_attendance_discord_deliveries(session_id,reminder)
    values(p_session,p_reminder) returning id into v_id;
  return jsonb_build_object('id',v_id,'label',v_session.label,'trained_on',v_session.trained_on,'deadline',v_poll.deadline);
end $$;

create function public.finish_training_attendance_discord(p_id uuid, p_state text)
returns void language sql security definer set search_path='' as $$
  update private.training_attendance_discord_deliveries set state=p_state
    where id=p_id and state='pending' and p_state in ('sent','unknown','rejected')
$$;

revoke all on function public.reserve_training_attendance_discord(uuid,uuid,uuid,boolean,boolean),
  public.finish_training_attendance_discord(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_training_attendance_discord(uuid,uuid,uuid,boolean,boolean),
  public.finish_training_attendance_discord(uuid,text) to service_role;
