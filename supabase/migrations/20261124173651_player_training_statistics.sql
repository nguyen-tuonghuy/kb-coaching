-- Statistiques d'entrainement anonymisees pour l'espace joueur.
-- Les calculs restent executes par le client partage, mais aucun identifiant
-- nominatif d'un autre joueur n'est expose dans le jeu de donnees joueur.

create table private.training_stats_player_aliases (
  group_id uuid not null references public.coaching_groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  alias_number integer not null check (alias_number > 0),
  created_at timestamptz not null default now(),
  primary key (group_id, player_id),
  unique (group_id, alias_number)
);

revoke all on private.training_stats_player_aliases from public, anon, authenticated;

create or replace function private.training_stats_alias_label(p_number integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_number integer := p_number;
  v_label text := '';
begin
  if v_number is null or v_number < 1 then return 'Joueur'; end if;
  while v_number > 0 loop
    v_number := v_number - 1;
    v_label := chr(65 + (v_number % 26)) || v_label;
    v_number := v_number / 26;
  end loop;
  return 'Joueur ' || v_label;
end $$;

create or replace function private.can_read_training_stats_raw(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.training_sessions s
    where s.id = p_session_id
      and (
        exists (
          select 1 from public.coaching_group_coaches c
          where c.group_id = s.group_id and c.user_id = auth.uid()
        )
        or exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = s.workspace_id and wm.user_id = auth.uid()
            and wm.role in ('owner', 'admin', 'coach')
        )
      )
  );
$$;

create or replace function private.can_read_group_player_raw(p_group_id uuid, p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coaching_group_coaches c
    where c.group_id = p_group_id and c.user_id = auth.uid()
  ) or exists (
    select 1
    from public.players p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = p_player_id and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin', 'coach')
  ) or exists (
    select 1 from public.coaching_player_accounts a
    where a.group_id = p_group_id and a.player_id = p_player_id and a.user_id = auth.uid()
  );
$$;

create or replace function private.can_read_player_raw(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coaching_group_players gp
    join public.coaching_group_coaches c on c.group_id = gp.group_id
    where gp.player_id = p_player_id and c.user_id = auth.uid()
  ) or exists (
    select 1
    from public.players p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = p_player_id and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin', 'coach')
  ) or exists (
    select 1
    from public.training_attendance ta
    join public.training_sessions s on s.id = ta.session_id
    join public.coaching_group_coaches c on c.group_id = s.group_id
    where ta.player_id = p_player_id and c.user_id = auth.uid()
  ) or exists (
    select 1
    from public.training_results tr
    join public.training_sessions s on s.id = tr.session_id
    join public.coaching_group_coaches c on c.group_id = s.group_id
    where tr.player_id = p_player_id and c.user_id = auth.uid()
  ) or exists (
    select 1 from public.coaching_player_accounts a
    where a.player_id = p_player_id and a.user_id = auth.uid()
  );
$$;

