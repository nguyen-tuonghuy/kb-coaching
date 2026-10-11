# Éditeur tactique G1 - progression et reprise

## État courant

- Branche de travail : `feature/tactical-diagram-editor`
- Étape active : G1.6 - Tracé en deux clics (terminé, tests Node exécutés) ; reste la validation navigateur manuelle de G1.7.
- État attendu : le dépôt reste exécutable après chaque étape ; aucun changement Supabase, commit ou push.

## Stratégie de reprise

En cas d'interruption, d'épuisement du quota ou de changement d'agent :

1. lire `AGENTS.md`, puis ce fichier ;
2. exécuter `git status --short`, `git branch --show-current` et `git diff` sans effacer les changements locaux ;
3. reprendre uniquement l'étape indiquée comme active ci-dessus ;
4. vérifier d'abord les tests déjà listés, puis terminer un incrément cohérent ;
5. actualiser ce fichier avant toute compaction de contexte ou interruption ;
6. ne jamais modifier Supabase, les sauvegardes d'entraînement, ni publier le travail G1.

## Format et architecture retenus

- Page autonome : `tactical-editor.html`.
- Styles de page : `css/tactical-editor.css`, puis autorité visuelle `css/common.css`.
- Modèle pur : `js/tactical-editor-model.js` (format, validation, historique, stockage local).
- Interface et rendu : `js/tactical-editor.js`, avec Konva.js épinglé côté page.
- Repère du document : carré logique de `1000 x 1000` unités, indépendant des pixels.
- Terrain : carré, avec métadonnées physiques isolées dans `document.court`. Le dépôt ne contenait aucune dimension sportive canonique ; la valeur de travail `20 x 20 m` est signalée par `basis: "working-default"` et ne pilote pas les coordonnées du document.

## Étapes

### G1.1 - Fondations

- Statut : terminé.
- Fonctionnalités terminées : branche dédiée ; page autonome reliée à l'accueil ; CSS et JavaScript externalisés ; Konva.js 9.3.18 épinglé ; canevas logique `1000 x 1000` ; terrain carré ; grille masquable ; zoom centré ; ajustement automatique ; déplacement de vue souris/tactile ; redimensionnement par `ResizeObserver`.
- Fichiers modifiés : `index.html`, `tactical-editor.html`, `css/tactical-editor.css`, `js/tactical-editor-model.js`, `js/tactical-editor.js`, `tests/tactical-editor.test.cjs`, ce document.
- Tests exécutés : `git diff --check` réussi. `node --check` et le test ciblé ont été tentés mais non exécutés car aucun binaire `node`, `nodejs`, `deno`, `bun`, Chromium ou Chrome n'est disponible sur le poste.
- Limitations : chargement initial de Konva dépend du CDN, comme les autres dépendances externes du projet ; validation visuelle non exécutée.
- Prochaine étape réalisée : G1.2.

### G1.2 - Éléments graphiques

- Statut : terminé, revue statique effectuée.
- Fonctionnalités terminées : joueurs noir/gris/rose avec marqueurs textuels N/G/R et numéros ; ballon reconnaissable ; flèches droites ; trajectoires courbes ; lignes continues/pointillées ; zones rectangle/ellipse ; texte libre ; couleurs, libellés et épaisseurs éditables selon le type.
- Fichiers modifiés : `tactical-editor.html`, `css/tactical-editor.css`, `js/tactical-editor-model.js`, `js/tactical-editor.js`.
- Tests exécutés : revue statique des fabriques d'objets, de leur validation et du rendu Konva ; `git diff --check` réussi.
- Limitations : rendu Konva non exécuté dans un navigateur sur ce poste.
- Prochaine étape réalisée : G1.3.

### G1.3 - Interactions d'édition

