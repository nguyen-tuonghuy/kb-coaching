# AGENTS.md — Kinball Coach

Instructions pour les agents de développement. **Portée : tout le dépôt**, y compris HTML, CSS, JavaScript, Supabase, tests, UX/UI et livrables.

## 1. Priorités et déroulement

Respecter cet ordre :

1. préserver les données et leur compatibilité ;
2. éviter les régressions fonctionnelles ;
3. conserver une architecture cohérente ;
4. préserver un démarrage rapide ;
5. maintenir une UI uniforme, responsive et accessible ;
6. produire des changements minimaux et faciles à vérifier.

**Déroulement obligatoire :** inspecter l'état local → identifier la cause → corriger au bon niveau → vérifier → livrer un bilan fidèle.

Une amélioration visuelle ne doit pas dégrader les performances. Une optimisation ne doit pas modifier les données. Une refactorisation ne doit pas changer le comportement utilisateur sans demande explicite.

Les règles ci-dessous sont obligatoires, sauf celles indiquées comme recommandations ou objectifs. Les exemples illustrent les règles ; ils ne sont pas des blocs à recopier systématiquement.

## 2. État local et protection du travail existant

Toujours partir de **l'état le plus récent du dépôt local**. Avant une modification importante :

```bash
git status --short
git branch --show-current
git diff
```

- Considérer les changements non commités comme faisant partie de l'état courant ; ne pas les écraser.
- Inspecter les fichiers actuels, même si un résumé de conversation décrit leur contenu ou leur état Git.
- Ne pas reconstruire un fichier depuis un ancien ZIP, une ancienne conversation, une copie supposée proche ou une version monolithique remplacée.
- Ne pas utiliser `git reset --hard`, `git checkout -- .`, `git restore` ou équivalent pour effacer du travail sans autorisation explicite.
- Ne pas reconstruire un fichier depuis `HEAD` pour réparer une petite édition : cela peut effacer des changements locaux. Corriger le bloc concerné dans le fichier actuel.
- Les versions historiques peuvent servir à comparer, jamais à remplacer automatiquement la source locale.

Si la source ou la propriété d'un changement est incertaine, inspecter avant d'éditer.

## 3. Repères d'architecture

Projet web statique. Cette arborescence est un **repère non exhaustif**, à vérifier dans le dépôt :

```text
/
├── AGENTS.md
├── index.html / training.html / training-live.html
├── videos.html / coach-videos.html / player-stats.html
├── quick-collection.html / face-a-face.html
├── css/
│   ├── common.css
│   └── CSS spécifiques aux pages
├── js/
│   ├── index.js
│   ├── training.js
│   ├── training-live.js
│   └── pwa.js
├── service-worker.js
├── manifest.webmanifest
├── supabase/
├── tests/
└── kinball-brand/
    ├── logo-full.png
    ├── logo-symbol.png
    └── favicon.png
```

- Ne pas réintégrer dans le HTML du CSS ou du JavaScript déjà externalisé.
- Externaliser un JavaScript dès qu'il devient significatif ou difficile à maintenir inline.
- Utiliser `common.css` pour les composants partagés ; un CSS de page pour sa structure et ses composants uniques.
- Ne pas créer de nouvelles implémentations concurrentes d'un même composant sans nécessité.
- Certains flux sont actuellement dupliqués entre `js/index.js` et `js/training.js`. Lorsqu'un de ces flux change, inspecter les deux versions, appliquer la correction aux deux pages concernées et vérifier leur parité. Ne pas imposer une identité globale à des fichiers dont les fonctions spécifiques diffèrent.
- Une mutualisation plus large doit répondre au besoin, sans transformer une correction ciblée en refonte.

## 4. Design system, CSS et accessibilité

### Autorité partagée

`css/common.css` définit la palette, la typographie, les boutons, champs, panneaux, headers, navigation, états hover/focus/disabled, bordures, rayons et composants réellement partagés.

Les CSS de page définissent uniquement la structure, les grilles, les composants uniques et le responsive propre au module. Conserver l'ordre :

```html
<link rel="stylesheet" href="css/page-specifique.css">
<link rel="stylesheet" href="css/common.css">
```

Avant un override local, vérifier si la cause appartient au composant commun. Si oui, corriger `common.css` plutôt qu'empiler des overrides ou des `!important` locaux.

Un composant partagé doit fonctionner de manière autonome : structure visuelle, bordure et espacement, pas seulement couleurs. Par exemple, `border-color` seul ne crée pas une bordure. Après une modification partagée, identifier et vérifier ses pages consommatrices, y compris les variantes et états existants.

