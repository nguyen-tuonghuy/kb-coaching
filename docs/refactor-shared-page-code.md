# Refactor accueil / entraînement — cartographie et plan d'extraction

## 1. Périmètre et référence

- Étape 1 du chantier : analyse statique et documentation, sans modification du comportement.
- Référence : commit `de468af`, dépôt propre au départ, le 3 octobre 2026.
- Branche locale : `refactor/shared-page-code`. Aucun commit ni push pour cette étape.
- Sources principales : `index.html`, `training.html`, `js/index.js`, `js/training.js`, `css/index.css`, `css/training.css`, `css/common.css`.
- Sources adjacentes examinées : `js/pwa.js`, `service-worker.js`, `tests/categories.test.cjs`, migrations disponibles et liens de navigation vers les modules autonomes.

Les numéros de ligne ci-dessous sont des repères de cette référence. Les noms de fonctions et d'identifiants DOM sont les ancres à conserver lors des étapes suivantes.

### Méthode et limites

Comparaison des lignes avec `difflib.SequenceMatcher(autojunk=False)`, inventaire des IDs HTML avec `html.parser.HTMLParser`, recherche des déclarations et appels littéraux, puis lecture ciblée des fonctions et des différences. Les inventaires lexicaux ne constituent pas un graphe AST exhaustif ; les références dynamiques et l'accessibilité réelle des parcours devront être vérifiées à l'étape 2.

Aucune connexion à Supabase, mutation, mesure de démarrage, validation visuelle ou exécution de parcours utilisateur n'a été réalisée pour cette cartographie. Les écarts fonctionnels signalés sont constatés dans les sources, sans reproduction navigateur à ce stade.

## 2. Volume et structure actuelle

| Paire | Lignes accueil / entraînement | Lignes identiques dans des blocs contigus ≥ 20 lignes | Nombre de blocs |
|---|---:|---:|---:|
| HTML | 1 309 / 1 510 | 1 221 | 10 |
| JavaScript | 7 011 / 8 228 | 6 617 | 34 |
| CSS de page | 2 228 / 2 175 | 2 020 | 6 |

Ces valeurs incluent commentaires et lignes vides. Elles mesurent la duplication textuelle, pas le code mort ni le temps gagné par une extraction.

Les HTML contiennent respectivement 402 et 486 IDs distincts, dont **401 communs**. Le seul ID propre à l'accueil est `groupDetailCreateGroup`. L'entraînement possède 85 IDs supplémentaires, principalement pour les séances/exercices, mais aussi `groupPlayerFollowupMessage` et `groupPlayerFollowupHistory`.

Un ID commun n'implique pas un écran identique : dans `index.html:333–335`, `trainingHome`, `trainingSession` et `trainingHistory` sont des conteneurs vides cachés, alors que `training.html:326–447` contient les vrais écrans. Ils servent actuellement de compatibilité aux accès DOM partagés.

### Chargement

Chaque page charge, dans cet ordre, des scripts classiques en fin de document :

1. SDK Supabase depuis le CDN ;
2. son fichier JS de page ;
3. `js/pwa.js`.

Chaque JS crée son client `db`, déclare ses états et branche de nombreux événements pendant son évaluation. À la fin : `render()`, `initVideoDesktopResizer()`, puis `initAuth()`. Le HTML existe déjà, mais les états déclarés plus bas ne doivent pas être utilisés avant leur initialisation.

Les CSS de page précèdent `common.css`. Ce dernier peut neutraliser des règles de page ; comparer les fichiers CSS ne suffit donc pas à déduire le rendu réel.

## 3. Carte des responsabilités

Les bornes sont des zones de lecture, pas des blocs à déplacer tels quels.

