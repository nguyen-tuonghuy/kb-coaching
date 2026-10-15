# Publication des analyses vidéo

Le statut technique `reviewed` reste l'indicateur de publication d'une analyse. Le client appelle `review_player_video` avec un `p_review_text` nullable : un commentaire global vide est accepté par l'interface lorsqu'au moins un repère horodaté a été chargé pour la vidéo.

## Migration à appliquer avant publication

La migration `supabase/migrations/20261015120000_allow_video_review_without_global_comment.sql` reprend la définition déployée de `review_player_video` et ne modifie que la règle de contenu : un commentaire non vide ou un repère existant est exigé. Elle rend `coaching_player_videos.review_text` nullable pour stocker sans ambiguïté une analyse composée uniquement de repères.

Elle conserve la garde `private.is_group_coach`, `SECURITY DEFINER`, le `search_path`, les métadonnées de revue, la remise à zéro de la synchronisation et le marqueur de lecture. `CREATE OR REPLACE` conserve les privilèges de la fonction existante. La publication ne met à jour et ne supprime aucun repère. Un partage sans commentaire ne remplace pas par `null` un commentaire déjà publié depuis un autre onglet.

Avant de déployer la V1 :

1. vérifier dans `supabase_migrations.schema_migrations` que le timestamp n'a pas déjà été appliqué ;
2. appliquer la migration via le processus Supabase habituel, sans la rejouer manuellement ;
3. confirmer sur une donnée de test que `get_player_video_notes` refuse toujours les brouillons au joueur ;
4. confirmer les droits `EXECUTE` actuels de `review_player_video` après migration ;
5. tester un partage avec repère seul et un partage avec commentaire seul.