### Apparence

- Panneaux et headers sans ombre portée par défaut.
- Boutons et champs plats, sans rendu navigateur `outset` / `inset`.
- Bordures des contrôles et surfaces bordées explicitement définies en `1px solid`.
- Conserver un focus visible ; ne pas le supprimer pour obtenir un aspect plat.
- Réutiliser les variables du design system.

Exemple de normalisation des contrôles :

```css
button, a.button, input, select, textarea {
  border: 1px solid var(--line);
  box-shadow: none;
}
```

Ne jamais communiquer un état uniquement par une couleur : ajouter texte, icône, bordure, graisse ou forme selon le cas. Vérifier la lisibilité et les contrastes, pas seulement les différences de teinte.

Tout vrai bouton de navigation arrière utilisant le design commun porte `class="ghost backNav"`. Ne pas appliquer `backNav` aux contrôles vidéo tels que `−5 s` ni automatiquement aux boutons qui ferment un dialogue.

## 5. JavaScript, réseau et démarrage

L'interface utile doit apparaître dès que les données indispensables sont disponibles. Ne pas attendre notifications, profil secondaire, droits admin secondaires, métriques ou détails différables pour masquer le splash.

Lancer les tâches secondaires en arrière-plan, avec gestion de leurs erreurs. Exemple :

```js
function runStartupBackground(label, task) {
  Promise.resolve()
    .then(task)
    .catch(error => console.warn('[startup background]', label, error));
}
```

- Paralléliser les requêtes indépendantes ; si une seule suffit au rendu, ne pas attendre les autres via `Promise.all` avant d'afficher.
- Réutiliser les données en mémoire et les requêtes déjà en cours, avec une clé adaptée au compte et au contexte. Éviter les caches périmés après mutation ou changement de compte.
- Éviter de recharger une liste complète après une petite mutation si une mise à jour locale suffit.
- Éviter les listeners ajoutés à chaque rendu, doubles abonnements, timers/polling dupliqués et re-renders complets inutiles.
- Une erreur sur une action utilisateur doit être visible et compréhensible. Une erreur secondaire peut être journalisée sans bloquer l'écran principal.
- Une annulation volontaire doit être traitée comme telle, sans message de panne ni journal d'erreur trompeur.

### Mesurer avant d'optimiser

Utiliser `performance.now()` et des traces ciblées. Conserver les traces utiles :

```text
[startup] session Supabase disponible: ...
[startup] groupes entraîneur chargés: ...
[startup] splash masqué: ...
```

Sur les entraînements, conserver aussi les mesures pertinentes pour séances et exercices. Pour une régression, mesurer séparément session, groupes, accès joueur, exercices, séances, profils, vidéos et statistiques selon le flux concerné.

**Objectifs**, sur une connexion normale : session locale quasi immédiate et affichage principal idéalement en moins d'une seconde. Corriger une cause observée, pas une cause supposée.

## 6. Supabase et contrats de données

**Localhost et la version publiée utilisent actuellement le même projet Supabase.** Une action depuis `http://localhost:8000` peut modifier la production. Ne pas traiter localhost comme un staging ; pour les tests destructifs, utiliser exclusivement des données de test prévues à cet effet.

- Dans le navigateur, utiliser uniquement la clé publique / publishable ; jamais `service_role`.
- Respecter les RLS ; ne pas les contourner depuis le front.
- Toute modification de policy, RPC, trigger ou schéma doit être explicitement demandée ou clairement nécessaire, minimale, vérifiée et compatible avec les données existantes.
- La présence d'un appel RPC dans le front ne prouve pas que sa définition SQL existe dans le dépôt. Vérifier les sources disponibles avant de proposer une migration.
- Ne pas appliquer de migration à la base distante dans le cadre d'un simple test local.

Préserver les contrats existants, notamment `action_type`, `result`, `fault_type`, `family`, `restart_location`, `zone` et leurs valeurs historiques. Pour un nouveau champ, gérer `null`, les anciennes lignes et une interprétation rétrocompatible ; éviter les migrations destructives.

Exemple : une séance sans champ `draft` et sans heure de début peut être interprétée comme brouillon.

Avant une suppression, vérifier ce qui disparaît de l'UI, ce qui est supprimé en base et ce qui doit rester dans l'historique. Retirer un joueur d'un groupe ne doit pas supprimer son identité globale ni son historique.

### Association de compte et consentement

Pour un flux d'association exigeant confirmation :