| Responsabilité | Repères JS accueil / entraînement | États et dépendances | DOM et effets principaux | Cible proposée |
|---|---|---|---|---|
| Utilitaires | `escapeHtml:23/23`, dates `3387/3327`, normalisation `3431/3371` | Paramètres, fonctions utilitaires locales | Aucun pour les fonctions pures | Bibliothèque partagée, premier pilote |
| Vidéo de match | Début des fichiers, `loadYouTubeIframeApi:258/257` | `state`, lecteur, promesse API, tokens de reprise | `matchVideo*`, `videoPosition`, callback global YouTube, resize, stockage | Contrôleur vidéo séparé après utilitaires |
| Démarrage / session | `initAuthenticated:1048/1020`, `initAuth:1134/1090` | `db`, `currentUser`, groupes, accès joueur, callbacks de page | Splash, écrans initiaux, auth, tâches différées | Socle auth + politique de démarrage propre à la page |
| Invitations | `loadSharedPlayerInvite:507/506`, `claimPlayerInviteIfPresent:617/616` | `sharedInviteState`, profil, utilisateur, token/ID | `playerJoin*`, `playerClaim*`, URL, stockage, métadonnées auth, RPC d'association | Flux partagé sensible, pas le pilote |
| Espace joueur / messages / objectifs | Entre invitations et auth ; `loadPlayerPortalGroup:1021/993` | `playerPortalState`, `groupState`, accès, aperçu staff | `playerPortal*`, notifications, conversations, objectifs ; polling différent | Contrôleurs avec contexte joueur/staff explicite |
| Types de match / catégories | `matchTypeState:2929/2870`, `categoryState:3040/2981` | Catalogues, flags `busy`, utilitaires | `settingsHome`, listes et sélecteurs, lectures et mutations | Services de catalogues + contrôleurs de réglages |
| Profils / administration | `fetchProfiles:3270/3210`, `getMyProfile:3280/3220` | `db`, `currentUser`, `groupState.profiles`, `adminState` | `profilePopup`, accès admin, groupes admin | Services de données puis contrôleurs |
| Groupes / sélections / suivi joueur | `fetchMyGroups:3469/3409`, `openGroupDetail:3592/3531` | `groupState`, préférences dans `state`, profil courant | `groupsHome`, `groupDetail`, sélecteurs de plusieurs modules ; suivi divergent | Services groupes + présentation configurable |
| Matchs : capture / persistance | `start:1828/1770`, `persistEvent:1957/1899`, `loadMatch:1997/1939` | `state`, variables de saisie, rôles défensifs, `db` | `setup`, `live`, `popup`, terrains ; événements, attributions, compositions | Contrôleur de capture, mutations isolées ultérieurement |
| Bibliothèque / lecture / analyse de matchs | `fetchMatchLibrary:4128/4093`, `loadMatchAnalysisDataset:4716/4681` | `matchLibraryState`, `groupAnalysisState`, `analysisState`, profils | `matchLibrary`, `matchReadOnly`, `matchAnalysis*` | Service dataset + contrôleurs |
| Calculs statistiques / impact | `analysisStats:4459/4424`, `playerOffensiveImpact:4608/4573`, `statsImpactQuantile:6278/7442` | Événements ; certains calculs lisent `analysisState` ou `statsState` | Fonctions pures mêlées aux rendus HTML et aux lectures réseau | Calculs purs, puis adaptateurs d'état |
| Statistiques d'entraînement | `loadStatsData:5259/6432` | `statsState`, catégories, groupes, résultats | `statsHome`, sélecteurs, graphiques ; tables d'entraînement sur les deux pages | Service dataset entraînement + contrôleur stats |
| Séances / bibliothèque d'exercices | Zone propre à `training.js:5154–6363` ; `saveTrainingSession:6285` | `trainingState`, `categoryState`, groupes, `state.workspaceId` | `training*`, `exercise*`, présences, plans, résultats | Reste spécifique à la page entraînement |
| Navigation / assemblage | `hideMainModules:4113/4078`, `bindStatsControls:6806/8024`, branchements répartis | Tous les contrôleurs et capacités de page | Affichage/masquage, routes, listeners immédiats | Points d'entrée propres aux deux pages |

Le bloc de matchs identique de 837 lignes (`index.js:1826–2662` / `training.js:1768–2604`) et le bloc de bibliothèque/analyse de 759 lignes (`4111–4869` / `4076–4834`) contiennent plusieurs responsabilités. Leur taille n'est pas une raison pour les extraire en un seul module.