revoke all on function private.training_stats_alias_label(integer) from public, anon, authenticated;
revoke all on function private.can_read_training_stats_raw(uuid) from public, anon, authenticated;
revoke all on function private.can_read_group_player_raw(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_read_player_raw(uuid) from public, anon, authenticated;
grant execute on function private.can_read_training_stats_raw(uuid) to authenticated;
grant execute on function private.can_read_group_player_raw(uuid, uuid) to authenticated;
grant execute on function private.can_read_player_raw(uuid) to authenticated;

alter table public.training_sessions enable row level security;
alter table public.training_attendance enable row level security;
alter table public.training_session_exercises enable row level security;
alter table public.training_results enable row level security;
alter table public.coaching_group_players enable row level security;
alter table public.players enable row level security;

create policy training_sessions_raw_staff_only
on public.training_sessions as restrictive for select to authenticated
using (private.can_read_training_stats_raw(id));

create policy training_attendance_raw_staff_only
on public.training_attendance as restrictive for select to authenticated
using (private.can_read_training_stats_raw(session_id));

create policy training_session_exercises_raw_staff_only
on public.training_session_exercises as restrictive for select to authenticated
using (private.can_read_training_stats_raw(session_id));

create policy training_results_raw_staff_only
on public.training_results as restrictive for select to authenticated
using (private.can_read_training_stats_raw(session_id));

create policy coaching_group_players_identity_guard
on public.coaching_group_players as restrictive for select to authenticated
using (private.can_read_group_player_raw(group_id, player_id));

create policy players_identity_guard
on public.players as restrictive for select to authenticated
using (private.can_read_player_raw(id));

create or replace function public.get_training_statistics_dataset(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := false;
  v_self_player_id uuid;
  v_self_name text;
  v_dataset jsonb;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.coaching_group_coaches c
    where c.group_id = p_group_id and c.user_id = v_uid
  ) into v_is_staff;

  if not v_is_staff then
    select a.player_id, p.display_name
      into v_self_player_id, v_self_name
    from public.coaching_player_accounts a
    join public.coaching_group_players gp
      on gp.group_id = a.group_id and gp.player_id = a.player_id
    join public.players p on p.id = a.player_id
    where a.group_id = p_group_id
      and a.user_id = v_uid
      and gp.active = true
      and gp.stats_access = 'group';

    if v_self_player_id is null then
      raise exception 'Acces aux statistiques du groupe refuse' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from public.coaching_groups g where g.id = p_group_id) then
    raise exception 'Groupe introuvable' using errcode = 'P0002';
  end if;
  -- Serialise uniquement l'attribution des alias, sans verrouiller le groupe.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_id::text, 0));

  with candidates as (
    select gp.player_id
    from public.coaching_group_players gp
    where gp.group_id = p_group_id and gp.active = true
    union
    select ta.player_id
    from public.training_attendance ta
    join public.training_sessions s on s.id = ta.session_id
    where s.group_id = p_group_id
    union
    select tr.player_id
    from public.training_results tr
    join public.training_sessions s on s.id = tr.session_id
    where s.group_id = p_group_id
  ), missing as (
    select c.player_id, row_number() over (order by c.player_id) as offset_number
    from candidates c
    where not exists (
      select 1 from private.training_stats_player_aliases a
      where a.group_id = p_group_id and a.player_id = c.player_id
    )
  ), current_max as (
    select coalesce(max(a.alias_number), 0) as value
    from private.training_stats_player_aliases a
    where a.group_id = p_group_id
  )
  insert into private.training_stats_player_aliases(group_id, player_id, alias_number)
  select p_group_id, m.player_id, cm.value + m.offset_number
  from missing m cross join current_max cm
  on conflict (group_id, player_id) do nothing;

  with session_rows as (
    select s.id, s.trained_on,
      'session-' || row_number() over (order by s.trained_on, s.id) as public_id
    from public.training_sessions s
    where s.group_id = p_group_id
  ), candidate_players as (
    select gp.player_id
    from public.coaching_group_players gp
    where gp.group_id = p_group_id and gp.active = true
    union
    select ta.player_id
    from public.training_attendance ta
    join public.training_sessions s on s.id = ta.session_id
    where s.group_id = p_group_id
    union
    select tr.player_id
    from public.training_results tr
    join public.training_sessions s on s.id = tr.session_id
    where s.group_id = p_group_id
  ), participant_rows as (
    select a.player_id, a.alias_number,
      'participant-' || a.alias_number as public_id,
      case
        when v_is_staff then p.display_name
        when a.player_id = v_self_player_id then v_self_name
        else private.training_stats_alias_label(a.alias_number)
      end as display_name,
      a.player_id = v_self_player_id as is_me,
      a.alias_number as ranking_order
    from private.training_stats_player_aliases a
    join candidate_players cp on cp.player_id = a.player_id
    join public.players p on p.id = a.player_id
    where a.group_id = p_group_id
  ), result_rows as (
    select tr.*, row_number() over (order by tr.id) as public_number
    from public.training_results tr
    join public.training_sessions s on s.id = tr.session_id
    where s.group_id = p_group_id
  )
  select jsonb_build_object(
    'viewer_role', case when v_is_staff then 'staff' else 'player' end,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sr.public_id,
        'trained_on', sr.trained_on
      ) order by sr.trained_on, sr.public_id)
      from session_rows sr
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.public_id,
        'display_name', pr.display_name,
        'is_me', pr.is_me,
        'ranking_order', pr.ranking_order
      ) order by pr.alias_number)
      from participant_rows pr
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', sr.public_id,
        'player_id', pr.public_id,
        'present', ta.present
      ) order by sr.public_id, pr.alias_number)
      from public.training_attendance ta
      join session_rows sr on sr.id = ta.session_id
      join participant_rows pr on pr.player_id = ta.player_id
    ), '[]'::jsonb),
    'session_exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', sr.public_id,
        'exercise_id', e.id,
        'focus', tse.focus,
        'position', tse.position,
        'exercise', jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'category', e.category,
          'category_id', e.category_id,
          'copied_from_exercise_id', e.copied_from_exercise_id,
          'measurement_type', e.measurement_type
        )
      ) order by sr.public_id, tse.position)
      from public.training_session_exercises tse
      join session_rows sr on sr.id = tse.session_id
      join public.exercises e on e.id = tse.exercise_id
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'result-' || rr.public_number,
        'session_id', sr.public_id,
        'exercise_id', rr.exercise_id,
        'player_id', pr.public_id,
        'successes', rr.successes,
        'attempts', rr.attempts,
        'numeric_value', rr.numeric_value,
        'created_at', null
      ) order by rr.public_number)
      from result_rows rr
      join session_rows sr on sr.id = rr.session_id
      join participant_rows pr on pr.player_id = rr.player_id
    ), '[]'::jsonb)
  ) into v_dataset;

  return v_dataset;
end $$;

revoke all on function public.get_training_statistics_dataset(uuid) from public, anon;
grant execute on function public.get_training_statistics_dataset(uuid) to authenticated;
