# Refactor — étape 2 : référence de non-régression

Cette référence décrit l'état avant extraction. Le [bilan de l'architecture livrée](shared-pages-architecture.md) documente les contrôles étendus et les correctifs réalisés ensuite ; les tests de l'historique ont été adaptés à son implémentation.

## 1. Référence et portée

Établie le 3 octobre 2026 sur `refactor/shared-page-code`, à partir du code applicatif du commit `de468af` et de la [cartographie](refactor-shared-page-code.md). Les modifications de cette étape portent uniquement sur les tests et la documentation. Aucun commit, push, changement de schéma ou appel à la base distante.

**Référence automatisée disponible pour l'extraction pilote.** La validation complète de tous les parcours et du SQL reste partielle : la suite catégories est bloquée par une migration absente et les parcours connectés à Supabase n'ont pas été exécutés.

## 2. Harnais et fidélité au code courant

### JSDOM : `tests/helpers/page-harness.cjs`

- Lit le HTML actuel et exécute intégralement ses scripts locaux, dans leur ordre, sauf `js/pwa.js`.
- Utilise un contexte VM pour conserver les déclarations lexicales globales ; aucun extracteur de fonction ni copie de code métier.
- Aucun chargement de ressource externe. Le client Supabase est fourni par un mock qui journalise les appels et refuse les tables/RPC non prévues et les mutations de tables.
- Les timers sont enregistrés sans s'exécuter automatiquement. Les tâches différées ne permettent donc pas de mesurer un démarrage réel dans JSDOM.
- Les promesses sont attendues explicitement ; la fermeture de chaque fenêtre est assurée par le test.

### Chrome : `tests/browser-baseline.test.cjs`

- Charge le HTML, les CSS, JS et images actuels via des réponses HTTP interceptées, sans serveur à démarrer.
- Le SDK Supabase du CDN est remplacé par un mock injecté avant les scripts. Toute autre requête externe est bloquée et fait échouer le contrôle.
- Les timers réels du navigateur fonctionnent. Les lectures simulées ont une latence contrôlée ; aucun chiffre ne représente les performances de Supabase ou du site publié.
- Viewports explicitement fixés et contrôlés : **1440 × 900**, **820 × 900**, **390 × 900**.
- Le service worker est bloqué dans ces contextes : la PWA n'est pas validée par cette suite.
- Une seule instance de navigateur, contextes isolés et fermeture automatique après les tests.

## 3. Résultats réellement obtenus

| Contrôle | Résultat | Ce qu'il prouve |
|---|---|---|
| `tests/refactor-baseline.test.cjs` | **30/30**, zéro échec, annulation ou skip | Comportements caractérisés sur le code complet, DOM JSDOM, Supabase simulé |
| `tests/browser-baseline.test.cjs` | **10/10**, zéro échec, annulation ou skip | Chargement et démarrage simulés dans Chrome, login, géométrie du dialogue et annulation mobile |
| Captures des premiers écrans | Six captures produites et examinées, deux pages × trois largeurs | Référence visuelle de l'accueil entraîneur et de l'entraînement sans séance, pas des écrans d'édition |
| Suite catégories SQL/frontend | **Bloquée**, arrêt sur prérequis manquant | Aucune validation SQL, RLS ou frontend de cette suite |

Les tests de caractérisation décrivent parfois un comportement imparfait existant. Leur succès ne signifie pas que ce comportement est souhaitable : tout correctif volontaire doit adapter l'attente correspondante dans un lot identifié.

### Couverture des 30 tests de caractérisation

Les mêmes quinze cas sont exécutés sur chaque page :

