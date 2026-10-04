# Journal du refactor accueil / entraînement

Branche : `refactor/shared-page-code`. Aucun commit, push ou publication autorisé.

## 2026-10-04 00:48 — Reprise autonome

- Étapes 1 et 2 conservées dans l'état local : cartographie, 30 tests JSDOM et 10 tests Chrome.
- Objectif : terminer les étapes 3 à 10, avec une source unique pour le code partagé et des variantes explicites pour les deux pages.
- Décision : conserver les fonctionnalités accessibles sur chaque page et les contrats de données. Les différences de messagerie, validation de match et suivi joueur seront préservées, pas écrasées.
- Méthode : extraction pilote, puis séparation des fonctions et états à partir d'un parseur JavaScript. Pas de découpage par comptage d'accolades.
- Le journal sera mis à jour aux jalons et blocages ; aucun processus d'attente artificielle pendant huit heures.
- Blocage préexistant : migration SQL des catégories absente. Aucun SQL de remplacement ne sera inventé.

## Jalon — étape 3 validée, extraction des étapes 4 à 7 engagée

- `js/shared/utils.js` fournit une API immuable et pure ; les cinq copies ont été retirées des deux pages. Les 30 tests JSDOM passent après le pilote.
- Extraction sémantique avec Acorn et eslint-scope : seuls les identifiants résolus dans la portée globale sont remplacés par des accès à un contexte applicatif explicite.
- Les fonctions locales, paramètres, clés d'objets et contrats SQL restent inchangés. Les fonctions communes sont classées par responsabilité ; 25 variantes accueil et 24 variantes entraînement restent dans des politiques de page.
- Les points d'entrée de page deviennent de petits appels de démarrage. Les fonctions d'entraînement sont conservées dans un fichier spécifique.
- L'initialisation est ordonnée et protégée contre une seconde exécution. Les listeners ne sont pas ajoutés lors de l'import des modules.

## 2026-10-04 01:25 — Mutualisation et contrôles étendus

- 25 calculs sont maintenant purs ; le référentiel d'impact et les options de tri sont passés explicitement.
- Les lectures profils/groupes/joueurs/sélections et l'assemblage des datasets de matchs sont séparés du DOM, avec client et compte courant injectés.
- 19 composants HTML sont montés depuis une source partagée, avant le démarrage. Les écrans accessibles restent disponibles sur chaque page.
- 895 règles/nœuds CSS communs ont une source unique. Comparaison des styles calculés de tous les IDs avant/après sur six configurations : aucun écart.
- Les scripts locaux utilisent `defer` pour télécharger les modules en parallèle sans modifier leur ordre d'exécution.
- Les copies résiduelles de contrôleurs statistiques et du démarrage authentifié ont été consolidées. Les politiques ne portent plus que les différences réelles.
- Un défaut de transfert (`$$` interprété comme `$` dans une chaîne de remplacement) a été détecté par les tests, corrigé précisément, puis les 30 tests de référence ont repassé.
- Correctifs sensibles identifiés et testés séparément : refus d'association lorsque l'identité n'est pas résolue ou le dialogue absent ; verrou sur le claim et le démarrage ; Échap, focus contenu/restauré et annulation login sans erreur trompeuse.
- 49 tests JSDOM passent, dont concurrence, datasets historiques, changement de compte, sérialisation du plan et organisation des brouillons.
- En cours : parcours Chrome avec données simulées non vides, comparaison des écrans dynamiques et bilan final.

## 2026-10-04 02:30 — Validation fonctionnelle approfondie

- Les parcours Chrome peuplés couvrent groupes, préparation des matchs, réglages, statistiques, portail joueur et plans d'entraînement aux trois largeurs.
- Le parcours match a révélé un conflit de nom local `app` avec le contexte injecté : renommage précis du conteneur DOM, puis audit des portées originales pour vérifier l'absence d'autres collisions.
- Le harnais navigateur utilise maintenant HTTPS : son origine HTTP fictive ne fournissait pas `crypto.randomUUID`, contrairement au site publié et à localhost sécurisé. Aucun polyfill n'est ajouté à ce stade ; la compatibilité tablette de `crypto.randomUUID()` est traitée séparément (voir l'entrée « Compatibilité tablette de newUuid »).
- Les styles de 237 éléments d'un plan peuplé (brouillon, exercice dual et notes longues) sont identiques aux CSS d'origine à 1440, 820 et 390 px. Les six comparaisons de styles par ID restent également identiques.
- Correctif séparé : l'historique joueur manquant est implémenté avec les lectures existantes, filtrage du joueur, échappement des notes et rejet des réponses après changement de sélection. Aucun nouveau SQL/RPC.
- Correctifs du cycle de session : abonnement auth non bloquant pour éviter un verrou SDK, relecture de la session réelle avant association, invalidation d'un démarrage après déconnexion et purge des caches de compte.
- Les 59 tests JSDOM passent. Le test frontend catégories couvre création/édition/copie, catégorie archivée et focus dual contre un stockage isolé en mémoire ; cela ne valide pas les RLS.
- La suite SQL catégories reste bloquée par sa migration absente. La base distante n'a pas été sollicitée.
- En cours : dernier passage Chrome, contrôle de syntaxe de tous les fichiers, inventaire final et documentation de l'architecture.

