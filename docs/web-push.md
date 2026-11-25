# Notifications push Web

## Audit et architecture

La PWA utilise le manifest et le service worker de la racine. Le worker s’active immédiatement et supprime les anciens caches Kinball Coach. Il n’intercepte pas les requêtes. Les deux nouveaux événements `push` et `notificationclick` s’ajoutent à ce fonctionnement. Un petit cache dédié contient uniquement l’identifiant opaque de l’abonnement actif sur l’appareil.

Les événements viennent des écritures existantes dans Supabase. L’audit en lecture seule a vérifié les RPC de la messagerie, des vidéos et des collectes, les colonnes, les politiques pertinentes et les fonctions Edge vidéo. Les indicateurs internes de lecture restent gérés par leurs RPC actuelles. Aucun hook e-mail métier correspondant n’a été identifié dans le dépôt ou dans les déclencheurs audités. Les e-mails hors dépôt, dont les e-mails d’authentification et d’invitation, gardent leur configuration actuelle. Un test avec une boîte de staging reste nécessaire pour les valider de bout en bout.

| Événement | Source existante | Destinataires |
| --- | --- | --- |
| Nouvelle vidéo | Insertion du dépôt vidéo | Compte joueur actif associé à la vidéo, hors auteur |
| Nouvelle annotation | Insertion d’un repère sur une vidéo partagée ou première transition vers une analyse partagée avec repères | Compte joueur actif de la vidéo, hors auteur |
| Nouveau message | Insertion dans l’historique de conversation | Joueur actif pour un envoi du staff, entraîneurs du groupe pour un envoi du joueur, hors auteur et hors messages déjà lus |
| Collecte ouverte | Première insertion de la collecte d’une occurrence | Comptes de l’instantané des participants, toujours liés au bon groupe, actifs, présents et autorisés à saisir pour cette occurrence ouverte |

Le contrat vidéo actuel autorise les notes au joueur associé à la vidéo lorsqu’elle est au statut `reviewed`. Il ne modélise aucun partage de notes à l’ensemble d’un groupe. Une annotation est distribuée aux seuls destinataires que le contrat existant autorise. Les repères en brouillon sont regroupés en une seule notification au partage. Les modifications de repères, les sauvegardes et la fermeture de la collecte ne créent pas d’événement. Les imports historiques de Drive sans auteur, détectés par l’action « synchroniser », restent silencieux. Le dépôt vidéo normal enregistre l’auteur dans `uploaded_by`.

Supabase conserve les écritures métier, les droits, les abonnements, les préférences et la file. La capture ajoute une écriture SQL locale par événement, sans appel réseau et sans attendre l’envoi. Les défaillances de la capture sont journalisées et la transaction métier peut aboutir. La distribution résout les destinataires dans la base, puis revérifie les droits, la préférence et l’état de l’appareil avant chaque tentative. L’ouverture du lien passe par le chargement normal de l’application et ses contrôles d’accès. La charge utile Web Push chiffrée ne contient ni nom, ni texte de conversation, ni résultat individuel. L’écran verrouillé n’affiche que des libellés génériques.

**Choix de distribution.** Une Supabase Edge Function évite une nouvelle intégration entre l’infrastructure de diffusion vidéo Cloudflare et Supabase. Elle utilise les secrets serveur et les appels RPC groupés du projet existant. Le Worker vidéo est déployé hors dépôt et son code n’était pas disponible pour cet audit. Un Worker Cloudflare dédié est possible avec un déclencheur Cron, mais il faudrait lui déléguer une identité Supabase, maintenir deux configurations et effectuer les mêmes lectures et écritures distantes. Il resterait pertinent si le volume s’approchait des limites Edge. Aucun quota Cloudflare supplémentaire n’est consommé ici.

L’API Badging a été étudiée. Une pastille fidèle exigerait un compteur consolidé entre groupes, rôles et appareils, y compris quand un message est lu ailleurs. Cette version conserve les compteurs existants dans l’application.

