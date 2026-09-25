# SALESFORCE_GAP.md — Parité Salesforce Flow, brique par brique, jugée pour un plombier de six employés

Phase 2B. Lecture seule. Pour chaque brique : ce que Salesforce Flow Builder / Automation fait, ce que Lume fait aujourd'hui (fichiers), l'écart, le verdict et l'effort. Le juge n'est pas un admin Salesforce certifié : c'est un entrepreneur en plomberie, électricité ou paysagement qui ouvre la page une fois par mois et qui veut que ses relances partent, juste, et jamais en double.

Verdicts : **À CONSTRUIRE** (ça manque et ça compte), **À SIMPLIFIER** (Salesforce le fait en usine à gaz, Lume doit le faire en un interrupteur), **À IGNORER** (bloat entreprise). Effort en jours-personne, estimation.

---

## S1. Types de déclencheurs

**Salesforce** : record-triggered (création, modification, suppression, avant/après sauvegarde), schedule-triggered (cron), platform events (externe), autolaunched (depuis un autre flux, Apex, API), screen flow (manuel depuis un écran).

**Lume** : 27 types nommés dans `server/lib/eventBus.ts:11-38`, 18 émis, 11 écoutés (`AUTOMATIONS_MAP.md` §1.4). Tous sont « après sauvegarde, applicatif » : ni trigger DB, ni cron, ni webhook entrant, ni manuel. `invoice.overdue` est le seul « planifié » (détection périodique), et personne ne l'écoute. Paiement Stripe → `invoice.paid` ✅ (`server/lib/payments.ts:958`). Réponse SMS → rien (le STOP est géré, une réponse « oui » ne déclenche rien).

**Écart.** (1) Pas de déclencheur « à la modification d'un champ » : impossible de réagir à « le job passe en retard », « le devis expire », « le client n'a plus de courriel ». (2) Pas de déclencheur planifié « tous les lundis 7 h » ni « chaque 1er du mois ». (3) Pas de déclencheur externe autre que les paiements. (4) Pas de déclenchement manuel (« envoie la relance maintenant à ce client »).

**Verdict : À SIMPLIFIER.** Ce qu'un entrepreneur demande vraiment : « quand la facture est en retard », « quand le devis expire », « chaque lundi, mes factures impayées », « envoie la relance maintenant ». Pas 5 types de triggers, mais 4 événements de plus (`invoice.overdue` déjà émis, `quote.expired` à émettre depuis `scheduler.expireOverdueQuotes`, `job.late` à détecter, `appointment.updated` réellement émis) et un bouton « Exécuter maintenant » sur une fiche. Le déclencheur cron générique est du bloat : on couvre les deux cas utiles (hebdo, mensuel) par des presets de digest plutôt que par un cron éditable. **Effort** 2 j (événements) + 1 j (bouton manuel, réutilise `POST /api/automations/events/*`).

## S2. Critères d'entrée et « seulement quand le record vient de satisfaire le critère »

**Salesforce** : entry conditions évaluées avant tout, avec l'option « Only when a record is updated to meet the condition requirements » — c'est ce qui empêche le spam à chaque sauvegarde.

**Lume** : `evaluateConditions` (`automationEngine.ts:61-98`) sur `event.metadata` uniquement ; pas d'ancienne valeur sauf si l'émetteur la fournit ; aucune règle « vient de devenir vrai ». Le tri est fait à la main côté navigateur pour les visites (`jobsApi.ts:258-296`) et nulle part ailleurs. Résultat mesuré : 3 `appointment_created` pour un même RDV, doublons d'exécutions immédiates (audit F3, F12).

**Verdict : À CONSTRUIRE**, c'est la brique qui distingue un moteur d'une boucle à spam. Concrètement pour Lume : (a) les émetteurs serveur portent `old`/`new` de manière systématique (statut, date de visite, montant) ; (b) `conditions` accepte `{ champ: { changed_to: X } }` et `{ changed: true }` ; (c) dédup d'événement 24 h par `(org, type, entité, empreinte)` (audit F12b). Pas besoin de l'interface : les presets en profitent d'abord. **Effort** 2 j.

