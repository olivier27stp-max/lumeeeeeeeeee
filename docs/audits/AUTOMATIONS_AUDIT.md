# AUTOMATIONS_AUDIT.md — Santé de l'architecture du moteur d'automatisations

Phase 2A. Lecture seule. S'appuie sur `AUTOMATIONS_MAP.md` (Phase 1) et sur trois requêtes `SELECT` supplémentaires passées en prod le 2026-09-13 (fuseau des SMS, doubles émissions, volumes SMS). Chaque finding cite le fichier, l'impact concret côté client, le correctif proposé, l'effort (estimation en jours-personne, à valider) et le risque du correctif.

Barème : **CRITIQUE** = dommage irréversible chez un client ou fuite entre locataires, à corriger avant tout nouveau client. **MAJEUR** = message faux, doublon, perte silencieuse, ou trou de conformité. **MINEUR** = dette, lisibilité, performance, cas limite.

---

## Correctifs appliqués — 2026-09-14 (branche `fix/automatisations-audit`)

Sur « go » de Rafba (« fait tes corrections pis push »). Tout est sur une branche + PR, rien n'est mergé ni déployé. Les 7 migrations sont appliquées sur **staging seulement** ; la prod attend le merge puis `npm run db:apply:prod` (colonnes additives et fonctions : l'ancien code continue de marcher pendant la fenêtre ; le nouveau code a un repli si une colonne manque).

| Finding | État | Où |
|---|---|---|
| F1 cross-tenant | **corrigé** | routes : `appartientALOrg()` avant toute émission (404) ; `actions/index.ts` : `.eq('org_id')` sur chaque lecture, `resolveContractVars`/`resolveSignedContractVars` filtrés ; `checkStopConditions` filtré |
| F2 heure UTC | **corrigé** | `resolveEntityVariables` : `Intl.DateTimeFormat(…, { timeZone: company_settings.timezone })` |
| F3 idempotence immédiate | **corrigé** | `reserverExecutionImmediate` : ligne `running` + clé unique + fenêtre 24 h (`metadata.rescheduled` = rejeu légitime) |
| F4 RLS | **corrigé (M1, staging)** | `20260914120100_automation_rls_admin.sql` |
| F5 reprise | **partiel** | une reprise dont l'exécution est déjà journalisée réussie clôt sans renvoyer ; PAS de clé d'idempotence fournisseur (Twilio/Resend n'en offrent pas sur l'envoi) |
| F6 kill switch / dry-run | **corrigé (M2)** | `AUTOMATIONS_ENABLED`, `company_settings.automations_paused_at` / `automations_dry_run` |
| F7 consentement | **corrigé (M5)** | `clients.marketing_consent` ; action commerciale différée refusée si `none` (échec définitif journalisé) ; `lost_lead_reengagement` inactif par défaut ; demande d'avis soumise au plafond de fréquence |
| F8 trace | **corrigé (M3)** | `recipient`, `actor_id`, `rule_snapshot`, `dry_run` dans `automation_execution_logs` ; `result_data.body` retiré |
| F9/F10/F12 outbox | **non livré** | migration M8, deuxième vague (T10.9 reste rouge, documenté) |
| F11/F13 plafonds | **corrigé (M4)** | `plans.automation_daily_sms_cap/_email_cap` (0 = illimité, valeurs à décider), compteur `automation_bump_counter`, report à demain, alerte à 80 % |
| F14 fuseaux | **corrigé** | « N jours avant » calculé en calendrier local (DST) |
| F15 update_status | non traité | machine d'état hors scope (trigger invoices neutralise déjà) |
| F16 règle relue | **corrigé** | le tick relit `is_active` et `actions[index]` (repli par type) ; conditions d'arrêt sur `jobs` |
| F17 ordre | **corrigé** | `order(created_at, id)` |
| F18 config.to | **corrigé** | destinataire = client de l'entité, `config.to` ignoré et journalisé |
| F19 quoteId vide | **corrigé** | 400 sans `quoteId`, 404 hors org |
| F20 code mort | non traité (R13) | M10 sur demande |
| F21 purge | **corrigé (M6)** | `purge_automation_history(12)` + `POST /api/cron/purge-automations` |
| F22 UX | **corrigé (partie lisible)** | `agreement.signed` / « Contrat signé » traduits, variable inconnue signalée dans l'éditeur, raisons d'échec en français dans le détail d'une règle (dictionnaire `automationErreurs.ts`, jumeau serveur/client testé) ; pas de page « À venir »/« Historique » (S15) |
| F24 N+1 | **partiel** | réglages d'org mémoïsés par événement/tick ; `resolveEntityVariables` relit encore `company_settings` par règle |
| F25 preset mort | **corrigé** | l'arrêt « prospect perdu » épargne la tâche armée par la perte ; motif d'annulation écrit dans `last_error` |
| F26 désabonné retenté | **corrigé** | `permanent: true` porté par l'action + motif dans la liste |
| T8.4 membre inactif | **corrigé (M7 + serveur)** | `has_org_membership` exige `status = 'active'` ; `requireAuthedClient` aussi |
| T10.3/T10.4/T10.5/T10.7 | **corrigés** | notification FR à l'admin après échec définitif ; délai max d'action (20 s, `AUTOMATION_ACTION_TIMEOUT_MS`) ; demi-état request_review = échec définitif ; règles isolées par try/catch |

