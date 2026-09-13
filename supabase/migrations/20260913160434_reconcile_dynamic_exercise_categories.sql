-- Reconciliation AFTER remote migration 20260913152156_dynamic_exercise_categories.
-- Inspected remote state: four system categories, 27 mapped exercises, no unmapped rows.
-- No seed, backfill, category renaming or data rewrite is performed by this migration.
-- Restore the remote migration history locally before applying this pending complement.
-- Re-running this file is supported for the inspected baseline / this reconciliation.
-- Unexpected baseline data must be reviewed, never silently remapped.
begin;
set local lock_timeout = '5s';

-- This is a complement, not a replacement for the original schema migration.
do $$
begin
  if to_regclass('public.exercise_categories') is null
     or to_regclass('public.exercises') is null then
    raise exception 'Prérequis absent : appliquer la migration initiale 20260913152156 avant cette réconciliation.';
  end if;
  if exists (
    select 1 from (values
      ('exercise_categories','id','uuid'), ('exercise_categories','name','text'),
      ('exercise_categories','slug','text'), ('exercise_categories','active','boolean'),
      ('exercise_categories','is_native','boolean'), ('exercise_categories','is_dual_focus','boolean'),
      ('exercise_categories','created_by','uuid'), ('exercise_categories','updated_by','uuid'),
      ('exercise_categories','created_at','timestamp with time zone'),
      ('exercise_categories','updated_at','timestamp with time zone'),
      ('exercises','category_id','uuid'), ('exercises','category','text')
    ) expected(table_name,column_name,data_type)
    where not exists (select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=expected.table_name
        and c.column_name=expected.column_name and c.data_type=expected.data_type)
  ) then
    raise exception 'Le schéma initial des catégories est absent ou incompatible : aucune reprise automatique.';
  end if;
end $$;

lock table public.exercise_categories, public.exercises in share row exclusive mode;

create or replace function public.exercise_category_name_key(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(
    replace(replace(lower(regexp_replace(normalize(value, NFKD),
      U&'[\0300-\036f]', '', 'g')), 'œ', 'oe'), 'æ', 'ae'),
    '[[:space:] ]+', ' ', 'g'));
$$;

-- Read-only preflight: preserve every existing UUID and category assignment.
do $$
begin
  if (select count(*) from public.exercise_categories
      where is_native and active and
       ((slug='attaque' and name='Attaque' and not is_dual_focus)
        or (slug='defense' and name='Défense' and not is_dual_focus)
        or (slug='attaque-defense' and name='Attaque / Défense' and is_dual_focus)
        or (slug='autre' and name='Autre' and not is_dual_focus))) <> 4 then
    raise exception 'Les quatre catégories système doivent être vérifiées ; aucune catégorie ne sera recréée.';
  end if;
  if exists (select 1 from public.exercise_categories
    group by public.exercise_category_name_key(name) having count(*)>1) then
    raise exception 'Des noms de catégories sont équivalents après normalisation ; aucune fusion automatique.';
  end if;
  if exists (select 1 from public.exercise_categories
    where name is null or length(public.exercise_category_name_key(name)) not between 1 and 100
      or (is_dual_focus and not is_native)) then
    raise exception 'Des catégories existantes ne respectent pas les nouvelles contraintes ; aucune modification automatique.';
  end if;
  if exists (select 1 from public.exercises e
    left join public.exercise_categories c on c.id=e.category_id
    where e.category_id is null or c.id is null) then
    raise exception 'Des exercices ne sont pas rattachés à une catégorie valide ; aucune remigration automatique.';
  end if;
end $$;

create unique index if not exists exercise_categories_name_key_unique
  on public.exercise_categories(public.exercise_category_name_key(name));
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.exercise_categories'::regclass
    and conname='exercise_categories_name_not_empty') then
    alter table public.exercise_categories add constraint exercise_categories_name_not_empty
      check (length(public.exercise_category_name_key(name)) between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.exercise_categories'::regclass
    and conname='exercise_categories_dual_native') then
    alter table public.exercise_categories add constraint exercise_categories_dual_native
      check (not is_dual_focus or is_native);
  end if;
