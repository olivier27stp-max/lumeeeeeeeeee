# AUTOMATIONS_MAP.md — Reconnaissance de la page Automatisations et de son moteur

Phase 1 de l'audit. **Lecture seule** : aucun fichier applicatif modifié, aucune écriture en base. Les chiffres de production viennent de requêtes `SELECT` passées par l'API Management (`read_only: true`) le 2026-09-13. Le code lu est `origin/main` au commit `16567e36`.

Précision d'entrée : le repo est **Vite + React 19 + Express + Supabase**, pas Next.js. Tout ce qui suit décrit ce qui existe réellement.

---

## 0. Résumé en dix lignes

- Il y a **un seul moteur vivant** : `server/lib/automationEngine.ts`, alimenté par un bus d'événements en mémoire (`server/lib/eventBus.ts`) et une file de tâches différées en base (`automation_scheduled_tasks`), dépilée toutes les 5 minutes par `server/lib/scheduler.ts`.
- Les règles vivent dans `automation_rules` (jsonb `conditions` + jsonb `actions`). **Zéro règle personnalisée en prod** : les 175 règles sont les 35 presets × 5 orgs, toutes actives.
- L'utilisateur ne peut faire que trois choses : activer/désactiver une règle, réécrire le texte d'un SMS ou d'un courriel, choisir la langue des messages. Il ne peut ni créer une règle, ni changer un déclencheur, un délai ou une condition.
- Le moteur tourne **entièrement sous `service_role`** (RLS contournée). Le garde-fou applicatif est le filtre `org_id` sur chaque requête… et il manque sur la résolution des variables (§3.4 et §6.1).
- Un membre authentifié peut faire lire au moteur une entité d'une **autre organisation** en passant un `eventId` étranger aux routes `POST /api/automations/events/*` (§6.1). Sous R3, c'est un finding à remonter immédiatement ; il est détaillé, pas encore classé (Phase 2).
- Idempotence : réelle pour les actions **différées** (index unique `idx_scheduled_tasks_dedup`, prise atomique), **inexistante pour les actions immédiates** (délai 0) : un événement émis deux fois = deux SMS.
- Journalisation : `automation_execution_logs` (une ligne par action tentée) et `activity_log` (une ligne par événement émis). Pas de purge, pas de trace des conditions évaluées, pas de trace des règles qui n'ont pas matché.
- Heures de silence 8 h–20 h America/Toronto sur SMS et courriels différés. Le reste du calcul de dates est en UTC, et les heures de rendez-vous dans les messages sont formatées **sans fuseau** (§3.6).
- Deux implémentations concurrentes existent encore : le vieux planificateur par polling (`automations`, 0 ligne, toujours interrogé toutes les 5 min) et trois fonctions SQL trigger dont deux orphelines (§6).
- Tests existants : 133 tests unitaires, dont les principaux **recopient** la logique du moteur au lieu de l'importer (§7). Aucun test d'intégration sur la base, aucun test d'isolation multi-tenant, aucun test d'idempotence réel.

---

## 1.1 Surface de la page

### Route, accès, plan

| Élément | Fichier | Détail |
|---|---|---|
| Route | `src/App.tsx:1595` | `/automations` → `<Gated permission="automations.read"><PlanFeatureGate flag="includes_automations"><PageWrapper><Automations/>` (lazy) |
| Redirections | `src/App.tsx:1602-1603` | `/automations/hub` et `/automations/builder` → `/automations` (restes du constructeur visuel retiré) |
| Menu | `src/App.tsx:1105` | tuile « Automatisations », icône Zap, `requiredPermission: automations.read`, `requiredPlanFlag: includes_automations` |
| Plan | table `plans` (prod) | `includes_automations` : autopilot ✅, pro (Scale) ✅, starter ❌ |
| Permission page | `src/pages/Automations.tsx:458` | `<PermissionGate permission="automations.update">` enveloppe TOUT le contenu : un membre qui a `automations.read` sans `update` ne voit rien |
| Rôles | `src/lib/permissions.ts:404-470` | `automations.read/update` : owner et admin seulement (`allTrue()`). Absents des listes `sales_rep` et `technician` |

### Composants

- `src/pages/Automations.tsx` (824 lignes) — page unique.
- `src/components/automations/MessageEditor.tsx` (208) — édition du texte d'un SMS (textarea + puces de variables) ou aperçu compact d'un courriel + bouton qui ouvre :
- `src/components/automations/EmailPreviewEditor.tsx` (404) — éditeur pleine page d'un courriel par blocs de texte, objet, aperçu habillé avec logo/nom d'entreprise, variables remplacées par des exemples. Le HTML est produit par `texteVersHtml` (`src/lib/emailBodyText.ts`), jamais rendu via `dangerouslySetInnerHTML`.
- `src/lib/automationRulesApi.ts` (240) — lecture/écriture PostgREST directe sur `automation_rules`, `automation_execution_logs`, `company_settings`.
- `src/lib/automationEventsApi.ts` (144) — dix hooks « fire-and-forget » vers `POST /api/automations/events/*`.

Seconde surface : `src/pages/SettingsMessaging.tsx:357-505` (« SMS automatiques ») liste les règles qui textent les clients et permet le même toggle (`toggleAutomationRule`). Même table, même API.

### Ce que l'utilisateur peut faire

| Geste | Chemin | Effet en base |
|---|---|---|
| Activer / désactiver | `handleToggle` → `toggleAutomationRule` (`automationRulesApi.ts:43`) | `update automation_rules set is_active` par PostgREST, RLS `automation_rules_update_org` |
| Réécrire un SMS ou un courriel (corps, objet) | `MessageEditor` → `updateRuleMessage` (`automationRulesApi.ts:71`) | lecture-modification-écriture du jsonb `actions` : seul `config.body` / `config.subject` de l'action ciblée change |
| Choisir la langue des messages | `changerLangue` → `setAutomationLanguage` | `company_settings.default_language` ('fr' \| 'en') |
| Chercher, filtrer par catégorie (8) et statut, replier une catégorie, déplier une règle | état local | rien |

