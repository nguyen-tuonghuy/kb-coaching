-- Lot B — Correctif de synchronisation : les autorisations de save_training_session
-- sont désormais déléguées aux policies RLS existantes de public.training_sessions.
--
-- Contexte :
--   * La migration 20261010120000_training_session_atomic_save.sql est appliquée.
--   * Le correctif correspondant a été appliqué directement sur la base distante :
--     suppression, dans la RPC, des deux vérifications explicites faisant appel à
--     private.is_group_coach() et private.can_edit_workspace(), car le rôle
--     `authenticated` n'a pas USAGE sur le schéma `private`.
--   * Cette migration additive reproduit EXACTEMENT ce correctif : seule la fonction
--     est remplacée (CREATE OR REPLACE FUNCTION, aucun autre objet, aucun GRANT/REVOKE,
--     aucune permission modifiée sur le schéma private). Vérifications métier et
--     protections transactionnelles inchangées.
--
-- Les autorisations sont donc contrôlées par les policies RLS existantes :
--   * création  → policy INSERT (coach du groupe OU éditeur du workspace) ;
--   * modification → policy SELECT (lecture verrouillante) + policy UPDATE.
-- Ne pas réintroduire d'appels directs aux fonctions du schéma private dans la RPC.

create or replace function public.save_training_session(
  p_session_id uuid,
  p_expected_version integer,
  p_workspace_id uuid default null,
  p_group_id uuid default null,
  p_team_id uuid default null,
  p_trained_on date default null,
  p_label text default null,
  p_theme text default null,
  p_duration_minutes integer default null,
  p_notes text default null,
  p_attendance jsonb default '[]'::jsonb,
  p_exercises jsonb default '[]'::jsonb,
  p_results jsonb default '[]'::jsonb,
  p_force boolean default false
)
returns table(status text, session_id uuid, version integer, updated_at timestamptz, remote_version integer)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_group uuid;
  v_version integer;
  v_updated timestamptz;
  v_sid uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if p_group_id is null then
    raise exception 'Groupe requis' using errcode = '22023';
  end if;
  if p_team_id is null then
    raise exception 'Équipe requise' using errcode = '22023';
  end if;
  if p_duration_minutes is not null and p_duration_minutes < 0 then
    raise exception 'Durée invalide' using errcode = '22023';
  end if;

  if p_session_id is null then
    -- Création : l'autorisation est appliquée par la policy RLS d'INSERT du parent
    -- (coach du groupe OU éditeur du workspace) ; le workspace est fourni par le
    -- client mais systématiquement vérifié.
    if p_workspace_id is null then
      raise exception 'Workspace requis' using errcode = '22023';
    end if;
    -- Cohérence : l'équipe doit appartenir au workspace cible.
    if not exists (select 1 from public.teams t
                   where t.id = p_team_id and t.workspace_id = p_workspace_id) then
      raise exception 'Équipe hors du workspace' using errcode = '22023';
    end if;
    v_ws := p_workspace_id;

    insert into public.training_sessions as s
      (workspace_id, group_id, team_id, trained_on, label, theme, duration_minutes, notes)
    values
      (v_ws, p_group_id, p_team_id, coalesce(p_trained_on, current_date),
       coalesce(nullif(btrim(p_label), ''), 'Entraînement'), nullif(btrim(p_theme), ''),
       p_duration_minutes, p_notes)
    returning s.id, s.version, s.updated_at into v_sid, v_version, v_updated;
  else
    -- Modification : verrou de ligne ; le contexte (groupe + workspace) est strictement
    -- préservé de la séance existante, jamais celui du navigateur. La lecture verrouillante
    -- est protégée par la policy RLS de SELECT (une séance invisible n'est jamais trouvée)
    -- et l'écriture par la policy RLS d'UPDATE.
    select s.workspace_id, s.group_id, s.version, s.updated_at
      into v_ws, v_group, v_version, v_updated
      from public.training_sessions s
      where s.id = p_session_id
      for update;
    if not found then
      raise exception 'Séance introuvable' using errcode = 'P0002';
    end if;
    if v_group is distinct from p_group_id then
      raise exception 'Séance hors du groupe' using errcode = '22023';
    end if;
    if not exists (select 1 from public.teams t
                   where t.id = p_team_id and t.workspace_id = v_ws) then
      raise exception 'Équipe hors du workspace de la séance' using errcode = '22023';
    end if;

    -- Détection de conflit : la version fournie doit correspondre à celle du dernier
    -- enregistrement. p_force ne court-circuite QUE cette comparaison : les cohérences
    -- restent pleinement vérifiées et l'usage en interface reste lié à une
    -- confirmation explicite de conflit.
    if not p_force and (p_expected_version is null or v_version <> p_expected_version) then
      return query select 'conflict'::text, p_session_id, null::integer, v_updated, v_version;
      return;
    end if;

    update public.training_sessions s set
      team_id = p_team_id,
      trained_on = coalesce(p_trained_on, s.trained_on),
      label = coalesce(nullif(btrim(p_label), ''), 'Entraînement'),
      theme = nullif(btrim(p_theme), ''),
      duration_minutes = p_duration_minutes,
      notes = p_notes
      where s.id = p_session_id
      returning s.version, s.updated_at into v_version, v_updated;
    if not found then
      raise exception 'Mise à jour refusée' using errcode = '42501';
    end if;
    v_sid := p_session_id;
  end if;

  -- Joueurs : membre du groupe (sans filtre `active`) OU déjà présent dans les présences
  -- actuelles de la séance. Un joueur retiré du groupe (ligne coaching_group_players
  -- supprimée) et présent dans une séance historique reste donc resauvegardable.
  if exists (select 1 from jsonb_array_elements(p_attendance) e
             where not exists (select 1 from public.coaching_group_players gp
                               where gp.group_id = p_group_id
                                 and gp.player_id = (e->>'player_id')::uuid)
               and (p_session_id is null
                    or not exists (select 1 from public.training_attendance olda
                                   where olda.session_id = v_sid
                                     and olda.player_id = (e->>'player_id')::uuid)))
  then
    raise exception 'Joueur non autorisé' using errcode = '23503';
  end if;

  -- Exercices : simple existence (un exercice archivé reste éditable dans une séance).
  if exists (select 1 from jsonb_array_elements(p_exercises) e
             where not exists (select 1 from public.exercises ex
                               where ex.id = (e->>'exercise_id')::uuid))
  then
    raise exception 'Exercice introuvable' using errcode = '23503';
  end if;

  -- Résultats : chaque résultat doit référencer un exercice du plan et un joueur présent.
  if exists (select 1 from jsonb_array_elements(p_results) e
             where not exists (select 1 from jsonb_array_elements(p_exercises) x
                               where (x->>'exercise_id')::uuid = (e->>'exercise_id')::uuid)
                or not exists (select 1 from jsonb_array_elements(p_attendance) a
                               where (a->>'player_id')::uuid = (e->>'player_id')::uuid
                                 and (a->>'present')::boolean))
  then
    raise exception 'Résultat incohérent' using errcode = '23514';
  end if;

  -- Présences : suppression des retirées puis upsert (préserve team_color du module live).
  -- Formulation sans ON CONFLICT : le nom de colonne de sortie `session_id` (RETURNS TABLE)
  -- entre en collision avec le nom de colonne de la table et rendrait la clause ambiguë.
  delete from public.training_attendance ta
    where ta.session_id = v_sid
      and not exists (select 1 from jsonb_array_elements(p_attendance) a
                      where (a->>'player_id')::uuid = ta.player_id);

  update public.training_attendance ta
    set present = s.present
    from (select (e->>'player_id')::uuid as player_id, (e->>'present')::boolean as present
          from jsonb_array_elements(p_attendance) e) s
    where ta.session_id = v_sid and ta.player_id = s.player_id;

  insert into public.training_attendance(session_id, player_id, present)
    select v_sid, s.player_id, s.present
    from (select (e->>'player_id')::uuid as player_id, (e->>'present')::boolean as present
          from jsonb_array_elements(p_attendance) e) s
    where not exists (select 1 from public.training_attendance ta
                      where ta.session_id = v_sid and ta.player_id = s.player_id);

  -- Plan : remplacement complet (variant/target/focus fournis par le formulaire).
  delete from public.training_session_exercises tse
    where tse.session_id = v_sid;
  insert into public.training_session_exercises(session_id, exercise_id, position, variant, target, focus)
    select v_sid, (e->>'exercise_id')::uuid, (e->>'position')::int,
           nullif(e->>'variant', ''), nullif(e->>'target', ''), nullif(e->>'focus', '')
    from jsonb_array_elements(p_exercises) e;

  -- Résultats : l'éditeur gère uniquement les lignes variant IS NULL (légitimes à re-créer
  -- via le formulaire). Les lignes éventuelles à variant non NULL proviennent d'une autre
  -- provenance et restent strictement intactes. L'éditeur ne renseigne jamais de variant.
  -- Dépendances vérifiées : aucun tableau migré ne référence training_results(id) (les
  -- migrations n'utilisent que exercise_id) ; les consommateurs (statistiques, historique
  -- joueur) lisent id/created_at pour l'affichage et rapprochent par (exercise_id, player_id).
  -- Recréer les lignes est donc sûr et ne casse aucune référence.
  delete from public.training_results tr
    where tr.session_id = v_sid and tr.variant is null;
  insert into public.training_results(session_id, exercise_id, player_id, successes, attempts, numeric_value, note)
    select v_sid, (e->>'exercise_id')::uuid, (e->>'player_id')::uuid,
           nullif(e->>'successes', '')::int, nullif(e->>'attempts', '')::int,
           nullif(e->>'numeric_value', '')::numeric, nullif(e->>'note', '')
    from jsonb_array_elements(p_results) e;

  return query select 'saved'::text, v_sid, v_version, v_updated, null::integer;
end $$;