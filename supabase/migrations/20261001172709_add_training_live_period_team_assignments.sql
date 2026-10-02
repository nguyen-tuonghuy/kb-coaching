alter table public.training_live_periods
  add column if not exists team_assignments jsonb;

comment on column public.training_live_periods.team_assignments is
  'Snapshot des affectations terrain par joueur pour une collecte, sous forme {player_uuid: blue|gray|black}.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_live_periods_team_assignments_object_chk'
  ) then
    alter table public.training_live_periods
      add constraint training_live_periods_team_assignments_object_chk
      check (team_assignments is null or jsonb_typeof(team_assignments) = 'object');
  end if;
end $$;