## 4. Dépendances transversales à rendre explicites

### États mutables

- `state` ne représente pas seulement un match : son `workspaceId` sert aussi à l'enregistrement des séances. Il est réassigné, notamment à la déconnexion. Capturer une référence définitive dans un module pourrait devenir incorrect.
- `currentUser` alimente auth, profils, audit, mutations et autorisations affichées. Prévoir un accès au contexte courant, pas une copie initiale.
- `groupState` combine groupes, effectifs, sélections, profils et notifications. Séparer progressivement les services de leurs mises à jour UI.
- `playerPortalState` combine identité personnelle, aperçu entraîneur, sélection de matchs et données secondaires. Ne pas transformer un aperçu staff en accès personnel du compte.
- `statsState` contient à la fois données, filtres, sélection, tri, référentiels et mode lecture seule. Ne pas déplacer ses consommateurs en prétendant qu'ils sont tous des fonctions pures.
- `analysisState.offensiveReference` est lu directement par `playerOffensiveImpact`; `statsImpactSortRows` lit le tri dans `statsState`. Injecter ces paramètres dans des lots distincts, après caractérisation.
- `trainingState` reste spécifique ; la sérialisation du plan avec `TRAINING_PLAN_MARKER` (`[[KC_PLAN_V1:`) et la compatibilité du champ `draft` doivent être préservées.

### Données Supabase

Familles d'accès constatées, avec exemples d'ancres et de contrats :

| Famille | Sources / appels | Frontière à respecter |
|---|---|---|
| Identité / contexte | `db.auth`, `user_profiles`, `workspace_members`, `workspaces`, `set_my_first_name` | Profil secondaire ≠ session indispensable ; `ensureWorkspace` peut créer des données |
| Groupes / effectifs | `coaching_group_coaches`, `coaching_groups`, `coaching_group_players`, `players`, tables `coaching_group_selection*` | Lectures séparées des créations, retraits et mutations de rôles |
| Invitations / droits joueur | `get_player_group_invite`, `get_my_player_access`, `claim_coaching_player_group_invite`, `claim_coaching_player_invite`, `unlink_coaching_player_account` | Consentement et RLS inchangés ; paramètres token / joueur conservés |
| Conversations / suivi | `get_player_conversation`, `mark_player_conversation_read`, `send_player_conversation_message`, `coaching_player_messages`, `coaching_player_message_history` | Lire une conversation peut marquer les messages lus ; ce n'est pas une lecture sans effet |
| Objectifs / notifications | `get_player_objectives`, RPC `add_*` / `update_*` / `delete_*` objectifs, `get_player_message_notifications`, `get_my_video_notifications` | Contexte joueur/staff explicite, tâches secondaires |
| Matchs | `matches`, `match_players`, `match_events`, `match_event_lineup`, `match_event_attributions`, `teams`, `match_types` | Préserver `action_type`, `result`, `fault_type`, `family`, `restart_location`, `zone` et les relations |
| Entraînement | `training_sessions`, `training_attendance`, `training_session_exercises`, `training_results`, `exercises`, `exercise_categories`, `get_exercise_usage` | Les deux pages lisent des statistiques d'entraînement ; l'édition appartient à `training.js` |
| Référentiel / administration | `get_active_offensive_reference`, `get_active_offensive_reference_meta`, `get_offensive_reference_sources`, `offensive_reference_versions`, `is_app_admin`, `admin_list_groups` | Calculs séparés du chargement et des opérations de gestion |

`fetchMyGroups` lit les données **et** remplit quatre sélecteurs. `fetchProfiles` écrit dans `groupState.profiles`. `fetchExerciseCategories` remplit `exerciseLibraryCategory`, absent de l'accueil mais toléré par sa version de `populateCategorySelect`. Ce sont des services candidats, pas encore des services indépendants du DOM.

`loadMatchAnalysisDataset` est un meilleur candidat ultérieur pour un service : il assemble matchs, événements, attributions, compositions et noms de joueurs. Conserver les enrichissements et les cas sans attribution ; ne pas remplacer ce contrat par le résultat brut de `matches`.