Suite après correctifs : unitaires `tests/automation/` 340/341 (T10.9 rouge, M8) ; intégration staging 33/33 (`--no-file-parallelism` obligatoire, base partagée) ; dépôt entier : 6 rouges préexistants sur `origin/main` (OfficeSwitcher sans Router, cliquet d'accessibilité OfficeNew/WorkspaceNew), hors scope.

---

## Tableau des findings

| # | Sévérité | Titre | Fichier principal |
|---|---|---|---|
| F1 | CRITIQUE | Un membre peut faire lire et texter le client d'une autre org | `server/routes/automation-events.ts`, `server/lib/actions/index.ts:231-432` |
| F2 | CRITIQUE | Heure de rendez-vous en UTC dans les SMS envoyés (12/12 en prod) | `server/lib/actions/index.ts:408-412` |
| F3 | CRITIQUE | Aucune idempotence des actions immédiates ; doublons déjà constatés en prod | `server/lib/automationEngine.ts:184-284` |
| F4 | CRITIQUE | RLS d'écriture ouverte à tout membre sur les trois tables du moteur | policies `automation_rules_*`, `automation_scheduled_tasks_*`, `automation_execution_logs_*` |
| F5 | MAJEUR | Reprise après crash ou échec peut renvoyer un message déjà parti | `automationEngine.ts:547-568, 501-523` |
| F6 | MAJEUR | Aucun kill switch, aucun dry-run | `server/index.ts:1239-1258`, `server/lib/qa-redirect.ts` |
| F7 | MAJEUR | Aucune vérification de consentement initial (CASL) ; avis clients hors plafond | `actions/index.ts:531-557, 764-957` |
| F8 | MAJEUR | Trace d'exécution insuffisante pour déboguer ou auditer (Loi 25) | `automationEngine.ts:243-281`, table `automation_execution_logs` |
| F9 | MAJEUR | Actions immédiates exécutées dans la requête web, hors file, perdues sur crash | `eventBus.ts:92-120`, `automationEngine.ts:413-461` |
| F10 | MAJEUR | `job.completed` n'a aucun émetteur serveur : dépend du navigateur | `src/lib/jobsApi.ts`, `automation-events.ts:204` |
| F11 | MAJEUR | Bulk naïf : N enregistrements = N envois immédiats, sans plafond par org | `automationEngine.ts:429-446`, `actions/index.ts:50-97` |
| F12 | MAJEUR | Détection de changement absente : « sauvegardé » ≠ « passé de A à B » | émetteurs + `evaluateConditions` |
| F13 | MAJEUR | Aucune limite de coût par org, aucun garde-fou de boucle | — |
| F14 | MAJEUR | Trois conventions de fuseau (UTC, America/Toronto, local) | `scheduler.ts:46`, `automationEngine.ts:116`, SQL |
| F15 | MAJEUR | `update_status` écrit un statut libre hors machine d'état | `actions/index.ts:723-755` |
| F16 | MAJEUR | Tâche différée figée sur l'ancien texte ; désactivation de la règle non honorée | `automationEngine.ts:363-399, 599-741` |
| F17 | MINEUR | Ordre d'exécution non déterministe | `automationEngine.ts:418-423` |
| F18 | MINEUR | `config.to` : destinataire arbitraire templatable | `actions/index.ts:441, 538` |
| F19 | MINEUR | `entityId` vide sur `quote-sent`/`quote-approved` | `automation-events.ts:392, 412` |
| F20 | MINEUR | Deux implémentations mortes toujours chargées + fonctions SQL orphelines | `scheduler.ts:684-762`, `01_schema.sql:1679-1790` |
| F21 | MINEUR | Journal doublé (`activity_log` × 2 par déclenchement), aucune purge, PII dans les logs | `eventBus.ts:100`, presets `log_activity` |
| F22 | MINEUR | Page : rien sur « ce qui va partir », historique limité à un badge | `src/pages/Automations.tsx` |
| F23 | MINEUR | Tests qui recopient le code ; dry-run qui teste un format abandonné | `tests/automation/*`, `automation-test.ts:253` |
| F24 | MINEUR | N+1 et requêtes répétées par exécution ; index de tri absent | `actions/index.ts`, `automationEngine.ts:579-591` |
| F26 | MINEUR | Un destinataire désabonné (courriel) est retenté 3 fois avant abandon (découvert par T11.4, Phase 4) | `automationEngine.ts:475-487` |
| F25 | MAJEUR | Preset `lost_lead_reengagement` mort : annulé par sa propre condition d'arrêt (découvert par le golden set, Phase 4) | `automationEngine.ts:839-852`, preset `lost_lead_reengagement` |

---

## A1. Correction du déclenchement

### F12 — Pas de détection de changement (MAJEUR)

**Constat.** Le moteur ne connaît que « un événement nommé est arrivé ». Aucun déclencheur ne compare l'ancienne et la nouvelle valeur d'un champ, sauf ce que l'émetteur met à la main dans `metadata` (`old_status`/`new_status` sur `lead.status_changed`, `leads.ts:589`), et `evaluateConditions` (`automationEngine.ts:61-98`) ne sait faire que `eq/neq/in/not_in` sur ces clés. Le tri « vrai changement ou simple sauvegarde » est fait **côté navigateur**, à la main, dans `src/lib/jobsApi.ts:258-296` (photo des visites avant/après `rpc_schedule_job`) : le serveur fait confiance à ce tri.

**Impact client.** Chaque sauvegarde de job qui repasse par un chemin non protégé ré-émet `appointment.created` : confirmation renvoyée au client, rappels J-7/J-1/2 h replanifiés (ceux-là sont protégés par la clé unique, la confirmation non). Mesuré en prod : 2 rendez-vous avec 3 événements `appointment_created` chacun sur 60 jours.

**Ré-entrée.** Aucun critère : une règle immédiate se redéclenche autant de fois que l'événement est émis pour le même enregistrement. Pour les règles différées, la clé `rule:entity:index` bloque tant qu'une tâche est `pending|running` ; une fois `completed`, la même relance peut être replanifiée si l'événement revient (renvoyer un devis = relances repartent, ce qui est le comportement voulu, mais non distinguable d'un rejeu accidentel).

