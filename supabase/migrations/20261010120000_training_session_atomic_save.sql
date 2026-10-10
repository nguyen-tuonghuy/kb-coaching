-- Lot B — Enregistrement transactionnel d'une séance d'entraînement.
-- Migration additive, rétrocompatible : aucun code client existant n'est modifié ou bloqué.
-- L'ancien JS continue d'écrire directement ; la RPC `save_training_session` devient la
-- seule porte d'écriture pour l'éditeur une fois la phase d'intégration (JS) réalisée.

-- Faits distants confirmés (audit sur la base réelle) :
--   * training_sessions.workspace_id NOT NULL (FK workspaces) ; team_id NOT NULL (FK teams) ;
--   * trg_training_sessions_audit (BEFORE INSERT OR UPDATE) via public.set_audit_user_fields() ;
--   * private.is_group_coach(uuid) et private.can_edit_workspace(uuid) existent (owner/admin/coach) ;
--   * RLS permissives sur training_sessions combinées par OR :
--       - INSERT : WITH CHECK (group_id IS NOT NULL AND private.is_group_coach(group_id))
--                  OU WITH CHECK private.can_edit_workspace(workspace_id) ;
--       - UPDATE : USING et WITH CHECK identiques (policies « group coaches » et « editors ») ;
--   * training_attendance PK (session_id, player_id) ; team_color ∈ blue|gray|black|NULL
--     (non inclus dans la PK) ; FK enfants ON DELETE CASCADE ;
--   * training_session_exercises UNIQUE (session_id, exercise_id, position) ;
--   * training_results.variant existe ; les 24 lignes actuelles ont toutes variant IS NULL ;
--     la combinaison (session_id, exercise_id, player_id) n'est PAS contrainte UNIQUE ;
--   * coaching_groups n'a PAS de colonne workspace_id ;
--   * le module collecte live écrit training_sessions et training_attendance (team_color),
--     jamais training_results ni training_session_exercises.

-- Limite documentée (cohérence groupe ↔ workspace) :
--   Aucune relation fiable ne relie un groupe à un workspace (coaching_groups sans
--   workspace_id ; teams liée à workspace uniquement ; aucune référence vers les groupes).
--   Nous n'inventons donc AUCUNE contrainte métier de rattachement. La RLS ne garantit
--   pas qu'un groupe appartient logiquement au workspace indiqué : l'anti-transversal est
--   assuré par (1) la préservation de group_id/workspace_id en modification, (2) la
--   vérification team.workspace_id = workspace cible, (3) le prédicat d'autorisation qui
--   épouse exactement les policies RLS (entraîneur du groupe OU éditeur du workspace).
--   Une future relation groupe↔workspace pourra durcir la création (groupe du même workspace).

alter table public.training_sessions
  add column if not exists version integer not null default 1;

comment on column public.training_sessions.version is
  'Compteur monotone pour la détection de conflits entre entraîneurs. Incrémenté à chaque UPDATE par trg_training_sessions_version.';

-- Incrémente la version à chaque mise à jour. Ne touche ni updated_at ni updated_by :
-- ces champs restent gérés exclusivement par trg_training_sessions_audit
-- (public.set_audit_user_fields) pour éviter tout double mécanisme concurrent.
create or replace function public.bump_training_session_version()
returns trigger
language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

drop trigger if exists trg_training_sessions_version on public.training_sessions;
create trigger trg_training_sessions_version
before update on public.training_sessions
for each row execute function public.bump_training_session_version();

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
    -- Création : le workspace est fourni par le client mais systématiquement vérifié.
    if p_workspace_id is null then
      raise exception 'Workspace requis' using errcode = '22023';
    end if;
    -- Deux chemins d'autorisation, comme les policies RLS d'INSERT (combinées par OR).
    if not private.is_group_coach(p_group_id) and not private.can_edit_workspace(p_workspace_id) then
      raise exception 'Accès refusé' using errcode = '42501';
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
    -- préservé de la séance existante, jamais celui du navigateur.
    select s.workspace_id, s.group_id, s.version, s.updated_at
      into v_ws, v_group, v_version, v_updated
      from public.training_sessions s
      where s.id = p_session_id
      for update;
    if not found then
      raise exception 'Séance introuvable' using errcode = 'P0002';
    end if;
    if not private.is_group_coach(v_group) and not private.can_edit_workspace(v_ws) then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
    if v_group is distinct from p_group_id then
      raise exception 'Séance hors du groupe' using errcode = '22023';
    end if;
    if not exists (select 1 from public.teams t
                   where t.id = p_team_id and t.workspace_id = v_ws) then
      raise exception 'Équipe hors du workspace de la séance' using errcode = '22023';
    end if;

    -- Détection de conflit : la version fournie doit correspondre à celle du dernier
    -- enregistrement. p_force ne court-circuite QUE cette comparaison : les droits et la
    -- cohérence restent pleinement vérifiés et l'usage en interface reste lié à une
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

comment on function public.save_training_session(uuid, integer, uuid, uuid, uuid, date, text, text, integer, text, jsonb, jsonb, jsonb, boolean) is
  'Enregistrement transactionnel d''une séance d''entraînement : création ou mise à jour avec
   détection de conflits via le compteur de version. Un seul appel RPC, une seule transaction :
   toute erreur (droits, cohérence, données) annule l''ensemble des écritures.';

revoke all on function public.save_training_session(uuid, integer, uuid, uuid, uuid, date, text, text, integer, text, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_training_session(uuid, integer, uuid, uuid, uuid, date, text, text, integer, text, jsonb, jsonb, jsonb, boolean) to authenticated;