Ce que l'utilisateur **ne peut pas** faire : créer une règle, en supprimer une, changer le déclencheur, le délai, les conditions, le canal, le destinataire, l'ordre des actions, ni voir l'historique d'exécution autrement qu'un badge « N échec » sur 7 jours.

### Écrans et états (capture textuelle)

**En-tête** : « Automatisations — Automatisations événementielles pour votre entreprise », à droite un sélecteur « Messages en FR | EN » et un bouton « Retour » (vers `/settings`).

**Ligne de stats** : trois cartes Total / Actives / Inactives (comptées sur les règles dédupliquées par `preset_key`, `Automations.tsx:366-374`).

**Filtres** : champ recherche (nom + description), select catégorie (Leads, Devis et soumissions, Jobs et rendez-vous, Factures, Paiements, Suivi, Avis, Engagement client), select statut, compteur « N résultats ».

**État chargement** : spinner centré (`loading`).

**État vide** : carte « Aucune automatisation » (icône Zap grisée) — ou « Aucun résultat » si une recherche est saisie. Ce cas n'arrive en pratique qu'à une org sans presets (le seed est automatique).

**État erreur de chargement** : toast « Impossible de charger les automatisations », liste vide. Erreur de chargement des échecs : silencieuse (console), badges absents.

**Liste pleine** : une carte par catégorie, en-tête repliable « Catégorie · k/n actives · description », puis un tableau : Automatisation (icône, nom traduit via `AUTOMATION_NAME_FR`, badge « Par défaut » ou « Optionnel », badge rouge « N échec » sur 7 jours) · Déclencheur (`TRIGGER_DISPLAY`, sinon la clé brute) · Délai (`formatDelay` : « Immédiat », « 2h avant », « 3 jours après », « 6 mois après ») · Canaux (SMS, Email, Notif, Tâche, Avis) · Statut (pastille Active / Off) · interrupteur.

**Ligne dépliée** : Description / Actions (libellés de `getActionLabel`) / Détails (délai, `key: preset_key` en `<code>`), puis un `MessageEditor` par action `send_sms` ou `send_email`.

**Édition SMS** : textarea du corps, puces `[client_first_name]`, `[client_name]`, `[company_name]`, `[invoice_number]`, `[invoice_total]`, `[quote_number]`, `[appointment_date]`, `[appointment_time]` (`VARIABLES_PROPOSEES`, `src/lib/emailBodyText.ts:174`), bouton Enregistrer → toast « Message enregistré » / message d'erreur.

**Édition courriel** : aperçu compact (premières lignes, variables remplacées) + « Modifier » → `EmailPreviewEditor` pleine page (objet, blocs, aperçu avec logo, Échap pour fermer).

**Toggle** : optimiste, toast « Automatisation activée/désactivée », rollback + toast d'erreur si l'écriture ne retourne pas la ligne (`.select('is_active')` vérifie que la RLS a laissé passer).

