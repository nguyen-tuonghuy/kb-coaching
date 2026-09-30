alter table public.training_live_events
  add column if not exists attribution_type text not null default 'player';

alter table public.training_live_events
  alter column player_id drop not null;

alter table public.training_live_events
  drop constraint if exists training_live_events_attribution_type_check;

alter table public.training_live_events
  add constraint training_live_events_attribution_type_check
  check (attribution_type in ('player','collective'));

alter table public.training_live_events
  drop constraint if exists training_live_events_attribution_player_check;

alter table public.training_live_events
  add constraint training_live_events_attribution_player_check
  check (
    (attribution_type = 'player' and player_id is not null)
    or
    (attribution_type = 'collective' and player_id is null)
  );

drop policy if exists "coaches insert live training events" on public.training_live_events;
create policy "coaches insert live training events"
on public.training_live_events
for insert
to authenticated
with check (
  private.is_group_coach(group_id)
  and exists (
    select 1
    from public.training_live_periods p
    where p.id = training_live_events.period_id
      and p.session_id = training_live_events.session_id
      and p.group_id = training_live_events.group_id
  )
  and (
    (
      attribution_type = 'player'
      and player_id is not null
      and exists (
        select 1
        from public.training_attendance ta
        where ta.session_id = training_live_events.session_id
          and ta.player_id = training_live_events.player_id
          and ta.present = true
      )
    )
    or
    (
      attribution_type = 'collective'
      and player_id is null
    )
  )
);

drop policy if exists "coaches update live training events" on public.training_live_events;
create policy "coaches update live training events"
on public.training_live_events
for update
to authenticated
using (private.is_group_coach(group_id))
with check (
  private.is_group_coach(group_id)
  and exists (
    select 1
    from public.training_live_periods p
    where p.id = training_live_events.period_id
      and p.session_id = training_live_events.session_id
      and p.group_id = training_live_events.group_id
  )
  and (
    (
      attribution_type = 'player'
      and player_id is not null
      and exists (
        select 1
        from public.training_attendance ta
        where ta.session_id = training_live_events.session_id
          and ta.player_id = training_live_events.player_id
          and ta.present = true
      )
    )
    or
    (
      attribution_type = 'collective'
      and player_id is null
    )
  )
);
