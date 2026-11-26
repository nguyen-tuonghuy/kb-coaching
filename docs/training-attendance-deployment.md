# Sondages de présence aux entraînements

## Validation et mise en service

1. Sur une base Supabase de test compatible avec la production, comparer l’historique des migrations et appliquer la migration `20261126073554_training_attendance_polls.sql`. L’historique SQL versionné du projet est partiel. Vérifier le plan d’application pour éviter de rejouer des migrations existantes.
2. Déployer la fonction Edge `training-attendance-discord` sur le projet de test. Elle vérifie le jeton utilisateur avec Supabase Auth et l’appartenance du coach au groupe dans la RPC de réservation. Si le projet utilise des jetons que la passerelle Edge ne sait pas vérifier, désactiver la vérification de la passerelle pour cette fonction uniquement. La vérification intégrée reste obligatoire.
3. Configurer le frontend de test avec l’URL et la clé publique du projet de test ainsi que son URL de retour d’authentification. Renseigner `TRAINING_ATTENDANCE_APP_URL` sur la fonction Edge si le site de test utilise une autre URL que celle de GitHub Pages. Vérifier la connexion depuis un lien de sondage et les URL de redirection autorisées dans Supabase Auth.
4. Tester avec un groupe et un canal Discord dédiés. Créer une séance via **Planifier sans présences**, l’enregistrer et ouvrir un sondage. Répondre avec deux comptes joueurs, fermer, rouvrir, initialiser la liste, corriger les présences et confirmer un écart tardif. Vérifier aussi un compte sans accès. Contrôler les résultats statistiques d’une séance existante avant et après.
5. Après validation explicite de la mise en production, appliquer la migration additive puis déployer la fonction Edge et ses secrets sur le projet de production. Publier ensuite le frontend via la PR sur `main`. La base de production est aussi utilisée par le frontend local par défaut.

## Configurer Discord

Dans le canal choisi, créer un webhook dans **Modifier le salon → Intégrations → Webhooks**. La fonction accepte le format `https://discord.com/api/webhooks/<id>/<jeton>`. Le serveur envoie le lien du sondage et coupe les mentions. Un coach du groupe peut publier puis relancer depuis la séance.

Enregistrer dans les secrets de la fonction Supabase `TRAINING_ATTENDANCE_DISCORD_WEBHOOKS`, un objet JSON qui associe chaque UUID de groupe à son URL secrète. Utiliser le tableau de bord Supabase ou un fichier temporaire privé fourni à `supabase secrets set --env-file … --project-ref …`. Garder les URL hors du code, des rapports, du navigateur et des historiques de commande. En cas de rotation, remplacer l’entrée du groupe et révoquer l’ancien webhook dans Discord.

Une publication confirmée est unique par séance. Les relances manuelles sont espacées d’au moins dix minutes. Après un refus explicite de Discord, une nouvelle tentative est possible. Après un délai dépassé ou une autre issue incertaine, la réservation reste bloquée pour éviter de publier deux fois. L’opérateur doit vérifier le canal et rapprocher l’état de la livraison dans `private.training_attendance_discord_deliveries` avant de marquer l’envoi comme `sent` ou `rejected`. Le sondage et le partage du lien restent disponibles.

## Relance automatique à J-2

Une relance automatique pourrait utiliser Supabase Cron sur une fonction serveur dédiée, avec un réglage par groupe et une clé unique par séance et échéance de relance. La sélection devrait calculer J-2 dans le fuseau du groupe, ignorer les sondages fermés ou expirés, et réutiliser les réservations pour partager l’anti-doublon avec les relances manuelles. Une modification de la date de séance doit déplacer l’échéance sans rejouer une relance déjà partie. Cette branche livre les relances manuelles. Aucun cron ni rappel automatique n’est activé.
