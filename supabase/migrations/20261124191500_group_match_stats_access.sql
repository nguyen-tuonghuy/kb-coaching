alter table public.coaching_group_players add column if not exists match_stats_access boolean not null default false;

create or replace function private.can_read_group_match_stats_raw(p_group_id uuid, p_workspace_id uuid)
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
    from public.workspace_members wm
    where p_workspace_id is not null
      and wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin', 'coach')
  ) or exists (
    select 1
    from public.coaching_player_accounts a
    join public.coaching_group_players gp
      on gp.group_id = p_group_id and gp.player_id = a.player_id
    where a.user_id = auth.uid()
      and a.group_id = p_group_id
      and gp.active = true
      and gp.match_stats_access = true
  );
$$;

create or replace function private.can_read_match_stats_raw(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and private.can_read_group_match_stats_raw(m.group_id, m.workspace_id)
  );
$$;

create or replace function private.can_read_match_event_stats_raw(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.match_events e
    where e.id = p_event_id
      and private.can_read_match_stats_raw(e.match_id)
  );
$$;

create or replace function private.can_read_match_team_raw(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matches m
    where (m.team_id = p_team_id
       or m.opponent_team_1_id = p_team_id
       or m.opponent_team_2_id = p_team_id)
      and private.can_read_group_match_stats_raw(m.group_id, m.workspace_id)
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
  ) or exists (
    select 1
    from public.coaching_player_accounts a
    join public.coaching_group_players own
      on own.group_id = p_group_id and own.player_id = a.player_id
    where a.user_id = auth.uid()
      and own.active = true
      and own.match_stats_access = true
      and exists (
        select 1 from public.coaching_group_players target
        where target.group_id = p_group_id
          and target.player_id = p_player_id
          and target.active = true
      )
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
  ) or exists (
    select 1
    from public.coaching_player_accounts a
    join public.coaching_group_players own
      on own.group_id = a.group_id and own.player_id = a.player_id
    join public.coaching_group_players gp
      on gp.group_id = a.group_id
    where a.user_id = auth.uid()
      and gp.player_id = p_player_id
      and gp.active = true
      and own.active = true
      and own.match_stats_access = true
  );
$$;

create or replace function public.get_my_player_match_stats_access()
returns table(group_id uuid, enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.group_id, coalesce(bool_or(gp.match_stats_access), false) as enabled
  from public.coaching_player_accounts a
  left join public.coaching_group_players gp
    on gp.group_id = a.group_id and gp.player_id = a.player_id and gp.active = true
  where a.user_id = auth.uid()
  group by a.group_id;
$$;

revoke all on function private.can_read_group_match_stats_raw(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_read_match_stats_raw(uuid) from public, anon, authenticated;
revoke all on function private.can_read_match_event_stats_raw(uuid) from public, anon, authenticated;
revoke all on function private.can_read_match_team_raw(uuid) from public, anon, authenticated;
revoke all on function private.can_read_group_player_raw(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_read_player_raw(uuid) from public, anon, authenticated;
revoke all on function public.get_my_player_match_stats_access() from public, anon, authenticated;

grant execute on function private.can_read_group_match_stats_raw(uuid, uuid) to authenticated;
grant execute on function private.can_read_match_stats_raw(uuid) to authenticated;
grant execute on function private.can_read_match_event_stats_raw(uuid) to authenticated;
grant execute on function private.can_read_match_team_raw(uuid) to authenticated;
grant execute on function private.can_read_group_player_raw(uuid, uuid) to authenticated;
grant execute on function private.can_read_player_raw(uuid) to authenticated;
grant execute on function public.get_my_player_match_stats_access() to authenticated;

alter table public.matches enable row level security;
alter table public.match_events enable row level security;
alter table public.match_players enable row level security;
alter table public.match_event_attributions enable row level security;
alter table public.match_event_lineup enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.coaching_group_players enable row level security;

drop policy if exists matches_match_stats_viewers_read on public.matches;
create policy matches_match_stats_viewers_read
on public.matches as permissive for select to authenticated
using (private.can_read_group_match_stats_raw(group_id, workspace_id));

drop policy if exists match_events_match_stats_viewers_read on public.match_events;
create policy match_events_match_stats_viewers_read
on public.match_events as permissive for select to authenticated
using (private.can_read_match_stats_raw(match_id));

drop policy if exists match_players_match_stats_viewers_read on public.match_players;
create policy match_players_match_stats_viewers_read
on public.match_players as permissive for select to authenticated
using (private.can_read_match_stats_raw(match_id));

drop policy if exists match_event_attributions_match_stats_viewers_read on public.match_event_attributions;
create policy match_event_attributions_match_stats_viewers_read
on public.match_event_attributions as permissive for select to authenticated
using (private.can_read_match_event_stats_raw(event_id));

drop policy if exists match_event_lineup_match_stats_viewers_read on public.match_event_lineup;
create policy match_event_lineup_match_stats_viewers_read
on public.match_event_lineup as permissive for select to authenticated
using (private.can_read_match_event_stats_raw(event_id));

drop policy if exists teams_match_stats_viewers_read on public.teams;
create policy teams_match_stats_viewers_read
on public.teams as permissive for select to authenticated
using (private.can_read_match_team_raw(id));

drop policy if exists players_match_stats_viewers_read on public.players;
create policy players_match_stats_viewers_read
on public.players as permissive for select to authenticated
using (private.can_read_player_raw(id));

drop policy if exists coaching_group_players_match_stats_viewers_read on public.coaching_group_players;
create policy coaching_group_players_match_stats_viewers_read
on public.coaching_group_players as permissive for select to authenticated
using (private.can_read_group_player_raw(group_id, player_id));

drop policy if exists matches_group_match_stats_guard on public.matches;
create policy matches_group_match_stats_guard
on public.matches as restrictive for select to authenticated
using (private.can_read_group_match_stats_raw(group_id, workspace_id));

drop policy if exists match_events_group_match_stats_guard on public.match_events;
create policy match_events_group_match_stats_guard
on public.match_events as restrictive for select to authenticated
using (private.can_read_match_stats_raw(match_id));

drop policy if exists match_players_group_match_stats_guard on public.match_players;
create policy match_players_group_match_stats_guard
on public.match_players as restrictive for select to authenticated
using (private.can_read_match_stats_raw(match_id));

drop policy if exists match_event_attributions_group_match_stats_guard on public.match_event_attributions;
create policy match_event_attributions_group_match_stats_guard
on public.match_event_attributions as restrictive for select to authenticated
using (private.can_read_match_event_stats_raw(event_id));

drop policy if exists match_event_lineup_group_match_stats_guard on public.match_event_lineup;
create policy match_event_lineup_group_match_stats_guard
on public.match_event_lineup as restrictive for select to authenticated
using (private.can_read_match_event_stats_raw(event_id));