**Récursion.** Aucune action n'émet d'événement aujourd'hui, donc pas de boucle possible. Aucune protection (profondeur, compteur par enregistrement) n'existe pour le jour où `update_status` ou une future action émettra. Le trigger SQL `automation_job_completed()` n'est pas attaché ; s'il l'était, il ne passe pas par le bus.

**Correctif.** Faire porter la détection au serveur : (a) les routes `automation-events` lisent l'entité **avant** d'émettre et comparent (date de visite, statut) avec ce qu'elles ont en base plutôt que de croire le corps de la requête ; (b) ajouter au bus un identifiant d'événement + une clé de dédup `(org_id, type, entity_id, hash(metadata pertinente))` persistée 24 h (table `automation_events` ou colonne sur `activity_log`) et refuser les doublons ; (c) ajouter un compteur de profondeur dans `CRMEvent.metadata.__depth` et refuser au-delà de 3. **Effort** 2 j. **Risque** faible pour (b)/(c) ; (a) touche les hooks client, à faire route par route.

### F10 — `job.completed` n'existe que côté navigateur (MAJEUR)

**Constat.** Aucun `emit('job.completed')` serveur. Seul `POST /api/automations/events/job-completed`, appelé par `src/lib/jobsApi.ts` après l'update PostgREST du statut, et par Lumi (`tools-etendus.ts:1449`). Un statut passé à `completed` par l'app mobile hors ligne en resync, par un import, par le MCP, par SQL, ne déclenche ni merci, ni sondage d'avis, ni relance saisonnière. Huit presets sur 35 dépendent de cet événement.

**Impact client.** L'entreprise croit que « le sondage part à la fin de chaque job » ; il part seulement quand le job est fermé depuis l'écran web avec le réseau.

**Correctif.** Émettre côté serveur : trigger `AFTER UPDATE OF status ON jobs` qui écrit dans une table `automation_events` (outbox), consommée par le tick — c'est aussi la réponse à F9. **Effort** 2 j (outbox) + 0,5 j par entité migrée. **Risque** moyen : changer la source des événements peut doubler les émissions pendant la transition ; à faire avec la dédup de F12(b) en place d'abord.

---

## A2. Fiabilité d'exécution

### Garantie réellement implémentée

- Actions **immédiates** (délai 0, 5 presets : confirmation de RDV, contrat signé, bienvenue lead, paiement, dépôt) : **at-most-once par émission, mais N émissions = N envois**. Pas de persistance avant exécution, pas de clé, pas de reprise.
- Actions **différées** : **at-least-once** avec dédup à la planification (`idx_scheduled_tasks_dedup`) et prise atomique (`update … where status='pending'`, `automationEngine.ts:621-643`). Pas exactly-once : la reprise après crash (F5) ré-exécute une action peut-être déjà partie.

### F3 — Aucune idempotence des actions immédiates (CRITIQUE)

**Constat.** `executeRuleActions` (`automationEngine.ts:184-284`) calcule `executionKey` mais ne l'utilise que pour le report en heures calmes ; sinon l'action part directement. Les hooks navigateur sont « fire-and-forget » (`automationEventsApi.ts:21-33`) : un double clic, un retry, deux onglets, ou le chemin `jobsApi.syncJobSchedule` + `scheduleApi.scheduleUnscheduledJob` sur la même visite = deux `appointment.created`. **Mesuré en prod : 2 exécutions immédiates identiques (même règle, même entité, même action) dans la même minute**, et 98 exécutions immédiates au total sans aucune clé.

**Impact client.** Deux SMS « votre rendez-vous est confirmé » à la suite, deux courriels de bienvenue. Irréversible, facturé, et ça fait amateur.

**Correctif.** Faire passer **toutes** les actions par la file : insérer une tâche `execute_at = now()` avec `execution_key` même pour délai 0, puis l'exécuter dans la foulée (ou au tick suivant, 5 min max, acceptable pour tout sauf la confirmation de RDV qu'on peut exécuter inline **après** l'insert réussi). La clé unique fait alors office d'idempotence pour tout. Ajouter à la clé un composant « génération » pour les cas de rejeu légitime (renvoi d'un devis) : `rule:entity:index:hash(metadata.sent_at)` ou statut `completed` exclu de l'index seulement après 24 h. **Effort** 1,5 j + tests T4. **Risque** faible ; changement de comportement : la confirmation part au tick suivant si on n'exécute pas inline.

### F5 — Reprise non idempotente vis-à-vis du fournisseur (MAJEUR)

**Constat.** `recupererTachesFigees` (`:547-568`) remet en `pending` toute tâche `running` depuis 15 min ; `nextStateAfterFailure` (`:501-523`) replanifie après un échec « transitoire ». Dans les deux cas l'action complète repart. Or `executeSendSms` appelle Twilio **puis** écrit `messages` **puis** retourne ; le log s'écrit encore après. Un crash ou un timeout entre l'appel Twilio et la fin = SMS parti, tâche reprise, SMS renvoyé. Twilio accepte une clé d'idempotence ; elle n'est pas utilisée. Un « échec transitoire » est déterminé par le texte de l'erreur (`isTransientFailure`, liste de 6 sous-chaînes anglaises) : un timeout réseau après envoi effectif est « transitoire ».

**Correctif.** (1) Passer `execution_key` comme clé d'idempotence au fournisseur (Twilio : header `Idempotency-Key` sur `messages.create` via l'option `idempotencyKey` du SDK ; Resend : header `Idempotency-Key`). (2) Avant toute reprise, vérifier `messages.provider_message_id` / `activity_log email_sent` pour la même clé et marquer `completed` sans renvoyer. **Effort** 1 j. **Risque** faible.

### Concurrence

Deux workers sur la même tâche : couvert par la prise atomique + advisory lock du tick (`scheduler.ts:820-837`). Deux instances qui reçoivent le même hook navigateur : **non couvert** (F3). Nombre de réplicas Railway non connu.

### F9 — Actions immédiates dans la requête web (MAJEUR)

