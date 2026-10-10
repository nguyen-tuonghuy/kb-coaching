-- ============================================================================
-- Lot C2 — Preuve de concurrence du bail d'edition (PostgreSQL REEL, DEUX connexions).
-- Fichier de TEST uniquement. NE PAS executer sur la production ni sur des
-- donnees reelles. Aucune modification de schema, aucune ecriture metier durable.
-- ============================================================================
--
-- POURQUOI CE FICHIER EXISTE
--   Le harnais PGlite (tests/training-transaction.test.cjs) est mono-connexion : il ne peut
--   pas prouver qu'une acquisition de bail attend la fin d'une ecriture live en cours. Le
--   verrou BEFORE STATEMENT (private.lock_live_training_session_lease) se juge uniquement
--   avec deux sessions concurrentes. Ce script ne remplace donc PAS PGlite.
--
-- CE QUI EST PROUVE (etat actuel de la migration)
--   Une ecriture live directe (js/training-live.js : INSERT/UPDATE sur training_attendance,
--   training_live_periods, training_live_events) ne passe pas par activate ; le declencheur
--   BEFORE STATEMENT private.lock_live_training_session_lease prend un SELECT ... FOR UPDATE
--   sur la ligne du bail AVANT tout verrou de ligne. Tant que la transaction live est
--   ouverte, sa ligne de bail reste verrouillee. Meme si le bail est EXPIRE (donc eligible a
--   une reattribution par acquire), acquire (INSERT ... ON CONFLICT ... DO UPDATE) doit
--   attendre le COMMIT/ROLLBACK de l'ecriture : il ne peut pas reattribuer le bail pendant
--   l'ecriture. C'est precisement la garantie que ce script met en evidence.
--
-- CE QUE CE SCRIPT DEMONTRE CONCRETEMENT
--   1) Le bail est acquis dans une transaction DISTINCTE puis COMMITe : le blocage observe
--      ensuite ne peut donc pas etre attribue a une insertion non validee.
--   2) Ensuite seulement, une ecriture live valide est faite dans une NOUVELLE transaction
--      qui reste ouverte (le bail est des lors verrouille).
--   3) Le bail est amene a expiration pendant que la transaction live est ouverte. La session
--      concurrente attend cette expiration AVANT d'appeler acquire, qui reste neanmoins
--      BLOQUEE jusqu'au COMMIT/ROLLBACK de la transaction live.
--   4) L'ecriture live est toujours faite AVANT expiration : elle utilise un bail valide.
--      (Une ecriture avec bail deja expire serait, a juste titre, refusee 55000.)
--
-- PREREQUIS
--   * Base de TEST (pas la production). Serveur PostgreSQL reel.
--   * DEUX connexions INDEPENDANTES (deux terminaux psql, ou deux onglets SQL). Un seul
--     onglet serialiserait tout et ne prouverait rien.
--   * Role d'ADMINISTRATION (proprietaire de la table, ex. postgres) : necessaire pour
--     l'etape 2 (avancer l'expiration du bail) ET pour le nettoyage. Sur une base de test
--     cela reste une lecture/ecriture locale sur la table de bail, jamais sur les donnees
--     metier.
--   * Aucune extension requise.
--
-- A RENSEIGNER (remplacer partout) :
--   <UUID_ENTRAINEUR>  : utilisateur coach du groupe de la seance.
--   <UUID_SEANCE>      : identifiant d'une seance de ce groupe ayant au moins une presence.
--   <UUID_JOUEUR>      : joueur present sur cette seance (ligne training_attendance).
--   <UUID_INSTANCE_1>  : UUID d'onglet pour la session 1 (gen_random_uuid() convient).
--   <UUID_INSTANCE_2>  : UUID d'onglet distinct pour la session 2.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ETAPE 0 — Reperage des donnees (LECTURE SEULE, sur la connexion ADMIN)
-- ---------------------------------------------------------------------------
-- select s.id as session_id, s.group_id, a.player_id
--   from public.training_sessions s
--   join public.training_attendance a on a.session_id = s.id
--  where s.group_id in (select group_id from public.coaching_group_coaches
--                        where user_id = '<UUID_ENTRAINEUR>')
--  order by s.trained_on desc
--  limit 1;
-- Relever <UUID_SEANCE> et <UUID_JOUEUR>. Relever aussi le group_id (controle final).