- Statut : terminé, sous réserve de validation navigateur.
- Fonctionnalités terminées : sélection simple, additive et par rectangle ; liste d'objets accessible au clavier ; déplacement simple/multiple ; déplacement fin aux flèches ; redimensionnement/rotation Konva ; modification des propriétés ; duplication ; suppression ; ordre avant/arrière ; annuler/rétablir ; raccourcis Ctrl/Cmd+S, Z, Maj+Z, Y, D, A, Suppr ; mode déplacement tactile ; protection des raccourcis natifs dans les champs.
- Fichiers modifiés : `tactical-editor.html`, `css/tactical-editor.css`, `js/tactical-editor.js`.
- Tests exécutés : revue statique ciblée des flux sélection, déplacement multiple, zoom/panoramique et Transformer ; correctifs appliqués après revue.
- Limitations : gestes réels souris/tablette non exécutés faute de navigateur disponible.
- Prochaine étape réalisée : G1.4.

### G1.4 - Sauvegarde et format

- Statut : terminé, tests automatisés écrits mais non exécutables sur ce poste.
- Fonctionnalités terminées : format JSON indépendant de Konva, version 1 ; identifiants stables ; validation stricte et limite d'import 2 Mo ; création ; stockage `localStorage` ; liste/réouverture ; renommage ; suppression confirmée ; import en nouvelle copie sans écrasement ; export JSON ; export PNG 2000 x 2000 ; avertissement avant perte ; statut non enregistré ; restauration garantie de l'éditeur après tentative PNG.
- Fichiers modifiés : `js/tactical-editor-model.js`, `js/tactical-editor.js`, `tests/tactical-editor.test.cjs`.
- Tests préparés : création/round-trip de tous les objets, rejets de formats invalides, historique immuable, stockage/liste/réouverture/suppression, coexistence d'une entrée locale corrompue.
- Tests exécutés : commande prévue `node --test tests/tactical-editor.test.cjs`, bloquée par l'absence de Node.
- Limitations : quota du stockage navigateur non simulé ; téléchargement réel JSON/PNG non vérifié.
- Prochaine étape : finaliser G1.5 et la validation globale G1.7.

### G1.5 / G1.7 - Interface et validation

- Statut : terminé sous réserve de validation navigateur manuelle.
- Fonctionnalités déjà présentes : disposition trois colonnes sur ordinateur ; canevas prioritaire et panneaux repliables sur tablette/téléphone ; contrôles tactiles de 42 px minimum ; dialogues locaux avec focus initial, piège de focus, Échap et restitution ; états vide, moteur indisponible, import invalide et absence de sélection ; design system chargé en dernier.
- Tests exécutés : deux revues statiques ciblées ; correction des flux de déplacement multiple, Transformer, import, titre/historique, validation des champs, restauration PNG, focus de la bibliothèque et sélection clavier ; dernière revue sans anomalie bloquante ; `git diff --check` réussi.
- Limitations : rendu desktop/tablette/mobile et Opera non encore vérifiés manuellement ; aucun navigateur automatisable présent.
- Prochaine étape : vérification manuelle dans Opera, puis exécution du test Node dès qu'un environnement avec Node est disponible.

### G1.6 - Tracé en deux clics et courbure

