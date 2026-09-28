# Kinball Coach — Groupe / Sélections

Cette version distingue désormais :

- **Groupe** : collectif durable, par exemple `EDF H 2025-2027`.
- **Sélection** : sous-effectif pour une compétition, un stage ou un autre contexte.
- **Séance d'entraînement** : reste rattachée au groupe complet ; une sélection peut seulement préremplir les présences.
- **Match** : reste rattaché au groupe et peut, facultativement, être rattaché à une sélection.

## Supabase déjà appliqué en production

- tables `coaching_group_selections` et `coaching_group_selection_players` ;
- champ `matches.selection_id` ;
- RLS et droits d'accès ;
- indexes ;
- sélection `CDE 2026` créée pour `EDF H 2025-2027` ;
- 9 joueurs repris depuis les effectifs réels des matchs CDE ;
- les 5 matchs CDE 2026 existants sont rattachés à cette sélection ;
- le match `QA testing` reste sans sélection.

Joueurs actuellement dans `CDE 2026` :
Adrien, Gildas, Lenny, Matthias, Philéas, Philippe, Rémi, Théo, Thibault.

`Test` n'est pas membre de cette sélection.

## Fonctionnalités UI

- créer, modifier et archiver une sélection depuis **Groupes** ;
- choisir les joueurs appartenant à la sélection ;
- choisir facultativement une sélection lors de la création d'un match ;
- filtrer automatiquement l'effectif proposé pour ce match ;
- modifier la sélection dans les métadonnées du match ;
- afficher la sélection dans la bibliothèque / lecture d'un match ;
- préremplir les présences d'une séance avec une sélection ;
- conserver les statistiques d'entraînement sur l'effectif complet du groupe.

Les autres joueurs de l'effectif élargi EDF H 2025-2027 n'ont pas été ajoutés automatiquement : leurs noms n'ont pas été fournis. Ils peuvent être ajoutés normalement depuis **Groupes**.

Les migrations Supabase correspondant aux changements déjà appliqués sont incluses dans `supabase/migrations/`.
