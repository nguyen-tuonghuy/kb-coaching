with target_group as (
  select id
  from public.coaching_groups
  where name = 'EDF H 2025-2027'
  order by created_at
  limit 1
),
cde_dates as (
  select min(m.played_on) as starts_on, max(m.played_on) as ends_on
  from public.matches m
  join public.match_types mt on mt.id = m.match_type_id
  join target_group g on g.id = m.group_id
  where mt.name = 'CDE 2026'
)
insert into public.coaching_group_selections (
  group_id, name, selection_type, starts_on, ends_on
)
select g.id, 'CDE 2026', 'competition', d.starts_on, d.ends_on
from target_group g
cross join cde_dates d;

insert into public.coaching_group_selection_players (
  selection_id, group_id, player_id
)
select distinct s.id, s.group_id, mp.player_id
from public.coaching_group_selections s
join public.matches m on m.group_id = s.group_id
join public.match_types mt on mt.id = m.match_type_id
join public.match_players mp on mp.match_id = m.id
join public.coaching_group_players gp
  on gp.group_id = s.group_id and gp.player_id = mp.player_id
where s.name = 'CDE 2026'
  and mt.name = 'CDE 2026';

update public.matches m
set selection_id = s.id
from public.coaching_group_selections s,
     public.match_types mt
where m.match_type_id = mt.id
  and mt.name = 'CDE 2026'
  and s.group_id = m.group_id
  and s.name = 'CDE 2026';
