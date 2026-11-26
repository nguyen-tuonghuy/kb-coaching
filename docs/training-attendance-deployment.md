# Sondages de présence aux entraînements

## Recette progressive en production

Le prochain entraînement réel est prévu le **dimanche 20 décembre 2026**. Réserver une fenêtre de recette et de retour arrière avant cette date, en dehors des collectes. Si la recette reste incomplète, garder le frontend publié et le parcours habituel pour cet entraînement. La validation du principe de la recette ne vaut pas autorisation d’exécution. Attendre une validation explicite avant la première écriture Supabase de mise en service, puis une validation explicite de la publication avant toute fusion dans `main`.

### 1. Préparer la sauvegarde et le retour arrière

- Relever le commit actuellement servi par GitHub Pages, la référence exacte du projet Supabase, les trois versions à appliquer et l’état du déploiement de la fonction. Garder la liste des comptes et groupes de test dans un espace privé.
- Vérifier dans **Database → Backups** la disponibilité et la fraîcheur du point de restauration. Juste avant la fenêtre, disposer d’une sauvegarde ou d’un point PITR vérifié et relever son horodatage. Si le point disponible laisse un intervalle de perte inacceptable, faire réaliser une sauvegarde logique vérifiée, avec le schéma, les données et les éléments Auth et rôles nécessaires à une restauration. Garder les exports chiffrés et hors du dépôt. Distinguer la sauvegarde de base des fichiers Storage et des secrets Edge, gérés séparément.
- Identifier la personne habilitée à restaurer, les opérations susceptibles de se produire après le point de sauvegarde et le temps de remise en service. Capturer aussi la définition et les privilèges de la RPC de statistiques en vigueur pour un éventuel correctif ciblé. Reporter l’intervention si le point de retour ou sa procédure manque.

### 2. Migrer avec le frontend précédent encore publié

Après accord, comparer `supabase_migrations.schema_migrations` au dépôt et examiner le plan d’application. L’historique versionné est partiel. Appliquer uniquement les versions manquantes de la liste suivante, dans l’ordre, en inscrivant chaque succès dans l’historique distant.

1. `20261126073554_training_attendance_polls.sql`
2. `20261126080225_training_attendance_review.sql`
3. `20261126085216_finalize_training_attendance_poll.sql`

Les colonnes de séance ajoutées ont des valeurs compatibles avec les écritures de l’ancien client. Les contrats de sauvegarde, de bail et de collecte existants gardent leurs signatures. La RPC de statistiques conserve sa signature et sa structure, avec un filtre qui exclut déjà les séances futures et les préparations non démarrées dès l’application SQL. Comparer les résultats du passé et les dénominateurs attendus séparément. Le frontend de la branche attend les trois migrations.

Tant que GitHub Pages sert encore l’ancien frontend, vérifier avec les comptes et les séances du groupe fictif la connexion, la consultation de l’historique, le chargement des statistiques et l’enregistrement d’une séance ordinaire avec bail. Vérifier qu’une collecte existante et ses résultats restent lisibles. Arrêter la procédure dès qu’un de ces contrôles échoue.

### 3. Tester la branche avec le groupe dédié

- Créer un groupe fictif et un canal Discord destinés à la recette, ainsi qu’un second groupe fictif pour les essais d’accès refusé. Utiliser uniquement des comptes de test, des séances au jour de la recette pour le démarrage et des séances futures pour la préparation. Garder les séances réelles, dont celle du 20 décembre, hors des essais.
- Déployer uniquement la fonction Edge `training-attendance-discord` sur la référence Supabase vérifiée, puis configurer le webhook du groupe de recette comme indiqué plus bas. La fonction valide le jeton via Supabase Auth et les droits du coach via la RPC de réservation. Si la passerelle ne reconnaît pas le format de jeton du projet, régler la vérification au niveau de cette seule fonction tout en conservant sa validation intégrée.
- Servir une copie privée du commit de la PR avant fusion, sur une origine réservée aux testeurs. Cette copie accède à **la base de production**. Même une copie sur localhost peut écrire en production. Aligner temporairement son `AUTH_REDIRECT_URL`, l’URL de retour autorisée dans Supabase Auth et `TRAINING_ATTENDANCE_APP_URL` sur l’URL de recette. La fonction utilise cette dernière URL pour le lien Discord et autorise son origine uniquement. Conserver les changements de configuration frontend dans la copie privée.
- Contrôler les scénarios de recette ci-dessous, consigner seulement des résultats anonymisés dans la PR, puis demander la validation de publication. Avant une fusion autorisée, remettre l’URL Edge sur celle de GitHub Pages et retirer l’autorisation de retour Auth temporaire. Vérifier ensuite le lien du site publié et l’ancien parcours avec le groupe dédié. Configurer le webhook du groupe réel seulement après validation de ces contrôles.

## Démarrage et assiduité

L’enregistrement, l’autosauvegarde et la duplication laissent la préparation privée. **Déclencher le sondage** ouvre les réponses, puis demande la confirmation d’une publication sur Discord. Le partage du lien reste disponible si cette publication est déclinée ou échoue. Une modification ultérieure de la séance conserve les réponses et le message déjà publié.

Le bouton **Démarrer la séance** dans le panneau **Sondage de présence** applique une seule fois les réponses positives, en respectant les corrections de présence déjà enregistrées, puis ferme le sondage dans la même transaction, même avec zéro présent. Il est disponible à partir de la date de séance en heure de Paris. À partir du démarrage, les réponses du sondage restent consultables et leur édition, sa réouverture et sa relance sont désactivées. Les ajustements se font directement dans les présences effectives.

