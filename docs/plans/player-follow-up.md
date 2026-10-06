# Plan d'évolution : UX et logique des statuts d'objectifs (Mon suivi)

## Métadonnées
- Branche : `feature/player-follow-up`
- État actuel : commits réalisés
  - f16802f Mon suivi : lisibilité du bloc "À revoir" + confort textarea note
  - ccc477f Mon suivi : simplifier aux états À travailler/Atteint, corriger pastille détail et fiche coach
  - 4f95cfe feat: simplify player objective follow-up
- Status Git : travail commité sur la branche ; `serve-no-cache.py` reste non suivi (hors périmètre)
- Migration : `20261005093000_player_objective_follow_up.sql` portée sur Supabase (version actuelle, sans `stage`)

## Problématique
Deux problèmes liés aux statuts d'objectifs :
1. Un objectif validé côté coach est déplacé dans « Objectifs atteints », mais l'ouverture de son détail affichait encore la pastille « À travailler » (bug corrigé partiellement).
2. L'interface coach distinguait À travailler / En progrès / Stabilisé d'un bouton séparé « Marquer atteint », ce qui est peu intuitif et crée des incohérences d'affichage.

## Objectif
Simplifier le modèle visible par l'utilisateur en seulement deux états :
- `À travailler` = `status='active'`
- `Atteint` = `status='completed'`

## Décisions prises
- Suppression complète des états `En progrès` et `Stabilisé`. Le `stage` et ses anciennes valeurs (`to_work`, `in_progress`, `stabilized`) ne font plus partie du nouveau modèle.
- Un objectif `status='completed'` doit toujours afficher « Atteint », même si son ancien `stage` vaut `to_work`, `in_progress` ou `stabilized`.
- Le statut réel en base (`status`) est prioritaire sur tout ancien `stage`.
- Une seule fonction de dérivation centralisée, conceptuellement : 
  ```js
  function getObjectiveDisplayState(objective) {
    if (objective.status === 'completed') {
      return 'completed';
    }
    return 'to_work';
  }
  ```
  Table unique des labels : `to_work` → `À travailler`, `completed` → `Atteint`.
