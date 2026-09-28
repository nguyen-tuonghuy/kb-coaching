drop policy "coaches read group selections" on public.coaching_group_selections;
drop policy "group stats viewers read group selections" on public.coaching_group_selections;
create policy "authorized users read group selections"
on public.coaching_group_selections for select
to authenticated
using (private.is_group_coach(group_id) or private.can_view_group_stats(group_id));

drop policy "coaches read group selection players" on public.coaching_group_selection_players;
drop policy "group stats viewers read group selection players" on public.coaching_group_selection_players;
create policy "authorized users read group selection players"
on public.coaching_group_selection_players for select
to authenticated
using (private.is_group_coach(group_id) or private.can_view_group_stats(group_id));