Les SQL des RPC ne sont pas tous présents dans les neuf migrations locales. Aucun changement de schéma ni création de RPC ne découle automatiquement de cette cartographie.

### Réutilisation, persistance et durée de vie

| Mécanisme actuel | Clé / état | Point de contrôle avant partage |
|---|---|---|
| Invitation en mémoire | `sharedInviteState.token` | Vérifier compte, nouveau token et fraîcheur de l'identité avant mutation |
| Profils en mémoire | `groupState.profiles[userId]` | Mutation du profil, déconnexion et changement de compte |
| Catalogues | `categoryState.categories`, `matchTypeState.types`, `busy` | Ce sont des listes en mémoire/verrous d'action, pas un cache réseau dédupliqué |
| Accès / statistiques | `playerPortalState.accesses`, `loading`, datasets dans `statsState` | Changement groupe/joueur/sélection, réponses tardives ; `loading` ne remplace pas une clé de requête |
| API YouTube | `youtubeIframeApiPromise`, callback global, tokens de reprise | Un seul chargement et nettoyage des interactions du lecteur |
| Contexte local de match | `kinball_coach_cloud_v200` | Clé commune aux deux pages ; garder les valeurs et le nettoyage existants |
| Sélection d'invitation | `kinball_player_invite_player` + query `player_id` | Annulation sans nettoyage ; éviter de réutiliser une sélection hors contexte |
| Largeur vidéo | `kinball_video_pane_ratio` | Préférence UI, distincte des données métier |
| Ordre des matchs d'impact | `statsImpactOrderStorageKey()` | Préserver sa construction contextuelle et son utilisation |

### Événements, timers et ordre d'initialisation

- Les `.onclick`, `.onchange`, `.oninput` et `addEventListener` sont répartis dans les fichiers, pas uniquement à la fin. Certains accès DOM sont inconditionnels, notamment `render()` sur `count`, `last`, `timeline` et les branchements sur `login`, `playerJoinContinue` ou `groupPlayerSharedLink`. `bindStatsControls()` protège en revanche de nombreux sélecteurs absents ; conserver cette tolérance pendant la transition.
- `initAuth` obtient la session et enregistre `onAuthStateChange`. La connexion explicite appelle aussi `initAuthenticated`. Caractériser les appels concurrents avant mutualisation, avec un seul abonnement par instance.
- Démarrage : garde splash de 4 secondes ; tâches secondaires différées par défaut de 900 ms. Groupes et accès joueur partent en parallèle. Ne pas rendre un profil ou un référentiel obligatoire au premier écran.
- Accueil seulement : polling de messages toutes les 5 secondes, suspendu fonctionnellement lorsque document/portail est caché, et listener `visibilitychange`.
- Autres listeners partagés : `hashchange`, délégation `document.click`, interactions pointeur sur la défense, resize vidéo. Entraînement : resize pour l'auto-agrandissement des notes et interactions d'organisation du plan.
- Aucun appel littéral `.channel()` / `.subscribe()` trouvé dans ces deux JS. Les abonnements auth et timers restent à gérer même sans realtime Supabase.
- `js/pwa.js` enregistre le service worker au `load`. `service-worker.js` ne met actuellement pas les ressources en cache lors des fetch ; ne pas introduire une stratégie de cache dans ce refactor.

### Routes à préserver

Accueil → `training.html`, `coach-videos.html`, `quick-collection.html`, `face-a-face.html`. Depuis le portail : `videos.html` et `player-stats.html` avec contexte `group` / `player` lorsque nécessaire.

Les retours `index.html#stats`, `index.html#team-stats`, `#player-home`, `#player-profile`, les paramètres `staff_group` / `staff_player` et les paramètres d'invitation sont des contrats de navigation. `AUTH_REDIRECT_URL` pointe vers l'accueil publié, même depuis la page entraînement. La mutualisation ne doit pas changer ces destinations implicitement.

## 5. Registre des divergences et points préexistants

**I** : différence de rôle de page à préserver. **V** : écart à caractériser et arbitrer avant extraction du module. **P** : problème/fragilité préexistant repéré statiquement, à vérifier séparément. Aucun de ces éléments n'est corrigé à l'étape 1.