**Constat.** `eventBus.emit` appelle les listeners en mémoire ; `handleEvent` est `async` et non attendu. Un `send_sms` immédiat s'exécute donc dans le processus web pendant que la réponse HTTP est déjà partie, sans file, sans trace tant que l'action n'est pas finie. Un redéploiement pendant ce laps de temps = envoi perdu sans aucune ligne nulle part (le log s'écrit après). Un événement émis pendant qu'`engineConfig` est encore `null` (démarrage) est ignoré (`:414`).

**Correctif.** Outbox : `emit` écrit l'événement en base (déjà fait à moitié : `activity_log`) et le tick consomme. Avec F3, tout devient « persisté d'abord, exécuté ensuite ». **Effort** inclus dans F3/F10.

---

## A3. Temps, délais, planification

### F2 — Heure de rendez-vous en UTC dans les SMS (CRITIQUE)

**Constat.** `resolveEntityVariables` (`actions/index.ts:408-412`) formate `appointment_date`/`appointment_time` avec `toLocaleDateString('fr-CA')` / `toLocaleTimeString('fr-CA', {hour, minute})` **sans `timeZone`**, donc dans le fuseau du processus. Aucun `TZ` dans `Dockerfile` ni `server/index.ts`. **Vérifié en prod** sur les 12 derniers SMS de rappel réellement envoyés : rendez-vous à 09:00 Montréal → « 13 h 00 » dans le SMS ; 11:00 → « 15 h 00 ». Douze sur douze, décalés de +4 h (heure avancée).

**Impact client.** Le client d'un plombier reçoit « Rappel : votre rendez-vous est demain à 13 h 00 » pour un passage à 9 h. Il n'est pas là, ou il attend quatre heures. C'est le message le plus envoyé du produit (118 exécutions `appointment.created`).

**Correctif.** `new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', … })` pour date et heure, avec le fuseau de l'org si `company_settings` en porte un (sinon constante). Même correction pour `quote_valid_until`, `invoice_due_date` (dates seules, moins exposées). **Effort** 0,25 j + test T9. **Risque** nul.

### F14 — Trois conventions de fuseau (MAJEUR)

`scheduler.ts:46 todayDateString()` = date UTC (jours de retard de facture, expiration de devis calculés une journée trop tôt ou trop tard selon l'heure) ; heures calmes en `America/Toronto` (`automationEngine.ts:116`) ; `automation_job_completed()` SQL en `America/Toronto` ; `resolveEntityVariables` en local. **Correctif** : une fonction `dateOrg()` unique (celle de `tools-etendus.ts:113` existe déjà, à extraire dans `server/lib/dates.ts`) et l'utiliser partout. **Effort** 0,5 j.

### Changement d'heure

`nextSendTime` avance par pas de 30 min et teste l'heure locale via `Intl` : correct aux deux changements (une relance prévue 2 h 30 le dimanche de mars tombe à 3 h 30, jamais dans le trou). `resolveExecuteAt` calcule `start_at + delay` en millisecondes absolues : un rappel « 24 h avant » un RDV le lendemain d'un changement d'heure part à 23 h ou à 1 h locale la veille, soit **dans les heures calmes** → reporté à 8 h le jour même du RDV. Tolérable pour J-1, faux pour « 2 h avant ». Non testé.

### Délais et modifications entre-temps (F16, MAJEUR)

**Constat.** La tâche différée embarque `action_config` **copié** au moment de la planification (`:385`). Si l'entreprise réécrit le texte du SMS via `MessageEditor`, les 180 tâches en attente partent avec **l'ancien texte**. Si elle **désactive** la règle, les tâches en attente partent quand même : `processScheduledTasks` ne relit pas `automation_rules.is_active` (la jointure `:587` ramène `name, actions, conditions`, pas `is_active`, et rien ne le teste). Si l'entité est supprimée : `checkStopConditions` couvre facture, devis, RDV, lead ; pas `job` (`thank_you_after_job`, `cross_sell_30d`, `client_anniversary`, `seasonal_reminder_6m`, `reengagement_90d` partent après suppression du job, avec `client_*` vides → « Bonjour , »). Si la date de RDV change : couvert par `appointment-rescheduled` (annule + replanifie), **seulement** si le client appelle ce hook.

**Impact client.** L'entrepreneur désactive « Relance de devis 7 jours » parce qu'un client s'est plaint ; la relance part quand même. Il corrige une faute dans un gabarit ; les envois déjà armés gardent la faute.

**Correctif.** À l'exécution, relire la règle (`is_active`, `actions[index]`) et l'utiliser à la place de la copie ; ajouter `job` à `checkStopConditions` (`deleted_at`, `status in cancelled`). **Effort** 0,5 j. **Risque** faible.

### Heures de silence

Implémentées (8 h–20 h `America/Toronto`) pour SMS toujours, courriels différés seulement (`shouldRespectQuietHours`, `:147-153`) : correct et argumenté. Non configurables par org. Les confirmations immédiates partent à toute heure par choix documenté. Le rappel « 2 h avant » un RDV à 7 h est reporté à 8 h, soit **après** le RDV (`resolveExecuteAt` accepte 30 min de retard puis abandonne ; ici le report en heures calmes contourne cette logique : `processScheduledTasks:607-616` repousse sans re-vérifier la pertinence). **Correctif** : abandonner (pas reporter) un rappel négatif dont `execute_at + report > start_at`. **Effort** 0,25 j.

---

## A4. Sécurité et isolation

### F1 — Lecture et envoi hors tenant par un membre (CRITIQUE)

**Constat.** Routes `automation-events.ts` : `appointment-created` (`:27-86`), `appointment-cancelled` (`:100-112`), `appointment-rescheduled` (`:137-193`), `invoice-paid` (`:428-470`), `lead-created` (`:483-505`), `lead-status-changed` (`:518-541`) émettent avec l'`entityId` du corps **sans vérifier son appartenance** à `auth.orgId` (les lookups faits sont de confort, `.maybeSingle()` puis émission inconditionnelle). En aval, sous `service_role` : `resolveEntityVariables` lit `schedule_events`/`jobs`/`clients` (`actions/index.ts:394-406`), `invoices`/`clients` (`:371-386`), `clients` pour lead (`:282-291`) par `id` seul ; `checkStopConditions` idem ; `executeCreateTask` lit `schedule_events` par `id` (`:680`) ; `executeRequestReview` lit `jobs`/`invoices` par `id` (`:789-802`). `executeUpdateStatus` est le seul correctement filtré.

**Scénario.** Membre (même technicien) de l'org A, jeton valide, UUID d'un `schedule_event` de l'org B (obtenu par un lien de contrat partagé, un export, un collègue passé d'une org à l'autre — `has_org_membership` ne teste pas `memberships.status`). `POST /api/automations/events/appointment-created {eventId}` → règle `appointment_confirmation` de A → nom, téléphone, courriel du client de B résolus → SMS et courriel de A envoyés au client de B, depuis le numéro de A, avec l'adresse du RDV de B dans le texte. Journalisé dans les tables de A. `appointment-rescheduled` permet en plus d'**annuler** les rappels en attente de B (`update automation_scheduled_tasks … eq('entity_id')` est filtré `org_id` : non, ici c'est correct — seules les tâches de A sont annulées). Le premier scénario suffit.