## S3. Constructeur de conditions

**Salesforce** : AND/OR, logique personnalisée « (1 AND 2) OR 3 », opérateurs typés (equals, contains, greater than, is null, was set, is changed…), comparaison old/new, gestion explicite des null.

**Lume** : `eq`, `neq`, `in`, `not_in`, égalité directe, AND implicite, comparaison en chaîne (`memeValeur`), `null` jamais égal, opérateur inconnu ⇒ règle muette (`console.warn`). Aucune interface : les conditions ne sont éditables que par PostgREST (audit F4). 32 presets sur 35 n'ont aucune condition.

**Écart.** Pas de `gt/lt/gte/lte` (impossible de dire « facture de plus de 500 $ »), pas de `contains`, pas de `is_null`, pas de OR, pas de typage (une date se compare en chaîne).

**Verdict : À SIMPLIFIER.** Un plombier ne construira jamais « (1 AND 2) OR 3 ». Ce qu'il veut tient en trois filtres par règle, choisis dans une liste fermée : montant (plus de / moins de), type de client (résidentiel/commercial), étiquette, canal disponible. Ajouter `gt/lt/contains/is_null/is_not_null` au moteur (0,5 j, typé : nombre si les deux côtés sont numériques), refuser à l'écriture tout opérateur hors liste (validation Zod, 0,25 j), et exposer 3 filtres max dans la page (2 j front). Le OR et la logique personnalisée : **À IGNORER** — deux règles valent mieux qu'un OR.

## S4. Branchements

**Salesforce** : élément Decision multi-chemins, chemin par défaut, imbrication illimitée, arbre visuel.

**Lume** : aucun. Une règle = un déclencheur + une condition plate + une liste d'actions. Un constructeur visuel a existé (table `workflows`, `20260315000000_workflows.sql`) et a été retiré le 2026-09-01 (`20260901160000_retrait_workflows_visuels.sql`) : 31 lignes dans une seule org, zéro exécution.

**Verdict : À IGNORER.** Le retrait était le bon appel et les chiffres le prouvent. Un arbre de décision est ce que personne n'ouvrira. Le cas « si le client a un courriel, courriel ; sinon SMS » se traite dans l'action (« canal préféré », voir S6), pas dans un branchement. Un moteur de règles plates avec conditions simples suffit à 100 % des presets actuels.

## S5. Chemins planifiés et délais

**Salesforce** : scheduled paths (« 3 jours après », « 2 h avant le champ Date »), recalcul si le champ source change, annulation si le record ne satisfait plus les conditions.

**Lume** : `delay_seconds` positif (après l'événement) ou négatif (avant `schedule_events.start_at`, uniquement pour les visites), persistance dans `automation_scheduled_tasks`, conditions d'arrêt `checkStopConditions` (facture, devis, RDV, lead — pas job), replanification sur déplacement de visite **si** le navigateur appelle `appointment-rescheduled`. Écarts mesurés : texte figé au moment de la planification, règle désactivée non honorée, job supprimé non couvert (audit F16) ; rappel « 2 h avant » reporté après le RDV par les heures calmes (audit A3).

**Verdict : À CONSTRUIRE** (corriger, pas inventer) : relire la règle à l'exécution, ajouter `job` aux conditions d'arrêt, recalculer côté serveur quand `start_at` change (trigger DB ou route unique), abandonner un rappel « avant » devenu « après ». Le « premier de chaque mois » relève de S1. **Effort** 1 j. C'est déjà le point fort relatif de Lume (180 tâches armées jusqu'en 2027) ; il faut le rendre fiable, pas l'étendre.

## S6. Bibliothèque d'actions

**Salesforce** : Update/Create/Delete Records, Email Alert, Send Email, Post to Chatter, Custom Notification, Submit for Approval, Outbound Message, HTTP Callout, Invocable Apex, Subflow, Assignment, Task.

