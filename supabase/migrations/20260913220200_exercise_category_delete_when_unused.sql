create or replace function public.get_exercise_category_usage(p_category_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with category_exercises as (
    select e.id
    from public.exercises e
    where e.category_id = p_category_id
  )
  select jsonb_build_object(
    'exercise_count',
      (select count(*) from category_exercises),
    'used_exercise_count',
      (select count(*)
       from category_exercises ce
       where exists (
         select 1 from public.training_session_exercises tse where tse.exercise_id = ce.id
       )
       or exists (
         select 1 from public.training_results tr where tr.exercise_id = ce.id
       )),
    'used',
      exists (
        select 1
        from category_exercises ce
        where exists (
          select 1 from public.training_session_exercises tse where tse.exercise_id = ce.id
        )
        or exists (
          select 1 from public.training_results tr where tr.exercise_id = ce.id
        )
      )
  );
$$;

revoke all on function public.get_exercise_category_usage(uuid) from public;
grant execute on function public.get_exercise_category_usage(uuid) to authenticated;

drop policy if exists "authenticated delete unused exercise categories" on public.exercise_categories;
create policy "authenticated delete unused exercise categories"
  on public.exercise_categories
  for delete
  to authenticated
  using ((not is_native) and ((select auth.uid()) is not null));