- Côté coach, le sélecteur d'état doit être visible dans la fiche joueur : `À travailler | Atteint`, sans dépendre uniquement de la couleur.
- Cliquer sur `Atteint` appelle la logique de complétion existante (`complete_player_objective`). 
- Un objectif atteint rouvert revient à `À travailler` (via `reopen_player_objective`).
- Le bouton séparé « Marquer atteint » côté coach est supprimé.
- Même interprétation dans la liste joueur, les « Objectifs atteints », le détail et la fiche joueur côté coach.
- La migration a été portée sur Supabase dans sa version sans `stage` ; si une version expérimentale avait créé la colonne `stage`, elle appelle une migration corrective distincte (nouveau timestamp, non réécriture du fichier appliqué).
- Ne pas redéfinir `complete_player_objective` ni `reopen_player_objective` dans la migration (leurs définitions réelles existent déjà et mettent `updated_at = now()`).
- `update_player_objective_coach_fields()` : le coach ne doit pas pouvoir modifier le texte d'un objectif personnel (`source='player'`). Les objectifs personnels restent sous le contrôle du joueur.
- Conserver `coach_note`, `player_note`, `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, et les gardes `private.is_group_coach`.

## Plan d'implémentation

### 1. Migration SQL
Fichier : `supabase/migrations/20261005093000_player_objective_follow_up.sql`
- Conserver uniquement les colonnes nécessaires : `coach_note`, `player_note`.
- Supprimer l'ajout de la colonne `stage`, sa contrainte `stage_check`, son `backfill`.
- Retirer `set_player_objective_stage()`.
- Modifier `get_player_follow_up_objectives()` :
  - Supprimer `stage` du type retourné et du `SELECT`.
  - Ne plus dépendre de `stage` pour le tri (garder uniquement statut, source, dates).
  - Conserver `coach_note`, `player_note`, `updated_at`, les gardes d'accès existantes.
- Ne pas redéfinir `complete_player_objective` / `reopen_player_objective`.
- Adapter `update_player_objective_coach_fields()` :
  - Retirer le paramètre `p_stage`, mettre à jour la signature (4 args) et le `GRANT`.
  - Refuser explicitement de modifier le texte d'un objectif personnel (`source='player'`).
  - Autoriser uniquement la modification du texte si `source='coach'`.
  - Ne modifier `coach_note` sans prendre le contrôle du texte personnel.
  - Conserver comportement de validation existant.

### 2. Frontend JavaScript (source partagée)
Fichier : `js/shared/player-portal.js` (et réplique dans `js/shared/coaching.bundle.js` après build)
- Ajouter/centraliser `playerObjectiveDisplayState(o)` retournant `'completed'` si `o.status==='completed'`, sinon `'to_work'`.
- Créer table unique pour l'affichage : `to_work` et `completed` uniquement (labels, icônes, classes).
- Supprimer `playerObjectiveStageOf`, `playerObjectiveStageInfo`, branches héritées et tout usage de `stage` pour le rendu.
- Renommer noms, variables, attributs DOM `Stage` en `Status` (`playerFollowUpStatus*`, `data-followup-status`, etc.).
- Retirer `detailStage` de `playerPortalState`.
- Nettoyer données de démo (retirer propriétés `stage`).
- `playerObjectiveItemHtml()` :
  - Dériver uniquement depuis `displayState` (pas de booléen divergent).
  - Supprimer le bouton coach séparé « Marquer atteint » / « Réouvrir » (géré par sélecteur).
  - Toujours afficher la pastille cohérente avec `status`.
- `playerObjectivesHtml()` : simplifier à deux groupes (actifs / atteints), supprimer classement par `stage`, supprimer section « Stabilisés ».
- `renderPlayerFollowUpDetail()` :
  - Pastille dérivée uniquement de `status`.
  - Côté coach, afficher sélecteur `À travailler | Atteint`. Côté non-coach, pastille en lecture seule.
  - Clics sur sélecteur déclenchent immédiatement `complete_player_objective` ou `reopen_player_objective` ; après mutation, recharger objectifs et réafficher détail.
- `savePlayerFollowUpDetail()` : ne pas transmettre `p_stage` à `update_player_objective_coach_fields()`.
- `groupFollowUpObjectivesHtml()` et `groupFollowUpBindStagePickers()` :
  - Utiliser uniquement les deux états.
  - Transformer les boutons d'état pour appeler `complete_player_objective` / `reopen_player_objective` (plus d'appel à `set_player_objective_stage`).
  - Afficher objectifs coach actifs et atteints.

### 3. HTML
Fichiers : `index.html`, `training.html`
- Remplacer « Objectifs coach en cours » par « Objectifs coach ».

### 4. CSS
Fichier : `css/coaching-shared.css`
- Renommer classes vers `playerObjectiveStatus*` si nécessaire, garder compatibilité temporaire au strict minimum.
- Supprimer `.playerFollowUpStage.inProgress`, `.playerFollowUpStage.stabilized`.
- Supprimer `.followUpStageEdit`.
- Renforcer l'état actif du sélecteur (texte, icône, contour, graisse, `aria-pressed`).

### 5. Build et validation
- `node tools/build-coaching-runtime.cjs` pour régénérer `js/shared/coaching.bundle.js`.
- `node --check js/shared/player-portal.js` et `js/shared/coaching.bundle.js`.
- Contrôles ciblés : dérivation statuts, rendu liste/détail/fiche coach, protection objectifs personnels, choix RPC.
- `node --test --test-concurrency=1` sur test ciblé si ajouté.
- `git diff --check` (sans ligne vide en fin de fichier).
- Aucun lancement de migration Supabase ni commande distante.

## Vérifications attendues
- Objectif actif → « À travailler » (même avec ancien `stage='in_progress'`).
- Objectif atteint côté coach → déplacé dans « Objectifs atteints ».
- Ouverture du détail → pastille « Atteint ».
- Fermeture/réouverture du détail → reste « Atteint ».
- Rechargement complet → reste « Atteint ».
- Vue joueur et vue coach → même interprétation.
- Réouverture d'un objectif atteint → revient à « À travailler ».
- Un objectif dans « Objectifs atteints » ne peut jamais afficher « À travailler ».