**Lume** (`server/lib/actions/index.ts`) : `send_sms`, `send_email`, `create_notification`, `create_task`, `update_status` (6 tables, statut libre — audit F15), `request_review`, `log_activity`. Manquent : assignation (technicien), création de facture depuis un job (le RPC `create_invoice_from_job` existe, la fonction SQL orpheline `automation_job_completed()` voulait l'appeler), création de devis, mise à jour de champ arbitraire, appel HTTP sortant (les webhooks sortants existent ailleurs : `dispatchWebhook` dans `leads.ts:161`), notification à une **personne** (`create_notification` n'a pas de `user_id` : notification d'org que tout le monde voit).

**Verdict** brique par brique :
- Notifier une personne précise (le technicien assigné, le propriétaire) : **À CONSTRUIRE**, 0,5 j (`user_id` sur `notifications` + résolution `jobs.assigned_to`).
- Assigner un job / créer une tâche pour quelqu'un : **À CONSTRUIRE**, 0,5 j.
- Créer la facture brouillon quand le job est terminé : **À CONSTRUIRE** comme preset (réutiliser `create_invoice_from_job`), 1 j, avec garde d'idempotence (une seule facture par job).
- Choisir le canal (« SMS si numéro, sinon courriel, jamais les deux ») : **À SIMPLIFIER**, une option par preset plutôt qu'une action de plus, 0,5 j. Aujourd'hui 20 presets envoient SMS **et** courriel : deux messages pour une relance, c'est déjà trop pour un client résidentiel.
- Appel HTTP sortant / webhook : **À SIMPLIFIER** — brancher `dispatchWebhook` existant comme action `webhook` sur les webhooks déjà configurés par l'org, 0,5 j. Pas d'URL libre dans une règle.
- Mise à jour de champ arbitraire, suppression, approbation, Chatter, Apex : **À IGNORER**.
- `update_status` libre : **à borner** (audit F15).

## S7. Boucles et collections

**Salesforce** : Loop sur une collection, Get Records multiple, actions en masse (« toutes les factures en retard de ce client »).

**Lume** : une exécution = une entité. Impossible d'exprimer « chaque lundi, un seul SMS par client qui liste ses factures en retard » : le moteur enverrait un SMS par facture (ou rien, `invoice.overdue` n'étant pas écouté). C'est une **limite réelle** : le digest est la seule façon de relancer les impayés sans harceler.

**Verdict : À SIMPLIFIER.** Pas de boucle générique. Une action `digest` par destinataire : le moteur agrège les événements d'une fenêtre (`group_by: client`, `window: 1 day`) et envoie un seul message avec `[items]`. Deux presets en profitent tout de suite : « impayés de la semaine » (client) et « ce qui part demain » (propriétaire). **Effort** 2 j (table d'agrégation + rendu de liste dans `resolveTemplate`). Lumi sait déjà composer ce genre de texte ; pour l'automatisation il faut du déterministe.

## S8. Variables et formules

**Salesforce** : formules (dates, montants, texte, conditions), variables de flux, resources.

**Lume** : 25 variables fixes `[var]` (`resolveEntityVariables`), remplacement pur, aucune formule. Formats incohérents : `quote_total` en `en-CA` (« $1,626.90 »), `invoice_total` en `$${x.toFixed(2)}`, dates en `fr-CA` sans fuseau (audit F2), `appointment_time` en UTC. Manquent des variables utiles : `[balance_due]`, `[days_overdue]`, `[technician_name]`, `[job_address]` (existe pour les RDV seulement), `[quote_link]`, `[pay_link]`, `[client_portal_link]`.

