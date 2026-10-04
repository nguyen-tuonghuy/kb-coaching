# Architecture partagée accueil / entraînement

## État livré

Le refactor des étapes 3 à 10 est réalisé sur `refactor/shared-page-code`. Les deux pages utilisent une source commune pour leurs fonctions, états et composants partagés. Les différences fonctionnelles caractérisées restent explicites dans leurs points d'entrée.

La validation locale utilise des données simulées : elle ne constitue pas une validation des RLS ou du schéma distant. La suite SQL catégories reste bloquée par la migration manquante décrite dans [le bilan de référence](refactor-baseline.md).

Consulter [le journal](refactor-journal.md) pour l'ordre des décisions, correctifs, contrôles et limites.

### Mesures de duplication

Même méthode que l'étape 1 : blocs contigus d'au moins 20 lignes strictement identiques, commentaires et lignes vides inclus. Le bundle généré est exclu de la comparaison des sources de page.

| Paire de pages | Taille avant | Taille après | Lignes communes ≥ 20 avant → après |
|---|---:|---:|---:|
| HTML accueil / entraînement | 1 309 / 1 510 | 344 / 545 | 1 221 → 224 |
| JS de page | 7 011 / 8 228 | 120 / 98 | 6 617 → 0 |
| CSS de page | 2 228 / 2 175 | 230 / 188 | 2 020 → 0 |

Le HTML restant commun comprend de petites structures et des portions de vues dont l'ordre ou les actions diffèrent. Les vingt composants partagés volumineux et le header ont une source unique. Les lignes supprimées des pages ont été déplacées dans les sources partagées, pas supprimées avec leurs fonctionnalités.

## Sources et responsabilités

```text
index.html / training.html       structure et variantes propres aux pages
js/index.js / js/training.js     politiques de page + appel du démarrage
js/training/sessions.js          plans, exercices, présences, résultats, historique
js/shared/
  page-shell.js                 composants HTML statiques communs
  utils.js                      échappement et parsing vidéo, API immuable
  context.js                    contexte d'application unique par document
  calculations.js               calculs purs, API immuable
  data.js                       lectures profils, groupes, catalogues, entraînements
  match-data.js                 assemblage des datasets de matchs
  auth.js / session.js          invitations, auth, consentement, cycle de session
  player-portal.js              portail, objectifs, notifications et présentations
  groups.js / catalogs.js       contrôleurs groupes, profils, administration, réglages
  video.js / match-capture.js   lecteur vidéo et capture des événements de matchs
  match-library.js / analysis.js bibliothèque, lecture et analyse
  statistics.js                 contrôleurs et rendus statistiques
  bootstrap.js                  états initiaux, branchements UI ordonnés, démarrage
  coaching.bundle.js            publication générée des 17 modules communs
css/coaching-shared.css          structure commune à ces deux pages
css/index.css / training.css    variantes et responsive propres aux pages
css/common.css                  autorité visuelle partagée, chargée en dernier
tools/build-coaching-runtime.cjs assemblage déterministe, sans dépendance npm
```

Les modules sont des scripts classiques : aucun framework, serveur de templates ou transpilation n'est nécessaire. Les outils AST utilisés pour la migration ne sont pas des dépendances du projet.

### Contexte explicite

`window.KinballCoach.app` contient les états et fonctions de l'instance courante. Les contrôleurs reçoivent cet objet dans leur portée ; ils ne dépendent plus des déclarations lexicales globales des deux anciens monolithes.

Lorsqu'un état est réassigné (déconnexion/changement de compte), les contrôleurs relisent `app.state`, `app.groupState`, etc. Éviter de conserver une référence définitive à ces objets dans une extension.

- `KinballCoach.utils` : fonctions pures, sans effet DOM/réseau.
- `KinballCoach.calculations` : 25 calculs purs. Le référentiel d'impact et le tri sont des paramètres, pas des lectures implicites des états de page.
- `KinballCoach.createDataServices({db,getUser})` : client et compte courant injectés. Les lectures ne rendent pas l'UI et n'ajoutent pas de cache global.
- `KinballCoach.createMatchDataService(db)` : enrichissement des événements avec attributions, compositions, noms historiques et adversaires.
- `app.services` : services créés une fois pendant l'initialisation. Les façades de contrôleur publient les résultats dans les états et mettent à jour le DOM.