- afficher le compte, le joueur et le groupe réellement concernés ; ne pas autoriser une mutation sur la base d'un libellé de repli qui masque une identité non résolue ;
- ne lancer la mutation qu'après validation explicite ; une auto-sélection ne vaut pas consentement ;
- un rapprochement de prénoms est indicatif, jamais une preuve d'identité ni une autorisation ;
- une annulation conserve les informations nécessaires pour réessayer, sans mutation d'association ni nettoyage de l'invitation ;
- protéger le flux entier contre les soumissions concurrentes, pas seulement le double clic dans le dialogue ;
- conserver l'autorisation côté serveur/RLS : le dialogue ne remplace pas les contrôles Supabase.

## 7. Responsive, dialogues et tactile

Toute modification UI significative doit être vérifiée sur desktop, tablette et mobile. Éviter largeurs fixes inutiles, texte collé aux bords, boutons trop petits, sticky masquant le contenu et grilles difficiles au tactile.

Les notes longues d'entraînement doivent s'agrandir automatiquement, sans scroll vertical interne, en laissant la page principale défiler.

Pour les dialogues :

- titre accessible, `role="dialog"` et `aria-modal="true"` lorsque le dialogue est modal ;
- focus initial approprié, navigation clavier contenue dans le dialogue et restitution du focus à la fermeture ;
- fermeture cohérente par les contrôles prévus et par Échap, sauf raison fonctionnelle explicite ;
- résolution unique de la promesse éventuelle et nettoyage des listeners à la fermeture ;
- contenu et boutons accessibles sur petit écran, y compris avec des libellés longs.

Pour les annotations vidéo : `touch-action:none` seulement en mode dessin, scroll bloqué uniquement pendant le dessin puis restauré, listeners compatibles avec `preventDefault()` lorsque nécessaire. Après enregistrement, effacer le dessin temporaire. Ne pas confondre contrôles vidéo et navigation générale.

## 8. Vérification proportionnée et preuves

### Syntaxe et tests existants

Pour chaque JS externe modifié, exécuter `node --check` sur ce fichier. Exemple :

```bash
node --check js/index.js
node --check js/training.js
```

Vérifier également les scripts inline modifiés par une méthode adaptée. Une modification documentaire seule appelle une relecture et un contrôle du diff, pas un test fonctionnel de toute l'application.

Le dépôt ne comporte actuellement pas de `package.json`. `tests/categories.test.cjs` utilise `node:test`, `jsdom`, `@electric-sql/pglite` et lit `supabase/migrations/20260913154540_dynamic_exercise_categories.sql`. Cette migration est absente de l'état local vérifié lors de cette mise à jour ; recontrôler sa présence et les dépendances avant de lancer :

```bash
node --test tests/categories.test.cjs
```

Ne pas inventer une commande `npm test` ni installer des dépendances dans le dépôt sans nécessité. Si un prérequis manque, annoncer le blocage ; ne pas déclarer la suite validée.

### Navigateur local

Depuis la racine, réutiliser un serveur existant approprié ou lancer :

```bash
python3 -m http.server 8000
```

Ouvrir `http://localhost:8000`. Après modification CSS/JS, effectuer `Ctrl + Shift + R` et vérifier, si nécessaire, le comportement du service worker/PWA pour distinguer cache et régression.

Tester les zones concernées et leurs dépendances. Pour un changement transversal (auth, navigation, CSS commun, données partagées), étendre les contrôles aux modules consommateurs : connexion, accueil, groupes, matchs, statistiques, entraînements, vidéos, vue joueur, Collecte rapide, Face-à-face et navigation Retour selon l'impact.

Vérifier console et réseau : aucune nouvelle erreur JS, aucun 404, aucune requête en boucle, aucun polling dupliqué.

### Fidélité des tests

- Distinguer explicitement tests avec mocks, navigateur local et tests connectés à Supabase. Un mock valide un comportement simulé, pas les droits ni la mutation réels en base.
- Un harnais doit tester le code actuel. Actualiser les copies JS/CSS après toute modification ; valider sa syntaxe et ses attentes avant de conclure.
- Éviter les extracteurs fragiles de fonctions par simple comptage d'accolades : paramètres déstructurés, chaînes et templates peuvent les tromper.
- Exiger une fin explicite de suite et le nombre attendu de résultats : un dump partiel ou une promesse bloquée ne vaut pas réussite.
- Lire le résultat DOM produit, pas une chaîne de rapport présente dans le source du script.
- Vérifier la largeur **réelle** du viewport. Un navigateur demandé à 390 px mais exécuté à 500 px ne valide pas un écran de 390 px ; utiliser une émulation adaptée si nécessaire.
- Les propriétés calculées complètent le contrôle visuel ; elles ne prouvent pas à elles seules la lisibilité ou la qualité globale du rendu.
- Ajouter des tests durables pour les comportements sensibles ou régressions utiles ; éviter les tests qui reproduisent simplement l'implémentation.