**Impact.** Fuite de données personnelles entre locataires + message non sollicité au client d'un concurrent. Loi 25 : incident de confidentialité à documenter.

**Correctif.** Deux couches. (1) Dans chaque route, **vérifier l'appartenance avant d'émettre** : `select id from schedule_events where id=? and org_id=auth.orgId` ; 404 sinon. (2) Dans `resolveEntityVariables`, `checkStopConditions`, `executeCreateTask`, `executeRequestReview` : ajouter `.eq('org_id', orgId)` à **toutes** les lectures (c'est le seul garde-fou en `service_role`, il doit être systématique — comme la branche `quote` l'a déjà). (3) Test T7 avec deux orgs. **Effort** 1 j. **Risque** nul (les lectures légitimes ont toujours le bon `org_id`).

### F4 — RLS d'écriture ouverte à tout membre (CRITIQUE)

**Constat.** Policies `automation_rules_insert/update/delete_org` = « membre de l'org » ; `automation_scheduled_tasks_*_org` et `automation_execution_logs_*_org` = `has_org_membership` pour INSERT/UPDATE/DELETE aussi. L'application ne restreint que par `PermissionGate automations.update` (owner/admin) dans l'interface. Par PostgREST direct, un technicien peut : activer les 35 règles, changer le corps d'un SMS, ajouter `config.to` (F18) pour recevoir une copie de chaque relance, insérer une règle `update_status` qui passe toutes les factures en `paid`, avancer une tâche, supprimer les logs d'exécution.

**Impact.** Escalade de privilège : un employé fait faire au moteur ce qu'il n'a pas le droit de faire à la main. Perte d'auditabilité (logs effaçables).

**Correctif (SQL, non exécuté — R1).**
```sql
-- automation_rules : lecture à tout membre, écriture aux admins (owner/admin)
drop policy if exists automation_rules_insert_org on public.automation_rules;
drop policy if exists automation_rules_update_org on public.automation_rules;
drop policy if exists automation_rules_delete_org on public.automation_rules;
create policy automation_rules_insert_admin on public.automation_rules for insert to authenticated
  with check (public.has_org_admin_role((select auth.uid()), org_id));
create policy automation_rules_update_admin on public.automation_rules for update to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));
create policy automation_rules_delete_admin on public.automation_rules for delete to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));
-- tâches et logs : lecture seule pour les membres ; le serveur (service_role) écrit
drop policy if exists automation_scheduled_tasks_insert_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_update_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_delete_org on public.automation_scheduled_tasks;
drop policy if exists automation_execution_logs_insert_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_update_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_delete_org on public.automation_execution_logs;
-- + revoke insert, update, delete on ces deux tables from authenticated (cf. secdef-lume-moindre-privilege)
```
Vérifier avant : `has_org_admin_role` existe (utilisé par `batch_restore`, `01_schema.sql`). Aligner `tests/rls-permissions-parite` et `member_has_permission('automations.update')` si on veut suivre la page Rôles plutôt que le rôle brut. **Effort** 0,5 j + `qa:rls-roles`. **Risque** : l'interface n'écrit ces tables que depuis `automationRulesApi.ts` (toggle, message) et `SettingsMessaging.tsx` (toggle), tous réservés aux admins par l'UI ; rien ne casse pour eux.

### Contexte de permission

Le moteur s'exécute **« en dieu »** : `service_role`, aucun acteur, aucune vérification de ce que le créateur de la règle ou le propriétaire de l'entité aurait le droit de faire. Acceptable pour des presets fournis par Lume ; inacceptable le jour où un utilisateur compose ses propres actions (F15, F18). Jugement : conserver `service_role` (les envois doivent partir même si le créateur est parti) mais **borner le catalogue d'actions** par validation serveur des règles écrites (schéma Zod dans `server/lib/validation.ts`, route serveur pour créer/modifier au lieu de PostgREST direct).

### Injection par gabarit

`resolveTemplate` (`actions/index.ts:117-125`) est un `replace` de `[mot]`/`{mot}` par une valeur de dictionnaire : pas d'expression, pas de chemin, pas d'exécution. Les valeurs proviennent de l'org de l'événement (une fois F1 corrigé). Le corps d'un courriel est du HTML brut de la règle (`buildEmailLayout(company, body)`), envoyé tel quel : un admin peut y mettre ce qu'il veut, c'est son courriel. Pas de vecteur inter-tenant. Une variable inconnue devient `''` : « Bonjour , » plutôt qu'un placeholder visible — jugé MINEUR, à afficher dans l'aperçu.