| Type | Constat et preuve | Traitement avant extraction |
|---|---|---|
| I | `initAuthenticated` affiche l'accueil dans `index.js:1048`, mais lance `openTrainingModule` dans `training.js:1020` | Garder deux politiques de premier écran ; les retours `#stats` et `staff_*` sont traités par l'accueil |
| I | `homeBtn`, `trainingBackHome` et `openTrainingModule` naviguent différemment selon la page | Adapter la navigation, pas uniformiser toutes les fonctions |
| I | L'accueil possède `groupDetailCreateGroup` et le CSS `groupDetailEmbedded`; les notes/plans de séance sont spécifiques à l'entraînement | Préserver accordéons et ergonomie tactile ; supprimer uniquement après inventaire des consommateurs |
| V | `loadPlayerPortalConversation` préserve le scroll et n'efface pas la liste à chaque rafraîchissement dans `index.js:775`; `training.js:774` réaffiche « Chargement… » et scrolle en bas. Polling uniquement dans l'accueil (`828`) | Capturer les deux comportements ; décider d'une politique explicite plutôt que prendre une copie arbitrairement |
| V | `updateStartButton` vérifie métadonnées, quatre joueurs et URL vidéo dans `index.js:1361`; `training.js:1317` ne vérifie que groupe et quatre joueurs. Les listeners de revalidation diffèrent aussi | Examiner le parcours match depuis l'entraînement ; séparer tout correctif de validation du déplacement de code |
| V | `setMatchHeaderMode` cache toujours `count` dans `index.js:4109`, mais utilise `isMatch` dans `training.js:4074`. `common.css:73` impose toutefois `#count{display:none!important}` | Écart JS actuellement masqué par le CSS ; caractériser les états de header avant toute suppression de règle |
| V | `saveGroupPlayerFollowup` ne modifie que rôle/droits dans l'accueil ; l'entraînement charge/enregistre en plus un message et son historique (`openGroupPlayerFollowup`, `saveGroupPlayerFollowup`) | Ne perdre aucune mutation ni réintroduire des champs absents de l'accueil ; arbitrer la coexistence avec les conversations |
| V | `populateCategorySelect` tolère un sélecteur absent dans l'accueil, pas dans l'entraînement ; plusieurs sélecteurs stats ont la même divergence de nullabilité | Déclarer les éléments requis par module, pas généraliser des `?.` sans responsabilité claire |
| V | Gestion de visibilité de `editGroupNameBtn` différente après édition/annulation | Vérifier owner/non-owner et présentation intégrée avant partage du contrôleur |
| P | `training.js:8020` appelle `loadPlayerHistory`, dont aucune définition n'a été trouvée dans les sources JS/HTML du dépôt | Reproduire « Historique joueur » à l'étape 2 ; ne pas confondre l'échec préexistant avec une régression d'extraction |
| P | `addTrainingPlayers` utilise `trainingAddPlayers`, absent des deux HTML ; `loadTrainingGroupPlayers` subsiste également | Candidats vestigiaux, pas déclarés code mort sans examen des appels |
| P | `confirmPlayerClaimAssociation` utilise des libellés de repli si l'identité n'est pas résolue et un confirm natif générique si le popup manque ; aucun verrou englobant tout le claim n'apparaît dans cette fonction | Caractériser identité absente et concurrence avant extraction du flux sensible |
| P | L'annulation est filtrée dans plusieurs appelants, mais `login` appelle encore `handleError('login init', e)` sans filtrage (`index.js:1186`, même code dans l'entraînement) | Vérifier le parcours login → annulation ; les tests doivent couvrir les appelants, pas seulement le dialogue |
| P | `tests/categories.test.cjs:153` extrait un `<script>` inline depuis `index.html`, alors que les scripts sont externes. Le harnais attend aussi `trainingState` et les fonctions d'édition de séances absents d'`index.js` | Adapter le harnais au code actuel lors de l'étape 2 ; ne pas l'utiliser comme preuve de non-régression en l'état |

