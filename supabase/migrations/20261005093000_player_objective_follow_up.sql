-- Mon suivi : notes et édition coach des objectifs joueur.
--
-- Portée strictement additive sur public.coaching_player_objectives :
--   * aucune colonne existante n'est supprimée ni modifiée ;
--   * aucune contrainte existante n'est touchée (status IN ('active','completed'),
--     source IN ('coach','player'), longueur de l'objectif 1 à 500) ;
--   * aucune nouvelle table ;
--   * le plafond de 3 objectifs actifs par source reste calculé sur status='active'.
--
-- Modèle visible : deux états seulement, dérivés de `status`.
--   status='active'    -> À travailler
--   status='completed' -> Atteint
--
-- Il n'y a aucun champ `stage`, aucune contrainte, aucun backfill et aucune
-- fonction d'étape : `status` est la seule source de vérité. Une ligne ancienne
-- reste correcte car sa lecture repose uniquement sur `status`.
--
-- Avant déploiement, vérifier dans `supabase_migrations.schema_migrations` que
-- ce fichier n'a jamais été rejoué ; une version antérieure expérimentale ayant
-- créé `stage` devrait faire l'objet d'une migration corrective distincte.

alter table public.coaching_player_objectives
  add column if not exists coach_note text null,
  add column if not exists player_note text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coaching_player_objectives_coach_note_check'
  ) then
    alter table public.coaching_player_objectives
      add constraint coaching_player_objectives_coach_note_check
      check (coach_note is null or char_length(coach_note) <= 1000);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'coaching_player_objectives_player_note_check'
  ) then
    alter table public.coaching_player_objectives
      add constraint coaching_player_objectives_player_note_check
      check (player_note is null or char_length(player_note) <= 2000);
  end if;
end $$;

-- Nettoyage des signatures d'une éventuelle version expérimentale de ce même
-- suivi : aucun n'est recréé ici, aucun ne porte de donnée. Les drops sont
-- sans effet si ces fonctions n'existent pas.
drop function if exists public.set_player_objective_stage(uuid,uuid,text);
drop function if exists public.update_player_objective_coach_fields(uuid,uuid,text,text,text);
drop function if exists public.get_player_follow_up_objectives(uuid,uuid);

-- Lecture des objectifs avec les colonnes de suivi.
-- Même garde d'accès et même tri que public.get_player_objectives, qui reste
-- inchangée. Le tri ne dépend que du statut, de la source et des dates.
create or replace function public.get_player_follow_up_objectives(
  p_group_id uuid,
  p_player_id uuid default null
)
returns table(
  id uuid,
  objective text,
  status text,
  source text,
  created_at timestamptz,
  completed_at timestamptz,
  created_by_name text,
  coach_note text,
  player_note text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_player_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;

  if private.is_group_coach(p_group_id) and p_player_id is not null then
    v_player_id := p_player_id;
    if not exists (
      select 1 from public.coaching_group_players gp
      where gp.group_id = p_group_id
        and gp.player_id = v_player_id
        and gp.active = true
    ) then
      raise exception 'Joueur absent du groupe';
    end if;
  else
    select a.player_id into v_player_id
    from public.coaching_player_accounts a
    where a.group_id = p_group_id
      and a.user_id = auth.uid();

    if v_player_id is null then
      raise exception 'Accès joueur refusé';
    end if;

    if p_player_id is not null and p_player_id <> v_player_id then
      raise exception 'Accès joueur refusé';
    end if;
  end if;

  return query
  select
    o.id,
    o.objective,
    o.status,
    o.source,
    o.created_at,
    o.completed_at,
    coalesce(
      up.first_name,
      case when o.source = 'player' then 'Joueur' else 'Entraîneur' end
    ) as created_by_name,
    o.coach_note,
    o.player_note,
    coalesce(o.updated_at,o.created_at) as updated_at
  from public.coaching_player_objectives o
  left join public.user_profiles up on up.user_id = o.created_by
  where o.group_id = p_group_id
    and o.player_id = v_player_id
  order by
    case when o.status = 'active' then 0 else 1 end,
    case when o.source = 'coach' then 0 else 1 end,
    coalesce(o.completed_at,o.created_at) desc;
end
$function$;

grant execute on function public.get_player_follow_up_objectives(uuid,uuid) to authenticated;

-- Édition coach : consigne et, uniquement pour un objectif coach, le texte de
-- l'objectif. Un objectif personnel (source='player') reste la propriété du
-- joueur : le coach peut y ajouter une consigne, jamais en réécrire le texte.
-- Ne touche pas `status`, donc ni le cycle de vie ni le plafond de 3
-- objectifs actifs par source.
create or replace function public.update_player_objective_coach_fields(
  p_group_id uuid,
  p_objective_id uuid,
  p_objective text default null,
  p_coach_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_objective text;
  v_source text;
  v_current_objective text;
begin
  if auth.uid() is null or not private.is_group_coach(p_group_id) then
    raise exception 'Accès entraîneur refusé';
  end if;

  select o.source, o.objective into v_source, v_current_objective
  from public.coaching_player_objectives o
  where o.id = p_objective_id
    and o.group_id = p_group_id;

  if v_source is null then
    raise exception 'Objectif introuvable';
  end if;

  if p_objective is not null then
    v_objective := btrim(p_objective);
    if v_objective = '' then
      raise exception 'Objectif vide';
    end if;
    if char_length(v_objective) > 500 then
      raise exception 'Objectif trop long';
    end if;
  end if;

  if p_coach_note is not null and char_length(btrim(p_coach_note)) > 1000 then
    raise exception 'Consigne trop longue';
  end if;

  if v_source = 'player' and v_objective is not null and v_objective is distinct from v_current_objective then
    raise exception 'Objectif personnel non modifiable par le coach';
  end if;

  update public.coaching_player_objectives o
     set objective = case
           when v_source = 'coach' and v_objective is not null then v_objective
           else o.objective
         end,
         coach_note = case when p_coach_note is null then o.coach_note else btrim(p_coach_note) end,
         updated_at = now()
   where o.id = p_objective_id
     and o.group_id = p_group_id;
end
$function$;

grant execute on function public.update_player_objective_coach_fields(uuid,uuid,text,text) to authenticated;

-- Note personnelle du joueur sur un de ses objectifs. Ne modifie ni le statut,
-- ni la consigne, ni la décision du coach.
create or replace function public.update_my_player_objective_note(
  p_group_id uuid,
  p_objective_id uuid,
  p_player_note text
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_player_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;

  select a.player_id into v_player_id
  from public.coaching_player_accounts a
  where a.group_id = p_group_id
    and a.user_id = auth.uid();

  if v_player_id is null then
    raise exception 'Accès joueur refusé';
  end if;

  if p_player_note is not null and char_length(btrim(p_player_note)) > 2000 then
    raise exception 'Note trop longue';
  end if;

  update public.coaching_player_objectives o
     set player_note = case when p_player_note is null then null else btrim(p_player_note) end,
         updated_at = now()
   where o.id = p_objective_id
     and o.group_id = p_group_id
     and o.player_id = v_player_id;

  if not found then
    raise exception 'Objectif introuvable';
  end if;
end
$function$;

grant execute on function public.update_my_player_objective_note(uuid,uuid,text) to authenticated;

-- public.complete_player_objective et public.reopen_player_objective ne sont
-- pas redéfinies ici : leurs définitions existent déjà en base, mettent
-- `updated_at = now()` et restent les seules voies de cycle de vie.
