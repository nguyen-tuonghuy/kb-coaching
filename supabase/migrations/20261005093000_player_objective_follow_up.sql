-- Mon suivi (MVP) : étape de travail du coach sur les objectifs joueur.
--
-- Portée strictement additive sur public.coaching_player_objectives :
--   * aucune colonne existante n'est supprimée ni modifiée ;
--   * aucune contrainte existante n'est touchée (status IN ('active','completed'),
--     source IN ('coach','player'), longueur de l'objectif 1 à 500) ;
--   * aucune nouvelle table ;
--   * le plafond de 3 objectifs actifs par source reste calculé sur status='active'.
--
-- Rétrocompatibilité : les trois colonnes sont nullables, les contraintes les
-- acceptent, et le backfill est idempotent. Une ligne ancienne reçoit la valeur
-- qui correspond exactement à son comportement actuel. Le front lit
-- coalesce(stage,'to_work') et reste correct même sans application de ce fichier.
--
-- `status` reste le cycle de vie (actif / atteint). `stage` porte le travail du
-- coach : to_work = à travailler, in_progress = en progrès, stabilized = stabilisé.
-- Étendre `status` aurait permis à des lignes d'échapper au plafond de 3 par source
-- et aurait fait disparaître des sections existantes du front.

alter table public.coaching_player_objectives
  add column if not exists stage text null,
  add column if not exists coach_note text null,
  add column if not exists player_note text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coaching_player_objectives_stage_check'
  ) then
    alter table public.coaching_player_objectives
      add constraint coaching_player_objectives_stage_check
      check (stage is null or stage in ('to_work','in_progress','stabilized'));
  end if;
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

-- Lignes antérieures : un objectif atteint devient « stabilisé », tout le reste
-- « à travailler ». Sans application de ce fichier, ces mêmes lignes restent
-- lues comme « à travailler » par le front.
update public.coaching_player_objectives
   set stage = case when status = 'completed' then 'stabilized' else 'to_work' end
 where stage is null;

-- Lecture des objectifs avec les colonnes de suivi.
-- Même garde d'accès et même tri que public.get_player_objectives, qui reste
-- inchangée : aucun DROP, aucun changement de type de retour, aucun droit retiré.
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
  stage text,
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
    coalesce(o.stage,'to_work') as stage,
    o.coach_note,
    o.player_note,
    coalesce(o.updated_at,o.created_at) as updated_at
  from public.coaching_player_objectives o
  left join public.user_profiles up on up.user_id = o.created_by
  where o.group_id = p_group_id
    and o.player_id = v_player_id
  order by
    case when o.status = 'active' then 0 else 1 end,
    case when o.stage = 'stabilized' then 1 else 0 end,
    case when o.source = 'coach' then 0 else 1 end,
    coalesce(o.completed_at,o.created_at) desc;
end
$function$;

grant execute on function public.get_player_follow_up_objectives(uuid,uuid) to authenticated;

-- Changement d'étape par l'entraîneur du groupe.
create or replace function public.set_player_objective_stage(
  p_group_id uuid,
  p_objective_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_stage text;
begin
  if auth.uid() is null or not private.is_group_coach(p_group_id) then
    raise exception 'Accès entraîneur refusé';
  end if;

  v_stage := btrim(coalesce(p_stage,'to_work'));

  if v_stage not in ('to_work','in_progress','stabilized') then
    raise exception 'Étape inconnue';
  end if;

  update public.coaching_player_objectives o
     set stage = v_stage,
         updated_at = now()
   where o.id = p_objective_id
     and o.group_id = p_group_id;

  if not found then
    raise exception 'Objectif introuvable';
  end if;
end
$function$;

grant execute on function public.set_player_objective_stage(uuid,uuid,text) to authenticated;

-- Édition coach : titre, consigne et étape. Ne touche pas `status`, donc ni le
-- cycle de vie ni le plafond de 3 objectifs actifs par source.
create or replace function public.update_player_objective_coach_fields(
  p_group_id uuid,
  p_objective_id uuid,
  p_objective text default null,
  p_coach_note text default null,
  p_stage text default null
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_objective text;
  v_coach_note text;
  v_stage text;
  v_source text;
begin
  if auth.uid() is null or not private.is_group_coach(p_group_id) then
    raise exception 'Accès entraîneur refusé';
  end if;

  select o.source into v_source
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

  if p_stage is not null then
    v_stage := btrim(p_stage);
    if v_stage not in ('to_work','in_progress','stabilized') then
      raise exception 'Étape inconnue';
    end if;
  end if;

  update public.coaching_player_objectives o
     set objective = coalesce(v_objective,o.objective),
         coach_note = case when p_coach_note is null then o.coach_note else btrim(p_coach_note) end,
         stage = coalesce(v_stage,o.stage),
         updated_at = now()
   where o.id = p_objective_id
     and o.group_id = p_group_id;
end
$function$;

grant execute on function public.update_player_objective_coach_fields(uuid,uuid,text,text,text) to authenticated;

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

-- Limitée connue : public.complete_player_objective et
-- public.reopen_player_objective ne sont pas rejoués ici, car leurs définitions
-- réelles ne sont pas disponibles dans ce dépôt. Tant qu'elles ne sont pas
-- réécrites avec `updated_at = now()`, « dernière mise à jour » ne bouge que sur
-- les étapes et l'édition coach, pas sur « Marquer atteint ».