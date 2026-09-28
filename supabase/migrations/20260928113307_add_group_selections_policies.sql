create policy "coaches read group selections"
on public.coaching_group_selections for select
to authenticated
using (private.is_group_coach(group_id));

create policy "group stats viewers read group selections"
on public.coaching_group_selections for select
to authenticated
using (private.can_view_group_stats(group_id));

create policy "coaches insert group selections"
on public.coaching_group_selections for insert
to authenticated
with check (private.is_group_coach(group_id));

create policy "coaches update group selections"
on public.coaching_group_selections for update
to authenticated
using (private.is_group_coach(group_id))
with check (private.is_group_coach(group_id));

create policy "coaches delete group selections"
on public.coaching_group_selections for delete
to authenticated
using (private.is_group_coach(group_id));

create policy "coaches read group selection players"
on public.coaching_group_selection_players for select
to authenticated
using (private.is_group_coach(group_id));

create policy "group stats viewers read group selection players"
on public.coaching_group_selection_players for select
to authenticated
using (private.can_view_group_stats(group_id));

create policy "coaches insert group selection players"
on public.coaching_group_selection_players for insert
to authenticated
with check (private.is_group_coach(group_id));

create policy "coaches delete group selection players"
on public.coaching_group_selection_players for delete
to authenticated
using (private.is_group_coach(group_id));

revoke all on table public.coaching_group_selections from anon;
revoke all on table public.coaching_group_selection_players from anon;
grant select, insert, update, delete on table public.coaching_group_selections to authenticated;
grant select, insert, delete on table public.coaching_group_selection_players to authenticated;
grant all on table public.coaching_group_selections to service_role;
grant all on table public.coaching_group_selection_players to service_role;