Après réussite des contrôles pertinents, ne les répéter ou les élargir que si une nouvelle modification ou un doute concret le justifie.

## 9. Outils et environnement

- Privilégier les outils dédiés de lecture, recherche et patch ; utiliser le shell pour commandes, Git, serveurs et tests.
- Faire des patches ciblés avec le contexte exact. Pour une indentation, corriger les lignes concernées plutôt que réécrire le fichier.
- Utiliser le répertoire de travail de l'outil et citer les chemins contenant des espaces.
- Créer les harnais et artefacts temporaires hors du projet, dans l'espace temporaire autorisé par l'environnement.
- Conserver le PID des processus démarrés et arrêter uniquement ceux-ci. Éviter les commandes larges telles que `pkill -f`, qui peuvent viser le shell ou des processus préexistants.
- Réutiliser ou laisser intact un serveur préexistant ; nettoyer uniquement les artefacts créés pendant l'intervention.
- Si un outil échoue, diagnostiquer séparément environnement et code. Ne pas remplacer un binaire global, modifier la configuration système ou réparer l'environnement sans autorisation appropriée.
- Garder les mises à jour utilisateur concises : découvertes, décisions et blocages, plutôt que narration de chaque lecture ou correction.

## 10. Git et livrables

Ne commiter ou pousser que sur demande explicite. L'autorisation de commit ne vaut pas autorisation de push ni de réécriture d'historique.

### Branches de travail et publication

- Pour les changements significatifs, développer sur une branche de travail dédiée à la fonctionnalité ou au refactor, créée avant les modifications après inspection de l'état local. Un changement de branche ne sauvegarde pas les modifications non commitées ; préserver le travail en cours.
- Faire des commits cohérents aux étapes validées, si l'utilisateur les autorise. Les push sur la branche de travail nécessitent également son autorisation explicite.
- GitHub Pages publie actuellement la racine (`/`) de la branche `main`. Un push sur une autre branche ne met pas à jour le site avec cette configuration ; toute mise à jour distante de `main`, par push ou fusion d'une PR sur GitHub, déclenche une publication et nécessite une autorisation explicite.
- Regrouper idéalement les changements vérifiés pour une publication en fin de journée. Cette cadence concerne les mises à jour de `main`, pas les sauvegardes autorisées sur les branches de travail.
- Garder un refactor incomplet sur sa branche dédiée, même s'il dure plusieurs jours. Ne pas le fusionner uniquement pour respecter une cadence quotidienne ; vérifier le diff et les tests pertinents avant intégration dans `main`.

### Commits et livrables

Avant commit :

```bash
git status --short
git diff
git log --oneline -10
```

Stager explicitement les fichiers concernés, vérifier le diff stagé et ne jamais inclure de secrets ou du travail non lié. Exemple à adapter aux fichiers réellement modifiés :

```bash
git add -- AGENTS.md
git diff --cached
git commit -m "Description claire"
```

Exécuter `git push` seulement si demandé. Ne pas contourner les hooks, amender ni réécrire l'historique sans autorisation explicite. Si un push forcé est explicitement autorisé et nécessaire, préférer `--force-with-lease` à `--force`, avec la branche et le remote vérifiés.

Si un patch est demandé, fournir les seuls fichiers concernés avec leur arborescence exacte. Si une version consolidée est demandée, partir de l'état local actuel, intégrer les changements, inclure le projet complet et vérifier les fichiers clés ; un assemblage d'anciennes versions n'est pas une consolidation.

## 11. Critères de fin et bilan

Avant livraison :

1. inspecter le diff final et confirmer l'absence de modification accidentelle ou de correctif perdu ;
2. vérifier syntaxe et contrôles pertinents pour le changement ;
3. vérifier les fonctions adjacentes et pages consommatrices concernées ;
4. confirmer compatibilité des données, design system et absence de requête bloquante inutile ;
5. vérifier que les fichiers annoncés correspondent aux changements réels.

Le bilan final reste court : **changements effectués, vérifications réellement réalisées, limites ou blocages restants**, et état commit/push si pertinent. Ne pas annoncer une validation visuelle, mobile, Supabase ou de non-régression qui n'a pas été effectuée. Si un contrôle manque, le travail est partiel sur ce point : le dire clairement.
