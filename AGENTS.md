---
name: kinball-coach-development
description: Règles de développement, architecture, qualité, performance et non-régression pour le projet Kinball Coach.
---

# Kinball Coach — Development Skill

## Objectif

Développer et maintenir **Kinball Coach** sans régression fonctionnelle, visuelle ou de données.

Ce skill doit être appliqué à toute modification de l'application : HTML, CSS, JavaScript, Supabase, UX/UI, performances, vidéo, statistiques, entraînements, groupes, messagerie ou vue joueur.

La priorité est, dans cet ordre :

1. préserver les données et la compatibilité ;
2. ne pas casser une fonctionnalité existante ;
3. garder une architecture cohérente ;
4. conserver un démarrage rapide ;
5. maintenir une UI uniforme et accessible ;
6. fournir des fichiers réellement testables et prêts à déployer.

---

# 1. Toujours partir de la bonne version

## Règle absolue

Ne jamais reconstruire une nouvelle version depuis un ancien ZIP ou un ancien fichier supposé « proche ».

Avant toute modification :

- identifier la **version la plus récente** du projet ;
- travailler à partir de cette version uniquement ;
- conserver tous les correctifs déjà intégrés ;
- si plusieurs patchs existent, vérifier explicitement leur ordre et leur compatibilité.

Ne jamais réintroduire involontairement :

- une ancienne logique de démarrage ;
- un ancien CSS ;
- une ancienne version de `index.js` ou `training.js` ;
- des fichiers monolithiques remplacés depuis par des fichiers modularisés ;
- des comportements supprimés ou corrigés auparavant.

Si un doute existe sur la version de départ, **vérifier avant d'éditer**.

---

# 2. Architecture du projet

Structure cible :

```text
/
├── index.html
├── training.html
├── videos.html
├── player-stats.html
├── coach-videos.html
├── quick-collection.html
├── face-a-face.html
├── css/
│   ├── common.css
│   ├── index.css
│   ├── training.css
│   ├── videos.css
│   ├── player-stats.css
│   ├── coach-videos.css
│   ├── quick-collection.css
│   └── face-a-face.css
├── js/
│   ├── index.js
│   └── training.js
└── kinball-brand/
    ├── logo-full.png
    ├── logo-symbol.png
    └── favicon.png
```

Ne pas réintégrer dans le HTML du CSS ou du JavaScript qui a déjà été externalisé.

Pour une nouvelle page :

- créer un CSS spécifique si nécessaire ;
- réutiliser `common.css` pour les composants partagés ;
- externaliser le JavaScript dès que sa taille ou sa complexité devient significative.

---

# 3. Règles CSS et design system

## `common.css` est l'autorité pour le design partagé

Les éléments suivants doivent être définis une seule fois dans `common.css` :

- palette ;
- typographie commune ;
- boutons ;
- champs de formulaire ;
- panneaux ;
- headers communs ;
- navigation ;
- états focus/hover/disabled ;
- `backNav` ;
- bordures ;
- rayons ;
- espacements génériques ;
- composants réutilisés par plusieurs pages.

Les CSS spécifiques (`index.css`, `training.css`, etc.) servent uniquement à :

- la structure propre à une page ;
- les grilles particulières ;
- les composants spécifiques à un module ;
- le responsive propre à ce module.

Ne jamais corriger localement un problème qui concerne en réalité un composant partagé.

Exemple : si tous les boutons Retour doivent être bleus, corriger `backNav` dans `common.css`, pas chaque page séparément.

## Ordre de chargement

Conserver le même ordre sur toutes les pages :

```html
<link rel="stylesheet" href="css/page-specifique.css">
<link rel="stylesheet" href="css/common.css">
```

Le design system commun a donc le dernier mot sur l'apparence partagée.

## Apparence actuelle

Par défaut :

- pas d'ombre portée sur les panneaux ou headers ;
- boutons et champs plats ;
- bordures explicites `1px solid`;
- pas d'effet navigateur `outset/inset`;
- ne pas utiliser la couleur seule pour transmettre une information.

Exemple :

```css
button,
a.button {
  border: 1px solid var(--line);
  box-shadow: none;
}

input,
select,
textarea {
  border: 1px solid var(--line);
  box-shadow: none;
}
```

## Daltonisme / accessibilité

L'utilisateur est daltonien.

Donc :

- ne jamais distinguer deux états uniquement par rouge/vert ou par une nuance proche ;
- utiliser aussi texte, icône, bordure, graisse ou forme ;
- conserver un contraste fort ;
- éviter les états sélectionnés perceptibles uniquement par une légère variation de couleur.

## Boutons Retour

Tout vrai bouton de navigation arrière utilisant le design commun doit porter :

```html
class="ghost backNav"
```

Ne pas appliquer `backNav` aux contrôles qui ne sont pas de la navigation, par exemple `−5 s` dans un lecteur vidéo.

---

# 4. JavaScript : règles de qualité