1. Démarrage sans session : login visible, splash retiré, un abonnement auth, aucune lecture de table/RPC.
2. Échappement HTML et attributs : les caractères dangereux restent du texte, sans insertion d'image.
3. Parsing des IDs YouTube : ID brut, watch, lien court, embed, shorts, live et cas invalides.
4. Parsing/formatage des temps : valeurs vides, secondes, minutes/heures, fractions et valeurs invalides.
5. Dates et normalisations distinctes : conversion française, dates impossibles, accents et rapprochement de noms.
6. Statistiques historiques : faute offensive, défense illégale, échappé, faute de l'adversaire, dénominateur nul et zones anciennes.
7–9. Invitation : Retour, croix et confirmation ; vérification de l'absence d'appel claim avant consentement, de ses arguments après confirmation et de la conservation du contexte après annulation.
10. Conversation : contenu pendant la lecture différée et conservation/déplacement du scroll selon la page.
11. Match : différence de validation du bouton de départ et quatre joueurs requis.
12. Polling : spécifique à l'accueil, un seul intervalle de 5 secondes après deux initialisations, nettoyage lorsque le portail est masqué.
13. Historique joueur : observation explicite de la fonction manquante et reproduction de l'exception du handler sur l'entraînement.
14. Groupes : mapping du rôle et alimentation des sélecteurs présents.
15. Démarrage entraîneur : premier écran visible avec lecture d'accès joueur encore en attente ; notifications/admin ne sont pas obligatoires à cet instant.

### Couverture des 10 tests Chrome

- Six démarrages entraîneur : les deux pages à trois largeurs, sans débordement horizontal, avec la lecture d'accès joueur encore en attente lors du premier affichage.
- Deux démarrages sans session à 390 px : login accessible, sans lecture de données.
- Deux confirmations à 390 px : dialogue dans les limites du viewport, clic Retour, aucun claim ni nettoyage des métadonnées et token d'invitation conservé.
- Pour ces scénarios : aucune nouvelle erreur JS, ressource manquante ou requête externe non autorisée ; un seul abonnement auth.

## 4. Référence de démarrage et de requêtes — simulation seulement

Fixture entraîneur : un groupe avec rôle owner, workspace existant, aucun accès joueur, aucun exercice ni séance. Les lectures de tables/RPC répondent nominalement en 30 ms, sauf accès joueur **3 000 ms** et profils **700 ms**. Les délais réellement observés peuvent être supérieurs selon la charge du navigateur.

Exemple relevé lors du premier passage complet (temps depuis le début du script de page) :

| Page / largeur | Session | Groupes | Splash retiré | Séances/exercices affichés |
|---|---:|---:|---:|---:|
| Accueil / 1440 | 74 ms | 120 ms | 121 ms | Sans objet |
| Accueil / 820 | 5 ms | 38 ms | 39 ms | Sans objet |
| Accueil / 390 | 4 ms | 37 ms | 37 ms | Sans objet |
| Entraînement / 1440 | 4 ms | 40 ms | 40 ms | 87 ms |
| Entraînement / 820 | 4 ms | 41 ms | 41 ms | 78 ms |
| Entraînement / 390 | 3 ms | 35 ms | 36 ms | 73 ms |

Le passage de capture a confirmé les premiers écrans aux trois largeurs, avec des valeurs différentes, dont 350 ms pour séances/exercices à 390 px. **Ce ne sont pas des seuils de performance à imposer aux tests.** L'invariant contrôlé est l'affichage sans attendre le RPC d'accès joueur lent ; les durées sont des diagnostics.

Appels tables/RPC observés pendant la fenêtre de référence :

- Accueil : `get_my_player_access`, `coaching_group_coaches`, puis `workspace_members`, notifications messages/vidéos, `user_profiles`, `is_app_admin` — sept appels.
- Entraînement : mêmes appels, plus `exercise_categories`, `exercises`, `training_sessions` — dix appels. Les profils des auteurs n'ajoutent pas de lecture avec les listes vides de cette fixture.
- Aucun appel de mutation de table, création de workspace ou claim pendant ces démarrages.

Les traces et l'inventaire sont émis par les tests via des diagnostics JSON. Les lectures d'accès et de profil encore en cours y ont une durée `null`, pas une durée nulle. La suite ferme les contextes ensuite ; ce relevé n'est pas un inventaire de l'activité d'une session prolongée.

