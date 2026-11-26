# Sondages de présence aux entraînements

## Validation et mise en service

1. Sur une base Supabase de test compatible avec la production, comparer l’historique des migrations et appliquer les migrations `20261126073554_training_attendance_polls.sql`, `20261126080225_training_attendance_review.sql` et `20261126085216_finalize_training_attendance_poll.sql` dans cet ordre. L’historique SQL versionné du projet est partiel. Vérifier le plan d’application pour éviter de rejouer des migrations existantes.
2. Déployer la fonction Edge `training-attendance-discord` sur le projet de test. Elle vérifie le jeton utilisateur avec Supabase Auth et l’appartenance du coach au groupe dans la RPC de réservation. Si le projet utilise des jetons que la passerelle Edge ne sait pas vérifier, désactiver la vérification de la passerelle pour cette fonction uniquement. La vérification intégrée reste obligatoire.
3. Configurer le frontend de test avec l’URL et la clé publique du projet de test ainsi que son URL de retour d’authentification. Renseigner `TRAINING_ATTENDANCE_APP_URL` sur la fonction Edge si le site de test utilise une autre URL que celle de GitHub Pages. Vérifier la connexion depuis un lien de sondage et les URL de redirection autorisées dans Supabase Auth.
4. Tester avec un groupe et un canal Discord dédiés. Créer une séance via **Planifier sans présences**, l’enregistrer plusieurs fois et utiliser **Déclencher le sondage** quand le programme est prêt. Vérifier le choix de publier sur Discord ou de passer cette étape. Répondre avec deux comptes joueurs, fermer, rouvrir et choisir **Démarrer la séance** le jour prévu. Corriger ensuite les présences effectives et vérifier que les réponses du sondage restent consultables. Vérifier aussi un compte sans accès. Contrôler les résultats statistiques d’une séance existante avant et après.
5. Après validation explicite de la mise en production, appliquer les trois migrations additives puis déployer la fonction Edge et ses secrets sur le projet de production. Publier ensuite le frontend via la PR sur `main`. La base de production est aussi utilisée par le frontend local par défaut.

## Démarrage et assiduité

L’enregistrement, l’autosauvegarde et la duplication laissent la préparation privée. **Déclencher le sondage** ouvre les réponses, puis demande la confirmation d’une publication sur Discord. Le partage du lien reste disponible si cette publication est déclinée ou échoue. Une modification ultérieure de la séance conserve les réponses et le message déjà publié.

Le bouton **Démarrer la séance** dans le panneau **Sondage de présence** applique une seule fois les réponses positives, en respectant les corrections de présence déjà enregistrées, puis ferme le sondage dans la même transaction, même avec zéro présent. Il est disponible à partir de la date de séance en heure de Paris. À partir du démarrage, les réponses du sondage restent consultables et leur édition, sa réouverture et sa relance sont désactivées. Les ajustements se font directement dans les présences effectives.

Une nouvelle séance future du parcours ordinaire ne garde que les choix de présence explicites. Les présélections automatiques se décochent dès que la date devient future. Les séances ordinaires du jour gardent leur présélection habituelle. Jusqu’au démarrage, une séance planifiée est hors historique et hors dénominateur d’assiduité. Les séances futures sont également exclues. Les séances historiques ordinaires suivent le calcul existant. Une séance planifiée doit être démarrée dans son éditeur avant de lancer une collecte en direct ou d’ouvrir la saisie individuelle.

## Vérification sur un environnement isolé

Un projet Supabase distinct et un canal Discord de test avec webhook sont nécessaires pour la validation de bout en bout. Ils ne sont pas disponibles dans le contexte de développement de la PR #4.

- Vérifier le nom et la référence du projet de test dans le tableau de bord. Utiliser cette référence pour chaque commande. Vérifier l’historique et appliquer seulement les trois migrations de la PR sur la base de test, dans l’ordre de leurs timestamps. Déployer avec `supabase functions deploy training-attendance-discord --project-ref <ref-test>`.
- Charger les secrets propres au canal et au frontend de test comme indiqué ci-dessous. Créer deux groupes de test, un coach du groupe cible et un compte joueur dans chacun des groupes. Depuis le groupe cible, publier le sondage, ouvrir le lien et enregistrer une réponse. Vérifier le refus quand le joueur ou le coach de l’autre groupe utilise le même identifiant de séance.
- Ouvrir deux onglets coach et lancer simultanément la publication. Vérifier qu’un seul message arrive dans le canal de test. Vérifier le conflit fermeture/réponse dans les deux ordres, puis une relance manuelle après la publication. Avant le démarrage, vérifier aussi la relance. Tester une réponse simultanée au démarrage dans les deux ordres, puis vérifier le refus des réponses, de la réouverture et des relances après le démarrage.
- Révoquer le webhook de test puis tenter une relance. Vérifier le message d’erreur, la possibilité de copier le lien et la persistance des réponses. Configurer un nouveau webhook de test et vérifier le réessai après le refus. Pour un résultat ambigu, suivre la procédure de rapprochement des envois ci-dessous.

## Configurer Discord

Dans le canal choisi, créer un webhook dans **Modifier le salon → Intégrations → Webhooks**. La fonction accepte le format `https://discord.com/api/webhooks/<id>/<jeton>`. Le serveur envoie le lien du sondage et coupe les mentions. Un coach du groupe peut publier puis relancer depuis la séance.

Enregistrer dans les secrets de la fonction Supabase `TRAINING_ATTENDANCE_DISCORD_WEBHOOKS`, un objet JSON qui associe chaque UUID de groupe à son URL secrète. Utiliser le tableau de bord Supabase ou un fichier temporaire privé fourni à `supabase secrets set --env-file … --project-ref …`. Garder les URL hors du code, des rapports, du navigateur et des historiques de commande. En cas de rotation, remplacer l’entrée du groupe et révoquer l’ancien webhook dans Discord.

Une publication confirmée est unique par séance. Les relances manuelles sont espacées d’au moins dix minutes. Après un refus explicite de Discord, une nouvelle tentative est possible. Après un délai dépassé ou une autre issue incertaine, la réservation reste bloquée pour éviter de publier deux fois. L’opérateur doit vérifier le canal et rapprocher l’état de la livraison dans `private.training_attendance_discord_deliveries` avant de marquer l’envoi comme `sent` ou `rejected`. Le sondage et le partage du lien restent disponibles.

## Relance automatique à J-2

Une relance automatique pourrait utiliser Supabase Cron sur une fonction serveur dédiée, avec un réglage par groupe et une clé unique par séance et échéance de relance. La sélection devrait calculer J-2 dans le fuseau du groupe, ignorer les sondages fermés ou expirés, et réutiliser les réservations pour partager l’anti-doublon avec les relances manuelles. Une modification de la date de séance doit déplacer l’échéance sans rejouer une relance déjà partie. Cette branche livre les relances manuelles. Aucun cron ni rappel automatique n’est activé.