---

## A5. Conformité (Québec)

### F7 — Consentement CASL non vérifié à la source ; avis hors plafond (MAJEUR)

**Constat.** SMS : `sms_opt_outs` vérifié à chaque envoi (`actions/index.ts:543-552`) ✅, STOP géré. Courriel : `isEmailUnsubscribed` + `List-Unsubscribe` ✅. **Mais** aucune notion de consentement **initial** : l'existence d'un numéro sur la fiche suffit pour recevoir des relances commerciales (cross-sell 30 j, réengagement 90 j, saisonnier 6 mois, anniversaire 1 an). En LCAP/CASL, une relance commerciale exige un consentement exprès ou tacite (relation d'affaires existante, 2 ans après le dernier achat) : le preset `client_anniversary` à 365 j et `seasonal_reminder_6m` sont dans la fenêtre tacite ; `lost_lead_reengagement` à 90 j après un **lead perdu** (jamais client) n'a **aucune base** de consentement tacite. `request_review` envoie courriel **et** SMS au même instant sur le tour immédiat, non `commercial`, donc hors plafond.

**Correctif.** Champ `clients.marketing_consent` (`'express' | 'implied' | 'none'`, avec date et source) déjà partiellement présent ? Non vérifié — à confirmer en Phase 4 par `check:schema-refs`. Règle moteur : action commerciale (délai > 0 et déclencheur non transactionnel) ⇒ exige `consent != none` ; `lost_lead_reengagement` désactivé par défaut. Marquer `request_review` `commercial: true`. **Effort** 1 j (hors migration, à écrire en SQL commenté). **Risque** faible.

### F8 — Traçabilité Loi 25 (MAJEUR)

**Constat.** `automation_execution_logs` garde action, config, résultat, erreur, durée. Il ne garde **pas** : la version de la règle (aucun versionnage), les conditions évaluées, l'acteur ayant déclenché, le destinataire résolu de manière structurée (il est dans `result_data` en texte), ni les règles qui ont matché sans planifier. Une décision automatisée touchant un client (relance, sondage) est reconstituable partiellement, par recoupement `activity_log` + `messages`. Les logs sont **modifiables et effaçables** par tout membre (F4). Rétention : aucune purge, PII (téléphone, courriel, corps du message) dans `result_data` et `action_config` pour toujours.

**Correctif.** Ajouter `rule_snapshot jsonb` (ou `rule_version`), `actor_id`, `recipient`, `event_id` ; journaliser aussi les non-matchs en mode debug (option par org) ; purge à 12 mois (`server/routes/cron.ts` existe déjà pour d'autres tables) ; retirer `result_data.body` du log (garder `to` haché ou tronqué). Migration SQL commentée à écrire en Phase 4. **Effort** 1 j.

---

## A6. Coût et abus

### F11 — Bulk naïf (MAJEUR) et F13 — Aucun plafond par org, aucun garde-fou de boucle (MAJEUR)

**Constat.** Un import de 200 leads via `request-forms.ts:769` ou `leads.ts:153` = 200 `lead.created` = 200 × (`welcome_new_lead` : SMS + courriel + notification + log) immédiats, séquentiels, dans le processus web. Un resync mobile de 50 jobs terminés = 50 × 8 presets. Seul plafond : 3 messages commerciaux / **destinataire** / 24 h (`PLAFOND_MSG_COMMERCIAUX_24H`), qui ne s'applique pas aux immédiats (`commercial` absent). `suppress_immediate` ne couvre que les visites en lot. Aucun plafond par org (par jour, par mois, en dollars), aucune agrégation, aucun throttle. Volume actuel : 47 SMS d'automatisation au total, une seule org (15 sur 30 jours) — le risque est devant, pas derrière.

**Correctif.** (1) Compteur `automation_send_counters(org_id, day, sms, email)` incrémenté à l'envoi ; plafond par plan (`plans.automation_daily_sms_cap`) ; au-delà : tâche `deferred_cap` + notification à l'admin, jamais d'envoi. (2) Pour les événements en rafale (> 20 pour la même org en 60 s) : mettre en file au lieu d'exécuter inline (dépend de F3/F9). (3) Compteur de profondeur (F12c). **Effort** 1,5 j. **Risque** faible.

---

## A7. UX de la page

### F22 — Rien sur l'avenir, presque rien sur le passé (MINEUR, mais c'est ce qui rend le produit crédible)

- **Comprendre avant d'activer** : oui pour le texte (aperçu avec variables d'exemple, logo, `EmailPreviewEditor`) ; non pour le déclencheur réel (« Rendez-vous créé » ne dit pas « à la première visite seulement, pas aux visites en lot ») ni pour les conditions d'arrêt (« ne part pas si la facture est payée » n'est écrit nulle part) ni pour les heures calmes.
- **Voir ce qui s'est passé** : un badge « N échec » 7 jours par règle ; pas de liste « envoyé à qui, quand, quoi », alors que les données existent (`automation_execution_logs.result_data`, `messages`). La timeline d'une fiche client montre les courriels (`activity_log`) et les SMS (Messages), mais sans dire « c'est l'automatisation X ».
- **Voir ce qui va partir** : rien. 180 tâches en attente en prod, invisibles. L'entrepreneur ne peut pas annuler une relance armée pour un client précis autrement qu'en payant la facture ou en désactivant la règle (et F16 : même ça ne marche pas).
- **Pourquoi ça n'a pas marché** : `result_error` en anglais technique (« SMTP not configured », « Frequency cap reached for +1514… ») n'est affiché nulle part ; Lumi (`get_automation_health`) le traduit, la page non.
- **États** : vide/chargement/erreur corrects ; toggle optimiste avec rollback correct ; libellés bilingues ; `TRIGGER_DISPLAY` incomplet (`agreement.signed` brut) et périmé (`job.scheduled`, `payment.received`).
- **Clics pour l'automatisation la plus courante** (relance de devis non répondu) : **zéro**, elle est active d'office. Pour la personnaliser : 3 clics (déplier, modifier, enregistrer). Pour en créer une différente : impossible.