## Déclenchement, échecs et quotas

Le travail Supabase Cron `kc-web-push-dispatch` s’exécute toutes les minutes. Il consulte `private.web_push_work_due()`. Si les envois sont actifs et qu’un événement récent attend une expansion ou qu’une livraison est arrivée à échéance, `pg_net` fait un POST asynchrone à `web-push`. Vault fournit l’URL et le secret envoyé via `Authorization: Bearer`. Aucun navigateur ne déclenche directement la fonction.

La fonction réserve au maximum 15 livraisons avec un bail de deux minutes. Pour chaque sous-lot de cinq, `prepare_web_push` revérifie immédiatement le bail, l’appareil, l’éligibilité au pilote, les préférences et les droits métier actuels avant de renvoyer les endpoints. Les requêtes au fournisseur ont un délai maximal de huit secondes. Une désactivation ou une révocation intervenue après ce dernier contrôle ne peut pas annuler un POST déjà parti. Le service worker vérifie encore l’appareil lors de la réception et l’application vérifie l’accès à l’ouverture.

Une erreur réseau, HTTP 401, 403, 408, 429 ou 5xx, ou une erreur de préparation du message peut déclencher un réessai. Le premier attend au moins 2 minutes, le deuxième 4 minutes et le troisième 8 minutes. Si le fournisseur renvoie un `Retry-After` plus long, il s’applique dans la limite de 30 minutes. Une livraison perdue sans résultat redevient disponible à l’expiration du bail. Il y a au plus quatre tentatives de livraison et aucune tentative au-delà des deux heures de l’événement. HTTP 404 et 410 retirent l’abonnement. Un retour de fournisseur positif signifie qu’il a accepté le message. Une perte de réponse peut entraîner un doublon malgré le tag et le sujet stables.

Sur 30 jours, à vide, le cron exécute **43 200 vérifications SQL et invoque la fonction Edge zéro fois**. Le nettoyage à 03 h 13 UTC ajoute environ 30 tâches SQL et zéro invocation Edge. Avec une file continuellement prête, ce cron peut déclencher 43 200 invocations en 30 jours, soit 8,64 % des **500 000 invocations mensuelles** incluses dans l’offre Free, partagées à l’échelle de l’organisation. Les appels manuels ou externes à la fonction et les autres fonctions du projet s’ajoutent à cette consommation. Chaque passage avec du travail fait jusqu’à cinq RPC groupées et un POST fournisseur par tentative. À titre d’ordre de grandeur, 200 événements, deux destinataires et 1,5 appareil par destinataire représentent 600 tentatives initiales. Le SQL et l’egress consomment toujours des ressources. [Quota Edge Functions](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)

## Clés et secrets

Depuis GitHub, ouvre `tools/web-push-keys.html` sur la branche approuvée, puis utilise **Download raw file**. Ouvre le fichier téléchargé depuis le disque dans un navigateur récent. Le bouton génère une paire VAPID ECDSA P‑256 et un secret Cron aléatoire de 32 octets en hexadécimal. Génère un jeu distinct pour chaque environnement. Copie les valeurs sensibles directement dans les champs Secrets ou Vault de Supabase, puis ferme la page. Garde la paire VAPID pour les redéploiements ordinaires. Évite les captures, le chat, le SQL Editor, les journaux et les commits pour la clé privée et le secret Cron.

| Nom exact | Où le renseigner |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Supabase → Edge Functions → Secrets. Copie également cette clé publique dans la configuration SQL ci-dessous. |
| `VAPID_PRIVATE_KEY` | Supabase → Edge Functions → Secrets. |
| `VAPID_SUBJECT` | Supabase → Edge Functions → Secrets. Adresse de contact au format `mailto:adresse@domaine`. |
| `WEB_PUSH_DISPATCH_SECRET` | Supabase → Edge Functions → Secrets. Copie la même valeur dans le secret Vault `kc_web_push_dispatch_secret`. |
| `kc_web_push_dispatch_url` | Supabase → Vault. URL HTTPS complète relevée dans les détails de `web-push`, sous la forme `https://<ref>.supabase.co/functions/v1/web-push`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Fournis automatiquement par le runtime Edge hébergé. Leur utilisation est réservée à la fonction serveur. |