## 5. Défauts et divergences préexistants

### Reproduits par les tests

- **Historique joueur :** le handler `historyPlayer.onchange` appelle `loadPlayerHistory`, absent du runtime, et lève une `ReferenceError`.
- **Messagerie :** l'accueil conserve le contenu durant un rafraîchissement et le scroll lorsque l'utilisateur lit plus haut ; l'entraînement affiche « Chargement… » puis scrolle en bas. Le polling n'existe que dans l'accueil.
- **Départ match :** avec un groupe et quatre joueurs mais métadonnées vides, l'accueil désactive le départ, l'entraînement l'autorise.
- **Cas limites de parsing :** `matchYoutubeId` accepte aussi un paramètre `v` sur un autre domaine ; `parseMatchVideoTime('1:90')` donne 150 ; `frInputToIso('2026-02-31')` est transmis sans validation, alors que `31/02/26` est rejeté. Ces observations servent à éviter une modification silencieuse pendant le pilote.

### Repérés statiquement, encore à caractériser

- Identité joueur introuvable, libellés de repli du dialogue, repli `window.confirm` et concurrence sur le flux complet d'association.
- Annulation après login : l'appelant login ne filtre pas encore `playerClaimCancelled` comme les autres appelants.
- Différences du suivi joueur, de visibilité de l'édition du nom de groupe et des sélecteurs facultatifs.
- Fonctions potentiellement vestigiales utilisant `trainingAddPlayers` et différences de header masquées par `common.css`.

Les tests d'association actuels couvrent **un seul flux à la fois avec une identité résolue**. Ils ne prouvent pas les RLS, le résultat réel de la mutation ni l'absence de soumissions concurrentes.

## 6. Suite catégories : adaptation et exécution

`tests/categories.test.cjs` est adapté pour charger `training.html` et ses scripts externes complets via le harnais partagé, attendre le démarrage simulé et accéder aux fonctions actuelles. L'adaptateur SQL dispose maintenant d'un appel RPC paramétré vers la fonction réellement installée dans PGlite ; il ne simule pas un succès de RPC.

Le prérequis manquant est explicitement signalé :

`supabase/migrations/20260913152156_dynamic_exercise_categories.sql`

Aucun fichier `20260913154540_dynamic_exercise_categories.sql` n'a jamais existé : la référence venait du seul test, qui visait une migration absente de l'historique réel. La référence a été remplacée par les migrations effectivement appliquées, restaurées depuis `supabase_migrations.schema_migrations` sous leur timestamp et leur contenu d'origine :

| Fichier | Rôle dans le harnais |
| --- | --- |
| `20260913152156_dynamic_exercise_categories.sql` | table, 4 catégories système, rattachement des exercices |
| `20260913160434_reconcile_dynamic_exercise_categories.sql` | normalisation, gardes, droits par colonne (déjà présent) |
| `20260913162416_exercise_lifecycle_delete_archive.sql` | `get_exercise_usage` |
| `20260913220200_exercise_category_delete_when_unused.sql` | `get_exercise_category_usage` |
| `20260914124624_fix_exercise_category_authenticated_grants.sql` | droits de table qui élargissent ceux de `160434` |

`supabase/migrations/` n'est pas l'historique complet de la base de production, qui compte 78 migrations appliquées et a aussi été modifiée hors CLI ; seules celles nécessaires à cette suite sont restaurées. La suite s'exécute et passe, y compris le scénario frontend de bout en bout. Elle reste limitée à PGlite : elle ne valide ni les droits réels, ni les données de production.

Constat hors périmètre, non corrigé : le trigger `guard_exercise_category` interdit tout DELETE alors que `220200` et `14124624` ont ouvert ce droit. Le bouton « Supprimer » des réglages ne peut donc pas aboutir.

## 7. Checklist des parcours à compléter