**Correctif.** Une carte « À venir » par règle et une page « Historique » lisible (destinataire, canal, heure, résultat en français, bouton Annuler sur une tâche pending) — 2 j front, aucune table nouvelle. Traduction des erreurs (dictionnaire de 10 entrées) — 0,25 j.

---

## A8. Performance

### F24 (MINEUR)

- Par événement : 1 requête règles + par règle matchée (`resolveEntityVariables` : `company_settings` + entité + client + jusqu'à 2 lectures `job_agreements`/`jobs`) + `langueOrg` + par action (`sms_opt_outs`, plafond, `getOrgSmsFromNumber`, `conversations`, `messages`, `automation_execution_logs`) ≈ **10 à 15 requêtes par action**, toutes séquentielles, dans la requête web pour les immédiats. `company_settings` et `langueOrg` sont relus pour chaque règle du même événement (5 règles `lead.created` = 5 lectures identiques). Estimation par lecture, non mesurée.
- `processScheduledTasks` : 50 tâches par tick, chacune 10-15 requêtes, séquentielles ; à 600 tâches échues (rattrapage après panne) il faut 12 ticks = 1 h.
- Index : corrects. `idx_scheduled_tasks_pending` = `(execute_at) where status='pending'` couvre exactement la sélection du tick ; `idx_automation_rules_trigger` = `(org_id, trigger_event) where is_active = true` couvre exactement la sélection des règles (`supabase/baseline/01_schema.sql:22880, 25561`). Rien à ajouter.
- Croissance : `automation_execution_logs` 249 lignes en 72 jours, `activity_log` 941 : négligeable aujourd'hui ; sans purge, linéaire (F21).

**Correctif.** Mémoïser `company_settings`/langue par `(org, événement)` ; batcher les logs. Aucun index à créer. **Effort** 0,5 j.

### Mesures (Phase 4, 2026-09-13) — ce qui était « estimé par lecture » est maintenant compté

Requêtes Supabase par événement immédiat, une règle, une action (`tests/automation/perf.unit.test.ts`, cliquet) :

| Cas | Requêtes | Dont évitables |
|---|---|---|
| Socle (bus, règles, variables, langue) | 8 | `company_settings` lu 2 fois, `job_agreements` lu 2 fois pour un job sans contrat |
| + `log_activity` | 10 | |
| + `create_notification` | 10 | |
| + `create_task` | 11 | |
| + `send_sms` | 12 | |
| + `send_email` | 13 | `email_unsubscribes` lu 2 fois **et écrit 1 fois** : `getUnsubscribeUrl` crée un jeton de désabonnement à chaque courriel (`notificationHelpers.ts:212`) |
| + `request_review` | 23 | `company_settings` et `jobs` relus |
| Preset `welcome_new_lead` (4 actions) | 21 | |

Un tick réel de 50 tâches `send_sms` sur staging (`tests/automation-integration/perf.test.ts`, `fetch` compté) : **604 requêtes PostgREST, 12,1 par tâche, 23,6 s, soit 472 ms par tâche, séquentiel**. Répartition : `automation_scheduled_tasks` 102 (sélection, prise, clôture), `schedule_events` 100, `company_settings` 100, `messages` 100 (plafond + insertion), `conversations` 51, `job_agreements` 50, `sms_opt_outs` 50, `automation_execution_logs` 50, `clients` 1. Débit maximal du moteur : 50 tâches par tick de 5 minutes ≈ 600 envois différés par heure, en environ 24 s de travail par tick — largement suffisant pour 5 orgs (180 tâches en attente), et une file de 600 tâches (panne d'une heure) se rattrape en une heure.

Prod, lecture seule (`pg_stat_user_indexes`, `pg_stat_user_tables`) : les index de la file sont bien ceux qui travaillent — `idx_scheduled_tasks_pending` 18 926 lectures, `idx_scheduled_tasks_dedup` 10 064, `idx_automation_rules_trigger` 613 ; `idx_automation_sched_tasks_entity` et `idx_automation_execution_logs_org_automation_rule_id` n'ont jamais servi (0). Tailles : `automation_rules` 3,7 Mo (jsonb des 175 règles), `automation_scheduled_tasks` 0,8 Mo, `automation_execution_logs` 0,3 Mo, `activity_log` 1,5 Mo — la croissance n'est pas un sujet avant longtemps ; la purge (F21) est une question de PII, pas de volume.

Conclusion A8 : pas de problème de performance aujourd'hui ni à dix fois la charge ; les gains faciles sont la mémoïsation des réglages par événement (−2 à −4 requêtes par règle) et la suppression de l'écriture `email_unsubscribes` par courriel (un jeton par destinataire suffit).

---

## Autres findings

- **F6 (MAJEUR) Kill switch / dry-run.** Aucun interrupteur global ni par org ; `QA_REDIRECT_TO` détourne les envois vers une adresse de test (recette), ce qui n'est pas un arrêt. `GET /api/automations/test` diagnostique, ne simule pas. **Correctif** : `AUTOMATIONS_ENABLED=false` (global, lu à chaque tick et dans `handleEvent`), `company_settings.automations_paused_at` (par org, visible dans la page : bandeau « Automatisations en pause »), mode `dry_run` par org qui écrit le log avec `result_data.dry_run=true` sans appeler Twilio/SMTP. **Effort** 1 j.
- **F15 (MAJEUR) `update_status` libre.** `actions/index.ts:732-755` écrit `status` sur `invoices`, `quotes`, `jobs`, `clients`, `tasks`, `schedule_events` sans passer par les RPC métier (`mark_invoice_paid`, transitions de devis avec historique). Aucun preset ne l'utilise ; le chemin est ouvert à quiconque écrit une règle (F4). **Nuance mesurée en Phase 4 (T8.1)** : pour `invoices`, le trigger `trg_invoices_apply_status_logic` recalcule le statut à partir des montants et de `sent_at` — un `status = 'paid'` écrit par le moteur est aussitôt ramené à la valeur dérivée. La facture ne peut donc pas passer payée par ce chemin ; la base a un garde-fou que le code n'a pas. Rien de tel sur `jobs`, `quotes` (l'historique `quote_status_history` est contourné), `clients`, `tasks`, `schedule_events`. **Correctif** : liste blanche de transitions par table, ou retirer l'action tant qu'aucune UI ne la propose. **Effort** 0,25 j.
- **F17 (MINEUR) Ordre.** `order by created_at, id` sur la sélection des règles ; documenter « les règles d'un même événement s'exécutent dans l'ordre de création ». 0,1 j.
- **F18 (MINEUR) `config.to`.** Retirer ou valider (courriel/E.164 de l'org seulement). 0,1 j.
- **F19 (MINEUR) `entityId: ''`.** Exiger `quoteId` (400) sur `quote-sent`/`quote-approved`. 0,1 j.
- **F20 (MINEUR) Code mort.** Retirer le polling `automations` du tick (`scheduler.ts:684-762` et les 5 handlers), les fonctions SQL `automation_job_completed()` / `automation_lead_stage_change()` (SQL commenté), l'alias `send_notification`, les 9 types d'événements jamais émis. 0,5 j. Hors scope tant que non demandé (R13).
- **F21 (MINEUR) Journal doublé, PII, purge.** Retirer `log_activity` des presets (l'événement est déjà dans `activity_log`) ; purge à 12 mois ; tronquer `result_data.body`. 0,5 j + SQL commenté.
- **F23 (MINEUR) Tests.** Voir `AUTOMATIONS_TEST_PLAN.md` (Phase 3).

---

### F25 — `lost_lead_reengagement` ne peut jamais partir (MAJEUR, découvert en Phase 4)

**Constat.** Le preset écoute `lead.status_changed` avec la condition `{ new_status: 'lost' }` et planifie un courriel + un SMS 90 jours plus tard (`automationPresets.data.ts`). Au dépilage, `checkStopConditions` (`automationEngine.ts:839-852`) lit le lead et annule la tâche dès que `lead_status ∈ {lost, closed, converted, …}`. Or le lead **est** perdu par définition du déclencheur. La tâche est donc toujours `cancelled` sans motif, jamais exécutée. Confirmé par le golden set (`tests/automation/golden/lost_lead_reengagement.json` : 3 tâches planifiées, 0 message, 3 annulations) et cohérent avec la prod : 0 exécution en 72 jours pour ce preset, 332 annulations « sans motif » dans la file.

**Impact client.** L'entrepreneur voit « Réengagement prospect perdu — 90 jours » actif, et rien ne part jamais. Aucun échec journalisé : invisible.

**Correctif.** Soit exempter ce preset de l'arrêt « lead perdu » (l'arrêt doit rester pour `lead_followup_*`), soit déplacer l'arrêt dans les conditions de la règle (`stop_when`) plutôt que dans un `if` global par type d'entité. Enregistrer le motif d'annulation dans `last_error` pour que ce genre de mort silencieuse se voie. **Effort** 0,25 j + golden à régénérer sciemment. À croiser avec F7 (ce preset n'a de toute façon pas de base de consentement).

### F26 — Désabonnement courriel retenté trois fois (MINEUR, découvert en Phase 4)

**Constat.** `executeSendEmail` refuse bien un destinataire désabonné (« Recipient … has unsubscribed from marketing emails », `actions/index.ts:469-471`), mais `isTransientFailure` (`automationEngine.ts:475-487`) ne connaît que six sous-chaînes définitives — `no recipient`, `not configured`, `opted out`, `plan does not include`, `are disabled`, `frequency cap`. « has unsubscribed » n'y est pas : la tâche repasse `pending` et est retentée à +5 min, +30 min, +2 h avant `failed`. Le SMS, lui, tombe sur `opted out` et s'arrête du premier coup. Prouvé par `tests/automation-integration/conformite.test.ts` T11.4.

**Impact client.** Aucun envoi indu (le refus tient à chaque passage), mais trois exécutions et trois logs d'échec pour rien, et une incohérence entre canaux.

**Correctif.** Ajouter `has unsubscribed` à la liste, ou mieux : faire porter le caractère définitif par l'action (`{ success:false, error, permanent:true }`) plutôt que par une liste de sous-chaînes anglaises. **Effort** 0,1 j (liste) ou 0,5 j (champ `permanent`).

## Ordre de correction recommandé (après go, un item à la fois — R17)

1. **F1** filtres `org_id` + vérification d'appartenance dans les routes (1 j) — bloquant V1.
2. **F2** fuseau des variables (0,25 j) — le message le plus envoyé est faux.
3. **F3 + F9** tout passe par la file avec clé (1,5 j) — fin des doublons.
4. **F4** policies RLS admin (SQL commenté, 0,5 j).
5. **F16** relire la règle à l'exécution, arrêt sur job supprimé (0,5 j).
6. **F5** clé d'idempotence fournisseur (1 j).
7. **F6** kill switch + dry-run (1 j).
8. **F11/F13** plafond par org + profondeur (1,5 j).
9. **F7** consentement (1 j + SQL).
10. **F8/F21** trace et purge (1 j + SQL).
11. **F10/F12** outbox et détection de changement côté serveur (2 j + 0,5 j/entité).
12. Le reste.

Total 1-10 : environ 9 jours-personne, sans les migrations (à écrire, pas à exécuter) ni les tests de la Phase 4.