Remarques d'interface (à juger en 2A-A7) : `TRIGGER_DISPLAY` ne connaît pas `agreement.signed` (affiché en clé brute), et affiche `job.scheduled` / `payment.received` qui n'existent pas dans le bus ; `AUTOMATION_NAME_FR` traduit par nom exact, donc une règle renommée retombe en anglais ; aucune page ne montre les tâches en attente (« qu'est-ce qui va partir, à qui, quand ») ni l'historique.

---

## 1.2 Modèle de données

Quatre tables `automation_*` (prod, 2026-09-13). Toutes avec RLS + FORCE RLS, 4 policies chacune.

### `automation_rules` (175 lignes)

`id`, `org_id` (FK orgs, cascade), `name`, `description`, `trigger_event text`, `conditions jsonb default '{}'`, `delay_seconds int default 0`, `actions jsonb default '[]'`, `is_active bool default true`, `is_preset bool`, `preset_key text`, `created_at`, `updated_at` (trigger `trg_automation_rules_updated`).

- Unique `(org_id, id)` (support des FK composites « même org »). Index `idx_automation_rules_org_preset`, `idx_automation_rules_trigger`.
- **Aucune contrainte** : pas de CHECK sur `trigger_event` (n'importe quelle chaîne), pas de CHECK sur `delay_seconds`, pas d'unicité `(org_id, preset_key)` (la page déduplique côté client, `Automations.tsx:366`), pas de `deleted_at`, pas de version, pas de `created_by`.
- Policies (`automation_rules_*_org`) : `org_id in (select org_id from memberships where user_id = auth.uid())` pour SELECT/INSERT/UPDATE/DELETE. **N'importe quel membre** (technicien inclus, membership inactive incluse — la policy ne teste pas `status`) peut insérer/modifier/supprimer une règle par PostgREST. L'interface le cache (`PermissionGate automations.update`), la base ne l'empêche pas.

### Champs JSON non validés qui portent de la logique

- `automation_rules.conditions` — objet `{ champ: valeur | { eq|neq|in|not_in } }` évalué contre `event.metadata` (§1.3). Aucun schéma, aucune validation à l'écriture. Un opérateur inconnu fait échouer la règle (silencieusement, `console.warn`).
- `automation_rules.actions[]` — `{ type, config }` : `config.body`, `body_en`, `subject`, `subject_en`, **`config.to`** (destinataire arbitraire, templatable), `config.table` + `config.status` (`update_status`), `config.title/body/reference_id`, `config.event_type/metadata`. Aucun schéma. Les presets n'utilisent jamais `to`, mais un membre peut l'écrire.
- `automation_scheduled_tasks.action_config` — copie de l'action **plus** `trigger_event` et `event_metadata` figés au moment de la planification : si la règle est modifiée entre-temps, la tâche exécute l'ancien texte.
- `automation_execution_logs.action_config` — copie de `config` (sans le type), donc le corps des messages envoyés est stocké en clair dans les logs.

### `automation_scheduled_tasks` (673 lignes : 180 pending, 152 completed, 332 cancelled, 9 failed)

`id`, `org_id`, `automation_rule_id` (FK cascade **et** FK composite `(org_id, automation_rule_id)`), `entity_type text`, `entity_id uuid NOT NULL`, `action_config jsonb`, `execute_at timestamptz`, `status` CHECK in (pending, running, completed, failed, cancelled), `execution_key text NOT NULL`, `attempts int`, `last_error`, `created_at`, `completed_at`. **Pas de `updated_at`** (le code réécrit `execute_at` pour dater la prise, `automationEngine.ts:621-636`).

- `idx_scheduled_tasks_dedup` UNIQUE `(org_id, execution_key) WHERE status IN ('pending','running')` — vérifié présent en prod. C'est LE verrou d'idempotence des actions différées (`20260751100300_uniques_org_scope_and_soft_delete.sql:145`).
- `idx_scheduled_tasks_pending`, `idx_automation_sched_tasks_entity`, FK-index.
- Policies : `has_org_membership(auth.uid(), org_id)` en SELECT/INSERT/UPDATE/DELETE pour `authenticated` — un membre peut annuler ou avancer une tâche par PostgREST.

### `automation_execution_logs` (249 lignes)

`id`, `org_id`, `automation_rule_id` (FK set null + composite), `scheduled_task_id` (FK set null + composite), `trigger_event`, `entity_type`, `entity_id uuid NOT NULL`, `action_type`, `action_config`, `result_success`, `result_data`, `result_error`, `duration_ms`, `created_at`. Policies membership, y compris **INSERT/UPDATE/DELETE pour `authenticated`** : un membre peut effacer ou fabriquer des logs.

Ce qui n'y est PAS : la version de la règle, les conditions évaluées et leur résultat, les règles qui ont matché sans exécuter (délai), l'acteur, l'identifiant de l'événement, le destinataire résolu (sauf dans `result_data` pour SMS/courriel).

### `automations` (0 ligne) — table héritée

`name`, `trigger` CHECK (days_after_quote_sent, days_before_appointment, on_invoice_due_date, days_after_invoice_due, days_after_job_completed, custom), `delay_value`, `delay_unit` (hours|days), `message_template`, `active`, `category`. Aucun écran n'y écrit (`grep from('automations')` : seul `scheduler.ts:725` la lit). Voir §6.

### Tables voisines utilisées par le moteur

`activity_log` (941 lignes ; chaque `eventBus.emit` y écrit), `notifications` (action `create_notification` : `org_id, type='automation', title, body, reference_id` — sans `user_id`, donc notification « d'org »), `messages` + `conversations` (trace des SMS d'automatisation, `sender_user_id` null), `sms_opt_outs`, `email_unsubscribes` (via `notificationHelpers.isEmailUnsubscribed`), `review_requests` + `satisfaction_surveys` (`request_review`), `tasks` (`create_task`, CHECK sur `linked_entity_type`), `company_settings` (langue, identité, liens d'avis, `review_enabled`).

### Fonctions et triggers SQL

- `trg_org_created_seed_automations` AFTER INSERT ON `orgs` → `handle_org_created_seed_automations()` → `seed_automation_presets(org)` + `apply_automation_presets_fr(org)`, SECURITY DEFINER, exception avalée en `raise warning` (`supabase/baseline/01_schema.sql:6232-6244`, `:27493`). Doublé côté serveur par `ensureAutomationPresets()` (`server/lib/automationPresetSeeder.ts`) appelé dans `server/routes/orgs.ts:127` et `server/lib/seedOrgDefaults.ts:233`, qui répare deux dérives connues (trigger `estimate.sent` → `quote.sent`, délai `google_review` 7200 → 0) et insère les presets manquants.
- `trg_automation_invoice_overdue` AFTER UPDATE ON `invoices` → `automation_invoice_overdue_check()` : insère une **notification** « Invoice overdue » quand une facture `sent|partial` passe sous `CURRENT_DATE`. Ne touche pas le moteur (`01_schema.sql:1651-1673`).
- `automation_job_completed()` et `automation_lead_stage_change()` : fonctions présentes, **attachées à aucun trigger**. La première référence des colonnes inexistantes (`automation_rules.entity_type`, `trigger_on`, `priority`, `deleted_at`) et une table inexistante (`automation_executions`) : elle planterait si on la branchait (`01_schema.sql:1679-1760`).

---

## 1.3 Moteur d'exécution

### Déclenchement — trois voies vers un seul bus

`server/lib/eventBus.ts` : `CRMEventBus extends EventEmitter`, singleton `eventBus`, 27 types `CRMEventType`. `emit(type, {orgId, entityType, entityId, actorId?, metadata, related…})` écrit d'abord une ligne `activity_log` (erreur loggée, jamais bloquante) puis appelle les listeners **en mémoire, dans le même processus**. Aucune persistance de l'événement lui-même, aucune file.

1. **Routes serveur** (17 sites) : `quotes.ts:428,577` (`quote.sent` courriel/SMS), `:1019` (`quote.approved`, signature publique), `:1395` (`quote.declined`), `:1482` (`quote.changes_requested`) ; `emails.ts:329` (`invoice.sent`), `:452` (`estimate.sent`, `entityType:'invoice'`) ; `leads.ts:153,589,689,705` ; `request-forms.ts:769` (`lead.created` depuis un formulaire public) ; `payments.ts:332` (`invoice.paid` avec `entityType:'quote'`, `payment_type:'deposit'`) ; `lib/payments.ts:958` (`invoice.paid`) ; `agreements.ts:601` (`agreement.signed`, `entityType:'job'`) ; `recurringJobScheduler.ts:182` (`appointment.created`, `source:'recurring'`).
2. **Hooks appelés par le navigateur** après une écriture PostgREST : `server/routes/automation-events.ts` — 10 routes `POST /api/automations/events/{appointment-created, appointment-cancelled, appointment-rescheduled, job-completed, deal-stage-changed, quote-sent, quote-approved, invoice-paid, lead-created, lead-status-changed}`. Validation `automationEventSchema` (`server/lib/validation.ts:291`) : tous les champs optionnels, `.passthrough()`. Appelants : `src/lib/jobsApi.ts:285-294`, `scheduleApi.ts:270,322,377`, `invoicesApi.ts`, `pipelineApi.ts`, `quotesApi.ts`. Les outils de l'agent Lumi passent par le même chemin (`signalerEvenement`, `server/lib/agent/tools-etendus.ts:1449,2460,2512,2836,3274`).
3. **Détections périodiques** dans `scheduler.ts` : `detectOverdueInvoices` émet `invoice.overdue` aux jours 1, 3, 5, 15, 30 (dédup **en mémoire seulement**, `hasFiredLocal`) ; `expireOverdueQuotes` expire les devis (sans émettre).

`job.completed` n'a **aucun émetteur serveur** : il n'existe que par le hook navigateur (`jobsApi.ts` `emitJobCompleted`) et par Lumi. Un statut passé à `completed` par un autre chemin (import, SQL, MCP direct, mobile hors ligne) ne déclenche rien.

### Synchrone ou asynchrone ?

`handleEvent` (`automationEngine.ts:413`) est un listener `async` sur un `EventEmitter` : il démarre dans la requête HTTP qui a émis, mais son résultat n'est pas attendu (`super.emit` retourne avant la fin). Les actions à **délai 0 s'exécutent donc immédiatement, dans le processus web, en tâche de fond non attendue** — un `send_sms` immédiat part pendant que la réponse HTTP est déjà envoyée. Les actions à délai ≠ 0 sont **persistées** dans `automation_scheduled_tasks` puis exécutées par le tick.

### Qui exécute, avec quel rôle

- `initAutomationEngine` (`server/index.ts:1253`) reçoit un client `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` : **toutes** les lectures et écritures du moteur, des actions et du scheduler passent par `service_role` (RLS contournée).
- Garde-fous applicatifs qui remplacent la RLS : filtre `.eq('org_id', …)` sur `automation_rules` (`:418-423`), sur `update_status` (`actions/index.ts:741-746`, plus liste blanche de 6 tables), sur `company_settings`, `memberships`, `sms_opt_outs`, `review_requests`, `messages`, `notifications`, `tasks`. **Absent** dans `resolveEntityVariables` pour `clients`, `jobs`, `invoices`, `schedule_events`, `job_agreements` (seule la branche `quote` filtre `org_id`, `actions/index.ts:316-322`) et dans `checkStopConditions` (`automationEngine.ts:761-855`), ainsi que dans `executeCreateTask` → `schedule_events` (`actions/index.ts:680`) et `executeRequestReview` → `jobs`/`invoices` (`:789-802`).
- Contexte de droits : ni celui de l'acteur, ni celui du propriétaire de l'entité. `actorId` est journalisé dans `activity_log` et jamais utilisé. Les tâches créées sont attribuées au propriétaire de l'org (`memberships.role='owner'`, `actions/index.ts:654-661`).

### Cycle d'une tâche différée (`processScheduledTasks`, `automationEngine.ts:570`)

1. `recupererTachesFigees` : toute tâche `running` dont `execute_at` < now − 15 min repasse `pending` (arrêt brutal).
2. Sélection de 50 `pending` échues (`execute_at <= now`), jointure explicite `automation_rules!automation_scheduled_tasks_automation_rule_id_fkey`. Le tick est sous `withAdvisoryLock('automation-scheduler')` + garde locale `tickEnCours` (`scheduler.ts:820-837`) ; une seule instance dépile.
3. Heures calmes : `send_sms` et `send_email` sont repoussés à `nextSendTime()` sans consommer de tentative.
4. Prise atomique : `update … set status='running', attempts+1, execute_at=now() where id=… and status='pending'` puis `.select('id')` — 0 ligne = quelqu'un d'autre l'a prise.
5. `checkStopConditions` : facture payée/annulée/client supprimé, devis répondu/expiré/converti, rendez-vous annulé/supprimé, lead sorti du statut lead → `cancelled` définitif. Une erreur de lecture **conserve** la tâche (correction documentée `:745-760`).
6. `resolveEntityVariables` + `executeAction` avec `commercial: true` (plafond 3 messages commerciaux / destinataire / 24 h, `AUTOMATION_MAX_COMMERCIAL_PER_DAY`).
7. Log dans `automation_execution_logs`, puis `completed` ou `nextStateAfterFailure` : reprise à 5 min, 30 min, 2 h (max 4 tentatives) si l'erreur est transitoire ; `failed` définitif si elle contient « no recipient », « not configured », « opted out », « plan does not include », « are disabled », « frequency cap » (`isTransientFailure`, `:475-487`).

### Que se passe-t-il si le processus meurt en plein milieu ?

- Action **immédiate** en cours : perdue sans trace (ni tâche, ni log — le log s'écrit après l'action). Si le SMS était parti chez Twilio mais pas encore loggé : envoyé sans log.
- Tâche **différée** prise (`running`) : ré-exécutée après 15 minutes par `recupererTachesFigees`. Si l'action externe avait abouti avant le crash (SMS envoyé, log non écrit), **elle repart** : la reprise n'est pas idempotente vis-à-vis du fournisseur (pas de clé d'idempotence Twilio/SMTP, pas de vérification « déjà envoyé » avant ré-exécution).
- Événement émis mais listener pas encore passé : perdu (bus en mémoire).

### Erreurs

- Résultat `{success:false}` ⇒ log + `console.error`. Retry uniquement sur le chemin différé (ci-dessus). **Pas de dead-letter** : après 4 tentatives, `failed` + `last_error`, personne n'est notifié (la page ne lit que `automation_execution_logs`, pas `automation_scheduled_tasks.failed`).
- Exceptions dans `handleEvent` : `catch` global → `console.error`, l'événement est perdu pour toutes les règles restantes.
- Échec d'écriture du log : `console.error` seulement.
- Le scheduler n'a **pas** de `withCronCheckIn` (les autres crons de `server/index.ts` en ont) : un tick qui ne tourne plus n'est pas détecté.

### Ordonnancement quand plusieurs règles matchent

`select * from automation_rules where org_id and trigger_event and is_active` **sans `order by`** (`automationEngine.ts:418-423`) : ordre de la base, non déterministe. Les actions d'une règle s'exécutent dans l'ordre du tableau `actions`, séquentiellement. Aucune priorité, aucune exclusion mutuelle, aucune notion de « première règle qui matche ».

---

## 1.4 Catalogue actuel

### Déclencheurs

**Déclarés dans le bus** (27) : `lead.created/updated/status_changed/converted`, `pipeline_deal.stage_changed`, `client.archived/deleted`, `estimate.sent/accepted/rejected`, `quote.created/sent/approved/declined/changes_requested/converted`, `agreement.signed`, `appointment.created/updated/cancelled`, `job.created/completed/ready_for_invoicing`, `invoice.created/sent/paid/overdue`.

**Réellement émis** (grep des `emit`) : `lead.created`, `lead.status_changed`, `lead.converted`, `job.created`, `quote.sent`, `quote.approved`, `quote.declined`, `quote.changes_requested`, `estimate.sent`, `invoice.sent`, `invoice.paid`, `invoice.overdue`, `agreement.signed`, `appointment.created`, `appointment.cancelled`, `job.completed`, `job.ready_for_invoicing`, `pipeline_deal.stage_changed`. Jamais émis : `lead.updated`, `client.archived/deleted`, `estimate.accepted/rejected`, `quote.created/converted`, `appointment.updated`, `invoice.created`.

**Écoutés par un preset** (11) : `job.completed` (8 presets), `invoice.sent` (5), `lead.created` (5), `quote.sent` (5), `appointment.created` (4), `quote.approved` (2), `invoice.paid` (2), `agreement.signed`, `estimate.sent`, `lead.status_changed`, `appointment.cancelled` (1 chacun). **Émis mais écoutés par personne** : `invoice.overdue` (toute la détection périodique ne sert qu'à `activity_log`), `quote.declined`, `quote.changes_requested`, `lead.converted`, `job.created`, `job.ready_for_invoicing`, `pipeline_deal.stage_changed` (consommé par `d2d-pipeline-listener.ts`, pas par le moteur).

Il n'existe aucun déclencheur « à la modification d'un champ », « avant sauvegarde », « planifié (cron) », « webhook entrant », « manuel », ni « appel depuis une autre règle ».

### Conditions (`evaluateConditions`, `automationEngine.ts:61`)

Égalité directe ou opérateurs `eq`, `neq`, `in`, `not_in` sur les clés de `event.metadata` uniquement (jamais sur l'entité en base), comparaison en chaîne (`memeValeur`), `null`/`undefined` jamais égaux à rien, opérateur inconnu ⇒ règle ignorée avec `console.warn`. AND implicite entre clés ; pas de OR, pas de `gt/lt`, pas d'ancienne valeur (sauf `old_status/new_status` quand l'émetteur les met dans metadata). Presets : 32 sans condition, `{"payment_type":"deposit"}`, `{"payment_type":{"neq":"deposit"}}`, `{"new_status":"lost"}`.

### Délais

`delay_seconds` entier : 0 = immédiat ; > 0 = « X après l'événement » (`now + delay`) ; < 0 = « X avant la date de référence », **seulement** pour `entityType ∈ {schedule_event, appointment}` (lecture de `schedule_events.start_at`, `resolveExecuteAt`, `:312`). Un délai négatif sur un autre type devient `Math.abs` après. Rappel dont le créneau est dépassé de plus de 30 min ⇒ abandonné (pas de tâche). Presets : 0 (5), 1 h, 2 h, 1 j, 2 j, 3 j, 7 j, 14 j, 21 j, 30 j, 90 j, 6 mois, 1 an ; −7 j, −1 j, −2 h.

### Actions (`server/lib/actions/index.ts`)

| Type | Effet | Coût externe | Réversible | Idempotence | Validation d'entrée |
|---|---|---|---|---|---|
| `send_sms` | Twilio depuis le numéro de l'org (`getOrgSmsFromNumber`), vérifie `sms_opt_outs`, plafond commercial, écrit `messages`+`conversations` | oui (SMS) | non | aucune (clé de tâche seulement si différé) | `config.to` optionnel non validé ; corps sans limite |
| `send_email` | `sendEmail` (Resend/SMTP) au nom de l'org, `List-Unsubscribe`, vérifie `isEmailUnsubscribed`, plafond, écrit `activity_log email_sent` | oui | non | aucune | idem ; HTML brut de la règle |
| `create_notification` / alias `send_notification` | insert `notifications` (org, sans user) | non | oui | aucune (doublons possibles) | aucune |
| `create_task` | insert `tasks` attribuée au owner ; `linked_entity_type` remappé (rendez-vous → job) | non | oui | aucune | titre tronqué implicitement non ; `due_date` brut |
| `update_status` | `update <table> set status` sur 6 tables autorisées, filtré org, 0 ligne = échec | non | partiellement | naturelle | table en liste blanche ; **valeur de statut non validée** contre les CHECK/machines d'état (ex. `invoices.status='paid'` sans paiement) |
| `request_review` | crée `satisfaction_surveys` + envoie courriel et SMS + `review_requests` | oui | non | anti-doublon 7 j par client (`review_requests`) | aucune |
| `log_activity` | insert `activity_log` | non | oui | aucune | `event_type` libre |

Absents : mise à jour de champ arbitraire, création de devis/facture, assignation, appel HTTP sortant, notification à un utilisateur précis, attente/branche.

### Variables de gabarit (`resolveTemplate`, `resolveEntityVariables`)

Syntaxe `[var]` ou `{var}`, remplacement simple (variable inconnue ⇒ chaîne vide), pas de code, pas d'accès par chemin (`client.notes` impossible). Variables : `company_name/phone`, `google_review_url`, `facebook_review_url`, `review_page_url`, `client_first_name/last_name/name/email/phone`, `quote_number/total/valid_until`, `job_name`, `invoice_number/due_date/total`, `appointment_date/time/title/address`, `contract_link/line/html`, `signed_contract_link`, `deposit_amount/line`, `survey_url/review_link`. Formatage : `quote_total` en `en-CA` (« $1,626.90 »), `invoice_total` en `$${x.toFixed(2)}`, `appointment_date/time` via `toLocaleDateString('fr-CA')` **sans `timeZone`** (§3.6).

### Kill switch, dry-run

- Global : aucun interrupteur « arrêter toutes les automatisations ». Le seul levier est de ne pas démarrer le serveur, ou `QA_REDIRECT_TO` / `QA_REDIRECT_EMAIL` (`server/lib/qa-redirect.ts`) qui **redirige** tous les envois vers une adresse de test (mode recette, pas un kill switch).
- Par tenant : désactiver les 35 règles une à une. Rien au niveau org.
- Dry-run : `GET /api/automations/test` (`server/routes/automation-test.ts`, admin) est un **diagnostic en lecture** (presets présents, variables résolues sur une vraie entité, file, logs, config Twilio/SMTP) — il n'exécute ni ne simule une règle. Son test 8 vérifie encore le **vieux** format de clé daté (`:253-258`) alors que `buildExecutionKey` ne date plus : test faux positif.

---

## 1.5 Réalité d'usage (prod, 2026-09-13, lecture seule)

| Mesure | Valeur |
|---|---|
| Orgs actives | 5 |
| Règles | 175 = 35 presets × 5 orgs, **175 actives**, 0 personnalisée, 0 org avec tout désactivé |
| Orgs ayant déjà eu une exécution | 2 sur 5 |
| Exécutions journalisées | 249 (219 succès, 30 échecs) du 2026-07-03 au 2026-09-13 ; 50 sur les 30 derniers jours |
| Par déclencheur | `appointment.created` 118 (114 ok), `lead.created` 99 (77 ok), `job.completed` 26 (22 ok), `invoice.sent` 2, `invoice.paid` 2, `agreement.signed` 2 |
| Par action | `log_activity` 91/91, `send_sms` 71/76, `send_email` 42/49, `create_notification` 11/26, `create_task` 3/4, `request_review` 1/3 |
| Presets ayant déjà tourné | 19 sur 35 (surtout confirmation/rappels de RDV, bienvenue et relances de lead) |
| Presets **jamais exécutés** | 16 : toutes les relances de devis (1 j à 21 j), `estimate_followup`, relances de facture 7/14/30 j, dépôt (rappel, suivi), `no_show_followup`, `lost_lead_reengagement`, `reengagement_90d`, `seasonal_reminder_6m`, `client_anniversary` |
| File | 180 pending (plus proche 2026-09-14, plus lointaine 2027-08-03), 0 en retard, 152 completed, 332 cancelled (322 sans motif = conditions d'arrêt ; 8 « doublon résorbé » ; 2 « rendez-vous déplacé »), 9 failed (max 1 tentative : antérieures au mécanisme de reprise) |
| Erreurs (toutes, datées) | `null value in column "message" of relation "notifications"` ×15 (03-07 juillet, corrigé depuis : la colonne a un défaut), `SMTP not configured` ×6 (juillet), `Invalid 'To' Phone Number: 555555XXXX` ×4 (données de test), `Review requests are disabled` ×2 (août), `Could not find the 'entity_id' column of 'tasks'` ×1 (17 juillet, corrigé), `No recipient email/phone` ×2 |
| `activity_log` | 941 lignes, 93 sur 30 jours |
| `automations` (héritée) | 0 ligne |
| `notifications` type automation | requête non retenue (non nécessaire) |

Lecture : le moteur **fonctionne en prod pour les rendez-vous et les leads**, avec un taux d'échec de 12 % sur l'historique, essentiellement des erreurs de configuration ou de schéma aujourd'hui corrigées. Les chaînes devis/facture/dépôt n'ont **jamais été vues partir en prod** : elles sont armées (10 + 8 + 6 + 3 tâches de relance de devis en attente, 10 + 6 + 2 de facture) mais aucune n'a encore atteint son échéance avec succès. Le premier client réel qui recevra une relance de devis à J+3 la recevra sans que personne ne l'ait jamais observée en production.

Ce qui n'est **pas mesurable** aujourd'hui : le nombre d'événements émis (seulement `activity_log`, sans lien avec les règles), les règles qui ont matché sans rien planifier, les envois immédiats perdus sur crash, les doublons d'envois immédiats (aucune clé), le coût SMS par org (les lignes `messages` d'automatisation sont identifiables par `sender_user_id is null` mais jamais agrégées).

---

## 1.6 Dette et zones mortes

1. **Vieux planificateur par polling** : `scheduler.ts:684-762` interroge `automations` (0 ligne) toutes les 5 minutes et embarque 5 handlers (`handleDaysAfterQuoteSent` lit… `invoices`, `handleDaysBeforeAppointment` lit `start_time`), la dédup `hasFired` par `notifications`, `sendOrgSms`. Code exécuté, jamais utile, **deuxième implémentation** du même besoin (R12).
2. **Fonctions SQL trigger orphelines** : `automation_job_completed()` (schéma périmé, table `automation_executions` inexistante) et `automation_lead_stage_change()` — présentes, non attachées, `GRANT service_role`. Troisième implémentation (SQL) jamais retirée.
3. **Types d'événements déclarés jamais émis** (9) et **émis jamais écoutés** (7), voir §1.4. `invoice.overdue` mobilise une détection complète chaque tick pour rien.
4. **`TRIGGER_DISPLAY`** affiche `job.scheduled` et `payment.received` (inexistants) et ignore `agreement.signed` (existant).
5. **`automation-test.ts:253`** vérifie un format de clé abandonné (`…:date`) ; `expectedPresets` (`:62-73`) ne couvre que 18 des 35 presets.
6. **`config.to`** des actions SMS/courriel : chemin implémenté (`actions/index.ts:441,538`), non exposé par l'interface, non validé — un destinataire arbitraire.
7. **Doublon de journal** : 34 presets sur 35 finissent par une action `log_activity`, alors que `eventBus.emit` a déjà écrit l'événement dans `activity_log`. Deux lignes d'activité par déclenchement, vocabulaire différent.
8. **`create_notification` sans `user_id`** : notification « d'org » ; 15 échecs historiques sur `message NOT NULL` montrent que l'insert ne suivait pas le schéma.
9. **`send_notification`** : alias conservé pour des workflows d'une table supprimée (`20260901170000_retrait_table_workflows.sql`).
10. **Dédup en mémoire** de `detectOverdueInvoices` et `expireOverdueQuotes` (`hasFiredLocal`) : réinitialisée à chaque déploiement ; inoffensif tant que personne n'écoute `invoice.overdue`.
11. **Tests unitaires qui recopient le code** : `tests/automation/automation-engine.test.ts:11-40` redéfinit `evaluateConditions`, `buildExecutionKey`, `delayToSeconds` au lieu de les importer ; `actions.test.ts:9` redéfinit `resolveTemplate`. Ces tests passent quel que soit l'état du moteur.
12. **Migrations empilées** (24 fichiers `*automation*`/`*workflow*`), plusieurs seeds successifs (`20260325200000`, `20260331100000`, `20260401000000` dedup, `20260401200000`, `20260611000000` activate all, `20260717150000` fr, `20260753100000` canonique, `20260810140000` dedup tâches, `20260909180000` backfill en) : la source de vérité des presets est aujourd'hui `automationPresets.data.ts` **et** `seed_automation_presets()` SQL, qui ont déjà divergé une fois (commentaire d'en-tête du seeder).
13. **Aucune purge** de `automation_execution_logs`, `automation_scheduled_tasks` (completed/cancelled) ni `activity_log`.
14. Scripts d'outillage hors app : `scripts/test-workflows.ts`, `scripts/seed-optional-workflows.cjs`, `scripts/apply-quotes-status-workflow.ts`, `scripts/backfill-automation-en.ts` — à vérifier en Phase 2 s'ils ciblent encore des tables existantes.

---

## 1.7 Trous de connaissance

| Ce que je n'ai pas pu établir | Ce qu'il faudrait |
|---|---|
| Fuseau horaire du processus Node sur Railway (aucun `TZ` dans `Dockerfile` ni `server/index.ts`). Si UTC, `appointment_date`/`appointment_time` dans les SMS de rappel sont en UTC (un RDV à 9 h Montréal s'écrit « 13:00 »). | Lire la variable `TZ` du service Railway, ou un SMS de rappel réellement reçu, ou un `result_data`/`messages.message_text` de prod contenant `appointment_time` (requête lecture seule ciblée). |
| Nombre d'instances du serveur (l'advisory lock protège le tick ; les actions immédiates n'ont aucun verrou, donc N instances qui reçoivent le même hook = N envois si le client rejoue). | Config Railway (replicas). |
| Taux réel de double émission côté client (`jobsApi.syncJobSchedule` + `scheduleApi.scheduleUnscheduledJob` peuvent-ils tous deux émettre `appointment.created` pour la même visite ?). | Test navigateur ou instrumentation : compter les `activity_log appointment_created` par `entity_id` sur 30 jours (requête lecture seule, faisable en Phase 2). |
| Volume et coût SMS d'automatisation par org. | Agrégat `messages where sender_user_id is null` par org et mois (lecture seule). |
| Comportement au changement d'heure (`nextSendTime` pas à pas de 30 min, `resolveExecuteAt` en ms absolus) — pas de test, pas de mesure. | Tests T9 avec dates fixées (Phase 4). |
| Si `apply_automation_presets_fr()` et `seed_automation_presets()` SQL sont encore alignés avec `automationPresets.data.ts` (trois sources). | `db:diff` + comparaison textuelle (Phase 2, lecture seule). |
| Membres avec `memberships.status <> 'active'` : `has_org_membership` et la policy `automation_rules` testent-ils le statut ? (`current_org_ids()` non lu.) | Lire `current_org_ids()` et `has_org_membership(p_user, p_org)` dans `01_schema.sql`. |
| Ce que reçoit réellement un client sur le chemin `request_review` (courriel + SMS le même instant) en termes de plafond commercial (le tour immédiat n'est pas `commercial`, donc non plafonné). | Test d'intégration. |

---

## Constats à qualifier en Phase 2 (relevés en lecture, non classés)

Signalés ici parce que la mission demande de remonter immédiatement ce qui touche à l'isolation (R3/R4) ; la classification CRITIQUE/MAJEUR/MINEUR est le travail de `AUTOMATIONS_AUDIT.md`.

1. **Entité d'un autre tenant lisible par le moteur (R3).** `POST /api/automations/events/appointment-created|cancelled|rescheduled`, `invoice-paid`, `lead-created`, `lead-status-changed` acceptent un `eventId`/`invoiceId`/`leadId` du corps et l'émettent dans l'org de l'appelant **sans vérifier qu'il lui appartient** (`automation-events.ts:27-86, 424-476, 479-547` — seules les lectures de confort sont filtrées, l'émission ne l'est pas). En aval, `resolveEntityVariables` et `checkStopConditions` lisent `schedule_events`, `invoices`, `clients`, `jobs` **par `id` seul sous `service_role`**. Un membre de l'org A qui connaît l'UUID d'un rendez-vous de l'org B fait résoudre nom/téléphone/courriel du client de B et envoie le gabarit de A à ce client, depuis le numéro de A. `job-completed` et les deux routes `quote-*` sont protégées (lookup org-scopé bloquant, ou branche `quote` filtrée). Les UUID ne sont pas devinables, ce qui limite l'exploitation, pas le défaut.
2. **Moteur en `service_role` sans garde sur la résolution (R4)** : même racine que 1, mais aussi pour les événements internes — une erreur d'émetteur (mauvais `orgId`) ne serait rattrapée par rien.
3. **RLS d'écriture ouverte à tout membre** sur `automation_rules`, `automation_scheduled_tasks`, `automation_execution_logs` (§1.2) : un technicien peut, par PostgREST, activer une règle, y mettre un `config.to`, avancer une tâche, ou effacer les logs. L'interface le cache, la base non.
4. **Aucune idempotence des actions immédiates** (R5) : `executeRuleActions` n'a pas de clé ; un hook rejoué (double clic, retry réseau du `fetch` fire-and-forget, deux onglets, ré-émission après `rpc_schedule_job`) = double SMS. Seules les tâches différées ont `idx_scheduled_tasks_dedup`.
5. **Reprise non idempotente vis-à-vis du fournisseur** : `recupererTachesFigees` et le retry renvoient une action dont l'effet externe a peut-être déjà eu lieu (§1.3).
6. **Pas de kill switch** global ni par org, **pas de dry-run** (R9) ; `QA_REDIRECT_TO` est un détournement de recette.
7. **Pas de transaction** : `request_review` enchaîne 4 écritures + 2 envois ; `create_task` + `log_activity` d'une même règle sont indépendants ; demi-états possibles (R6).
8. **Traçabilité incomplète** (R8) : pas de version de règle, pas de conditions évaluées, pas de « non-match », pas d'acteur dans les logs d'exécution ; logs modifiables par les membres.
9. **`update_status` écrit un statut libre** sur `invoices`/`quotes`/`jobs` sans passer par les machines d'état (ex. facture « paid » sans paiement) — aucun preset ne l'utilise, mais le chemin est ouvert.
10. **Fuseau** : `todayDateString()` (scheduler) et `detectOverdueInvoices` comptent les jours en UTC ; `automation_job_completed()` SQL en America/Toronto ; heures calmes en America/Toronto ; `appointment_date/time` sans fuseau. Trois conventions.
11. **Détection de changement** : aucun déclencheur ne distingue « sauvegardé » de « passé de A à B » (le hook client `syncJobSchedule` fait ce tri à la main, `jobsApi.ts:258-296`) ; `lead.status_changed` porte old/new mais rien ne l'exploite au-delà d'`eq`.
12. **Bulk** : N événements = N `handleEvent` séquentiels dans la requête ; `suppress_immediate` couvre seulement les visites en lot. Un import de 200 leads via `request-forms`/`leads.ts` = 200 `welcome_new_lead` immédiats (SMS + courriel), sans throttle autre que le plafond 3/24 h **par destinataire**.
13. **Ordre non déterministe** des règles (§1.3).
14. **16 presets jamais exécutés en prod** (§1.5) — les chaînes devis/facture sont en production sans jamais avoir été observées.
15. **Consentement** : SMS vérifie `sms_opt_outs` à l'exécution ✅ ; courriel vérifie `isEmailUnsubscribed` ✅ ; **aucune vérification de consentement initial** (CASL : consentement exprès ou tacite documenté) — l'existence d'un numéro suffit. `request_review` envoie SMS + courriel au même instant sans plafond (tour immédiat non `commercial`).
16. **Coût / abus** : plafond 3 messages commerciaux / destinataire / 24 h seulement ; aucun plafond par org, par règle, par jour ; boucle impossible aujourd'hui uniquement parce qu'aucune action n'émet d'événement (mais `update_status` sur `jobs` → `completed`… n'émet pas non plus, le trigger SQL étant orphelin). Le jour où une action émet, il n'y a ni profondeur max ni compteur.
17. **Route `quote-sent` / `quote-approved`** émettent avec `entityId: quoteId || ''` : une chaîne vide finit en `insert automation_scheduled_tasks(entity_id uuid)` → erreur 22P02 loggée, événement perdu.
18. **Test de dry-run périmé** (`automation-test.ts:253`).

Fin de la Phase 1. J'attends le go pour la Phase 2 (`AUTOMATIONS_AUDIT.md` + `SALESFORCE_GAP.md`).
