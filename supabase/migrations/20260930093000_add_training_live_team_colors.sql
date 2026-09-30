alter table public.training_attendance
  add column if not exists team_color text;

alter table public.training_live_events
  add column if not exists team_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_attendance'::regclass
      and conname = 'training_attendance_team_color_check'
  ) then
    alter table public.training_attendance
      add constraint training_attendance_team_color_check
      check (team_color is null or team_color = any (array['blue'::text,'gray'::text,'black'::text]));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_live_events'::regclass
      and conname = 'training_live_events_team_color_check'
  ) then
    alter table public.training_live_events
      add constraint training_live_events_team_color_check
      check (team_color is null or team_color = any (array['blue'::text,'gray'::text,'black'::text]));
  end if;
end
$$;

create index if not exists training_attendance_session_team_idx
  on public.training_attendance(session_id, team_color)
  where present = true;

create index if not exists training_live_events_period_team_idx
  on public.training_live_events(period_id, team_color);

comment on column public.training_attendance.team_color is
  'Current terrain team assignment for this training session: blue, gray, black, or null.';

comment on column public.training_live_events.team_color is
  'Snapshot of the terrain team for the event; nullable for legacy or unassigned events.';
