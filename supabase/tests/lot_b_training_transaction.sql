-- Lot B — Validation de la migration 20261010120000 sur la base réelle.
-- ==========================================================================
-- CONDITIONS D'EXÉCUTION (obligatoires) :
--   * Exécuter dans le SQL editor Supabase (rôle administrateur du projet) ou un
--     client capable de lancer SET LOCAL ROLE. Le rôle administrateur ne sert QU'À
--     activer `set local role authenticated` : toutes les étapes s'exécutent ensuite
--     avec le rôle `authenticated` réel, ses droits PostgreSQL et les politiques RLS
--     actives. Aucun privilège superutilisateur ne masque une erreur de permission.
--   * Renseigner les TROIS identifiants réels ci-dessous :
--       <UUID_ENTRAINEUR>     : entraîneur d'AU MOINS UN groupe, membre owner/admin/coach
--                               d'AU MOINS UN workspace ;
--       <UUID_EDITEUR_WORKSPACE> : owner/admin/coach du MÊME workspace, NON entraîneur
--                               du groupe cible (vide '' => étape notée « contrôles sautés ») ;
--       <UUID_NON_AUTORISE>   : utilisateur réel SANS accès au groupe ni au workspace cibles
--                               (vide '' => vérifie le refus par identité absente).
--   * STRUCTURE : UNE SEULE TRANSACTION (`begin;` ... `rollback;`) avec ROLLBACK EXPLICITE
--     final. Aucune donnée ne persiste, même en cas de panne intermédiaire. Aucune séance
--     existante n'est créée, modifiée ou supprimée : le script crée deux séances jetables,
--     entièrement annulées par le rollback. Toute hypothèse non satisfaite (groupe sans
--     joueur actif, workspace sans équipe...) s'arrête par une exception => rollback total.
--   * REMPLACER les trois valeurs ci-dessous puis exécuter EN UN SEUL bloc.
-- ==========================================================================
-- Résultat attendu : « Lot B : scénarios validés (ROLLBACK final — aucune donnée persistée) ».

begin;
set local role authenticated;
set local request.jwt.claim.sub = '<UUID_ENTRAINEUR>';

