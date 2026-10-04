create or replace function public.get_exercise_usage(p_exercise_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'used',
      exists(select 1 from public.training_session_exercises tse where tse.exercise_id = p_exercise_id)
      or exists(select 1 from public.training_results tr where tr.exercise_id = p_exercise_id),
    'has_results',
      exists(select 1 from public.training_results tr where tr.exercise_id = p_exercise_id),
    'session_count',
      (select count(distinct tse.session_id) from public.training_session_exercises tse where tse.exercise_id = p_exercise_id),
    'result_count',
      (select count(*) from public.training_results tr where tr.exercise_id = p_exercise_id)
  );
$$;

revoke all on function public.get_exercise_usage(uuid) from public;
grant execute on function public.get_exercise_usage(uuid) to authenticated;

drop policy if exists "creators delete global exercises" on public.exercises;
drop policy if exists "authenticated delete unused exercises" on public.exercises;

create policy "authenticated delete unused exercises"
  on public.exercises
  for delete
  to authenticated
  using (true);