## 2026-10-04 03:05 — Refactor structurel terminé

- Étapes 3 à 10 réalisées. Sources communes dans `js/shared/`, politiques dans `js/index.js` / `js/training.js`, édition des séances dans `js/training/sessions.js`.
- Vingt composants HTML ont une source unique, header compris. Les variantes de vues et les fonctionnalités accessibles ont été conservées.
- Duplication mesurée (blocs identiques d'au moins 20 lignes) : HTML 1 221 → 224 lignes ; JS des pages 6 617 → 0 ; CSS des pages 2 020 → 0.
- Pages allégées : HTML 344 / 545 lignes ; JS de page 120 / 98 ; CSS de page 230 / 188.
- Les nombreux scripts séparés augmentaient le nombre de ressources. Packaging déterministe en un bundle partagé, sans dépendance npm de production ; les tests refusent un bundle périmé. Instructions ajoutées à `AGENTS.md`.
- Dernier passage complet : **75 tests, 75 réussites, zéro échec, skip ou annulation** (59 JSDOM, 15 Chrome, un contrôle de packaging).
- Syntaxe : 31 fichiers JS/CJS valides. Bundle reconstruit puis vérifié. `git diff --check` réussi.
- Dernières comparaisons de styles : zéro écart pour tous les IDs aux six configurations et pour 237 éléments de plan peuplé aux trois largeurs.
- Benchmark comparatif local simulé : médianes navigation → écran utile à 820 px, accueil 97 → 122 ms, entraînement 141 → 139 ms. Pas de revendication d'accélération générale ou de mesure Supabase réelle.
- `supabase/`, `common.css`, PWA/service worker, manifeste et entraînement live inchangés par rapport à la référence. Aucun appel à la production pendant les tests.
- Documentation finale : `docs/shared-pages-architecture.md` ; références et limites dans `docs/refactor-baseline.md`.
- Limite maintenue : suite SQL catégories non validée, migration absente. Tests connectés/RLS et PWA réelle à vérifier sur données de test autorisées avant publication.
- Branche toujours `refactor/shared-page-code`, HEAD `de468af`. **Aucun commit, push, fusion ni publication.** Les fichiers sont dans l'arbre de travail local.

Le travail est achevé pour cette intervention ; aucun serveur ni processus de test n'est laissé volontairement en arrière-plan. Les dépendances, captures et outils temporaires sont conservés dans `/tmp/opencode/kb-refactor-tests/` pour permettre la reproduction des contrôles.

## 2026-10-04 — Blocage de la suite catégories levé

- Cause réelle du blocage : `tests/categories.test.cjs` visait `20260913154540_dynamic_exercise_categories.sql`, un fichier qui n'a jamais existé. La référence venait du test, pas de l'historique.
- Historique réel vérifié dans `supabase_migrations.schema_migrations` : 78 migrations appliquées, 9 fichiers dans `supabase/migrations/`. La base a aussi été modifiée hors CLI, donc `schema_migrations` ne décrit que les passages par la CLI.
- Quatre migrations restaurées sous leur timestamp et leur contenu d'origine : `152156`, `162416`, `220200`, `14124624`. `160434` était déjà présent. Le harnais les applique dans l'ordre réel.
- Les deux RPC ne sont plus supposés : `get_exercise_usage` vient de `162416`, `get_exercise_category_usage` de `220200`. La fixture ne fournit que le schéma de base de remplacement et `training_session_exercises`, exigée par les deux fonctions.
- Attentions dérivées du SQL réel : la suppression d'une catégorie native ne lève plus `permission denied` mais est filtrée par la policy `USING (not is_native)` ; `is_native` et `is_dual_focus` sont désormais refusés par les triggers de `160434`, plus par les droits ; le message sur copie archivée est « Choisissez une catégorie active avant de modifier cette copie. ».
- Deux assertions antérieures étaient inatteignables et ont été corrigées : le compte de catégories seeded (4, pas 5) et le trigger d'audit de la fixture, qui réécrivait `updated_at` pendant le rattachement et masquait ce que `152156` touche réellement. Les dates de fixture passent au 15 juin pour ne plus dépendre du fuseau.
- `openSettingsModule` mélange les catégories et les types de match ; le test appelle désormais `fetchExerciseCategories` puis `renderCategorySettings` pour isoler le scénario testé, sans ajouter de table `match_types` supposée.
- Contrôles : `categories.test.cjs` 3/3 ; 74 réussites sur les 5 autres suites, avec un test navigateur annulé par contention puis 15/15 seul ; bundle partagé conforme ; `node --check` et `git diff --check` réussis.
- Constats hors périmètre, documentés et non corrigés : le trigger `guard_exercise_category` interdit tout DELETE alors que `220200` et `14124624` ont ouvert ce droit, donc le bouton « Supprimer » ne peut pas aboutir ; les policies « delete unused » ne garantissent pas la condition d'inutilisation, que seul le front vérifie ; deux fichiers locaux portent un timestamp absent de l'historique réel et seraient réappliqués par `supabase db push`.
- Règle d'historique SQL ajoutée dans `AGENTS.md`.
- Branche `refactor/shared-page-code`, HEAD `3b21ad9`. **Commit `3b21ad9` poussé sur la branche de travail ; aucune fusion ni publication.** `main` reste à `de468af`. Base distante jamais sollicitée.

## 2026-10-04 — Compatibilité tablette de newUuid

- Cause : `crypto.randomUUID()` n'existe que dans un contexte sécurisé. Sur une tablette en HTTP (LAN), `window.crypto` existe mais `randomUUID` vaut `undefined` : la création d'un bloc de plan ou l'ajout d'un exercice à la séance s'interrompait sur une `TypeError`.
- `newUuid()` est ajouté à `js/shared/utils.js` et exposé via `app.newUuid`, le déstructuring de `bootstrap.js` étant le seul pont vers `app.*`. Trois paliers : `crypto.randomUUID()` ; `crypto.getRandomValues()`, disponible hors contexte sécurisé et donc celui qui débloque la tablette ; `Math.random()` seulement si Web Crypto est absent. Les bits version 4 et variante 10xx sont posés explicitement sur les deux derniers paliers, sinon `getRandomValues` produirait des identifiants non conformes.
- Les 8 appels directs de `js/training/sessions.js` passent par `app.newUuid()`. Aucun autre comportement modifié.
- Constat hors périmètre, laissé tel quel : `newPlanBlock()` génère déjà un `id` que les lignes 1103 et 1150 écrasent aussitôt, soit deux UUID jetés par bloc.
- Test dédié `tests/utils-uuid.test.cjs` : un JSDOM minimal charge uniquement `js/shared/utils.js`, sans démarrer l'application. `window.crypto` étant un accesseur configurable, chaque palier est forcé explicitement. Séquençage vérifié, format v4, variante et unicité sur les trois paliers ; l'exposition `app.newUuid` est vérifiée sur la page entraînement.
- Le harnais existant ne pouvait pas détecter ce défaut : son origine est HTTPS, donc `randomUUID` y est toujours présent.
- Contrôles : `utils-uuid.test.cjs` 4/4, y compris un test de mutation qui confirme que les assertions détectent la suppression du forçage de variante et du chemin natif ; 5 autres suites 66/67 ; bundle partagé conforme ; `node --check` et `git diff --check` réussis.
- Limite mesurée, préexistante : la suite navigateur est instable sur cette machine, dont le load average atteint 10 à 11. Comparée sur trois passages à HEAD sans ce changement, elle y a donné 3, 1 puis 4 annulations, contre 1 puis 0 puis 0 avec le changement. Un de ces timeouts s'est manifesté une fois par une assertion perdant la course contre le délai de 3000 ms du mock d'accès. Cause environnementale, non corrigée ici.
- Branche `refactor/shared-page-code`. **Aucun commit, push, fusion ni publication au moment de la rédaction de cette entrée.**
