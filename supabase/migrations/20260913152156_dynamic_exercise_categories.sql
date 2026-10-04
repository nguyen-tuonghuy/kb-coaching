create table if not exists public.exercise_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  is_native boolean not null default false,
  is_dual_focus boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exercise_categories enable row level security;

drop policy if exists "authenticated read exercise categories" on public.exercise_categories;
create policy "authenticated read exercise categories"
  on public.exercise_categories for select
  to authenticated using (true);

drop policy if exists "authenticated insert exercise categories" on public.exercise_categories;
create policy "authenticated insert exercise categories"
  on public.exercise_categories for insert
  to authenticated with check (not is_native and created_by = auth.uid());

drop policy if exists "authenticated update exercise categories" on public.exercise_categories;
create policy "authenticated update exercise categories"
  on public.exercise_categories for update
  to authenticated
  using (not is_native)
  with check (not is_native);

insert into public.exercise_categories(name,slug,is_native,is_dual_focus,created_by,updated_by)
values
 ('Attaque','attaque',true,false,null,null),
 ('Défense','defense',true,false,null,null),
 ('Attaque / Défense','attaque-defense',true,true,null,null),
 ('Autre','autre',true,false,null,null)
on conflict (slug) do nothing;

alter table public.exercises
  add column if not exists category_id uuid references public.exercise_categories(id) on delete set null;

update public.exercises e
set category_id = c.id
from public.exercise_categories c
where e.category_id is null
  and (
    lower(trim(e.category)) = lower(trim(c.name))
    or (lower(trim(e.category)) in ('attack','attaque') and c.slug='attaque')
    or (lower(trim(e.category)) in ('defense','défense') and c.slug='defense')
    or (lower(trim(e.category)) in ('attaque / défense','attaque/défense','attack / defense','attack/defense') and c.slug='attaque-defense')
  );

update public.exercises e
set category_id = c.id
from public.exercise_categories c
where e.category_id is null and c.slug='autre';

create or replace function public.touch_exercise_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_exercise_categories_touch on public.exercise_categories;
create trigger trg_exercise_categories_touch
before update on public.exercise_categories
for each row execute function public.touch_exercise_category();