Les différences d'indentation seules existent aussi. Elles ne justifient ni réécriture complète ni commit de formatage mêlé à une extraction.

## 6. Premières frontières d'extraction vérifiées

| Candidat | Dépendances directes | Risque / lot |
|---|---|---|
| `escapeHtml`, alias `escapeAttr` | `String`, mapping local | Faible ; préserver traitement null et échappement, utilisé dans tout le rendu |
| `matchYoutubeId` | `URL`, expressions régulières | Faible ; parsing uniquement, aucune création de lecteur |
| `parseMatchVideoTime`, `formatMatchVideoTime` | `String`, `Number`, `Math` | Faible ; conserver précisément arrondis et valeurs invalides |
| `normalizeClaimName` | `String.normalize('NFD')` | Faible techniquement ; sémantique d'avertissement uniquement |
| `normalizeCategoryName`, `normalizeMatchTypeName` | `String.normalize('NFKD')`, transformations distinctes | Ne pas fusionner les deux algorithmes sous prétexte de similarité |
| `formatDateShort`, `isoToFrInput`, `frInputToIso` | `Date`, `formatDateShort`, locale française | Lot dates séparé : années à deux chiffres, dates invalides et fuseaux à caractériser |
| `normalizePlayerName`, `levenshtein`, `nearDuplicatePlayer` | Chaîne de fonctions, tableau de joueurs | Lot rapprochement séparé ; ne jamais convertir proximité en consentement |
| `analysisStats` et helpers sémantiques | `analysisSemanticType`, `analysisOutcome`, événements | Bon premier lot de calculs ; protéger fautes et défense illégale historiques |
| `emptyOffensiveCounts`, `addOffensiveObservation`, conversion d'événement | `OFFENSIVE_CONTEXTS`, `offensiveContextFromEvent` | Lot calculs suivant ; garder constantes et clés de contextes ensemble |
| `playerOffensiveImpact`, `statsImpactSortRows` | Référentiel/tri lus dans états globaux, helpers | Pas immédiatement purs ; introduire des paramètres après tests de caractérisation |
| `fetchGroupPlayers`, `fetchGroupSelections`, `getMyProfile` | `db`; utilisateur courant pour profil | Bons premiers services après utilitaires/calculs ; conserver tri, defaults et lignes absentes |

**Pilote recommandé pour l'étape 3 :** `escapeHtml` / `escapeAttr` et les trois fonctions de parsing/formatage vidéo. C'est un petit lot sans DOM, réseau, état métier ni changement de signature. Les dates et rapprochements restent des lots distincts.

## 7. Architecture de transition proposée

- Conserver initialement les scripts classiques et le client Supabase existant, un seul par page. Pas de framework, bundler ou migration globale en ES modules pour le pilote.
- Exposer les utilitaires via un namespace explicite, par exemple `window.KinballCoach.utils`, chargé avant le JS de page. Aucun effet DOM ou réseau lors du chargement de cette bibliothèque.
- Les `let` / `const` globaux des scripts classiques ne sont pas automatiquement des propriétés de `window`. Les services et contrôleurs futurs recevront explicitement `db`, les getters du contexte courant et les callbacks de page ; ils ne liront pas implicitement les anciens globaux.
- Garder les deux points d'entrée de page. Ne pas charger les deux JS monolithiques dans un même document.
- Définir ultérieurement les contrôleurs avec une initialisation unique, leurs éléments DOM requis et un nettoyage des listeners/timers. Un écran absent doit signifier « contrôleur non initialisé », pas « toutes les erreurs masquées par des tests de nullité ».
- Séparer lecture réseau, calcul, rendu et mutation progressivement. Ne pas ajouter simultanément un cache global ou une optimisation réseau au simple déplacement d'une fonction.
- Préserver les différences intentionnelles via callbacks/options de page. Une divergence fonctionnelle non arbitrée bloque l'extraction de ce flux, pas celle des utilitaires indépendants.

Ces noms et frontières sont des propositions d'implémentation, pas des fichiers déjà créés.

## 8. Ordre des prochains lots et portes de validation