do $$
declare
  v_coach_claim text := '<UUID_ENTRAINEUR>';
  v_editor_claim text := '<UUID_EDITEUR_WORKSPACE>';
  v_unauth_claim text := '<UUID_NON_AUTORISE>';
  v_uid uuid;
  v_group_id uuid;
  v_workspace_id uuid;
  v_team_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_ex1 uuid;
  v_ex2 uuid;
  v_sid uuid;
  v_sid2 uuid;
  v_status text;
  v_version integer;
  v_current integer;
  v_remote integer;
  v_att jsonb;
  v_exs jsonb;
  v_res jsonb;
  v_raised boolean;
  v_other_group uuid;
  v_other_team uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Identité entraîneur non résolue : renseignez <UUID_ENTRAINEUR>.';
  end if;

  select c.group_id into v_group_id from public.coaching_group_coaches c
    where c.user_id = v_uid limit 1;
  if v_group_id is null then
    raise exception 'L''entraîneur doit être coach d''au moins un groupe.';
  end if;

  select wm.workspace_id into v_workspace_id from public.workspace_members wm
    where wm.user_id = v_uid and wm.role in ('owner','admin','coach') limit 1;
  if v_workspace_id is null then
    raise exception 'L''entraîneur doit être owner/admin/coach d''un workspace.';
  end if;

  select t.id into v_team_id from public.teams t
    where t.workspace_id = v_workspace_id limit 1;
  if v_team_id is null then raise exception 'Le workspace doit avoir au moins une équipe.'; end if;

  select gp.player_id into v_p1 from public.coaching_group_players gp
    where gp.group_id = v_group_id and gp.active order by gp.player_id limit 1;
  select gp.player_id into v_p2 from public.coaching_group_players gp
    where gp.group_id = v_group_id and gp.active and gp.player_id <> v_p1 order by gp.player_id limit 1;
  if v_p1 is null then raise exception 'Le groupe doit compter au moins un joueur actif.'; end if;

  select e.id into v_ex1 from public.exercises e where e.active order by e.id limit 1;
  select e.id into v_ex2 from public.exercises e where e.active and e.id <> v_ex1 order by e.id limit 1;
  if v_ex1 is null then raise exception 'Au moins un exercice actif requis.'; end if;
  if v_ex2 is null then v_ex2 := v_ex1; end if;

  v_att := jsonb_build_array(jsonb_build_object('player_id', v_p1, 'present', true));
  v_exs := jsonb_build_array(jsonb_build_object('exercise_id', v_ex1, 'position', 1));
  v_res := jsonb_build_array(jsonb_build_object('exercise_id', v_ex1, 'player_id', v_p1, 'successes', 3, 'attempts', 4));

  -- 1) Création transactionnelle par l'entraîneur : version = 1, workspace vérifié.
  select t.status, t.session_id, t.version into v_status, v_sid, v_version
    from public.save_training_session(
      p_session_id => null, p_expected_version => null,
      p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
      p_trained_on => current_date, p_label => 'LOTB validation', p_theme => 'Validation',
      p_duration_minutes => 45, p_notes => 'Créé par le script de validation',
      p_attendance => v_att, p_exercises => v_exs, p_results => v_res, p_force => false) t;
  if v_status is distinct from 'saved' or v_version is distinct from 1 then
    raise exception 'Étape 1 (création) : status = %, version = % (attendu saved/1).', v_status, v_version;
  end if;

  -- 2) Mise à jour atomique : plan à 2 exercices, version incrémentée.
  v_att := jsonb_build_array(jsonb_build_object('player_id', v_p1, 'present', true),
                             jsonb_build_object('player_id', v_p2, 'present', true));
  v_exs := jsonb_build_array(jsonb_build_object('exercise_id', v_ex1, 'position', 1),
                             jsonb_build_object('exercise_id', v_ex2, 'position', 2));
  v_res := jsonb_build_array(jsonb_build_object('exercise_id', v_ex1, 'player_id', v_p1, 'successes', 7, 'attempts', 8));
  select version into v_current from public.training_sessions where id = v_sid;
  select t.status, t.version into v_status, v_version
    from public.save_training_session(
      p_session_id => v_sid, p_expected_version => v_current,
      p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
      p_trained_on => current_date, p_label => 'LOTB modifié', p_theme => 'Validation',
      p_duration_minutes => 45, p_notes => null,
      p_attendance => v_att, p_exercises => v_exs, p_results => v_res, p_force => false) t;
  if v_status is distinct from 'saved' or v_version is distinct from 2 then
    raise exception 'Étape 2 (maj) : status = %, version = % (attendu saved/2).', v_status, v_version;
  end if;
  if (select count(*) from public.training_session_exercises where session_id = v_sid) <> 2 then
    raise exception 'Étape 2 : le plan devrait contenir 2 exercices.';
  end if;

  -- 3) Conflit de version : aucune écriture, remote_version restituée.
  select t.status, t.remote_version into v_status, v_remote
    from public.save_training_session(
      p_session_id => v_sid, p_expected_version => 1,
      p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
      p_label => 'Concurrent', p_attendance => v_att, p_exercises => v_exs, p_results => v_res,
      p_force => false) t;
  if v_status is distinct from 'conflict' or v_remote is distinct from 2 then
    raise exception 'Étape 3 (conflit) : status = %, remote_version = % (attendu conflict/2).', v_status, v_remote;
  end if;
  if (select label from public.training_sessions where id = v_sid) is distinct from 'LOTB modifié' then
    raise exception 'Étape 3 : conflit attendu sans écriture (label modifié).';
  end if;

  -- 4) Forçage explicite : écrase la version périmée, reste soumis aux contrôles.
  select t.status, t.version into v_status, v_version
    from public.save_training_session(
      p_session_id => v_sid, p_expected_version => 1,
      p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
      p_label => 'LOTB forcé', p_attendance => v_att, p_exercises => v_exs, p_results => v_res,
      p_force => true) t;
  if v_status is distinct from 'saved' or v_version is distinct from 3 then
    raise exception 'Étape 4 (force) : status = %, version = % (attendu saved/3).', v_status, v_version;
  end if;

  -- 5) Rollback sur donnée invalide (joueur inconnu) : version et données inchangées.
  v_raised := true;
  begin
    select t.status into v_status
      from public.save_training_session(
        p_session_id => v_sid, p_expected_version => 3,
        p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
        p_label => 'Casser',
        p_attendance => jsonb_build_array(
          jsonb_build_object('player_id', v_p1, 'present', true),
          jsonb_build_object('player_id', '00000000-0000-0000-0000-000000000000', 'present', true)),
        p_exercises => v_exs, p_results => v_res, p_force => false) t;
    v_raised := false;
  exception when others then null; end;
  if not v_raised then raise exception 'Étape 5 : joueur inconnu accepté à tort.'; end if;
  if (select version from public.training_sessions where id = v_sid) <> 3 then
    raise exception 'Étape 5 : la version a changé malgré l''échec.';
  end if;

  -- 6) Rollback APRÈS plusieurs écritures réussies : les présences sont réécrites puis
  --    l'insertion du plan échoue (position en double, contrainte UNIQUE). L'ensemble,
  --    y compris la nouvelle version de la séance, doit être annulé.
  v_raised := true;
  begin
    select t.status into v_status
      from public.save_training_session(
        p_session_id => v_sid, p_expected_version => 3,
        p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
        p_label => 'Plan en double',
        p_attendance => jsonb_build_array(jsonb_build_object('player_id', v_p2, 'present', true)),
        p_exercises => jsonb_build_array(jsonb_build_object('exercise_id', v_ex1, 'position', 1),
                                         jsonb_build_object('exercise_id', v_ex1, 'position', 1)),
        p_results => v_res, p_force => false) t;
    v_raised := false;
  exception when others then null; end;
  if not v_raised then raise exception 'Étape 6 : position dupliquée du plan acceptée à tort.'; end if;
  if (select version from public.training_sessions where id = v_sid) <> 3 then
    raise exception 'Étape 6 : la version a changé malgré l''échec.';
  end if;
  if (select count(*) from public.training_attendance where session_id = v_sid) <> 2 then
    raise exception 'Étape 6 : les présences réécrites auraient dû être annulées.';
  end if;
  if (select count(*) from public.training_session_exercises where session_id = v_sid) <> 2 then
    raise exception 'Étape 6 : le plan d''origine aurait dû être conservé (2 exercices).';
  end if;

  -- 7) Éditeur de workspace (pas coach du groupe) : création + modification permises.
  if v_editor_claim is null or v_editor_claim = '' then
    raise notice 'Étape 7 : éditeur non fourni — contrôles sauté.';
  else
    perform set_config('request.jwt.claim.sub', v_editor_claim, true);
    if (select exists(select 1 from public.coaching_group_coaches c
                      where c.group_id = v_group_id and c.user_id = auth.uid())) then
      raise exception 'Étape 7 : l''éditeur fourni est aussi coach du groupe — choisir un non-coach.';
    end if;
    if not (select exists(select 1 from public.workspace_members wm
                          where wm.workspace_id = v_workspace_id and wm.user_id = auth.uid()
                            and wm.role in ('owner','admin','coach'))) then
      raise exception 'Étape 7 : l''éditeur fourni n''est pas owner/admin/coach du workspace cible.';
    end if;
    select t.status, t.session_id, t.version into v_status, v_sid2, v_version
      from public.save_training_session(
        p_session_id => null, p_expected_version => null,
        p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
        p_trained_on => current_date, p_label => 'LOTB créée par éditeur', p_theme => 'Validation',
        p_duration_minutes => 30, p_notes => null,
        p_attendance => v_att, p_exercises => v_exs, p_results => v_res, p_force => false) t;
    if v_status is distinct from 'saved' or v_version is distinct from 1 then
      raise exception 'Étape 7a (création éditeur) : status = %, version = % (attendu saved/1).', v_status, v_version;
    end if;
    select version into v_current from public.training_sessions where id = v_sid;
    select t.status, t.version into v_status, v_version
      from public.save_training_session(
        p_session_id => v_sid, p_expected_version => v_current,
        p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
        p_label => 'LOTB édité par éditeur', p_attendance => v_att, p_exercises => v_exs,
        p_results => v_res, p_force => false) t;
    if v_status is distinct from 'saved' or v_version is distinct from v_current + 1 then
      raise exception 'Étape 7b (maj éditeur) : status = %, version = % (attendu saved/%).', v_status, v_version, v_current + 1;
    end if;
    perform set_config('request.jwt.claim.sub', v_coach_claim, true);
  end if;

  -- 8) Utilisateur non autorisé OU identité absente : refus sous RLS réelles.
  if v_unauth_claim is null or v_unauth_claim = '' then
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('request.jwt.claim.sub', v_unauth_claim, true);
  end if;
  v_raised := true;
  begin
    select version into v_current from public.training_sessions where id = v_sid;
    select t.status into v_status
      from public.save_training_session(
        p_session_id => v_sid, p_expected_version => v_current,
        p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
        p_label => 'Intrus', p_attendance => v_att, p_exercises => v_exs, p_results => v_res,
        p_force => false) t;
    v_raised := false;
  exception when others then null; end;
  perform set_config('request.jwt.claim.sub', v_coach_claim, true);
  if not v_raised then raise exception 'Étape 8 : accès non autorisé accepté à tort.'; end if;

  -- 9) Détournement de groupe interdit (le groupe d'une séance ne peut pas être changé).
  select g.id into v_other_group
    from public.coaching_groups g
    where not exists (select 1 from public.coaching_group_coaches c
                      where c.group_id = g.id and c.user_id = auth.uid())
    limit 1;
  if v_other_group is not null then
    v_raised := true;
    begin
      select t.status into v_status
        from public.save_training_session(
          p_session_id => v_sid, p_expected_version => (select version from public.training_sessions where id = v_sid),
          p_workspace_id => v_workspace_id, p_group_id => v_other_group, p_team_id => v_team_id,
          p_label => 'Détourné', p_attendance => v_att, p_exercises => v_exs, p_results => v_res,
          p_force => false) t;
      v_raised := false;
    exception when others then null; end;
    if not v_raised then raise exception 'Étape 9 : changement de groupe non autorisé accepté à tort.'; end if;
  else
    raise notice 'Étape 9 : aucun autre groupe pour tester le détournement (contrôle sauté).';
  end if;

  -- 10) Équipe d'un autre workspace refusée.
  select t.id into v_other_team from public.teams t where t.workspace_id <> v_workspace_id limit 1;
  if v_other_team is not null then
    v_raised := true;
    begin
      select t.status into v_status
        from public.save_training_session(
          p_session_id => v_sid, p_expected_version => (select version from public.training_sessions where id = v_sid),
          p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_other_team,
          p_label => 'Équipe étrangère', p_attendance => v_att, p_exercises => v_exs, p_results => v_res,
          p_force => false) t;
      v_raised := false;
    exception when others then null; end;
    if not v_raised then raise exception 'Étape 10 : équipe d''un autre workspace acceptée à tort.'; end if;
  else
    raise notice 'Étape 10 : aucune équipe d''un autre workspace pour tester (contrôle sauté).';
  end if;

  -- 11) Tout écrivain direct (ancien client / live) incrémente la version via le trigger,
  --      puis la RPC signale un conflit pour une version périmée.
  update public.training_sessions set notes = 'Écriture directe legacy' where id = v_sid;
  select version into v_current from public.training_sessions where id = v_sid;
  if v_current <= 3 then
    raise exception 'Étape 11 : l''écriture directe n''a pas incrémenté la version (version = %).', v_current;
  end if;
  select t.status, t.remote_version into v_status, v_remote
    from public.save_training_session(
      p_session_id => v_sid, p_expected_version => v_current - 1,
      p_workspace_id => v_workspace_id, p_group_id => v_group_id, p_team_id => v_team_id,
      p_label => 'Conflit post-direct', p_attendance => v_att, p_exercises => v_exs,
      p_results => v_res, p_force => false) t;
  if v_status is distinct from 'conflict' or v_remote is distinct from v_current then
    raise exception 'Étape 11 : status = %, remote_version = % (attendu conflict/%).', v_status, v_remote, v_current;
  end if;
end $$;

raise notice 'Lot B : scénarios validés (ROLLBACK final — aucune donnée persistée).';
rollback;