Les contrôleurs demeurent coordonnés par un contexte commun : ce refactor n'en fait pas des plugins indépendants de tous les autres modules. Les états de présentation et les mutations de métier restent dans leurs contrôleurs, avec leurs contrats existants.

## Démarrage et cycle de vie

Ordre de chargement : SDK Supabase → bundle commun → module séances sur l'entraînement → point d'entrée de page → PWA. Les scripts locaux portent `defer`, qui préserve cet ordre tout en permettant le téléchargement parallèle.

Le bundle monte les composants HTML puis enregistre les fonctions partagées. Le point d'entrée enregistre sa politique et appelle `KinballCoach.boot(page)`. Ce dernier installe les états, les services et les listeners, puis lance le rendu et l'authentification. Une seconde exécution du boot est ignorée.

Le splash et son logo restent dans le HTML initial. `coaching-shared.css` est préchargé pour éviter que son import ajoute une découverte tardive sur le chemin critique.

- Un seul client Supabase et un abonnement auth par document.
- L'abonnement auth ne retourne pas de promesse d'initialisation : les appels auth/réseau sont lancés hors du verrou SDK.
- Les initialisations simultanées du même compte partagent une tâche.
- Une déconnexion invalide un démarrage encore en attente, ferme le consentement, stoppe le polling et purge les caches de compte.
- Les tâches secondaires différées vérifient leur génération de session ; une ancienne tâche ne doit pas relancer un profil/workspace après déconnexion.
- L'accueil affiche son écran principal dès les groupes disponibles ; l'entraînement affiche sa structure puis ses séances/exercices. Les accès joueur et profils secondaires ne bloquent pas ces premiers écrans.

Les consommateurs d'un nouveau service asynchrone doivent vérifier le compte/contexte avant publication d'une réponse tardive. Ne pas ajouter un second démarrage ou listener pour compenser un ordre de chargement incorrect.

## Variantes conservées

- Destination initiale entraîneur et bouton Accueil propres à chaque page.
- Retours `#stats`, `#team-stats`, `#player-home`, `#player-profile`, `staff_group` et `staff_player` conservés.
- Messagerie : maintien du scroll et polling sur l'accueil ; comportement historique de rafraîchissement sur l'entraînement.
- Validation du départ d'un match : complète sur l'accueil, plus permissive sur l'entraînement, comme dans la référence.
- Suivi joueur : rôle/droits sur l'accueil ; message et historique supplémentaires sur l'entraînement.
- Présentation intégrée du groupe, organisation tactile des plans et notes longues préservées.

Les sélecteurs statistiques partagés tolèrent désormais un contrôle absent, conformément à la variante accueil. Cela n'altère pas le comportement des deux écrans complets et permet une séparation explicite des contrôles disponibles.

Les trois conteneurs d'entraînement vides de l'accueil restent des éléments de compatibilité pour les contrôleurs de navigation. Les écrans partagés de matchs/statistiques sont conservés : ils sont encore consommés par les branchements et parcours existants, et ne sont pas déclarés inutiles parce qu'ils sont cachés au premier affichage.

## Correctifs séparés du déplacement de code

### Association joueur

- Le compte, le joueur et le groupe doivent être résolus avant confirmation ; un libellé de repli ou un dialogue générique ne peut pas autoriser la mutation.
- Une seule tâche couvre résolution, consentement, mutation et nettoyage.
- Le compte affiché et la session auth réelle sont vérifiés avant le RPC.
- Retour, croix, fond et Échap annulent sans claim ni nettoyage de l'invitation.
- Focus initial, containment clavier, résolution unique et restitution du focus.
- Une annulation après login ne déclenche plus un message de panne.

