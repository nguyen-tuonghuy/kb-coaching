create index coaching_group_selections_created_by_idx
  on public.coaching_group_selections(created_by);

create index coaching_group_selection_players_group_selection_idx
  on public.coaching_group_selection_players(group_id, selection_id);

create index matches_group_selection_idx
  on public.matches(group_id, selection_id);
