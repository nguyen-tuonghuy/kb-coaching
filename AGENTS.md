# AGENTS.md — Kinball Coach

Ce fichier définit les règles de travail pour tout agent de développement intervenant sur ce dépôt.

**Portée : tout le dépôt.**  
Ces instructions s'appliquent aux fichiers HTML, CSS, JavaScript, Supabase, tests, UX/UI, statistiques, entraînements, groupes, vidéos, messagerie et vues joueurs.

## 1. Priorités

Respecter cet ordre de priorité :

1. préserver les données et la compatibilité ;
2. éviter toute régression fonctionnelle ;
3. conserver une architecture cohérente ;
4. préserver un démarrage rapide ;
5. maintenir une UI uniforme, responsive et accessible ;
6. produire des changements minimaux, testables et faciles à relire.

Une amélioration visuelle ne doit pas dégrader les performances.  
Une optimisation ne doit pas modifier les données.  
Une refactorisation ne doit pas changer le comportement utilisateur sauf demande explicite.

---

## 2. Source de vérité et version de départ

### Règle absolue

Toujours travailler à partir de **l'état le plus récent du dépôt local**.

Avant toute modification importante :

```bash
git status
git branch --show-current
git diff
```

Ne jamais reconstruire une version depuis :

- un ancien ZIP ;
- un ancien fichier de conversation ;
- une copie supposée « proche » ;
- une version monolithique remplacée depuis ;
- une ancienne version de `index.js`, `training.js`, `common.css`, etc.

Ne jamais écraser les modifications locales de l'utilisateur.

Si des changements non commités sont présents :

- les considérer comme faisant partie de l'état courant ;
- ne pas les supprimer ;
- ne pas faire de `git reset --hard`, `git checkout -- .` ou équivalent sans demande explicite.

Si la version source n'est pas certaine, **inspecter avant d'éditer**.

---

## 3. Architecture cible

Structure actuelle attendue :