Une nouvelle séance future du parcours ordinaire ne garde que les choix de présence explicites. Les présélections automatiques se décochent dès que la date devient future. Les séances ordinaires du jour gardent leur présélection habituelle. Jusqu’au démarrage, une séance planifiée est hors historique et hors dénominateur d’assiduité. Les séances futures sont également exclues. Les séances historiques ordinaires suivent le calcul existant. Une séance planifiée doit être démarrée dans son éditeur avant de lancer une collecte en direct ou d’ouvrir la saisie individuelle.

## Scénarios du groupe de recette

| Essai | Résultat attendu |
| --- | --- |
| Créer et enregistrer deux fois une préparation future. Ouvrir son panneau de sondage après la dernière sauvegarde. | Aucune réponse ouverte et aucun envoi Discord. La séance ordinaire du jour garde son parcours habituel. |
| Déclencher un sondage avec échéance, puis décliner Discord. Modifier ensuite la séance. | Le lien copiable fonctionne, les réponses saisies restent présentes et la modification ne republie rien. |
| Ouvrir le lien Discord sur téléphone avec un compte joueur déconnecté, puis se connecter. Essayer aussi avec les comptes du second groupe. | Le joueur habilité retrouve le sondage et peut répondre. Les comptes hors groupe sont refusés. |
| Publier deux fois presque simultanément sur un sondage de test ouvert, puis effectuer une relance avant le démarrage. | Une seule publication initiale arrive dans le canal. La relance manuelle est disponible. |
| Fermer et rouvrir une séance de test du jour. Faire coïncider une réponse et le démarrage, puis tester une séance à zéro présent. | La réponse est soit prise en compte avant la fermeture, soit refusée. Le démarrage ferme le sondage même à zéro. Les réponses sont consultables, la réouverture et la relance sont bloquées, et le coach peut corriger les présences effectives. |
| Tenter une relance avec le webhook de test révoqué. Contrôler ensuite le canal puis rétablir un webhook de test valide. | Le refus Discord est visible. Le lien et les réponses restent disponibles. Voir la procédure ci-dessous si l’issue est incertaine. |
| Comparer les statistiques historiques avant et après. Vérifier la préparation future et le démarrage vide du groupe de recette. | Les résultats historiques sont conservés. Les préparations restent hors dénominateur jusqu’au démarrage et les séances futures sont exclues. |

## Retour arrière

1. **Avant la fusion** — Suspendre la recette et couper les publications en retirant l’entrée webhook du groupe de test. Fermer les sondages de recette encore ouverts si nécessaire. Le site déjà publié reste le point de service. Si le problème est limité à la fonction Edge, la désactiver ou rétablir la version et la configuration précédentes. Conserver les réponses, les journaux de livraison et les séances en base.
2. **Après la fusion** — Suspendre les publications du groupe concerné. Faire valider un revert Git de la publication pour redéployer le frontend précédent via GitHub Pages. Vérifier le commit servi et recharger les clients PWA avant de tester le parcours habituel. Ce revert laisse les migrations en place, y compris le filtre statistique.
3. **Si le problème persiste côté base** — Isoler la cause. Préférer un correctif SQL ciblé et validé, par exemple rétablir le contrat antérieur de la RPC de statistiques, puis tester le frontend publié. Éviter de supprimer les nouvelles tables ou colonnes depuis un script d’annulation. Une restauration complète est le dernier recours. Avant d’obtenir l’accord, faire le bilan des écritures postérieures au point de sauvegarde, sauvegarder l’état courant si possible et arrêter les écritures pendant l’opération. Une restauration à un point antérieur peut perdre ces écritures et doit faire l’objet d’une validation spécifique.
4. Vérifier la connexion, la sauvegarde ordinaire, la collecte et les statistiques avec le groupe dédié. Consigner le point rétabli et les écarts avant de réouvrir le service.

## Configurer Discord

Dans le canal choisi, créer un webhook dans **Modifier le salon → Intégrations → Webhooks**. La fonction accepte le format `https://discord.com/api/webhooks/<id>/<jeton>`. Le serveur envoie le lien du sondage et coupe les mentions. Un coach du groupe peut publier puis relancer depuis la séance.

Enregistrer dans les secrets de la fonction Supabase `TRAINING_ATTENDANCE_DISCORD_WEBHOOKS`, un objet JSON qui associe chaque UUID de groupe à son URL secrète. Utiliser le tableau de bord Supabase ou un fichier temporaire privé fourni à `supabase secrets set --env-file … --project-ref …`. Garder les URL hors du code, des rapports, du navigateur et des historiques de commande. En cas de rotation, remplacer l’entrée du groupe et révoquer l’ancien webhook dans Discord.

Une publication confirmée est unique par séance. Les relances manuelles sont espacées d’au moins dix minutes. Après un refus explicite de Discord, une nouvelle tentative est possible. Après un délai dépassé ou une autre issue incertaine, la réservation reste bloquée pour éviter de publier deux fois. L’opérateur doit vérifier le canal et rapprocher l’état de la livraison dans `private.training_attendance_discord_deliveries` avant de marquer l’envoi comme `sent` ou `rejected`. Le sondage et le partage du lien restent disponibles.

## Relance automatique à J-2

Une relance automatique pourrait utiliser Supabase Cron sur une fonction serveur dédiée, avec un réglage par groupe et une clé unique par séance et échéance de relance. La sélection devrait calculer J-2 dans le fuseau du groupe, ignorer les sondages fermés ou expirés, et réutiliser les réservations pour partager l’anti-doublon avec les relances manuelles. Une modification de la date de séance doit déplacer l’échéance sans rejouer une relance déjà partie. Cette branche livre les relances manuelles. Aucun cron ni rappel automatique n’est activé.