| Étape du plan | Sous-lots proposés | Prérequis / sortie attendue |
|---|---|---|
| 2 — Référence de non-régression | Checklist des deux pages ; caractérisation des utilitaires et divergences ; références réseau/démarrage ; réparation ciblée du harnais de tests | Distinguer défauts existants, mocks et base réelle. Aucun test destructif sur des données utilisateur |
| 3 — Pilote | Bibliothèque utilitaires + branchement sur les deux pages + suppression des seules copies correspondantes | Tests de cas limites, syntaxe, scripts bien chargés, aucune nouvelle erreur |
| 4 — Calculs | Sémantique événements / `analysisStats` ; contextes offensifs ; impact/tri avec paramètres explicites | Tests sur anciennes valeurs, attributions collectives, zéro observation, référentiel absent |
| 5 — Données | Profils ; groupes/joueurs/sélections ; catalogues ; datasets matchs ; datasets stats entraînement | Même contrat de retour et mêmes filtres ; rendu découplé ; mutation/caches traités séparément |
| 6 — Flux sensibles | Invitations ; auth/session ; politiques de démarrage accueil/entraînement | Identités résolues, annulation intacte, concurrence maîtrisée, un abonnement auth ; ne pas normaliser les routes de page |
| 7 — Contrôleurs | Profils/réglages/groupes ; portail/messages ; bibliothèque/analyse ; capture/vidéo | Arbitrages V documentés ; initialisation et destruction explicites ; aucun DOM fantôme requis |
| 8 — CSS | Contrôles/dialogues ; composants groupes/portail ; composants stats ; retrait des copies | Inventaire de toutes les pages consommatrices de `common.css`, variantes et responsive réel |
| 9 — HTML | Retrait des conteneurs de compatibilité ; examen des modules maintenus dans entraînement ; dialogues réutilisables | Aucune suppression basée sur le seul fait qu'un écran est caché au démarrage ; parcours et liens conservés |
| 10 — Intégration | Diff global, parcours adjacents, performances/requêtes, duplication restante, documentation | Publication vers `main` uniquement après autorisation explicite et validation |

### Checklist à établir à l'étape 2

- Session absente/présente, login/logout, récupération de mot de passe, compte joueur/entraîneur/mixte et premier écran propre à la page.
- Invitation commune, retour email, confirmation/annulation/réessai, joueur introuvable et tentatives simultanées.
- Groupes, sélections, changement de nom, owner/non-owner, suivi et aperçu staff ; conservation de l'identité du compte.
- Match live/vidéo, champs requis, quatre joueurs, édition/lecture/analyse, attributions collectives, rôles défensifs et retour depuis Face-à-face.
- Portail, messages, scroll/polling, objectifs, accès aux stats équipe et liens vidéos/stats avec contexte.
- Séances, présences par sélection, plans/brouillons, notes longues, copie/édition, exercices et catégories archivées, historique joueur.
- Démarrage : session → groupes → splash ; sur entraînement, exercices/catégories et séances ; données secondaires et console/réseau.

Les améliorations de comportement éventuellement nécessaires seront des lots correctifs identifiés, pas des changements cachés dans une extraction.

## 9. État des vérifications de l'étape 1

- Mesures textuelles et IDs recalculés depuis les fichiers actuels ; exemples de dépendances et divergences relus dans les sources.
- Prérequis locaux contrôlés : pas de `package.json`, `jsdom` et `@electric-sql/pglite` non résolus par Node. À cette étape, le harnais catégories visait `20260913154540_dynamic_exercise_categories.sql`, un fichier qui n'a jamais existé ; ce blocage est levé depuis, voir [le bilan de référence](refactor-baseline.md).
- Tests fonctionnels non exécutés : cette étape ne modifie que la documentation et ne constitue pas une validation de l'application.
- La prochaine étape peut établir la référence de tests en commençant par les utilitaires indépendants ; les problèmes des catégories ne bloquent pas toute la cartographie ni le pilote.

L'étape 2 dispose maintenant d'un [bilan de référence de non-régression](refactor-baseline.md), avec tests exécutés, limites et checklist des parcours restants. Les constats ci-dessus restent la photographie statique de l'étape 1.