**Verdict : À IGNORER pour les formules** (un mini-langage maison est une dette énorme, et un plombier n'écrira jamais `IF(days>30,"urgent","")`). **À CONSTRUIRE pour les variables** : une dizaine de variables de plus, un formatage unique québécois (« 1 626,90 $ », « mardi 9 h », `America/Toronto`) partagé avec Lumi (`server/lib/agent/tools-rapports.ts:fmtArgent` existe déjà), et les variables inconnues laissées **visibles** dans l'aperçu plutôt que remplacées par du vide. **Effort** 1 j.

## S9. Sous-flux et réutilisation

**Salesforce** : subflows, invocable actions partagées.

**Lume** : aucun. La réutilisation est faite par copie dans les 35 presets (34 finissent par le même `log_activity`).

**Verdict : À IGNORER.** À l'échelle de 35 règles plates, un sous-flux n'existe pas. La seule réutilisation qui compte est le **gabarit de message** partagé (même texte de signature, même pied de page) : déjà couvert par `buildEmailLayout` côté courriel. Rien à faire.

## S10. Templates par métier, activables en un clic

**Salesforce** : Flow templates génériques, AppExchange ; rien par métier, tout à configurer.

**Lume** : 35 presets semés à la création de l'org, **tous actifs par défaut**, en français québécois, avec version anglaise, toggle en un clic, texte éditable avec aperçu. C'est le vrai différenciateur et il est déjà là. Réserves : (1) les presets sont les mêmes pour un plombier, un paysagiste et un laveur de vitres (`seasonal_reminder_6m` a du sens pour le déneigement, pas pour l'électricien) ; (2) tout est actif d'office, y compris 20 règles qui envoient SMS **et** courriel — un nouveau client Lume met sa clientèle sous un tir de 10 messages par job sans l'avoir choisi ; (3) 16 presets sur 35 n'ont jamais tourné en prod (`AUTOMATIONS_MAP.md` §1.5) ; (4) la source de vérité est triple (`automationPresets.data.ts`, `seed_automation_presets()` SQL, `apply_automation_presets_fr()` SQL) et a déjà divergé.

**Verdict : À CONSTRUIRE, c'est LA brique.** (a) Une seule source (le fichier TS ; les fonctions SQL deviennent des appels au serveur ou sont figées et testées contre le fichier). (b) Des **paquets par métier** : à l'onboarding, « plomberie » active 8 règles, « paysagement » 10, « nettoyage » 9 ; le reste est présent mais off. (c) Un défaut « SMS ou courriel, pas les deux » (S6). (d) Un « aperçu de la semaine » avant activation : « avec ces réglages, vos 12 clients de la semaine dernière auraient reçu 31 messages » — calculable depuis `activity_log` sans rien envoyer. **Effort** 3 j (a+b+c), 2 j (d).

## S11. Versionnage et activation

**Salesforce** : brouillon vs actif, versions numérotées, retour arrière, « qui a modifié quoi et quand ».

**Lume** : `is_active` + `updated_at`. Pas de brouillon (une modification de texte est active à la seconde), pas d'historique (le texte précédent est perdu), pas d'auteur (`automation_rules` n'a pas `updated_by`), pas de retour arrière. Les tâches en attente embarquent l'ancien texte (audit F16), ce qui est une forme de versionnage accidentel et non voulu.

**Verdict : À SIMPLIFIER.** Pas de versions numérotées ni de brouillon. Une table `automation_rule_history (rule_id, org_id, before jsonb, after jsonb, changed_by, changed_at)` alimentée par trigger, un bouton « Rétablir le texte d'origine » (le preset canonique existe déjà dans le fichier TS), et `updated_by` sur la règle. Ça donne l'audit Loi 25 (qui a changé le message envoyé aux clients) et le retour arrière utile. **Effort** 1 j + SQL commenté.

## S12. Gestion d'erreur déclarative

**Salesforce** : Fault paths sur chaque action, action de repli, courriel d'erreur à l'admin, reprise depuis Flow Error Emails / Paused Interviews.

**Lume** : retry 5 min / 30 min / 2 h sur erreurs « transitoires » (par sous-chaîne de texte), puis `failed` silencieux ; pas de repli (« si le SMS échoue, envoie le courriel » n'existe pas : les deux actions sont indépendantes, donc souvent les deux partent) ; aucune notification à l'admin ; aucune reprise manuelle (une tâche `failed` est morte, il faut la réinsérer en SQL). Le badge « N échec » 7 jours est la seule surface.

**Verdict : À SIMPLIFIER.** Pas de fault path par action. Trois choses : (1) notification à l'admin de l'org après le premier échec définitif d'une règle (« Relance de devis 3 jours : impossible d'envoyer à Marc Tremblay — pas de numéro ») avec le motif traduit ; (2) bouton « Réessayer » sur une tâche `failed` (remise en `pending`) ; (3) repli de canal intégré à l'action d'envoi (S6) plutôt que déclaré. **Effort** 1 j.

## S13. Débogueur

**Salesforce** : Debug mode qui exécute contre un record réel sans effet de bord (rollback), montre chaque élément, chaque condition évaluée, chaque valeur.

**Lume** : `GET /api/automations/test` (`server/routes/automation-test.ts`) — un diagnostic (presets présents, variables résolues sur la dernière entité, file, logs, config Twilio/SMTP), pas une simulation ; il n'évalue aucune règle, et son test 8 vérifie un format de clé abandonné. `QA_REDIRECT_TO` détourne les envois réels vers une adresse de test : c'est de la recette, pas du débogage utilisateur.

**Verdict : À SIMPLIFIER.** Le débogueur complet est un outil d'admin Salesforce. Ce qu'il faut : un mode **dry-run par org** (audit F6) qui journalise « aurait envoyé à X : texte » sans appeler Twilio, et un bouton « Tester sur ce client » dans la page qui joue la règle en dry-run sur une vraie fiche et affiche le message résolu. Le rendu des conditions évaluées va dans le log (audit F8). **Effort** 1,5 j, dont 1 j déjà compté en F6.

## S14. Tests intégrés

**Salesforce** : Flow Tests (record d'entrée + assertions, rejouables après modification).

**Lume** : rien pour l'utilisateur ; côté développeur, 133 tests unitaires dont les principaux recopient le code, un banc `scripts/qa/automatisations.mjs` qui joue `job.completed` sur staging avec avance d'échéance (8 vérifications), et aucun golden set.

**Verdict : À IGNORER côté utilisateur, À CONSTRUIRE côté développeur.** Un entrepreneur n'écrit pas de cas de test ; le dry-run (S13) lui suffit. Pour l'équipe : golden set CI (`AUTOMATIONS_TEST_PLAN.md` T14) — un enregistrement d'entrée et le message attendu par preset, rejoué à chaque changement de gabarit ou de moteur. **Effort** : Phase 4.

## S15. Monitoring

**Salesforce** : Automation Home, Paused and Failed Flow Interviews, Time-Based Workflow queue, alertes par courriel, métriques d'exécution par flux.

**Lume** : badge « N échec » 7 jours par règle ; Lumi (`get_automation_health`) sait résumer les logs en français ; aucun écran des tâches en attente, en cours, en échec ; aucune alerte ; le scheduler n'a pas de `withCronCheckIn` (les autres crons de `server/index.ts` en ont) : un tick mort n'est pas détecté.

**Verdict : À CONSTRUIRE**, version modeste. (1) Page « Activité des automatisations » : à venir (pending, avec Annuler), envoyé (7 j), échoué (motif en français, Réessayer). (2) `withCronCheckIn('automation-scheduler')` + alerte si aucun tick depuis 15 min. (3) Compteur par règle sur 30 j (envoyés / échoués / annulés) dans la ligne de la règle. Pas de dashboard temps réel. **Effort** 2,5 j (1 j back, 1,5 j front).

## S16. Limites et quotas

**Salesforce** : limites documentées (éléments par transaction, SOQL, interviews planifiées par org et par 24 h), erreurs explicites quand atteintes.

**Lume** : une seule limite, implicite : 3 messages commerciaux par destinataire et par 24 h (`AUTOMATION_MAX_COMMERCIAL_PER_DAY`, non documentée, non visible), et le plafond de 50 tâches par tick. Aucune limite par org, par règle, par jour, en dollars ; aucune limite de profondeur ; aucune limite de taille de message (un SMS de 1 000 caractères = 7 segments facturés).

**Verdict : À CONSTRUIRE**, explicite et visible : plafond quotidien de SMS d'automatisation par plan (Scale 100, Autopilot 300 — chiffres à décider), affiché sur la page (« 12 / 100 SMS automatiques aujourd'hui »), notification à l'admin à 80 %, arrêt propre à 100 % (tâches reportées au lendemain, jamais perdues). Longueur de SMS avertie dans l'éditeur (segments). **Effort** 1,5 j (audit F11/F13) + 0,5 j front.

## S17. Ordre d'exécution

**Salesforce** : Flow Trigger Explorer, ordre configurable (Trigger Order), documenté avant/après sauvegarde.

**Lume** : `select … where org_id and trigger_event and is_active` sans `order by` (`automationEngine.ts:418-423`) : ordre de la base. Pas de priorité, pas de documentation. Conséquence concrète aujourd'hui : nulle (les règles d'un même événement sont indépendantes). Conséquence demain (S6 « SMS ou courriel », S7 digest) : réelle.

**Verdict : À SIMPLIFIER.** `order by created_at, id`, une phrase dans la page (« les automatisations d'un même événement partent dans l'ordre de la liste »), pas d'interface de tri. **Effort** 0,1 j.

## S18. Permissions

**Salesforce** : Manage Flow / Run Flows par profil, contexte d'exécution système ou utilisateur, choix par flux.

**Lume** : page réservée à `automations.update` (owner/admin, `src/lib/permissions.ts`), mais RLS d'écriture ouverte à tout membre sur les trois tables (audit F4) ; exécution en `service_role` sans contexte ; `has_org_membership` ne teste pas le statut du membre.

**Verdict : À CONSTRUIRE (corriger).** Policies admin-only (SQL commenté dans l'audit), écriture des règles par une route serveur validée (Zod) plutôt que PostgREST direct, contexte d'exécution « système borné » : catalogue d'actions fermé, `update_status` borné, `config.to` retiré. Pas de contexte utilisateur par règle : un plombier ne veut pas choisir « exécuter en tant que ». **Effort** 1 j + audit F4.

## S19. Export / import / duplication

**Salesforce** : packaging, change sets, export de définitions entre orgs et environnements.

**Lume** : rien pour l'utilisateur ; les presets voyagent par le code (`automationPresets.data.ts`) et par migrations SQL ; staging et prod sont recopiés par `db:clone-staging`. Aucune org n'a de règle personnalisée à exporter.

**Verdict : À IGNORER**, sauf un seul cas : **dupliquer un preset** (« Relance de devis 3 jours » → « Relance de devis 3 jours — commercial » avec un autre texte) le jour où les règles personnalisées existent. 0,5 j à ce moment-là, pas avant.

## S20. Analytique

**Salesforce** : faible — nombre d'exécutions et d'erreurs par flux, rien sur la valeur.

**Lume** : rien non plus, mais toutes les données sont là : `automation_execution_logs` (envois), `messages` (SMS d'automatisation = `sender_user_id is null`), `quotes.status` + `quote_status_history` (un devis approuvé après une relance), `invoices.paid_at` vs relances, `review_requests` → `satisfaction_surveys` (avis obtenus). Lumi lit déjà les logs (`get_automation_health`).

**Verdict : À CONSTRUIRE, c'est l'ouverture.** Trois chiffres par règle sur 30 jours, calculés par une vue SQL et affichés dans la ligne : « 14 envoyés · 4 devis acceptés dans les 3 jours suivants · 1 250 $ ». Pour les factures : « 9 relances · 6 payées dans les 7 jours ». Pour les avis : « 12 demandes · 5 avis ». C'est ce qui fait qu'un entrepreneur **garde** l'automatisation active et qu'il parle de Lume à un autre. Salesforce ne le fait pas parce que sa valeur n'est pas mesurable de façon générique ; celle de Lume l'est, parce que le métier est fixe. **Effort** 2 j (vue + page), après S15.

---

## Synthèse

### 1. Écarts qui rendent Lume non fiable aujourd'hui — à corriger avant les clients

1. **Fuite entre locataires par les routes d'événements** (audit F1, S18) : un membre fait texter le client d'une autre org. Bloquant.
2. **Heure de rendez-vous fausse dans les SMS** (audit F2, S8) : 12 sur 12 en prod, +4 h. Le message le plus envoyé du produit dit une heure erronée.
3. **Doublons d'actions immédiates** (audit F3/F9/F12, S2) : constatés en prod ; aucune clé, aucune file pour le délai 0, aucune détection de changement côté serveur.
4. **Règle désactivée et texte modifié non honorés par les tâches en attente** (audit F16, S5) : l'interrupteur ne fait pas ce qu'il dit.
5. **RLS d'écriture ouverte à tout membre** (audit F4, S18) : escalade de privilège et logs effaçables.
6. **Aucun kill switch, aucun dry-run** (audit F6, S13) : impossible d'arrêter proprement ni de tester sans envoyer.
7. **Reprise qui peut renvoyer un message déjà parti** (audit F5).
8. **Consentement CASL non vérifié à la source ; réengagement de leads perdus sans base légale** (audit F7).

### 2. Écarts qui rendent Lume moins vendable — à construire ensuite

1. **Paquets de presets par métier + « SMS ou courriel, pas les deux » + aperçu du volume avant activation** (S10, S6) — la brique différenciante.
2. **Page d'activité : à venir / envoyé / échoué, avec Annuler et Réessayer, erreurs en français** (S15, S12, audit F22).
3. **Analytique de valeur par règle** (S20) — ce que Salesforce ne fait pas.
4. **Plafond de SMS par org, visible** (S16, audit F11/F13).
5. **Digest** « une seule relance qui liste les factures en retard » (S7).
6. **Événements manquants** : facture en retard écoutée, devis expiré, job en retard, RDV modifié réellement émis ; bouton « Envoyer maintenant » (S1).
7. **Variables de plus et formatage québécois unique** (S8) ; notification à une personne, assignation, facture brouillon à la fin du job (S6).
8. **Historique des modifications de gabarit + « Rétablir le texte d'origine »** (S11).
9. **Trois filtres simples par règle** (montant, type de client, étiquette) (S3).

### 3. Bloat entreprise à ne jamais construire

- **Constructeur visuel de flux, branchements, imbrication** (S4) : déjà tenté, retiré, 0 exécution en 5 mois. Personne n'ouvrira un canvas.
- **Formules et mini-langage** (S8) : dette énorme, usage nul chez la cible ; les variables fixes couvrent le besoin.
- **Logique de conditions personnalisée « (1 AND 2) OR 3 »** (S3) : deux règles valent mieux qu'un OR.
- **Sous-flux et actions invocables** (S9) : rien à réutiliser à 35 règles plates.
- **Versions numérotées, brouillons, cycle de publication** (S11) : un historique et un bouton « rétablir » suffisent.
- **Fault paths déclaratifs par action** (S12) : le repli de canal vit dans l'action d'envoi, l'échec notifie l'admin, point.
- **Débogueur pas à pas avec rollback** (S13) : un dry-run par org et « tester sur ce client » font le travail.
- **Cas de test utilisateur** (S14) : outil d'équipe, pas de produit.
- **Export/import/packaging entre orgs** (S19) : les presets voyagent par le code.
- **Déclencheur cron éditable, webhooks entrants génériques, contexte d'exécution par règle** (S1, S18) : couvrir les deux ou trois cas utiles par des presets et des événements nommés.

La règle de décision qui ressort : Lume gagne en faisant **peu de choses, justes, visibles et arrêtables**. Tout ce qui demande à l'entrepreneur de concevoir plutôt que de choisir est du bloat.

Fin de la Phase 2. J'attends le go pour la Phase 3 (`AUTOMATIONS_TEST_PLAN.md`).