## Pas de requête bloquante inutile au démarrage

L'interface principale doit être visible dès que les informations indispensables sont disponibles.

Ne pas attendre avant le premier affichage :

- notifications ;
- profil utilisateur ;
- droits admin secondaires ;
- workspace secondaire ;
- métriques non indispensables ;
- informations de détail qui peuvent arriver après le rendu.

Utiliser une logique du type :

```js
runStartupBackground('profil', () => ensureMyProfile());
```

pour les tâches non critiques.

## Paralléliser les requêtes indépendantes

Préférer :

```js
const [groups, accesses] = await Promise.all([
  fetchMyGroups(),
  fetchMyPlayerAccesses()
]);
```

à deux `await` séquentiels lorsque les appels sont indépendants.

Mais si une seule de ces réponses suffit pour afficher l'interface, **ne pas attendre les deux** avant de rendre la page.

## Ne pas dupliquer les appels réseau

Avant d'ajouter une requête Supabase :

- chercher si la même donnée vient déjà d'être chargée ;
- réutiliser le cache en mémoire ;
- éviter deux `fetchMyGroups()` consécutifs ;
- ne pas recharger une liste complète pour une modification locale mineure si cela n'est pas nécessaire.

## Démarrage

Conserver les traces de performance utiles :

```text
[startup] session Supabase disponible: ...
[startup] groupes entraîneur chargés: ...
[startup] splash masqué: ...
```

Le splash ne doit jamais rester affiché à cause d'une opération secondaire.

Objectif normal :

- session locale : quasi immédiate ;
- écran principal visible idéalement en moins d'une seconde sur une connexion normale ;
- les données secondaires peuvent continuer à se charger ensuite.

## Gestion des erreurs

Une erreur d'une tâche secondaire ne doit pas bloquer toute l'application.

Préférer :

```js
Promise.resolve()
  .then(task)
  .catch(error => console.warn('[startup background]', label, error));
```

Pour une opération utilisateur explicite, afficher en revanche une erreur compréhensible à l'écran.

## Événements

Éviter :

- les doubles `addEventListener` ;
- les listeners recréés à chaque rendu ;
- les timers ou polling dupliqués ;
- les re-renders complets quand une mise à jour locale suffit.

---

# 5. Supabase et données

## Important : localhost utilise la vraie base

La version locale et GitHub Pages utilisent actuellement le **même projet Supabase de production**.

Donc une action faite depuis :

```text
http://localhost:8000
```

peut modifier les vraies données.

Ne jamais considérer le test local comme un bac à sable.

Pour les tests destructifs, utiliser les données de test prévues à cet effet.

## Sécurité

Dans le navigateur :

- utiliser uniquement la clé publique/publishable ;
- ne jamais exposer de `service_role`;
- respecter les politiques RLS ;
- ne jamais contourner une RLS dans le front.

Toute évolution des policies doit être volontaire, minimale et vérifiée.

## Compatibilité des données

Ne jamais casser la lecture des données existantes.

Préserver notamment les valeurs et champs historiques :

- `action_type`
- `result`
- `fault_type`
- `family`
- `restart_location`
- `zone`
- et les autres valeurs déjà stockées.

Lorsqu'un nouveau champ est ajouté :

- gérer les anciennes lignes où il est absent ou `null`;
- prévoir une valeur par défaut ou une interprétation rétrocompatible ;
- ne pas exiger une migration destructive si elle peut être évitée.

Exemple déjà utilisé :

- une séance sans champ `draft` mais sans heure de début peut être interprétée comme brouillon.

## Suppression

Toute suppression doit être examinée sur trois niveaux :

1. ce qui disparaît visuellement ;
2. ce qui est supprimé en base ;
3. ce qui doit rester dans l'historique.

Exemple : retirer un joueur d'un groupe ne doit pas supprimer son identité globale ni son historique.

---

# 6. Performance

## Avant d'optimiser

Mesurer d'abord.

Utiliser :

```js
performance.now()
```

et des traces console explicites.

Identifier séparément :

- récupération de session ;
- groupes ;
- accès joueur ;
- exercices ;
- séances ;
- profils ;
- vidéos ;
- statistiques.

Ne pas deviner la source d'un ralentissement.

## Règles

- paralléliser les appels indépendants ;
- afficher les données essentielles avant les données secondaires ;
- éviter les appels complets après chaque petite mutation ;
- utiliser des caches mémoire raisonnables ;
- ne pas bloquer le splash sur une tâche secondaire ;
- ne pas charger une ressource lourde avant qu'elle ne soit utile ;
- éviter les requêtes répétées en polling trop fréquent.

---

# 7. Responsive

Toute modification UI doit être vérifiée au minimum dans trois formats :

- desktop ;
- tablette ;
- mobile.

Éviter :

- largeur fixe non nécessaire ;
- texte collé aux bordures ;
- boutons trop petits ;
- textarea avec scroll interne lorsqu'une hauteur automatique est préférable ;
- sticky qui masque du contenu ;
- grilles impossibles à utiliser au toucher.