end $$;

-- Only genuinely new column; existing exercise values and audit fields are untouched.
-- Provenance survives deletion of the source; its validity is checked at insertion.
alter table public.exercises add column if not exists copied_from_exercise_id uuid;

-- Change only the FK delete action if needed; keep its column and all stored UUIDs.
do $$
declare category_att smallint; id_att smallint; existing_fk record;
begin
  select attnum into category_att from pg_attribute
    where attrelid='public.exercises'::regclass and attname='category_id';
  select attnum into id_att from pg_attribute
    where attrelid='public.exercise_categories'::regclass and attname='id';
  if not exists (select 1 from pg_constraint where conrelid='public.exercises'::regclass
    and contype='f' and conkey=array[category_att]
    and confrelid='public.exercise_categories'::regclass and confkey=array[id_att]
    and confdeltype='r') then
    for existing_fk in select conname from pg_constraint
      where conrelid='public.exercises'::regclass and contype='f'
        and conkey=array[category_att]
        and confrelid='public.exercise_categories'::regclass and confkey=array[id_att]
    loop
      execute format('alter table public.exercises drop constraint %I',existing_fk.conname);
    end loop;
    alter table public.exercises add constraint exercises_category_id_fkey
      foreign key (category_id) references public.exercise_categories(id) on delete restrict;
  end if;
  if not (select attnotnull from pg_attribute
    where attrelid='public.exercises'::regclass and attname='category_id') then
    alter table public.exercises alter column category_id set not null;
  end if;
end $$;
create index if not exists exercises_category_id_idx on public.exercises(category_id);
create index if not exists exercise_categories_created_by_idx on public.exercise_categories(created_by);
create index if not exists exercise_categories_updated_by_idx on public.exercise_categories(updated_by);

-- Replace the earlier audit-only trigger. No SECURITY DEFINER is needed.
drop trigger if exists trg_exercise_categories_touch on public.exercise_categories;
create or replace function public.guard_exercise_category()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare base_slug text;
begin
  if tg_op='DELETE' then
    raise exception 'Archivez la catégorie au lieu de la supprimer.' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    if old.is_native and
       row(new.name,new.slug,new.active,new.is_native,new.is_dual_focus)
       is distinct from row(old.name,old.slug,old.active,old.is_native,old.is_dual_focus) then
      raise exception 'Cette catégorie est fixe.' using errcode='23514';
    end if;
    if row(new.id,new.slug,new.is_native,new.is_dual_focus,new.created_at)
       is distinct from row(old.id,old.slug,old.is_native,old.is_dual_focus,old.created_at) then
      raise exception 'Les propriétés internes de la catégorie sont fixes.' using errcode='23514';
    end if;
  elsif new.is_native or new.is_dual_focus then
    raise exception 'Seules les catégories personnalisées peuvent être ajoutées.' using errcode='23514';
  end if;
  new.name := btrim(regexp_replace(new.name, '[[:space:] ]+', ' ', 'g'));
  if tg_op='INSERT' then
    base_slug := trim(both '-' from regexp_replace(public.exercise_category_name_key(new.name), '[^a-z0-9]+', '-', 'g'));
    -- UUID suffix allows distinct names with identical URL transliterations.
    new.slug := coalesce(nullif(base_slug,''),'categorie') || '-' || new.id::text;
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_exercise_category on public.exercise_categories;
create trigger guard_exercise_category before insert or update or delete
on public.exercise_categories for each row execute function public.guard_exercise_category();