```text
/
├── AGENTS.md
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

### Règles d'architecture

- Ne pas réintégrer dans le HTML du CSS déjà externalisé.
- Ne pas réintégrer dans le HTML du JavaScript déjà externalisé.
- Pour une nouvelle page, créer un CSS spécifique si nécessaire.
- Réutiliser `common.css` pour les composants partagés.
- Externaliser un JavaScript dès qu'il devient significatif ou difficile à maintenir inline.
- Ne pas créer deux implémentations différentes d'un même composant sans raison.

---

## 4. Design system et CSS

### `css/common.css` est l'autorité visuelle partagée

Les éléments suivants doivent être définis dans `common.css` lorsqu'ils sont communs à plusieurs pages :

- palette ;
- typographie ;
- boutons ;
- champs ;
- panneaux ;
- headers communs ;
- navigation ;
- états hover/focus/disabled ;
- `backNav` ;
- bordures ;
- rayons ;
- règles d'apparence génériques ;
- composants réellement partagés.

Les CSS de page servent uniquement à :

- la structure spécifique ;
- les grilles propres au module ;
- les composants uniques ;
- le responsive propre à la page.

### Ne pas masquer un problème commun par un override local

Avant d'ajouter une règle spécifique, se demander :

> Le problème existe-t-il parce que le composant partagé est mal défini ?

Exemple à éviter :

```css
.quickCollection .panel {
  box-shadow: none !important;
}
```

si tous les panneaux de l'application doivent être plats.

Dans ce cas, corriger `common.css`.

### Ordre de chargement CSS

Conserver partout :

```html
<link rel="stylesheet" href="css/page-specifique.css">
<link rel="stylesheet" href="css/common.css">
```

Ainsi, le design system commun garde le dernier mot sur l'apparence partagée.

### Apparence actuelle

Par défaut :

- pas d'ombre portée sur les panneaux ou headers ;
- boutons et champs plats ;
- bordures explicites `1px solid`;
- pas de rendu navigateur `outset` / `inset`;
- pas d'information transmise uniquement par la couleur.

Les contrôles communs doivent rester explicitement normalisés, par exemple :

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

### Daltonisme et accessibilité

Ne jamais distinguer des états uniquement par une couleur.

Utiliser aussi selon le cas :

- texte ;
- icône ;
- bordure ;
- graisse ;
- forme ;
- libellé explicite.

Éviter les différences fondées seulement sur une légère variation de teinte.

### Boutons Retour

Tout vrai bouton de navigation arrière utilisant le design commun doit utiliser :

```html
class="ghost backNav"
```

Ne pas appliquer `backNav` à un contrôle vidéo tel que `−5 s`.

---

## 5. JavaScript et qualité d'exécution

### Premier affichage rapide

L'interface utile doit apparaître dès que les données indispensables sont disponibles.

Ne pas bloquer le premier affichage sur :

- notifications ;
- profil secondaire ;
- droits admin secondaires ;
- métriques ;
- détails non indispensables ;
- données qui peuvent être ajoutées après le rendu.

Les tâches secondaires doivent être lancées en arrière-plan et leurs erreurs ne doivent pas bloquer l'application.

Exemple :

```js
function runStartupBackground(label, task) {
  Promise.resolve()
    .then(task)
    .catch(error => console.warn('[startup background]', label, error));
}
```

### Paralléliser les requêtes indépendantes

Préférer :

```js
const [a, b] = await Promise.all([
  loadA(),
  loadB()
]);
```

aux appels séquentiels lorsqu'il n'existe pas de dépendance.

Mais si `a` suffit à afficher l'interface, ne pas attendre `b` avant le rendu.

### Éviter les appels réseau dupliqués

Avant d'ajouter une requête Supabase :

- vérifier si la donnée est déjà en mémoire ;
- vérifier si un appel identique vient d'être lancé ;
- réutiliser les résultats existants ;
- éviter de recharger une liste complète après une petite mutation si un update local suffit.

### Événements et rendu

Éviter :

- doubles `addEventListener` ;
- listeners ajoutés à chaque rendu ;
- timers ou polling dupliqués ;
- re-renders complets inutiles ;
- manipulations DOM répétitives coûteuses lorsqu'une mise à jour ciblée suffit.

### Erreurs

Une erreur sur une opération utilisateur explicite doit être visible et compréhensible.

Une erreur sur une tâche secondaire peut être journalisée sans bloquer l'écran principal.

---

## 6. Performance et instrumentation

### Mesurer avant d'optimiser

Ne pas deviner la source d'un ralentissement.

Utiliser :

```js
performance.now()
```

et des traces ciblées.

Conserver les traces utiles de démarrage :

```text
[startup] session Supabase disponible: ...
[startup] groupes entraîneur chargés: ...
[startup] splash masqué: ...
```

Sur la page entraînement, conserver également les mesures pertinentes pour les séances et exercices.

### Objectif de démarrage

Sur une connexion normale :

- session locale : quasi immédiate ;
- affichage principal : idéalement en moins d'une seconde ;
- données secondaires : peuvent arriver après.

Le splash ne doit jamais attendre une tâche secondaire.

### Pour toute régression de performance

Mesurer séparément :

- session Supabase ;
- groupes ;
- accès joueur ;
- exercices ;
- séances ;
- profils ;
- vidéos ;
- statistiques.

Corriger la cause observée, pas une cause supposée.

---

## 7. Supabase et données de production

### Localhost utilise actuellement la vraie base

La version locale et la version publiée utilisent le même projet Supabase.

Donc une action depuis :

```text
http://localhost:8000
```

peut modifier les vraies données.

Ne jamais traiter le localhost comme un environnement de staging.

Pour les tests destructifs, utiliser exclusivement des données de test prévues à cet effet.

### Sécurité

Dans le navigateur :

- utiliser uniquement la clé publique / publishable ;
- ne jamais exposer de `service_role`;
- respecter les RLS ;
- ne pas contourner une RLS depuis le front.

Toute modification de policy, fonction RPC, trigger ou schéma doit être :

- explicitement demandée ou clairement nécessaire ;
- minimale ;
- vérifiée ;
- compatible avec les données existantes.

### Compatibilité des données

Ne jamais casser les valeurs existantes.

Préserver notamment les champs/valeurs historiques tels que :

- `action_type`
- `result`
- `fault_type`
- `family`
- `restart_location`
- `zone`

et tout autre contrat déjà utilisé par l'application.

Pour tout nouveau champ :

- gérer `null` ;
- gérer les anciennes lignes ;
- définir une interprétation rétrocompatible ;
- éviter les migrations destructives.

Exemple déjà en place :

- une séance sans champ `draft` mais sans heure de début peut être interprétée comme brouillon.

### Suppressions

Avant toute suppression, vérifier :

1. ce qui disparaît de l'UI ;
2. ce qui est supprimé de Supabase ;
3. ce qui doit rester dans l'historique.

Exemple : retirer un joueur d'un groupe ne doit pas supprimer son identité globale ni son historique.

---

## 8. Responsive et interaction

Toute modification UI significative doit être pensée pour :

- desktop ;
- tablette ;
- mobile.

Éviter :

- largeurs fixes non nécessaires ;
- texte collé aux bordures ;
- boutons trop petits ;
- scroll interne inutile dans un textarea ;
- sticky qui masque le contenu ;
- grilles difficiles au tactile.

### Notes d'entraînement

Les notes longues doivent :

- s'agrandir automatiquement ;
- ne pas avoir de scroll vertical interne ;
- laisser la page principale défiler.

---

## 9. Vidéo et tactile

Pour les annotations :

- `touch-action:none` seulement quand le mode dessin est actif ;
- bloquer le scroll seulement pendant le dessin ;
- restaurer le scroll normal hors annotation ;
- utiliser des listeners compatibles avec `preventDefault()` si nécessaire.

Après enregistrement d'une annotation, effacer automatiquement le dessin temporaire.

Ne jamais confondre les contrôles vidéo avec la navigation générale.

---

## 10. Tests avant livraison

### Syntaxe JavaScript

Pour tout fichier JS externe modifié :

```bash
node --check js/index.js
node --check js/training.js
```

et faire l'équivalent pour tout autre fichier concerné.

### Test local

Depuis la racine :

```bash
python3 -m http.server 8000
```

Puis ouvrir :

```text
http://localhost:8000
```

Après modification CSS/JS :

```text
Ctrl + Shift + R
```

pour éviter de diagnostiquer un cache périmé comme un bug.

### Smoke test minimum après changement significatif

Vérifier au minimum les zones concernées et leurs voisines :

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

Vérifier aussi la console :

- aucune erreur JavaScript nouvelle ;
- aucun 404 ;
- aucune requête en boucle ;
- aucun polling dupliqué.

---

## 11. Non-régression

Avant de déclarer un changement terminé :

1. inspecter `git diff` ;
2. vérifier que les changements sont limités au besoin ;
3. vérifier qu'aucun correctif récent n'a disparu ;
4. vérifier les fonctionnalités adjacentes ;
5. vérifier la syntaxe ;
6. tester localement.

Ne jamais remplacer un fichier récent par un fichier issu d'un ancien package.

Lors d'une consolidation, la version la plus récente du dépôt local est la base. Les anciens ZIP ne sont jamais la base.

---

## 12. Patches, ZIP et livrables

### Patch ciblé

Si seuls quelques fichiers changent :

- fournir uniquement ces fichiers ;
- conserver leur arborescence exacte ;
- annoncer clairement qu'il s'agit d'un patch.

### Version consolidée

Si une version consolidée est demandée :

- partir de l'état le plus récent ;
- intégrer les changements dans cet état ;
- inclure le projet complet ;
- vérifier les fichiers clés ;
- exécuter les tests syntaxiques ;
- vérifier `git diff` ou un diff équivalent ;
- ne jamais appeler « consolidé » un assemblage provenant d'une ancienne base.

---

## 13. Git

Avant commit :

```bash
git status
git diff
```

Puis, lorsqu'un commit/push est demandé :

```bash
git add .
git commit -m "Description claire"
git push
```

Ne pas utiliser `--force` par défaut.

Si un push forcé est explicitement nécessaire, préférer :

```bash
git push --force-with-lease origin main
```

Ne jamais réécrire l'historique sans nécessité claire.

---

## 14. Modification minimale et cause racine

Pour chaque bug :

1. reproduire ou inspecter ;
2. identifier la cause ;
3. déterminer si elle est locale ou commune ;
4. corriger au bon niveau ;
5. tester la zone concernée ;
6. vérifier la non-régression.

Préférer une correction structurée à un empilement d'overrides ou de hacks.

Avant une modification importante, répondre à ces questions :

- Quelle est la version source exacte ?
- Le problème appartient-il à la page ou au composant commun ?
- Peut-il casser les données existantes ?
- Ajoute-t-il une requête bloquante ?
- Desktop, tablette et mobile restent-ils utilisables ?
- L'état reste-t-il compréhensible sans dépendre uniquement de la couleur ?
- Existe-t-il une correction plus petite et plus propre ?
- Les correctifs récents sont-ils toujours présents ?

---

## 15. Définition de terminé

Une modification n'est terminée que si :

- le code est syntaxiquement valide ;
- l'UI respecte le design system ;
- aucune fonctionnalité existante utile n'a disparu ;
- les anciennes données restent lisibles ;
- le démarrage n'est pas ralenti inutilement ;
- le test local fonctionne ;
- les fichiers annoncés correspondent réellement aux changements ;
- `git diff` ne contient pas de modifications accidentelles.