- Statut : terminé, syntaxe et tests Node exécutés avec succès.
- Fonctionnalités : les boutons Flèche, Trajectoire et Segment basculent en mode tracé ; premier clic = départ, mouvement = aperçu dynamique, second clic = arrivée et création de l'objet ; Échap ou clic sur un autre outil annule ; un second clic trop proche du départ est traité comme un geste involontaire et annulé. L'aperçu suit le zoom et le panoramique. Une trajectoire placée peut être infléchie après coup via le champ « Courbure » du panneau de propriétés.
- Choix techniques : événements de tracé basés sur `pointerdown`/`pointermove` de Konva pour éviter les doubles déclenchements `touchstart`/`mousedown` compatibles sur écrans tactiles ; l'objet n'est créé dans le document et l'historique qu'au second clic ; coordonnées converties dans le repère du document (`stageToLocal`) ; points stockés relatifs au centre du groupe ; `curvature` (défaut `0.3`, bornes `[-2, 2]`) persisté sur le type `curve` dans le format v1.
- Fichiers modifiés : `tactical-editor.html`, `css/tactical-editor.css`, `js/tactical-editor-model.js`, `js/tactical-editor.js`, `tests/tactical-editor.test.cjs`.
- Tests exécutés : `node --check` sur les trois JS modifiés ; `node --test tests/tactical-editor.test.cjs` : 7 tests passants (ajouts : points de contrôle d'une courbe, validation de `curvature` optionnelle ; les 5 tests G1.4 restent verts) ; `git diff --check` réussi.
- Limitations : gestes réels souris/tablette non exécutés faute de navigateur automatisable ; validation visuelle manuelle restante (voir vérification Opera, étape 3 bis).
- Prochaine étape : validation navigateur manuelle G1.7.

### G1.6b - Correctif de finalisation du tracé

- Statut : terminé, tests exécutés.
- Cause constatée dans Opera : au second clic, `finalizeDraw()` lisait `draw.end` alors que les gestionnaires ne stockaient que `draw.pointer` ; `end` valait donc `undefined`, provoquant une `TypeError` silencieuse dans le dispatch Konva et l'absence de création. Les autres soupçons (aperçu interceptant les événements, cible du clic, seuil de distance, réinitialisation précoce) ont été écartés : l'aperçu est non écoutant (`listening:false`), le gestionnaire dessin n'impose pas la cible au terrain, et la distance est mesurée dans le repère du document.
- Correction : le cycle complet (activation, premier clic, déplacement, second clic, destruction/annulation) est délégué à `Model.createDrawSession(type, start)` dans `js/tactical-editor-model.js` ; les gestionnaires réels `handleDrawPoint`, `updateDrawPreview` et `finalizeDraw` ne font plus que traduire les points de la scène et rendre l'aperçu Konva. `end` est désormais un paramètre explicite de `session.end(point)`, la dérive ne peut pas se reproduire. Le seuil `DRAW_MIN_SPAN = 12` unités document est nommé dans le modèle et partagé.
- Fichiers modifiés : `js/tactical-editor-model.js`, `js/tactical-editor.js`, `tests/tactical-editor.test.cjs`.
- Tests exécutés : `node --check` sur les trois JS ; `node --test tests/tactical-editor.test.cjs` : 9 tests, 9 passants (2 ajoutés : cycle complet pour arrow/line/curve avec objet validé et centré sur le milieu ; annulation quand le second clic reste sur le départ) ; `git diff --check` réussi.
- Limitations : le test exerce la session utilisée par les gestionnaires réels, mais ni Konva ni un clic navigateur ; validation visuelle Opera restante.

### G1.6c - Correctif d'intégration document / rendu

- Statut : terminé, test d'intégration ajouté.
- Cause : `session.end(point)` créait un objet valide, mais la refactorisation G1.6b avait supprimé l'ancien `this.document.objects.push(object)` avec `createDrawnObject()`. `finalizeDraw()` détruisait donc l'aperçu puis appelait `commit()` sur un document inchangé ; `commit()` restaurait l'instantané courant et `renderObjects()` conservait logiquement un `objectGroup` vide.
- Correction : `finalizeDraw(object)` insère l'objet dans `document.objects` avant de détruire l'aperçu et de commiter. Aucune modification des événements, coordonnées, couches ou autres outils.
- Test d'intégration : chargement du vrai contrôleur et double Konva minimal ; émission des vrais événements enregistrés par `bindStage`, création par `startDraw` / `handleDrawPoint`, rendu par `commit` / `renderObjects` / `buildNode`, puis nouveau rendu et changement d'outil. Flèche, Segment et Trajectoire sont vérifiés.
- Tests exécutés : `node --check` sur les trois JS ; `node --test tests/tactical-editor.test.cjs` : 10 tests, 10 passants ; `git diff --check` réussi.
- Limitation : le double Konva valide l'intégration du contrôleur et la persistance dans les groupes, pas le raster graphique réel d'Opera ; contrôle visuel final à refaire dans Opera.

## Contrat JSON v1 et préparation G2

Le document ne contient aucune donnée Konva. Sa racine est :

- `schema: "kinball-coach-tactical-diagram"` et `schemaVersion: 1` ;
- `id`, `title`, `createdAt`, `updatedAt` ;
- `canvas: { width: 1000, height: 1000 }` ;
- `court`, qui isole largeur, hauteur, unité, proportion et origine de l'hypothèse ;
- `objects`, ordonné de l'arrière vers l'avant, avec un `id` stable et un `type` par objet.

Les types v1 sont `player`, `ball`, `arrow`, `curve`, `line`, `zone` et `text`. Les coordonnées, rotations et échelles sont stockées dans le repère logique, pas en pixels écran. `validateDocument()` et `parseDocument()` contrôlent le contrat avant chargement.

Point d'intégration futur, sans G2 dans ce chantier :

- `window.KinballCoach.createTacticalEditor(root, options)` crée une instance ;
- `editor.loadDiagram(json)` charge une copie validée ;
- `editor.getDiagram()` retourne une copie JSON indépendante ;
- `editor.toDataURL(pixelRatio)` produit l'aperçu ;
- `KinballTacticalModel.createDocument()` crée autant de documents indépendants que nécessaire.

L'intégration future pourra persister ces objets et aperçus dans les séances sans modifier le format interne ni exposer Konva à la couche de données. Aucun code Supabase ou mécanisme A/B/C1/C2 n'a été touché.

## Vérification manuelle Opera

1. Servir la racine en HTTP et ouvrir `tactical-editor.html`, puis effectuer un rechargement forcé.
2. Vérifier l'absence d'erreur console et de 404, notamment pour Konva 9.3.18, les deux scripts et les deux CSS.
3. Ajouter chaque type d'objet ; vérifier les marqueurs N/G/R, les libellés, les lignes pointillées et la trajectoire courbe.
3 bis. Tracé : activer Flèche/Trajectoire/Segment, cliquer, tracer un aperçu en déplaçant la souris, cliquer pour créer ; vérifier Échap (annulation), un second clic au même endroit (annulation avec message), la courbure par défaut d'une trajectoire, puis son ajustement après coup ; vérifier le tracé au doigt sur tablette/téléphone, y compris avec zoom.
4. Sélectionner par clic, Maj + clic, rectangle et liste clavier ; déplacer une sélection multiple ; transformer puis annuler/rétablir.
5. Tester zoom molette/boutons, ajustement, grille et déplacement de vue à la souris puis au tactile.
6. Modifier les propriétés, l'ordre, dupliquer et supprimer ; vérifier Ctrl/Cmd+S, Z, Maj+Z, Y, D, A, Suppr et flèches.
7. Enregistrer, recharger la page, ouvrir le schéma et comparer tous les objets et coordonnées.
8. Renommer et supprimer un schéma ; vérifier confirmation, focus du dialogue et avertissement de modifications non enregistrées.
9. Exporter puis réimporter le JSON ; vérifier qu'une nouvelle copie est créée sans écraser l'original et que les objets sont identiques.
10. Exporter le PNG et vérifier qu'il est lisible, complet et sans poignées de sélection.
11. Tester environ 1440 px, tablette paysage/portrait et téléphone autour de 390 px : canevas prioritaire, panneaux repliables, boutons tactiles et page consultable.

## Limites connues

- Konva est chargé depuis jsDelivr et nécessite donc le réseau au premier chargement ; le service worker actuel ne met aucun asset en cache.
- L'éditeur ne gère ni animation, ni chronologie, ni synchronisation cloud, conformément au périmètre G1.
- Les tests automatisés de modèle ont été exécutés avec Node 18.19.1 : `node --test tests/tactical-editor.test.cjs` donne 7 réussites, 0 échec ; syntaxe vérifiée par `node --check`.
- Aucun navigateur local n'étant automatisable sur ce poste, le rendu et les gestes tactiles restent à valider dans Opera (voir liste ci-dessus, y compris le tracé en deux clics).
- La dimension `20 x 20 m` est une valeur de travail isolée, non une nouvelle constante sportive affirmée par le dépôt ; le repère graphique reste indépendant en `1000 x 1000`.