La branche historique `player_invite` reste compatible avec son RPC direct. Aucun lien individuel n'est généré par ces pages ; elle n'a pas été transformée en nouveau flux de consentement. L'autorisation de l'association demeure côté Supabase/RLS.

### Historique joueur

Le handler absent est remplacé par un lecteur spécifique à l'entraînement : groupe entraîneur sélectionné, joueur résolu, lectures existantes, résultats filtrés, notes échappées, réponses obsolètes ignorées lorsque la sélection change. Aucun RPC ou champ SQL ajouté.

Les cas permissifs de parsing vidéo et de dates de la référence sont conservés ; leur durcissement serait une modification distincte.

## Édition et publication du bundle

**Éditer les modules sources, jamais `coaching.bundle.js`.** Après toute modification dans `js/shared/` :

```bash
node tools/build-coaching-runtime.cjs
node tools/build-coaching-runtime.cjs --check
```

Les modifications de `js/index.js`, `js/training.js` et `js/training/sessions.js` sont directement chargées et ne demandent pas une reconstruction du bundle.

Les harnais JSDOM/Chrome exécutent le code publié mais vérifient d'abord que le bundle correspond exactement aux sources. Un bundle périmé bloque les tests. Le fichier généré doit accompagner les sources dans tout commit, patch ou publication GitHub Pages.

Le packaging a été ajouté après mesure : la version à nombreux scripts séparés demandait 27/28 ressources dans le benchmark, contre 11/12 après packaging. La référence monolithique en demandait 9. Ces nombres incluent CSS/images/SDK simulé et dépendent du scénario ; ce ne sont pas des requêtes Supabase supplémentaires.

## Vérifications et limites

- 59 tests JSDOM et 15 tests Chrome passent ; le contrôle de packaging apporte un test supplémentaire sans dépendance.
- Chrome : viewports réels 1440, 820, 390 px ; premiers écrans, groupes, préparation de matchs, réglages, stats, portail et plans/historique avec fixtures peuplées.
- Styles par ID identiques avant/après aux six configurations ; styles de 237 éléments de plans peuplés identiques aux trois largeurs.
- Catalogue frontend : création/édition/copie, catégories archivées et focus dual validés contre un stockage isolé en mémoire.
- Aucun nouveau 404, appel externe non autorisé ou erreur JS dans ces scénarios ; pas de mutation distante.

Benchmark comparatif local à 820 px, même Chrome, ressources interceptées et latences simulées : médianes sur trois passages, navigation → écran utile, accueil **97 ms → 122 ms**, entraînement **141 ms → 139 ms**. Les premières mesures sont variables à froid. Ces chiffres ne garantissent pas les performances du site publié et ne prouvent pas une accélération générale de l'accueil.

La suite SQL/RLS catégories s'exécute : elle applique les migrations de catégories dans l'ordre réel de `supabase_migrations.schema_migrations`, restaurées dans Git sous leur timestamp d'origine. `supabase/migrations/` n'est pas l'historique complet de la base de production, qui compte 78 migrations appliquées et a aussi été modifiée hors CLI : `supabase db reset` reste donc impossible, et `supabase db push --include-all` réappliquerait des migrations déjà appliquées. Les tests connectés à Supabase et la PWA réelle ne sont pas validés par les mocks. Aucune migration distante appliquée. Les mutations réelles de matchs/séances doivent être vérifiées uniquement sur des données de test autorisées avant publication.

### Commandes de contrôle

```bash
node tools/build-coaching-runtime.cjs --check
node --test tests/build-runtime.test.cjs
NODE_PATH=/tmp/opencode/kb-refactor-tests/node_modules node --test tests/refactor-baseline.test.cjs tests/refactor-modules.test.cjs tests/catalog-frontend.test.cjs tests/browser-baseline.test.cjs
```

Les dépendances de test restent installées hors dépôt ; voir [préparation et versions](refactor-baseline.md#8-reproduction). Les captures et outils de comparaison temporaires sont dans `/tmp/opencode/kb-refactor-tests/` et ne font pas partie de la publication.