-- category_id is authoritative. The text column remains a compatibility mirror.
create or replace function public.sync_exercise_category()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare selected public.exercise_categories; source_category_id uuid;
begin
  if tg_op='UPDATE' then
    if new.copied_from_exercise_id is distinct from old.copied_from_exercise_id then
      raise exception 'La provenance de la copie ne peut pas être modifiée.' using errcode='23514';
    end if;
  end if;
  if new.category_id is null then
    select * into selected from public.exercise_categories c
    where public.exercise_category_name_key(c.name)=public.exercise_category_name_key(new.category);
    if not found then
      select * into selected from public.exercise_categories where slug='autre';
    end if;
    new.category_id := selected.id;
  else
    select * into selected from public.exercise_categories where id=new.category_id;
  end if;
  if selected.id is null then
    raise exception 'Catégorie introuvable.' using errcode='23503';
  end if;
  if tg_op='INSERT' and new.copied_from_exercise_id is not null then
    select category_id into source_category_id from public.exercises
      where id=new.copied_from_exercise_id;
    if source_category_id is null or source_category_id<>new.category_id then
      raise exception 'La copie doit conserver la catégorie de son exercice source.' using errcode='23514';
    end if;
  end if;
  if not selected.active then
    if tg_op='INSERT' then
      if new.copied_from_exercise_id is null then
        raise exception 'Cette catégorie est archivée. Choisissez une catégorie active.' using errcode='23514';
      end if;
    elsif new.category_id is distinct from old.category_id
       or (old.copied_from_exercise_id is not null and
           (to_jsonb(new) - array['category','updated_at','updated_by'])
             is distinct from (to_jsonb(old) - array['category','updated_at','updated_by'])) then
      raise exception 'Choisissez une catégorie active avant de modifier cette copie.' using errcode='23514';
    end if;
  end if;
  new.category := selected.name;
  return new;
end $$;
drop trigger if exists sync_exercise_category on public.exercises;
create trigger sync_exercise_category before insert or update on public.exercises
for each row execute function public.sync_exercise_category();

-- Renames remain visible to the legacy frontend as well; existing exercise RLS applies.
create or replace function public.sync_exercise_category_name()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    update public.exercises set category=new.name where category_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists sync_exercise_category_name on public.exercise_categories;
create trigger sync_exercise_category_name after update of name on public.exercise_categories
for each row execute function public.sync_exercise_category_name();

alter table public.exercise_categories enable row level security;
-- Keep the original policy names/history; update only these three known policies.
-- No other policies or exercise permissions are dropped.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='exercise_categories' and policyname='authenticated read exercise categories') then
    create policy "authenticated read exercise categories" on public.exercise_categories
      for select to authenticated using ((select auth.uid()) is not null);
  else
    alter policy "authenticated read exercise categories" on public.exercise_categories
      to authenticated using ((select auth.uid()) is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='exercise_categories' and policyname='authenticated insert exercise categories') then
    create policy "authenticated insert exercise categories" on public.exercise_categories
      for insert to authenticated
      with check (not is_native and not is_dual_focus and created_by=(select auth.uid()));
  else
    alter policy "authenticated insert exercise categories" on public.exercise_categories
      to authenticated
      with check (not is_native and not is_dual_focus and created_by=(select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='exercise_categories' and policyname='authenticated update exercise categories') then
    create policy "authenticated update exercise categories" on public.exercise_categories
      for update to authenticated
      using (not is_native and (select auth.uid()) is not null)
      with check (not is_native and not is_dual_focus and (select auth.uid()) is not null);
  else
    alter policy "authenticated update exercise categories" on public.exercise_categories
      to authenticated
      using (not is_native and (select auth.uid()) is not null)
      with check (not is_native and not is_dual_focus and (select auth.uid()) is not null);
  end if;
end $$;
-- Deliberately shared between authenticated coaches, matching the global library.
revoke all on public.exercise_categories from public, anon, authenticated;
grant select on public.exercise_categories to authenticated;
grant insert(name), update(name,active) on public.exercise_categories to authenticated;

revoke all on function public.exercise_category_name_key(text) from public, anon;
grant execute on function public.exercise_category_name_key(text) to authenticated, service_role;
revoke all on function public.guard_exercise_category() from public, anon, authenticated;
revoke all on function public.sync_exercise_category() from public, anon, authenticated;
revoke all on function public.sync_exercise_category_name() from public, anon, authenticated;

comment on column public.exercises.category is 'Legacy mirror; category_id is the authoritative reference.';
notify pgrst, 'reload schema';
commit;