## Déploiement depuis les interfaces web, après validation explicite

1. **GitHub — préparer la source.** Les changements sont sur la branche locale de Codex `feature/web-push`. Autorise séparément le commit et le push de cette branche. Sur GitHub, ouvre une PR vers `main` pour revue. La fusion déclenche la publication GitHub Pages de production.
2. **Supabase — sélectionner un projet de staging isolé.** Utilise un projet dont le schéma métier est déjà restauré, avec uniquement des données fictives. L’historique SQL du dépôt est partiel. Avant toute recette, publie le frontend sur une origine HTTPS distincte et assure-toi que *toutes* les pages pointent vers l’URL Supabase et la clé publique de staging. Les valeurs par défaut du dépôt pointent vers la production. Fournis des configurations de test séparées pour les e-mails, le stockage vidéo et les services externes si tu testes ces flux.
3. **Supabase — appliquer une seule migration.** Dans **SQL Editor**, vérifie que `20261125131535` est absente de `supabase_migrations.schema_migrations` et que `to_regclass('private.web_push_configuration')` renvoie `NULL`. Si l’historique et le schéma se contredisent, arrête-toi pour auditer la divergence. Vérifie les dépendances métier du projet avant d’appliquer **`supabase/migrations/20261125131535_web_push.sql`**. Utilise le processus de migration habituel si disponible à distance. Avec **SQL Editor**, entoure le contenu exact du fichier par `BEGIN; SET LOCAL lock_timeout = '5s';` et `COMMIT;`. Après la réussite, inscris **uniquement** `20261125131535` comme `applied` avec `supabase migration repair` depuis un terminal distant autorisé, par exemple GitHub Codespaces relié explicitement au projet de staging. Contrôle l’historique depuis SQL Editor avant de continuer. L’éditeur SQL n’enregistre pas la migration à lui seul. Évite une synchronisation globale des migrations dans ce dépôt. [Historique des migrations Supabase](https://supabase.com/docs/guides/deployment/database-migrations)
4. **Supabase — enregistrer les secrets et déployer la fonction.** Ajoute les quatre valeurs dans **Edge Functions → Secrets**. Dans **Edge Functions → Deploy a new function → Via Editor**, nomme-la `web-push`, copie `supabase/functions/web-push/index.ts` et déploie. Dans **Details**, désactive **Verify JWT** pour cette seule fonction. Elle exige le secret Cron et rejette les appels non authentifiés. La dépendance npm est épinglée dans le source. Le déploiement depuis une CLI distante permet aussi de livrer le verrou Deno contrôlé au dépôt. [Déploiement via l’éditeur](https://supabase.com/docs/guides/functions/quickstart-dashboard) · [Authentification des fonctions](https://supabase.com/docs/guides/functions/auth)
5. **Supabase — configurer Vault et Cron.** Ajoute les deux entrées Vault. Active les extensions `pg_cron` et `pg_net` via le tableau de bord si nécessaire. Exécute le bloc Cron ci-dessous dans SQL Editor. Renseigne uniquement la clé *publique* dans la configuration. Elle laisse l’envoi désactivé par défaut. Confirme que le Cron SQL tourne et que les invocations Edge restent à zéro.
6. **Supabase — ouvrir le pilote de staging.** Dans **Authentication → Users**, relève les UUID des comptes de test, puis ajoute-les avec le bloc pilote. Active l’envoi, fais la recette ci-dessous et vérifie le bouton d’arrêt. Quand tous les contrôles passent, programme séparément la production. Déploie d’abord la migration, la fonction et le Cron avec `enabled=false`. Après validation, fusionne la PR sur GitHub pour publier le frontend. Confirme la version GitHub Pages et le service worker, puis active uniquement les comptes pilotes convenus.

### Enregistrer la migration après un passage par SQL Editor

Depuis le terminal web Codespaces d’un checkout de la branche approuvée, authentifie la CLI si nécessaire. Remplace `REF_PROJET_APPROUVE` par la référence du projet où le SQL a réussi. Le second appel modifie uniquement l’historique correspondant à cette migration. Après son exécution, vérifie la ligne dans SQL Editor.

```sh
npx --yes supabase@3.4.0 login
npx --yes supabase@3.4.0 migration repair 20261125131535 --status applied --remote=REF_PROJET_APPROUVE --yes
```

### SQL de configuration et de planification

```sql
-- Requête de contrôle à exécuter avant toute migration.
select version, name from supabase_migrations.schema_migrations where version='20261125131535';
select to_regclass('private.web_push_configuration') as push_configuration;
```

```sql
-- Après la migration et la création des entrées Vault.
insert into private.web_push_configuration(vapid_public_key)
values ('<clé-VAPID-publique>')
on conflict (singleton) do nothing;

select cron.schedule('kc-web-push-dispatch', '* * * * *', $job$
  select net.http_post(
    url := u.decrypted_secret,
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets u cross join vault.decrypted_secrets s
  where u.name='kc_web_push_dispatch_url' and s.name='kc_web_push_dispatch_secret'
    and private.web_push_work_due();
$job$);

select cron.schedule('kc-web-push-cleanup', '13 3 * * *', $job$
  delete from private.web_push_events where created_at<now()-interval '7 days';
  delete from private.web_push_devices where disabled_at<now()-interval '7 days';
$job$);

select jobname, schedule, active from cron.job
where jobname in ('kc-web-push-dispatch','kc-web-push-cleanup');
```

### Activation pilote, arrêt et reprise

```sql
-- Pilote. Répéter l’INSERT pour les comptes autorisés.
begin;
insert into private.web_push_pilots(user_id) values ('<UUID-du-compte>') on conflict do nothing;
update private.web_push_configuration set pilot_only=true, enabled=true where singleton;
commit;

-- Retirer un compte du pilote.
delete from private.web_push_pilots where user_id='<UUID-du-compte>';

-- Arrêt des envois. La messagerie, les e-mails et les opérations métier continuent.
update private.web_push_configuration set enabled=false where singleton;

-- Reprise ultérieure en pilote, après validation.
update private.web_push_configuration set enabled=true, pilot_only=true where singleton;

-- Ouverture générale, après validation du pilote.
update private.web_push_configuration set enabled=true, pilot_only=false where singleton;
```

L’activation et le changement de mode fixent un nouveau seuil temporel. Les anciens événements métier ne sont pas relus, les événements en attente avant ce seuil sont ignorés et un compte nouvellement ajouté au pilote ne reçoit pas les événements antérieurs à son ajout. Réactiver le même mode après une pause conserve les préférences et les abonnements. Les droits et la disponibilité de l’appareil sont revérifiés avant envoi.

Pour un retour arrière, mets d’abord `enabled=false`. Si tu veux également arrêter les vérifications SQL, désactive le seul travail `kc-web-push-dispatch` dans **Integrations → Cron → Jobs**. Pour retirer l’interface après approbation, utilise **Revert** sur la PR GitHub puis fusionne la PR de retour arrière. Laisse la migration en place, inactive, pour conserver l’historique et les préférences. L’arrêt ne rappelle pas les requêtes déjà parties vers les fournisseurs. En cas de rotation de la paire VAPID, garde l’envoi désactivé, remplace les deux clés Edge et la clé publique SQL, désactive les anciens abonnements, puis demande à chaque appareil de se réactiver.

## Recette sur appareils et navigateur

Avec des comptes et groupes fictifs de staging, utilise un entraîneur, un joueur présent, un joueur absent et un joueur d’un autre groupe.

1. Android Chrome : ouvre le site ou installe la PWA. Dans **Mon profil → Notifications**, active l’appareil, accepte la permission, envoie un test, puis ferme l’application. Vérifie l’arrivée du test et l’ouverture de Kinball Coach au toucher. Répète depuis un navigateur desktop compatible.
2. iOS/iPadOS 16.4 ou ultérieur : vérifie les instructions depuis Safari puis utilise **Partager → Sur l’écran d’accueil**. Ouvre l’icône installée et refais la recette Android. Avec une autre installation de test, refuse d’abord la permission et vérifie les indications.
3. Active deux appareils pour le même compte. Reçois un message sur les deux, puis désactive un seul appareil. Vérifie que le test ne cible que l’appareil demandeur.
4. Déconnecte l’un des appareils et connecte un autre compte. Vérifie que les notifications du premier compte ne s’affichent plus, puis active explicitement le second compte.
5. Dépose une vidéo de test pour le joueur, ajoute un repère brouillon, publie l’analyse, puis ajoute un nouveau repère. Vérifie les trois notifications attendues et l’absence de notification de brouillon au joueur.
6. Ouvre une collecte avec le joueur présent. Vérifie que l’absent, les comptes d’un autre groupe et l’auteur ne reçoivent rien. Enregistre et rouvre l’éditeur, puis tente d’ouvrir de nouveau la même collecte. Vérifie l’absence de second push. Ouvre le lien et vérifie le formulaire et ses droits après reconnexion.
7. Avec un compte hors pilote, vérifie que les réglages refusent l’activation et le test. Retire un compte après la mise en file, puis vérifie l’absence d’envoi pour ce compte. Crée une action durant la pause, reprends le pilote, puis vérifie que seule une nouvelle action déclenche un push.
8. Vérifie la messagerie interne. Fais passer un message de l’état non lu à lu sans et avec l’appareil activé. Dans la boîte de staging, vérifie les e-mails de confirmation de compte, d’invitation et de réinitialisation. Vérifie les éventuels e-mails métier configurés hors dépôt avec les mêmes destinataires et conditions qu’avant.
9. Révoque un abonnement de test et vérifie sa suppression après 404/410. Vérifie l’affichage des réglages sur mobile, tablette et desktop et l’absence de nouvelles requêtes push au démarrage. Confirme un nombre nul d’appels Edge pendant un intervalle sans travail, avant puis après une pause.

## Vérification locale

Les tests `web-push-sql`, `web-push-browser` et `web-push-dispatch` utilisent respectivement PGlite, JSDOM et des réponses HTTP simulées, avec des données fictives. Ils peuvent être exécutés avec les dépendances exposées dans `NODE_PATH`, sans installer de dépendances dans le dépôt.

```sh
node --test --test-concurrency=1 tests/web-push-*.test.cjs
deno check --frozen --lock=supabase/functions/web-push/deno.lock supabase/functions/web-push/index.ts
node tools/build-coaching-runtime.cjs --check
```

Les tests du service worker simulent les événements et la réutilisation des fenêtres. La réception par un fournisseur réel, le rendu sur appareil physique et l’acheminement des e-mails sont couverts par la recette de staging.

## Ajouter une catégorie

Ajoute la préférence RLS et son contrôle de formulaire, puis rattache un type d’événement à une transition métier durable. Définis les destinataires, l’exclusion de l’auteur et la vérification d’accès dans `private.web_push_targets`. Ajoute une clé de déduplication stable, la copie générique et une destination interne prédéfinie dans le service worker. Étends les tests SQL et les tests de clic. Le répartiteur continue à traiter les mêmes contrats de file et de livraison.