-- ===========================================================================
-- SESSION 1 — Phase A : acquisition du bail dans une transaction PROPRE, puis COMMIT
-- ============================================================================
begin;
select set_config('request.jwt.claim.sub','<UUID_ENTRAINEUR>',true);
set local role authenticated;

select status, lease_token, expires_at
  from public.acquire_training_session_lease('<UUID_SEANCE>'::uuid, '<UUID_INSTANCE_1>'::uuid);
-- Attendu : status = 'acquired'. Relever <JETON_1> (colonne lease_token).

commit;     -- OBLIGATOIRE : le bail doit etre valide et visible AVANT le scenario concurrent.
-- SESSION 1 reste connectee (elle sert a l'etape 3) mais sa transaction est terminee.


-- ---------------------------------------------------------------------------
-- ETAPE 2 — Avancer l'expiration du bail (connexion ADMIN, base de TEST uniquement)
-- ---------------------------------------------------------------------------
-- Objectif : rendre le bail "expire" pendant la transaction live afin de prouver que
-- l'ecriture en cours empeche SA reattribution. La fenetre ci-dessous doit rester
-- suffisante pour executer l'etape 3 juste apres (une vingtaine de secondes).
-- update public.training_session_leases
--    set acquired_at = statement_timestamp(),
--        expires_at  = statement_timestamp() + interval '20 seconds'
--  where session_id = '<UUID_SEANCE>'::uuid;
-- -- Controle : doit renvoyer true une fois la fenetre ecoulee (lecture non bloquante) :
-- select expires_at, expires_at <= statement_timestamp() as expire
--   from public.training_session_leases
--  where session_id = '<UUID_SEANCE>'::uuid;
-- NB : sur une base sans droits d'ecriture sur la table, utiliser la VARIANTE NATURELLE
--      en fin de fichier (bail laisse a 90 s, transaction live plus longue).


-- ===========================================================================
-- ETAPE 3 (SESSION 1) — ecriture live VALIDE puis maintien de la transaction
-- ===========================================================================
-- A executer immediatement apres l'etape 2 (fenetre encore valide).
begin;
select set_config('request.jwt.claim.sub', '<UUID_ENTRAINEUR>', true);
set local role authenticated;
select set_config('request.headers',
  json_build_object(
    'x-kb-editor-instance-id', '<UUID_INSTANCE_1>',
    'x-kb-lease-token', '<JETON>'
  )::text, true);

-- Ecriture reelle sur une ligne existante. Le declencheur BEFORE STATEMENT verrouille la
-- ligne du bail AVANT tout verrou de ligne ; le declencheur de ligne valide le bail.
-- present = present : aucun changement de valeur metier.
update public.training_attendance
   set present = present
 where session_id = '<UUID_SEANCE>'::uuid
   and player_id  = '<UUID_JOUEUR>'::uuid;
-- Si cette instruction echoue avec « Bail d edition absent » (55000), la fenetre de
-- l'etape 2 etait deja ecoulee : reprendre a l'etape 1 avec une fenetre plus large.

-- Maintenir la transaction OUVERTE pendant que le bail expire et que la session 2
-- tente son acquisition. Le verrou du bail est tenu sur toute cette duree.
select pg_sleep(60);

-- NE PAS COMMITER tout de suite : laisser la session 2 bloquer (etape 4), puis revenir.
-- Fin a l'etape 5. (commit; ou rollback;)


-- ===========================================================================
-- ETAPE 4 (SESSION 2) — attendre l'expiration, puis acquerir (doit rester BLOQUE)
-- ===========================================================================
-- Connexion INDEPENDANTE. A lancer des que l'etape 3 est engagee.
-- \timing on   -- (psql) pour mesurer la duree du blocage.
begin;
select set_config('request.jwt.claim.sub', '<UUID_ENTRAINEUR>', true);
set local role authenticated;

-- Attendre que le bail soit reellement expire (fenetre de l'etape 2 = ~20 s).
select pg_sleep(25);

-- Acquisition. Le bail est EXPIRE a ce stade : sans verrou concurrent, acquire
-- reattribuerait immediatement. Ici, l'ecriture live de la session 1 tient encore le
-- verrou de la ligne de bail : cet appel doit RESTER BLOQUE jusqu'a la fin de l'etape 3.
select status, holder_user_id, lease_token, expires_at
  from public.acquire_training_session_lease('<UUID_SEANCE>'::uuid, '<UUID_INSTANCE_2>'::uuid);
-- Attendu APRES le commit/rollback de la session 1 : status = 'acquired' (reattribution),
-- et une duree de blocage d'environ 35 s (~60 s de l'etape 3 moins les 25 s deja attendues).
-- Relever <JETON_2> (nouveau jeton de la session 2).


-- ===========================================================================
-- ETAPE 5 (SESSION 1) — terminer la transaction live
-- ===========================================================================
-- commit;     -- libere le verrou de bail ; la session 2 se debloque alors.
-- (rollback;   equivalent ici : l'ecriture ne modifie aucune valeur.)


-- ===========================================================================
-- ETAPE 6 — Nettoyage des donnees de test (base de TEST uniquement)
-- ===========================================================================
-- La session 2 est devenue detentrice du bail (etape 4) : liberer ce bail.
--   select public.release_training_session_lease(
--     '<UUID_SEANCE>'::uuid, '<UUID_INSTANCE_2>'::uuid, '<JETON_2>'::uuid);
--   commit;
-- Verification : plus aucun bail, et la seance comme les presences sont inchangees.
--   select * from public.training_session_leases where session_id = '<UUID_SEANCE>'::uuid; -- 0 ligne
--   select count(*) from public.training_sessions where id = '<UUID_SEANCE>'::uuid;         -- 1
--   select present from public.training_attendance
--     where session_id = '<UUID_SEANCE>'::uuid and player_id = '<UUID_JOUEUR>'::uuid;      -- valeur d'origine
-- Aucun nettoyage metier n'est necessaire : l'etape 3 ecrit present = present et peut etre
-- terminee par rollback.


-- ===========================================================================
-- CRITERES DE REUSSITE OBSERVABLES
--   * Etape 4 : l'appel acquire NE renvoie PAS immediatement. Il reste bloque pendant
--     plusieurs dizaines de secondes (mesure \timing), jusqu'a la fin de l'etape 3.
--   * Etape 4 : status = 'acquired' APRES la fin de l'etape 3 (bail expire reattribue
--     seulement une fois l'ecriture terminee).
--   * Aucun « deadlock detected » cote serveur.
--   * Etape 6 : table des baux vide pour la seance ; seance et presence inchangees.
-- CONTRE-EPREUVE (ce que l'on evite) : sans le verrou BEFORE STATEMENT, acquire trouverait
-- un bail expire et le mettrait a jour immediatement des l'etape 4, pendant que la
-- transaction live est encore ouverte. Le fait que l'appel reste bloque EST la preuve.
-- ============================================================================


-- ===========================================================================
-- VARIANTE NATURELLE (sans droits d'ecriture sur la table de bail) — repli
-- ===========================================================================
-- Remplacer les etapes 2 et 3 par : aucune modification d'expiration, et laisser la
-- transaction live ouverte plus longtemps que le TTL produit (90 s).
--   Etape 1 : acquire + COMMIT (inchange).
--   Etape 2 : supprimee.
--   Etape 3 (SESSION 1) : begin; ... update ...; select pg_sleep(150);  -- > TTL 90 s
--   Etape 4 (SESSION 2) : begin; select pg_sleep(100);  -- > TTL 90 s
--                         select ... from acquire_training_session_lease(...);
--   Etape 5 (SESSION 1) : commit;  -- la session 2 se debloque alors.
-- Meme critere de reussite : l'appel de l'etape 4 reste bloque au-dela de l'expiration
-- (100 s) jusqu'a la fin de l'etape 3 (150 s), puis renvoie 'acquired'.
-- ============================================================================