Sur les notes d'entraînement :

- pas de scroll vertical interne ;
- auto-grow selon le contenu ;
- la page elle-même doit défiler.

---

# 8. Vidéo et interactions tactiles

Pour les outils d'annotation :

- `touch-action:none` seulement quand le mode dessin est actif ;
- empêcher le scroll uniquement pendant le dessin ;
- restaurer le scroll normal hors annotation ;
- éviter les listeners passifs lorsqu'un `preventDefault()` est requis.

Après enregistrement d'une annotation, le dessin temporaire doit être effacé automatiquement.

Les contrôles vidéo (`−1`, `+1`, `−5 s`, etc.) ne doivent jamais être confondus avec des boutons de navigation.

---

# 9. Tests obligatoires avant livraison

## Vérifications syntaxiques

Pour chaque JS modifié :

```bash
node --check js/index.js
node --check js/training.js
```

et équivalent pour tout autre fichier JS externe.

## Test local

Depuis la racine :

```bash
python3 -m http.server 8000
```

Puis :

```text
http://localhost:8000
```

Faire un rechargement forcé lorsque le CSS ou le JS a changé :

```text
Ctrl + Shift + R
```

## Smoke test minimum

Après une modification significative, vérifier au moins :

- connexion ;
- accueil ;
- groupes ;
- matchs ;
- statistiques ;
- entraînements ;
- vidéos ;
- vue joueur ;
- Collecte rapide ;
- Face-à-face ;
- navigation Retour ;
- responsive mobile/tablette.

Vérifier la console :

- aucune erreur JavaScript nouvelle ;
- aucune requête en boucle ;
- aucun 404 sur CSS/JS/images.

---

# 10. Règle de non-régression

Avant de livrer un nouveau ZIP :

1. comparer les fichiers modifiés avec la version de départ ;
2. vérifier que seules les modifications voulues sont présentes ;
3. vérifier que les correctifs récents n'ont pas disparu ;
4. ne jamais remplacer un fichier récent par un fichier issu d'un ancien package ;
5. vérifier les fonctionnalités adjacentes à la zone modifiée.

Une correction visuelle ne doit pas réintroduire une régression de performance.

Une optimisation ne doit pas modifier les données.

Une refactorisation ne doit pas changer le comportement utilisateur sans demande explicite.

---

# 11. Patches et ZIP consolidés

## Patch ciblé

Si quelques fichiers seulement sont modifiés, fournir un ZIP contenant uniquement ces fichiers et leur arborescence exacte.

Expliquer clairement qu'il s'agit d'un patch.

## Version consolidée

Si l'utilisateur demande une version consolidée :

- repartir de la version la plus récente ;
- intégrer tous les patchs récents dans l'ordre ;
- inclure le projet complet ;
- vérifier les fichiers clés après fusion ;
- effectuer les tests syntaxiques ;
- ne pas appeler « consolidé » un ZIP construit depuis une base ancienne.

---

# 12. Git

Avant un commit :

```bash
git status
git diff
```

Puis :

```bash
git add .
git commit -m "Description claire"
git push
```

Ne pas recommander `--force` par défaut.

Si un push forcé est réellement nécessaire, préférer :

```bash
git push --force-with-lease origin main
```

---

# 13. Règle de modification minimale

Pour un bug :

- identifier d'abord la cause ;
- corriger au niveau architectural approprié ;
- éviter les overrides CSS locaux qui masquent le problème ;
- éviter les hacks JavaScript ajoutés après coup si le HTML/CSS peut être correctement structuré.

Exemple :

**Mauvais :**

```css
.quickCollection .panel {
  box-shadow: none !important;
}
```

si l'application entière ne doit pas avoir d'ombre.

**Bon :**

corriger le token ou la règle correspondante dans `common.css`.

---

# 14. Avant toute modification importante

Répondre mentalement à ces questions :

- Quelle est la version source exacte ?
- Est-ce un problème local ou un problème du composant commun ?
- Est-ce que cette modification peut casser les anciennes données ?
- Est-ce que cela ajoute une requête réseau bloquante ?
- Est-ce que mobile/tablette restent utilisables ?
- Est-ce que l'état est compréhensible sans dépendre uniquement de la couleur ?
- Est-ce que je peux faire moins de changements pour obtenir le même résultat ?
- Est-ce que les correctifs précédents sont toujours présents ?

Si une de ces réponses n'est pas claire, inspecter le code avant de modifier.

---

# 15. Critère de livraison

Une modification est considérée comme terminée seulement si :

- le code est syntaxiquement valide ;
- l'UI est cohérente avec `common.css`;
- aucune ancienne fonctionnalité utile n'a disparu ;
- les anciennes données restent lisibles ;
- le premier affichage n'est pas ralenti inutilement ;
- le test local est possible ;
- les fichiers livrés correspondent exactement aux modifications annoncées.