| Parcours | Référence obtenue | Contrôle restant avant extraction du module |
|---|---|---|
| Démarrage / auth | Sans session et entraîneur avec groupe, simulés | Compte joueur seul/mixte, login/logout, changement de compte, retour email et récupération de mot de passe |
| Invitations | Dialogue résolu, confirmation/Retour/croix, mocks | Identité absente, annulation via login, retry, double soumission et tests serveur sur données de test |
| Groupes / sélections | Mapping rôles/sélecteurs, mocks | Création/join, owner/non-owner, renommer, retirer sans effacer l'historique, suivi et aperçu staff |
| Matchs / vidéo | Utilitaires, sémantique événements, validation divergente | Live/vidéo, lecture/reprise/édition, attributions, rôles défensifs, liens et chargement API YouTube |
| Analyses / impact | Calculs de base et valeurs historiques | Référentiel actif, multi-matchs, filtres, faibles volumes, vues staff/joueur et anonymisation |
| Messages / objectifs | Scroll et registre de polling, mocks | Envoi/lecture réels, changement de conversation, objectifs, erreurs réseau et session longue |
| Séances / exercices | Premier écran vide, captures | Données peuplées, présences/sélections, plans/brouillons, notes longues, copie/édition/suppression et catégories archivées |
| Navigation adjacente | Destinations cartographiées | Retours Face-à-face, vidéos, statistiques joueur, paramètres staff et navigation mobile au clavier/tactile |
| PWA / réseau réel | Non testé ; réseau de test intercepté | Comportement du service worker, cache, droits et latences Supabase sur données de test autorisées |

Ces contrôles sont à réaliser avant le lot qui modifie leur module, plutôt que considérer tout le chantier bloqué jusqu'à un smoke test exhaustif. Le pilote d'utilitaires peut s'appuyer sur les références déjà établies.

## 8. Reproduction

Environnement utilisé : Node `v24.21.0`, Chrome `138.0.7204.168`, `jsdom@30.1.1`, `playwright-core@1.63.0`, `@electric-sql/pglite@0.5.8`.

Le dépôt n'a pas de `package.json`. Dépendances installées hors projet dans `/tmp/opencode/kb-refactor-tests` ; elles ne sont pas incluses dans les livrables. Depuis la racine du dépôt, avec ces dépendances disponibles :

```bash
NODE_PATH=/tmp/opencode/kb-refactor-tests/node_modules node --test tests/refactor-baseline.test.cjs
NODE_PATH=/tmp/opencode/kb-refactor-tests/node_modules node --test tests/browser-baseline.test.cjs
```

Pour préparer cet environnement temporaire dans une autre session :

```bash
mkdir -p /tmp/opencode/kb-refactor-tests
npm install --prefix /tmp/opencode/kb-refactor-tests --no-audit --no-fund jsdom@30.1.1 playwright-core@1.63.0 @electric-sql/pglite@0.5.8
```

Le navigateur existant est utilisé, sans téléchargement. `CHROME_BIN` permet de remplacer `/usr/bin/google-chrome`. Pour les captures, définir `KB_BASELINE_ARTIFACTS` vers un dossier temporaire existant ; les captures de cette intervention sont dans `/tmp/opencode/kb-refactor-tests/artifacts`.

La commande suivante doit être exécutée séparément et **échoue actuellement sur son prérequis**, sans valider la base :

```bash
NODE_PATH=/tmp/opencode/kb-refactor-tests/node_modules node --test tests/categories.test.cjs
```

## 9. Décision pour la suite

Le pilote de l'étape 3 est préparé : `escapeHtml` / `escapeAttr`, `matchYoutubeId`, `parseMatchVideoTime`, `formatMatchVideoTime`. Conserver leurs résultats exacts, y compris les cas permissifs documentés, lors de l'extraction. Tout durcissement du parsing sera un correctif distinct.

Pour lancer : « Lance l'étape 3 sur la branche `refactor/shared-page-code`, sans commit ni push. »
