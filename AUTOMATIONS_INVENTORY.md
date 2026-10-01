# Inventaire des automatisations — Lume CRM

Généré le 2026-09-30, pour la mission « prouver que tout ce qui touche aux automatisations fonctionne ». **Source de vérité : le code** (commit 5487b250 + branche `qa/automatisations-suite`), pas l'interface ni les documents d'audit antérieurs. Chaque affirmation cite `fichier:ligne`. Abréviations : `E:` = `server/lib/automationEngine.ts`, `A:` = `server/lib/actions/index.ts`, `M:` = `server/lib/mailer.ts`. Les numéros de ligne peuvent être décalés de quelques lignes par les correctifs de la mission.

Les « bogues suspectés » listés ici sont des **pistes** relevées à la lecture. Chacune est confirmée ou écartée par un test de la suite `npm run test:automations` (voir `AUTOMATIONS_TEST_MATRIX.md` et le rapport final). Le statut réel est dans la matrice, pas ici.

## Table des matières
1. Écarts UI ↔ moteur
2. Partie 1 — Le moteur : déclencheurs, conditions, étapes de contrôle, variables, infrastructure (workers, crons, files, tables), cycle de vie, validation, fonctions pures
3. Partie 2 — Les actions et les chemins d'envoi : chaque action et ses écritures en base, envois sortants (texto, courriel, webhook), conformité, rendu des courriels, langue, plafonds, injection
4. Partie 3 — Les points d'entrée : API, interface, outils de Lumi, préréglages, systèmes adjacents (relances de paiement, factures récurrentes, jobs récurrents, rapports planifiés), permissions, tests existants

## Bac à sable des envois (ajouté par la mission)
`server/lib/bac-a-sable.ts` + tables `orgs_envois_simules` / `envois_simules` (migration 20261005100000, staging + prod). Une entreprise inscrite n'envoie rien : textos (enveloppe Twilio), courriels (`sendEmail`) et webhooks (`posterSansSsrf`) sont consignés. Second filet par destinataire (555-01xx, `lume-qa.test`, `.invalid`). **Hors couverture** : l'envoi par l'API Gmail d'un compte connecté (`server/lib/email/send/gmail.ts:72`, boîte de réception, jamais utilisé par une automatisation) et les courriels de Supabase Auth.

## Écarts UI ↔ moteur (vérifiés dans le code)
1. ⚠ (gravité moyenne : seulement par saisie manuelle — ni le générateur Lumi ni les presets/modèles n'écrivent ces clés dans une étape « si ») **Étape « si » + conditions d'étiquettes ignorées.** `evaluateConditions` saute `client_a_etiquette`/`client_sans_etiquette` (`automationEngine.ts:189`) car jugées par `conditionsEtiquettesOk` — appelé seulement pour le déclencheur (`:1131-1133`), PAS pour une étape « si » (`:1773-1781` n'appelle que `conditionsChampsOk`). Une ligne `client_a_etiquette = VIP` tapée dans l'étape « si » est donc toujours VRAIE → branche « alors » systématique.
2. ⚠ **Étape « si » sur un parcours de rendez-vous ou d'opportunité jugée sur l'état d'origine.** `metadonneesFraiches` ne relit que `quote|invoice|job|lead|client|appointment` (`automationEngine.ts:2146-2153`) ; or les RDV sont émis avec `entityType 'schedule_event'` (`automation-events.ts:104`, trigger SQL `20261003100000…sql:99,107`) et les opportunités avec `'deal'` (`pipelineEvenements.ts`, `rappels-dates.ts:214`) → `source[...]` indéfini ⇒ retour du contexte figé (`:2155-2156`), sans trace. `statut = cancelled` sur un RDV ne devient jamais vrai.
3. ⚠ **`client.inactive` : plafond fusionné par seuil.** Le balayage prend le MIN de `max_par_heure` des règles de même `mois` et le met dans les métadonnées (`client-inactif.ts:96-99,135`) ; le moteur compare chaque clé de `conditions` par égalité (`automationEngine.ts:250`) ⇒ une règle dont `max_par_heure` diffère du min (ou hors bornes 1..1000 / `mois` hors 1..60, bornage `client-inactif.ts:61-62`) ne se déclenche JAMAIS. Même mécanisme pour `date.reached` : `jours_avant` borné ±365 et tronqué (`rappels-dates.ts:60-65`) vs valeur brute dans `conditions` (ex. « 3.5 », « 400 »).
4. **Opérateurs** : moteur `eq,neq,in,not_in,gt,gte,lt,lte` (`automationEngine.ts:170`) ; UI « si » n'offre que 6 (`PanneauEtape.tsx:51`) — `in/not_in` sans UI (sauf valeurs liste des champs du déclencheur). Opérateur inconnu ⇒ règle refusée (`:211-217`).
5. **Actions moteur sans UI** : `update_status`, `log_activity`, alias `send_notification` (`actions/index.ts:3012-3023`) ; `log_activity` accepté dans les étapes mais non proposé (`validation.ts:1078-1092`, `sequenceTypes.ts:386`).
6. **Réglage `marquer_lu`** accepté par Zod, ignoré par le moteur (`validation.ts:1219-1228`, `automationEngine.ts:319-320`) — retiré de l'UI.
7. ⚠ **`updateRuleMessage` (front) ignore `steps`.** Écrit seulement `actions` en PostgREST direct (`automationRulesApi.ts:107-134`) ; le moteur exécute `steps` quand ils existent (`automationEngine.ts:1188`). Depuis Réglages › Messagerie/Avis, modifier le texte d'un préréglage CONVERTI en parcours (ou d'un pack `pack_*`) répond « enregistré » et le client reçoit l'ancien texte. (L'outil Lumi équivalent a été corrigé : `tools-reglages.ts:508-524`.) Ne détache pas non plus `modele_id` ni ne propage aux copies (contrairement à PATCH `automation-rules.ts:533,597`).
8. **Filet légal fenêtre** : `horsFenetre` ne s'applique qu'aux tâches DIFFÉRÉES de type message (`automationEngine.ts:1619`, `ACTIONS_MESSAGE :411`) ; une action immédiate part hors fenêtre (voulu : confirmations).
9. **Fuseau** : moteur = `company_settings.timezone` via `fuseauOrg` (`automationEngine.ts:1616-1618`) ; actions : repli `America/Toronto` (`actions/index.ts:226,1011`). OK.
10. **Ré-entrée** : UI `reentree` → clé d'exécution suffixée (`automationEngine.ts:264-290,759,1020,1203`) — branché.
11. **PATCH peut publier une règle en corbeille** : `problemesBloquants({...existante,...patch})` sans `deleted_at` (`automation-rules.ts:518,555-558`), alors que `changerPublication` le refuse (`automations-publication.ts:69-74`). Sans effet d'envoi (le moteur filtre `deleted_at` `automationEngine.ts:1095`), mais état incohérent (publiée + corbeille).
12. **Préréglages et forfait** : le moteur ne vérifie ni `includes_automations` ni l'abonnement (aucune occurrence dans `automationEngine.ts`) ; les presets sont semés ACTIFS pour toute org (voir §4) alors que l'UI et `/api/automations/pause` sont bloqués par `PlanFeatureGate`/`featureGuard` (`feature-guard.ts:67`). ⚠ Une org sans `includes_automations` reçoit des envois automatiques qu'elle ne peut ni voir, ni modifier, ni « Tout arrêter » (à confirmer contre les données `plans`).

---


---

# Partie 1 — Le moteur

## Inventaire du MOTEUR d'automatisations — Lume CRM

> Source : le CODE du worktree `wt-autotest` (HEAD `5487b250`, 2026-09-30). Chemins relatifs à la racine du dépôt. Chaque affirmation est citée `fichier:ligne`.
> `SCHEMA_SNAPSHOT.md` est daté du **2026-09-28** : les migrations `20261001…` à `20261004…` sont plus récentes que lui (voir §5.6).

### 0. Vue d'ensemble (chaîne d'exécution)

```
Émetteur (route, lib, trigger SQL, cron)
   └─ eventBus.emit(type, {orgId, entityType, entityId, metadata})       server/lib/eventBus.ts:213
        ├─ activity_log (journal)                                        eventBus.ts:291
        ├─ domain_events (outbox, sauf deal.*)                           eventBus.ts:325 / 187
        └─ écouteurs : automationEngine.handleEvent (onAnyEvent)         automationEngine.ts:2490
                        + d2d-pipeline-listener (5 types)                d2d-pipeline-listener.ts:21-90
handleEvent                                                              automationEngine.ts:1057
   ├─ kill switch AUTOMATIONS_ENABLED → pause org → réveil attentes « réponse »
   ├─ SELECT automation_rules (org, trigger_event, is_active, deleted_at null, ORDER created_at,id)
   └─ par règle : chaîne anti-boucle → portée pipeline → conditions (métadonnées) → champs perso
                  → étiquettes → délai entre passages → lancerRegle()     automationEngine.ts:1105-1155
lancerRegle                                                              automationEngine.ts:1182
   ├─ steps[] non vide → planifierEtape(1re étape)  (parcours, tout passe par la file)
   ├─ delay_seconds ≠ 0 → scheduleDelayedActions → automation_scheduled_tasks
   ├─ suppress_immediate → rien (visite en lot)
   └─ sinon executeRuleActions (immédiat, en ligne)
processScheduledTasks (tick 5 min, verrou « automation-scheduler »)      automationEngine.ts:1516 / scheduler.ts:744,923
```

---

### 1. DÉCLENCHEURS

#### 1.1 Trois listes qui ne coïncident pas

| Liste | Où | Contenu |
|---|---|---|
| `CRMEventType` (ce que le bus sait porter) | `server/lib/eventBus.ts:11-110` | 42 types |
| `EVENT_TO_ACTIVITY` (ce que `onAnyEvent` écoute) | `eventBus.ts:137-180`, `onAnyEvent` `eventBus.ts:387-392` | les 42 mêmes |
| **Catalogue offert** `DECLENCHEURS` / `CLES_DECLENCHEURS` (seuls acceptés à l'enregistrement) | `src/lib/automationCatalogue.ts:123-459`, `:484-490` ; validation `server/lib/validation.ts:773-776` | **29 clés** |

Filtres étiquettes `client_a_etiquette` / `client_sans_etiquette` ajoutés d'office à tous les déclencheurs sauf `webhook.received` et ceux qui ont déjà un champ `etiquette` (`automationCatalogue.ts:468-488`). Déclencheurs derrière un drapeau `org_features` : non offerts sans le drapeau (`declencheurOffert` `automationCatalogue.ts:98`, `catalogueOffert` `server/routes/automation-rules.ts:151-157`).

#### 1.2 Catalogue → points d'émission

`ENTITE_PAR_DECLENCHEUR` : `automationCatalogue.ts:1127-1161`. « base » = trigger SQL → `automation_evenements_base` → `traiterEvenementsBase` (15 s) → bus (`server/lib/evenementsBase.ts:115-190`, migration `supabase/migrations/20261003100000_evenements_automatisations_par_la_base.sql`).

| Clé (catalogue) | Entité émise | Émetteur(s) — `fichier:ligne` | Métadonnées utiles aux conditions | Réglages du déclencheur (dans `conditions`) |
|---|---|---|---|---|
| `quote.sent` | quote | `server/routes/quotes.ts:421` (courriel), `quotes.ts:575` (SMS), `server/lib/actions/index.ts:2969` (action `envoyer_soumission` sur brouillon), `server/routes/automation-events.ts:299` (route navigateur, **aucun appelant dans `src/`**) | `lead_id, channel, quote_number, client_name, origine` | — |
| `quote.viewed` | quote | `server/lib/vuesSoumission.ts:153` | `ouverture:['premiere','chaque']`, `is_first_view, view_count, total_cents, montant, pipeline_id, stage_id, etiquette:[…], service_id:[…]` (`vuesSoumission.ts:163-172`) | `ouverture` (défaut `premiere`), `montant__gte/__lte`, `service_id`, `stage_id`, `etiquette` (`automationCatalogue.ts:136-172`) |
| `quote.approved` | quote | **base** : `trg_automation_evenements_devis` (migration 20261003100000 l.148-174) | `quote_number, client_id, lead_id, origine:'base', evenement_base_id` | — |
| `quote.declined` | quote | **base** (même trigger) | idem | — |
| `quote.changes_requested` | quote | `server/routes/quotes.ts:1501` (page publique) | `quote_number, message` | — |
| `invoice.sent` | invoice | **base** `trg_automation_evenements_facture` (brouillon→envoyée ou INSERT déjà `sent`, migration l.179-201) ; renvoi : `server/routes/emails.ts:509` (si statut ≠ draft) ; `server/lib/recurringInvoicesEngine.ts:175` (auto_send) | `invoice_number, client_id, subject_sent, recurring_schedule_id…` | — |
| `invoice.paid` | invoice (**quote** pour un dépôt) | `server/lib/payments.ts:1025` ; `server/routes/invoice-mark-paid.ts:108` ; dépôt Stripe : `server/routes/payments.ts:373` (entityType **`quote`**, `payment_type:'deposit'`) | `payment_id, amount_cents, provider, client_id, job_id, payment_type` | — |
| `invoice.overdue` | invoice | `server/lib/scheduler.ts:676` (`detectOverdueInvoices`, paliers `OVERDUE_DAYS=[1,3,5,15,30]` `scheduler-utils.ts:63`, jour calculé dans le fuseau org `scheduler.ts:589-638`) | `invoice_number, days_overdue, due_date` | — |
| `payment.failed` (drapeau `auto_paiement_echoue`) | invoice | `server/lib/paiement-echoue.ts:150` (webhook Stripe `server/routes/payments.ts:71`) ; drapeau vérifié `paiement-echoue.ts:110` | `invoice_id, invoice_number, client_id, montant_cents, montant, raison_code, origine, payment_intent_id, stripe_event_id` | — |
| `invoice.viewed` (drapeau `auto_consultation_documents`) | invoice | `server/lib/vuesFacture.ts:85` | `ouverture[], is_first_view, view_count, total_cents, balance_cents, montant` | `ouverture` |
| `appointment.created` | **schedule_event** | **base** `trg_automation_evenements_visite` INSERT (migration l.85-121) ; re-émis par `server/routes/automation-events.ts:102` (route « appointment-rescheduled », appelée par le navigateur `src/lib/jobsApi.ts:300,304`, `src/lib/scheduleApi.ts:340`) | `job_id, client_id, start_time, title, origine`, `suppress_immediate` (ajouté par `enrichir` si visite en lot, `evenementsBase.ts:83-104`), `rescheduled:true` | accepte délai négatif (`automationCatalogue.ts:248`) |
| `appointment.cancelled` | schedule_event | **base** (UPDATE status→cancelled, clé `annulation:<txid>`) ; migration 20261003100010 (« retirer de l'horaire émet l'annulation ») | `job_id, client_id, start_time` | — |
| `job.completed` | job | **base** `trg_automation_evenements_job` (migration l.124-145) | `job_name, client_id, origine` | — |
| `job.ready_for_invoicing` | job | `server/routes/automation-events.ts:174` (route navigateur `src/lib/jobsApi.ts:1238`, **seulement si l'acteur est technicien**) | `job_name, client_*, technician_id` | — |
| `lead.created` | lead | `server/routes/leads.ts:153`, `server/routes/request-forms.ts:940` (`source:'request_form'`), `automation-events.ts:347` (route sans appelant `src/`) | `name/lead_name, email, phone, source, status` | — |
| `lead.status_changed` | lead | `server/routes/leads.ts:615`, `automation-events.ts:382` (sans appelant `src/`) | `old_status, new_status` | — |
| `client.replied` | client | SMS entrant `server/routes/messages.ts:637` (sauf réponses à Lumi) ; courriel `server/lib/email/sync/gmail.ts:262` | `canal, texte (≤500), conversation_id / email_message_id` | — |
| `client.tagged` / `client.untagged` | client | `server/lib/etiquettes.ts:41` (`annoncerEtiquette`), appelé par les actions (`actions/index.ts:2436,2463,2471`) et par la route `automation-events.ts:439-440` (navigateur `src/lib/etiquettesApi.ts:75,82`) | `tag, client_name, email, phone, chaine` | `tag` |
| `client.inactive` (drapeau `auto_client_inactif`) | client | `server/lib/client-inactif.ts:126`, balayage horaire `server/index.ts:1567-1577` (9 h-19 h fuseau org, réservation anti-doublon) | `client_id, mois, max_par_heure, periode, dernier_job_termine_at` | `mois` (oblig.), `max_par_heure` |
| `agreement.signed` | **job** | `server/routes/agreements.ts:606` | `agreement_id, signer_name, job_number` | — |
| `task.completed` | client | `automation-events.ts:514` (navigateur `src/lib/tasksApi.ts:198,232`) | (voir route) | — |
| `note.added` | client | `server/routes/activity-notes.ts:100` | `note_sur, texte (≤500)` | — |
| `webhook.received` | `automation_webhook_receipt` | `server/routes/webhooks-entrants.ts:234` | champs du JSON à plat (sauf `CHAMPS_RESERVES_MOTEUR` `:272-279`) + `corps, webhook, webhook_id, recu_le` | — |
| `date.reached` | client **ou deal** | `server/lib/rappels-dates.ts:212` (deal) / `:248` (client), balayage quotidien `POST /api/cron/rappels-dates` (`server/routes/cron.ts:94-104`) | `champ_id, jours_avant, date, jour` | `champ_id` (oblig.), `jours_avant` (-365..365) |
| `deal.stage_entered` | deal | trigger `trg_deals_emettre_evenements` (AFTER INSERT/UPDATE OF stage_id, `supabase/migrations/20260923100100_pipeline_moteur_et_forfait.sql:170-173` ; corps actuel `deals_emettre_evenements()` `20260925230000_pipelines_facon_ghl.sql:1308-1361`, court-circuité si GUC `lume.deplacement_administratif='on'`) → `pipeline_events` (clé `enter:<deal>:<stage>:<epoch stage_entered_at>`) → `traiterEvenementsPipeline` (`server/lib/pipelineEvenements.ts:264-336`, tick 5 min) | `deal_id, stage_id, from_stage_id, pipeline_id, source, utm_campaign, assigned_user_id` | `stage_id` |
| `deal.stage_idle` | deal | RPC `pipeline_detecter_stagnation()` à chaque tick (`pipelineEvenements.ts:350-359`, `scheduler.ts:775`), version `20261004200000_deal_sans_mouvement_regle_editeur.sql:18-72` : seuil `conditions->>'idle_days'` (défaut 7, **non exposé dans l'éditeur**), étape = colonne `stage_id` sinon `conditions.stage_id` ; clé `idle:<deal>:<rule>:<jours>:<stage>` | `deal_id, stage_id, pipeline_id, source, utm_campaign, assigned_user_id, idle_days, rule_id` | `stage_id` |
| `custom_field.changed` | objet du champ (client/deal/job/quote/invoice) | `server/lib/champs/service.ts:487` (seulement si valeur réellement changée et `source !== 'automation'`, `service.ts:475`) | `field_id, field_key, field_label, object_type, old_value, new_value, source` | (le champ visé → `field_id`) |

#### 1.3 Émis mais ABSENTS du catalogue (non créables par l'éditeur ; les préréglages peuvent les porter)

| Type | Émetteur | Remarque |
|---|---|---|
| `estimate.sent` | `server/routes/emails.ts:640` (`/emails/send-quote`, ancienne table « devis dans invoices », aucun appelant trouvé dans `src/`) | écouté par le préréglage `estimate_followup` (`server/lib/automationPresets.data.ts:328`) |
| `lead.converted` | `server/routes/leads.ts:734` | — |
| `job.created` | `server/routes/leads.ts:750` | écouté par `d2d-pipeline-listener.ts:68` |
| `pipeline_deal.stage_changed` | `server/routes/automation-events.ts:266` (navigateur `src/lib/pipelineApi.ts:398,452`) | ancien pipeline porte-à-porte |
| `deal.stage_exited` | trigger → `pipeline_events` (CHECK `pipeline_events_type_connu`, SCHEMA_SNAPSHOT.md:9317) | aucun déclencheur catalogue |

#### 1.4 Déclarés au bus mais JAMAIS émis (morts)

`lead.updated`, `client.archived`, `client.deleted`, `estimate.accepted`, `estimate.rejected`, `quote.created` (pourtant écouté par `d2d-pipeline-listener.ts:21`), `quote.converted`, `appointment.updated`, `invoice.created` (`eventBus.ts:13,23-24,26-28,37,44,49`). Aucun `emit` correspondant (grep `eventBus.emit` sur `server/`). Aucun n'est au catalogue → pas de règle utilisateur morte, mais l'écouteur D2D `quote.created` ne se déclenche jamais.

#### 1.5 Déclencheurs temporels

| Mécanisme | Où | Détail |
|---|---|---|
| Délai positif d'une règle simple | `resolveExecuteAt` `automationEngine.ts:917-983` | `now + delay_seconds` |
| Délai **négatif** (« X avant ») | `automationEngine.ts:924-979` | seulement `entityType` `schedule_event`/`appointment` ; lit `schedule_events.start_at/start_time` ; correction heure d'été `corrigerChangementDHeure` (`:390`) ; créneau dépassé > 30 min (`RETARD_TOLERE_MS` `:899`) → abandon ; retard ≤ 30 min → dans 5 s ; sans date → rien planifié + journal `saute_code:'date_absente'` (`:986-1003`). Route : délai négatif refusé si le déclencheur n'a pas `accepte_delai_negatif` (`server/routes/automation-rules.ts:83-96`) |
| Attente `avant_date` d'un parcours | `planifierEtape` `server/lib/automationSequences.ts:369-385`, échéance `echeanceAvantDate` `:487-542` | date relue à l'échéance : annulé → fin ; déplacé plus tard (> 2 min) → replanifié ; dépassé (+30 min) → `si_depasse` ; sinon `suivant` |
| Attente `reponse` | `automationSequences.ts:394-396`, `automationEngine.ts:1819-1856`, réveil `reveillerAttentesReponse` `automationEngine.ts:2280-2310` | échéance = plafond ; réveillée par `client.replied` (`:1074-1076`) |
| Facture en retard J+1/3/5/15/30 | `scheduler.ts:593-687` | anti-doublon durable = `activity_log` (`event_type='invoice_overdue'` + `days_overdue`) + index unique `20261001100000_activity_log_retard_unique.sql` (émission « journal d'abord », `eventBus.ts:201,219-221`) |
| Date de champ perso | `rappels-dates.ts:75-273` | quotidien, fuseau **figé** `America/Toronto` (`rappels-dates.ts:33`) |
| Client inactif | `client-inactif.ts:77-165` | horaire, 9 h-19 h fuseau org |
| Opportunité qui dort | RPC `pipeline_detecter_stagnation` | tick 5 min |
| Rendez-vous déplacé | `automation-events.ts:52-120` | annule TOUTES les tâches `pending` de l'entité puis ré-émet `appointment.created` (confirmation renvoyée volontairement) — dépend d'un appel **navigateur** |

---

### 2. CONDITIONS

#### 2.1 Évaluateur principal — `evaluateConditions(conditions, event): boolean`

`server/lib/automationEngine.ts:177-254` — **exporté, pur** (aucune E/S ; seulement `console.warn`). Aides internes non exportées : `memeValeur` (`:110-124`), `versNombreComparable` (`:138-152`), `comparer` (`:157-167`), `OPERATEURS_CONNUS` (`:170`). Réutilisé par `couvertureAutomatisations` (`server/routes/reminders-cron.ts:213`) et par l'étape `si` (`automationEngine.ts:1773`).

| Aspect | Comportement | Ligne |
|---|---|---|
| Conditions vides / null | `true` | `:181` |
| Clé `champs_perso` | ignorée ici (jugée par `conditionsChampsOk`) | `:187` |
| Clés `client_a_etiquette`, `client_sans_etiquette` | ignorées ici (jugées par `conditionsEtiquettesOk`) | `:189` |
| Valeur attendue `''`, `null`, `undefined` | **ignorée** (= pas de filtre) | `:192` |
| Suffixe `cle__gt/gte/lt/lte` | converti en `{op: valeur}` sur `cle` | `:199-201` |
| Source de la valeur réelle | `event.metadata[key]` (niveau 1 seulement, pas de chemin pointé) | `:202` |
| Valeur scalaire | égalité `memeValeur` | `:248-251` |
| Objet d'opérateurs | `eq, neq, in, not_in, gt, gte, lt, lte` ; **tout autre opérateur → `false`** (règle refusée) + warn | `:205-217` |
| `eq`/`neq` | `memeValeur` | `:219-220` |
| `in`/`not_in` | ignorés si la valeur n'est pas un tableau ; sinon `some(memeValeur)` | `:221-224` |
| `gt/gte/lt/lte` | nombre d'abord (`/^-?\d+(\.\d+)?$/`), sinon `Date.parse` ; incomparable (null, `''`, texte, objet) → **`false`** | `:138-167`, `:236-247` |
| Opérateurs combinés | ET logique (tous doivent passer) ; conditions entre clés = ET | — |

`memeValeur(a, b)` : `a === b` ; **si `a` (métadonnée) est un tableau → vrai si UN élément correspond** ; `null/undefined` ≠ tout (sauf identité stricte) ; objets → faux ; sinon comparaison en **chaîne** (`3 == "3"`, `true == "true"`) ; sensible à la casse ; pas de trim.

Types gérés : texte (égalité exacte, casse comprise — **pas de `contains`**), nombre (chaîne numérique ou number), date ISO (comparaisons), booléen (via chaîne), liste (métadonnée tableau = « contient »). Pas d'opérateur « vide / non vide », pas de « contient ».

#### 2.2 Ce que la validation accepte (écart avec l'évaluateur)

- Zod `conditionsAutomatisation` : `server/lib/validation.ts:1033-1067` — valeur scalaire `string(≤200)|number|boolean`, ou objet strict `{eq,neq,in,not_in,gt,gte,lt,lte}` non vide, ou tableau **seulement sous `champs_perso`** (≤10 conditions `conditionChampSchema` `:1023-1031`) ; ≤ 10 clés.
- `OPERATEURS_CONDITIONS = ['eq','neq','in','not_in']` (`src/lib/automationCatalogue.ts:1291`) — **ne liste pas `gt/gte/lt/lte`** que le moteur et Zod acceptent (commentaire « ATTENTION » `:1283-1290` périmé).

#### 2.3 Champs personnalisés — `conditionsChampsOk` / `CLE_CONDITIONS_CHAMPS = 'champs_perso'`

`conditionsChampsOk(supabase, orgId, entityType, entityId, conditions: unknown): Promise<boolean>` — `server/lib/champs/automatisations.ts:40-63` (clé `:21`). Évalue les **valeurs actuelles** en base (pas les métadonnées), en ET logique.

- `conditions` absent / non-tableau / vide → **vrai** sans lecture (`:43`).
- `objetDeLEntite(entityType)` (`:24-33`, pur : client/lead→client, deal, job, quote/estimate→quote, invoice ; sinon `null`) nul → **faux** (rendez-vous, webhook, `pipeline_deal`…).
- Lit tous les champs de l'objet **y compris archivés** (`:47`), les valeurs de l'entité (`:48`), le fuseau `company_settings.timezone` (repli Toronto).
- `field_id` qui n'est pas un id de champ perso → **faux** (`:52-53`) — une clé de champ standard (annoncée par le type `Condition`, `src/lib/champs/filtres.ts:29`) est donc toujours fausse.
- Toute erreur (lecture, opérateur hors famille, valeur manquante) → journalisée, **faux** (`:57-62`).

Évaluateur pur `evaluerCondition(type, valeur, c, ctx?)` — `src/lib/champs/filtres.ts:174-258` (`ctx.maintenant` injectable) ; `evaluerConditions` `:261-271` ; familles `familleDuType` `:40-47`, opérateurs par famille `:49-58` (opérateur hors famille → **lève**).

| Famille | Types de champ | Opérateurs | Vide / null |
|---|---|---|---|
| toutes | — | `is_empty`, `is_not_empty` | vide = `null/undefined/''/[]` (`:148-149`) |
| case | checkbox | `is` (true/'true'/false/'false', sinon lève) | jamais remplie = non cochée (`:182-187`) |
| texte | single_line, multi_line, email, url, phone | `is, is_not, contains, not_contains` | normalisé trim + espaces + minuscules (`:152-154`), téléphone → E.164 (`:158-166`) ; vide : `is`/`contains` faux, `is_not`/`not_contains` vrai |
| nombre | number, monetary (cents) | `eq, neq, gt, lt, between` (bornes incluses) | `c.value` non numérique → lève ; valeur vide : tout faux sauf `neq` vrai |
| liste | dropdown_single, dropdown_multi | `any_of, none_of` (par id) | aucune cible → lève ; vide : `any_of` faux, `none_of` vrai |
| date | date (± heure) | `today, yesterday, in_last, more_than_ago, less_than_ago, before, after, between` | **vide → toujours faux** (`:230`) ; heure murale du fuseau (`:96-108`) ; `before/after/between` exigent `AAAA-MM-JJ` |
| fichier | file | `is_empty, is_not_empty` | — |

Zod : `conditionChampSchema` `server/lib/validation.ts:1023-1031` (`value`, `value2`, `n` 0-3650, `unit` days/weeks/months).

#### 2.4 Étiquettes — `conditionsEtiquettesOk(admin, clientIdFn, conditions)`

`server/lib/etiquettes.ts:65-86` : sans filtre → vrai sans lecture ; fiche sans client → **faux** ; lecture `client_tags` en échec → **faux** (le message dit « règle retenue », elle est en fait écartée) ; une seule étiquette par clé, insensible à la casse, trim ; lecture `client_tags` **sans filtre `org_id`** (`:77`). Le client vient de `clientDeLEntite` (`server/lib/actions/index.ts:~2340`). **Non appelée pour les étapes `si`** (voir bogues).

#### 2.5 Autres filtres appliqués par `handleEvent` (dans l'ordre, `automationEngine.ts:1117-1141`)

1. `event.reglesTraitees.includes(rule.id)` (rejeu outbox) → sauté.
2. `regleDansLaChaine(metadata, rule.id)` (`etiquettes.ts:89-92`) : chaîne ≥ `CHAINE_MAX=5` ou règle déjà dans la chaîne → sauté.
3. `regleViseCetEvenement(rule, event)` (`automationEngine.ts:79-85`, **exporté pur**) : seulement pour `deal.*`, compare les COLONNES `rule.pipeline_id/stage_id` à `metadata.pipeline_id/stage_id` ; métadonnée absente → passe.
4. `evaluateConditions`.
5. `conditionsChampsOk` (async, DB).
6. `conditionsEtiquettesOk` (async, DB).
7. `settings.delai_entre_passages_jours` → `dejaPasseRecemment` (`:1280-1300`) : journaux + tâches de CETTE règle pour CETTE entité depuis N jours ; lecture ratée → passe.

Étape `si` d'un parcours : `evaluateConditions` sur `metadonneesFraiches` (relecture `quotes/invoices/jobs/clients/schedule_events`, alias `statut`, `montant = total_cents/100`, `statutAvecAlias` quote `awaiting_response→sent`, `converted→approved`, invoice `sent/partial→unpaid`) + `conditionsChampsOk` (`automationEngine.ts:1766-1805`, `:2133-2206`).

---

### 3. ÉTAPES DE CONTRÔLE

#### 3.1 Délais et attentes

| Élément | Unités / bornes | Où |
|---|---|---|
| `delay_seconds` (règle simple) | entier, `-30 j … +366 j` | `validation.ts:1246-1250`, constantes `automationCatalogue.ts:1250-1253` |
| `attendre` `duree` | `delai_secondes` 0 … 366 j ; attentes consécutives **cumulées** dans la tâche suivante | `validation.ts:1110-1136`, `automationSequences.ts:342-351` |
| `attendre` `reponse` | plafond `delai_secondes`, suites `si_reponse` / `suivant` | `automationSequences.ts:57-98` |
| `attendre` `avant_date` | `secondes_avant` 0 … 30 j, `si_depasse` | `validation.ts:1131-1135` |
| `delayToSeconds(value, unit)` | minutes/hours/days | `automationEngine.ts:1049-1055` — **code mort (jamais appelé)** |

#### 3.2 Branches, arrêt, graphe

- Types d'étape : `action | attendre | si | arreter` (`automationSequences.ts:39-113`). `si` → `alors`/`sinon` (`etapeSuivante` `:550-554`). `arreter` → fin.
- Parcours joué **une étape à la fois** ; rien n'est planifié d'avance (`planifierEtape` `:324-473`). La 1re étape (même une action « immédiate ») passe par la **file** → exécutée au tick suivant (≤ 5 min).
- Validation du graphe `problemesDuGraphe(steps): string[]` (`:213-263`, **pur**) : ids uniques, renvois existants (`suivant, alors, sinon, si_reponse, si_depasse`), **aucun cycle** (DFS), pas de fin sur attente sans `suivant`.
- Bornes d'exécution : `ETAPES_MAX_PAR_PARCOURS = 50` (compteur `franchies` dans `sequence_context`, `:122`, `:355-360`) ; 50 sauts d'attentes (`:345`). Zod : ≤ 30 étapes (`validation.ts:1163`).
- Visite en lot (`suppress_immediate`) : parcours démarré à `premiereEtapeSansConfirmation` (`automationSequences.ts:156-164`) ; règle simple immédiate supprimée (`automationEngine.ts:1216-1223`).
- `annulerSequence` (`automationSequences.ts:564-585`) : exportée, **jamais appelée**.

#### 3.3 Sortie / conditions d'arrêt (avant chaque tâche différée)

1. `motifAnnulationRegle(regle)` (`automationEngine.ts:1265-1270`, **pur**) : règle `deleted_at` → annulée ; `is_active=false` → annulée (`:1573-1586`).
2. Étape supprimée du parcours → annulée (`:1594-1604`).
3. Drapeau `auto_sortie_parcours` ON → `verdictSortie` (`server/lib/sortie-parcours.ts:115-190`) ; sinon (ou verdict `null`) → `checkStopConditions` (`automationEngine.ts:2360-2479`).
   - `FAMILLE_PAR_DECLENCHEUR` (`sortie-parcours.ts:36-42`), case `settings.arreter_si_resolu` (`sortieCochee` `:57-63`, défauts `:45-50` : soumission/facture/rendez-vous = vrai, opportunité = faux), `DECLENCHE_PAR_RESOLUTION` (`:99-105`) empêche d'arrêter une règle déclenchée par la résolution elle-même.
   - `checkStopConditions` (ancien) : facture `paid/cancelled/void` ou client supprimé ; `estimate.sent` ; rendez-vous annulé/supprimé ; devis `approved/declined/changes_requested/expired/converted/archived/void` ; lead ≠ `lead` ou `lead_status` fermé (exception `lost_lead_reengagement` `:2469-2475`). **Lecture en erreur → ne conclut rien (tâche gardée)**.
4. `settings.arret_sur_reponse` → `clientARepondu` (messages entrants SMS + courriels entrants des boîtes connectées depuis `task.created_at`, `:2312-2358`) pour `send_sms/send_email/request_review` (`:1733-1738`).

#### 3.4 Fenêtre d'envoi / heures calmes / fuseau

| Élément | Valeur | Où |
|---|---|---|
| Fenêtre par défaut | 8 h ≤ h < 20 h | `automationEngine.ts:304-305` |
| Réglable | `settings.fenetre {debut,fin}` bornée 7 h-22 h, `debut<fin` ; `jours_ouvrables` (sam/dim exclus) | `validation.ts:1184-1212`, `horsFenetre` `automationEngine.ts:345-362` (**exporté pur**) |
| Qui la respecte (immédiat) | `shouldRespectQuietHours` (`:413-426`, non exporté) : SMS et `request_review` toujours ; tout message si fenêtre/jours ouvrables réglés ; sinon seulement si `delay_seconds ≠ 0` | `ACTIONS_MESSAGE` `:411` |
| Qui la respecte (file) | TOUTE action message (`send_sms, send_email, request_review, envoyer_facture, envoyer_soumission`) | `:1619` |
| Report | `nextSendTime(from, reglages, tz)` pas de 30 min, max 24 h (72 h si jours ouvrables), sinon renvoie `from` | `:429-443` (**exporté pur**) |
| Rappel périmé | si la prochaine fenêtre tombe après `event_metadata.start_time/start_at` → annulé | `:1632-1649` |
| Fuseau | `company_settings.timezone` via `fuseauOrg` (cache 5 min, repli `America/Toronto`, fuseau invalide → repli) | `server/lib/automations-fuseau-org.ts:31-98` |
| `isQuietHours(d, tz)` | exporté pur | `automationEngine.ts:330-333` |

#### 3.5 Ré-entrée, idempotence, anti-doublon

| Mécanisme | Détail | Où |
|---|---|---|
| Clé de tâche | `ruleId:entityId:actionIndex` (sans date) ; `settings.reentree` ajoute un suffixe aléatoire | `buildExecutionKey` `automationEngine.ts:264-290` (non exporté) |
| Clé d'étape | `ruleId:entityId:step:<stepId>[:passage]` | `cleEtape` `automationSequences.ts:184-187` (**exporté pur**) |
| Index unique tâches | `idx_scheduled_tasks_dedup (org_id, execution_key) WHERE status IN (pending,running)` | `supabase/migrations/20260751100300_uniques_org_scope_and_soft_delete.sql:145-148` |
| Actions immédiates | réservation `automation_execution_logs.execution_key = base@tranche2min`, index `idx_execution_logs_immediat_dedup` (partiel `scheduled_task_id IS NULL`) ; + regard sur la tranche précédente ; rejeu outbox → pas refaite si réussie/en cours depuis `rejoueDepuis` | `reserverActionImmediate` `automationEngine.ts:592-671`, migration `20260923180000_idempotence_actions_immediates.sql:41-43` |
| Règle déjà traitée pour un événement | `domain_events.regles_traitees` | `noterRegleTraitee` `server/lib/outbox.ts:170-187` |
| Une relance de facture / jour, toutes règles | `estRegleDeRelanceFacture` (pur) + `relanceFactureDejaPartie` (20 h) | `automationEngine.ts:544-583`, usages `:812-821`, `:1889-1902` |
| Idempotence d'envoi en reprise | `ctx.dejaEnvoyeDepuis`, `ctx.cleIdempotence = taskId:stepId` | `:1932-1933` |
| Délai entre passages | `settings.delai_entre_passages_jours` 1-365 | `validation.ts:1218`, `:1280-1300` |

#### 3.6 Anti-boucle

| Chemin | Garde | Où |
|---|---|---|
| Étiquette posée/retirée par une action | `chaine` (règles ancêtres) propagée, `CHAINE_MAX=5`, règle déjà dans la chaîne sautée | `etiquettes.ts:20,89-92`, `actions/index.ts:2401-2403` |
| `demarrer_automatisation` | chaîne + `PROFONDEUR_MAX_DEMARRAGE` | `actions/index.ts:2823-2861` ; éditeur exclut la règle elle-même `automation-rules.ts:195-196` |
| `update_custom_field` | pas d'événement si `source === 'automation'` | `champs/service.ts:475` |
| Parcours cyclique | refus Zod + borne 50 étapes | §3.2 |
| `move_deal_stage` → `deal.stage_entered` (trigger SQL) | **aucune chaîne** (métadonnées issues de `pipeline_events`) | voir bogues |
| Chaîne injectée de l'extérieur | clés réservées retirées du JSON webhook | `webhooks-entrants.ts:272-279` |

#### 3.7 Plafonds / débit

- Étalement SMS : > `DEBIT_SMS_PAR_MINUTE = 30` textos réussis/min/org → report d'1 min (`automationEngine.ts:516-531`, `:791-810`, `:1882-1887`). Pas un plafond.
- `client.inactive` : `max_par_heure` (défaut 25) (`client-inactif.ts:45,59`).
- Plafond de fréquence / consentement : dans les actions (voir §4) ; codes non réessayables `isTransientFailure` (`automationEngine.ts:1360-1384`, **exporté pur**).
- 5 actions max par règle simple, 20 bornes dures, 30 étapes (`validation.ts:1257-1311`, `ACTIONS_MAX` `automationCatalogue.ts:1279`).

#### 3.8 Interrupteurs

| Interrupteur | Effet | Où |
|---|---|---|
| `AUTOMATIONS_ENABLED` = `false/0/off/no` | `handleEvent` et `processScheduledTasks` sortent immédiatement ; file intacte ; **les événements reçus pendant l'arrêt sont perdus** (l'outbox les coche traités car l'écouteur ne lève pas) | `automations-interrupteur.ts:231-251`, `automationEngine.ts:1062,1521` |
| « Tout arrêter » (`company_settings.automations_paused`) | cache 15 s ; événements ignorés (perdus aussi) ; tâches laissées `pending` | `automations-pause-org.ts:313-342`, `automationEngine.ts:1070,1559`, route `automation-rules.ts:1054-1118` (+ `oublierPause`) |
| Drapeaux `org_features` | `auto_desabonnement_canal, auto_sortie_parcours, auto_consultation_documents, auto_paiement_echoue, auto_client_inactif` ; cache 30 s ; lecture ratée = OFF | `automations-drapeaux.ts:469-518` |
| **Non couverts** par les deux interrupteurs | cron `payment-reminders` (`reminders-cron.ts:291`), ancienne table `automations` (`scheduler.ts:820-858`), factures récurrentes (`scheduler.ts:747`, `cron.ts:69`), expiration de devis | voir bogues |

---

### 4. VARIABLES / CHAMPS DE FUSION

Alias : `A` = `server/lib/actions/index.ts`.

#### 4.1 Rendu — `resolveTemplate(template, vars, options?: {html?}) : string` (`A:557-579`, **exporté pur**)

- UNE passe, regex `/\{\{\s*([a-z]+)\.([a-z][a-z0-9_]*)\s*\}\}|\{(\w+)\}|\[(\w+)\]/g` (`A:569-570`).
- Syntaxes : `{{objet.cle}}` → `vars['objet.cle'] ?? vars['objet_cf_cle']` (intégrées pointées AVANT champs perso, `A:575`) ; `{cle}` ; `[cle]` (`\w+`, chiffres acceptés).
- Variable inconnue/absente → **chaîne vide** (`A:563`). Aucune syntaxe de défaut (`{{x|défaut}}` n'existe pas).
- Échappement HTML (`echapperHtml` `A:546-548` : `& < > " '`) seulement si `html:true` ET clé ne finissant pas par `_html`. `html:true` n'est passé que pour le **corps** de `send_email` (`A:1173`) et le gabarit `review_request` (`A:1991`). Objet, `from_name` (retire `<>"`), `reply_to`, pré-en-tête (retire `<>`) : non échappés (`A:1172,1295-1314`). SMS, notifications, tâches, notes : texte brut.
- Post-traitements : `sansPrenomVide` (`A:525-531`, courriel seulement), `accorderPluriels` (`A:538-544`, notifications), `avecMentionCommerciale` (`server/lib/desabonnement/mention-sms.ts:44-56`, SMS commerciaux/sollicitations).
- Variantes localisées : `champLocalise` lit `<champ>_en` si la langue de l'org est `en` (`A:183-189`).
- Autres moteurs de rendu (divergents) : `applyTemplate` (`server/lib/notificationHelpers.ts:354-373`, inconnues CONSERVÉES, `hasOwnProperty`) — utilisé par l'ancien scheduler / routes, pas par les actions ; `resolveReviewTemplate` (`server/lib/reviews.ts:148-152`, deux passes) ; aperçus `remplacerVariables` (`src/lib/emailBodyText.ts:174-181`) et `remplacerParExemples` (`src/lib/variablesCourriel.ts:109-123`) ; détecteur éditeur `variablesInconnues` (`src/lib/emailBodyText.ts:236-249`).

#### 4.2 `resolveEntityVariables(supabase, orgId, entityType, entityId): Promise<Record<string,string>>` (`A:690-1067`)

Appelée une fois par événement (WeakMap, copie par règle, `automationEngine.ts:707-718`) et une fois par tâche (`automationEngine.ts:1904`).

| Groupe | Clés | Où / remarques |
|---|---|---|
| Entreprise | `company_name` (repli `orgs.name`), `company_phone`, `google_review_url`, `facebook_review_url`, `review_page_url` | `A:699-732` ; absentes si pas de ligne `company_settings` |
| Client (`setClientVars`) | `client_first_name` (repli company / nom complet), `client_last_name`, `client_name`, `client_email` (= **destinataire** courriel `A:1167`), `client_phone` (= **destinataire** SMS `A:1409`), `client.nom` | `A:744-758`, `A:1064` |
| deal | client + `deal_stage`, `deal_stage_en`, `deal_source`, `deal_jours_dans_etape` | `A:762-786` (lecture sans filtre org `A:770`) |
| lead / client | client | `A:788-810` |
| quote | `quote_number`, `quote_total` (devise du devis), `quote_valid_until` (ISO brut), `quote_link` (`/quote/<view_token>`), `job_name`, `soumission.numero/total/lien/lien_interne/nb_vues/ouverte_le` | `A:824-877` |
| job | `job_name`, client, `contract_link/line/html`, `signed_contract_link`, `deposit_amount` (fr-CA fixe), `deposit_line` | `A:879-897`, `A:593-688` |
| invoice | `invoice_number`, `invoice_due_date` (ISO brut), `invoice_total` (**CAD forcé**), `invoice_link`, client, `job_name` ; drapeau `auto_paiement_echoue` → `paiement.montant/raison/facture/lien` ; drapeau `auto_consultation_documents` → `facture.numero/total/lien/lien_interne/nb_vues/consultee_le` | `A:899-974` |
| schedule_event / appointment | `appointment_date` / `appointment_time` (**`fr-CA` fixe** : `2026-09-30`, `09 h 00`, fuseau org), `appointment_title`, `appointment_address`, `job_name`, client (via job ou `jobs.client_name`), `contract_*` | `A:976-1030` |
| automation_webhook_receipt, pipeline_deal | **aucune branche** : seulement les variables entreprise (courriel/SMS sautés faute de destinataire ; le JSON reçu n'est pas exposé en variable) | — |
| Liens produits ailleurs | `survey_url`, `review_link` (seulement par `request_review`, mutation de `vars` `A:1959-1961`) ; `client.lien_reservation` (`avecLienReservation` `A:96-113`, drapeau `auto_client_inactif`) | — |
| Désabonnement | pas une variable : pied de page + en-têtes `List-Unsubscribe` si `ctx.commercial` | `A:1253,1278-1282,1335-1342` |

`resolvePublicBaseUrl()` lève si aucune URL publique n'est configurée → `resolveEntityVariables` échoue en entier pour un devis/facture avec jeton (`server/lib/helpers.ts:138-151`, appels `A:839,935,943,961`).

#### 4.3 Champs personnalisés et « clés système » `{{objet.cle}}`

- Références : `client` (client/lead), sinon lues sur `deals/jobs/quotes/invoices` (`client_id, lead_id, job_id, quote_id`) ; `deal` via `dealLie` (`A:1083-1122`). **Rien pour `schedule_event` ni `property`** (`A:1041-1059`).
- `variablesChamps(db, orgId, refs, langue)` (`server/lib/champs/service.ts:532-555`) : champs non archivés, valeurs `custom_field_values` (+ `custom_field_value_options`), formatage `formaterValeur` (`src/lib/champs/valeurs.ts:199-244`).
- Clé de variable : `variableModele(objet, cle)` = `${objet}_cf_${cle}` (`src/lib/champs/types.ts:119-121`), écrite `{{objet.cle}}` ; `cle` = `slugCle(libellé)` (`src/lib/champs/valeurs.ts:247-254`).
- Champs système `server/lib/champs/variablesSysteme.ts` : client (`:83-102`, 20 clés), job (`:104-132`), quote (`:134-161`), invoice (`:163-177`, dont `internal_notes`), deal (`:179-197`), property (`:199-202`, jamais atteint). Montants système en CAD (`:24-28`).
- Toute erreur de ce bloc est avalée → variables vides (`A:1061-1063`).

#### 4.4 Exécuteur `executeAction(actionType, config, vars, ctx): Promise<ActionResult>` (`A:998-3062`)

`ActionType` `A:491-516`, `ActionContext` `A:20-82`, saut = `{success:true, data:{saute, saute_code}}` (`A:138-140`, codes `A:125-135`). Délai max 5 s par action (`automationEngine.ts:1321`).

| Action | Fonction | Gardes clés |
|---|---|---|
| `send_email` | `executeSendEmail` `A:1156` | destinataire imposé ; mailer configuré ; adresse injoignable ; désabonnement ; identité LCAP (commercial) ; consentement `consentementCommercial` `A:360-453` ; plafond fréquence `depassePlafondFrequence` `A:244-280` (commercial, 3/24 h par défaut, `AUTOMATION_MAX_COMMERCIAL_PER_DAY`) ; « déjà envoyé » `dejaEnvoye` `A:153-171` (objet + destinataire) ; journal `activity_log email_sent` |
| `send_sms` | `executeSendSms` `A:1393` | Twilio ; téléphone ; `sms_opt_outs` ; consentement (commercial) ; plafond ; mention STOP ; numéro de l'org / forfait (`plan_excludes_sms`) ; gel de migration ; « déjà envoyé » (texte exact) |
| `create_notification` / alias `send_notification` | `A:1632` (+ `destinatairesNotification` `A:1538`) | `destinataire` : propriétaire / responsable / `equipe_du_deal` / membre ; `par_courriel` |
| `create_task` | `A:1710` | propriétaire obligatoire, membre vérifié, échéance UTC |
| `update_status` | `A:1839` | liste blanche de tables `A:1830-1837`, statut non validé |
| `move_deal_stage` | `A:2176` | deal ou devis ; `cible` role/role_envoyee/gagne/étape ; pas de `chaine` |
| `request_review` | `A:1871` | avis activés, lien configuré, anti-doublon 7 j (`review_requests`), plafond forcé commercial, puis re-passe par send_email/send_sms |
| `log_activity` (interne) | `A:2100` | — |
| `update_custom_field` | `executerMajChamp` `server/lib/champs/automatisations.ts:66-95` | écrit avec `source:'automation'` (pas d'événement) |
| `envoyer_slack` | `A:2695` | toujours « pas encore disponible » (définitif) |
| `ajouter_etiquette` / `retirer_etiquette` | `A:2414` / `A:2443` | annonce avec `chaine` |
| `modifier_client` / `assigner_responsable` / `ajouter_note` | `A:2481` / `A:2528` / `A:2573` | — |
| `modifier_statut_rendezvous` / `modifier_deal` / `assigner_deal` | `A:2612` / `A:2638` / `A:2663` | — |
| `envoyer_facture` / `envoyer_soumission` | `A:2982` / `A:2990` → `envoyerDocument` `A:2877` | lien public requis ; marque envoyé (`quote.sent` si brouillon) |
| `webhook` | `A:2717` | SSRF `posterSansSsrf` (`server/lib/url-sortante.ts:120-158`), https, DNS public, 3 redirections, 10 s ; corps = TOUTES les `vars` ; `Idempotency-Key` seulement pour tâches différées |
| `arreter_automatisation` | `A:2753` | annule les tâches `pending` de l'entité (règle courante ou toutes) |
| `demarrer_automatisation` | `A:2805` → `demarrerRegle` `automationEngine.ts:1234-1258` | chaîne + `PROFONDEUR_MAX_DEMARRAGE=3` ; **les conditions de la règle cible ne sont pas évaluées** |
| autre | `A:3059` | `Unknown action type` |

Type d'envoi : `typeEnvoi(p)` (`server/lib/desabonnement/index.ts:123-145`, **pur**) : `config.type_envoi` → type d'action → preset (`:87-98`) → déclencheurs transactionnels (`:101-109`) → `lead.created`/`quote.sent` immédiats → `job.completed` < 7 j → sinon **marketing**.

---

### 5. INFRASTRUCTURE D'EXÉCUTION

#### 5.1 Processus et boucles (tout dans le serveur Express)

| Boucle | Fréquence | Verrou | Où |
|---|---|---|---|
| `initAutomationEngine` → `eventBus.onAnyEvent(handleEvent)` | temps réel | — | `server/index.ts:1390`, `automationEngine.ts:2483-2493` |
| Tick du planificateur `tick()` | 5 min (+ au démarrage) | local `tickEnCours` + bail `withAdvisoryLock('automation-scheduler')` (table `cron_locks`, bail 10 min, `supabase/migrations/20260754000000_cron_locks_lease.sql:14-40`, `server/lib/advisory-lock.ts:10-40`) | `server/lib/scheduler.ts:872-940` |
| └ ordre du tick | factures récurrentes (ancien clonage) → `processScheduledTasks` → `rejouerEvenementsOrphelins` + `menageOutbox` → `traiterEvenementsPipeline` + `detecterStagnation` → `detectOverdueInvoices` → `expireOverdueQuotes` → ménage fichiers (1/j) → archivage devis → **ancienne table `automations`** (5 handlers `days_after_*`) | | `scheduler.ts:744-862` |
| File « événements de la base » | 15 s | prise atomique par ligne (`attempts`) | `server/lib/evenementsBase.ts:196-205` |
| Clients inactifs | 1 h | `withAdvisoryLock('clients-inactifs')` | `server/index.ts:1567-1577` |
| Crons pg_cron → HTTP `/api/cron/*` (en-tête `x-cron-secret`) | `lume_payment_reminders` 13:00 UTC, `lume_rappels_dates` 12:15, `lume_recurring_invoices` 11:45, `lume_webhook_retries` */10 min, `lume_release_sms_numbers` 08:10 | verrou pour recurring/webhook/payment-reminders ; **aucun pour rappels-dates** | `trigger_cron_api` `supabase/migrations/20261004200200_crons_rappels_dates_factures_recurrentes_webhooks.sql:27-84` ; `trigger_payment_reminders` `20261003100200_cron_sans_repli_vers_la_prod.sql:34-71` ; routes `server/routes/cron.ts:69-132`, `server/routes/reminders-cron.ts:291` |

#### 5.2 Tables

| Table | Rôle | Colonnes / index clés |
|---|---|---|
| `automation_rules` | règles | `trigger_event, conditions, delay_seconds, actions, steps, settings, is_active, is_preset, preset_key, pipeline_id, stage_id, deleted_at, purged_at, folder_id, modele_id, lumi_conversation` (SCHEMA_SNAPSHOT.md:528-550 ; `purged_at` migration `20261004400000`) ; unique `(org_id, preset_key)` |
| `automation_scheduled_tasks` | file différée + étapes de parcours | `status ∈ pending/running/completed/failed/cancelled` (CHECK SNAPSHOT:7995), `execute_at, attempts, last_error, step_id, sequence_context, execution_key` ; **pas de `updated_at`** ; `idx_scheduled_tasks_dedup` ; FK règle ON DELETE CASCADE |
| `automation_execution_logs` | journal (immédiat + différé) | `result_success, result_data (saute/saute_code), result_error ('en cours' pendant réservation), duration_ms, execution_key, scheduled_task_id` ; `idx_execution_logs_immediat_dedup` |
| `domain_events` | outbox | `processed_at, attempts, last_error, regles_traitees uuid[]` ; rétention 14 j |
| `automation_evenements_base` | événements écrits par trigger | `cle`, unique `(org_id,type,entity_id,cle)`, `traite_at, attempts` ; ligne-repère `__mise_en_service__` (`evenementsBase.ts:51-67`) |
| `pipeline_events` | événements deals | `cle_unicite` unique par org, `processed_at, attempts` |
| `activity_log` | journal métier ; preuve anti-doublon des retards | index unique `invoice_overdue` par `(entity_id, days_overdue)` (`20261001100000`) |
| `automation_webhooks` / `automation_webhook_receipts` | webhooks entrants | trace = entité de l'événement |
| `clients_inactifs_declenches`, `paiements_echoues_traites`, `liens_reservation` | anti-doublons des balayages | `20261001400000`, `20261001300000` |
| `notifications` | alerte `automation_failed` en échec définitif | `prevenirEchecDefinitif` `automationEngine.ts:1409-1445` |
| `automations` (ancienne) | ancien système `days_after_*` encore lu à chaque tick | 0 ligne en prod (SNAPSHOT:40) |
| `reminder_settings` / `reminder_log` | relances de paiement (système parallèle) | 0 ligne en prod (SNAPSHOT:232) |

#### 5.3 Outbox et rejeu

- `emit` : journal + outbox en parallèle (sauf `invoice.overdue` : journal d'abord, doublon → rien n'est émis ; `deal.*` : pas d'outbox) (`eventBus.ts:213-244`). Écouteurs non attendus ; coche `processed_at` quand tous ont fini (`cocher` `:360-381`) ; erreur préfixée `[à rejouer] ` → ligne laissée non cochée (`:366`, levée par le moteur si les règles sont illisibles `automationEngine.ts:1099-1103`).
- `rejouerEvenementsOrphelins` (`outbox.ts:85-158`) : délai de grâce 3 min, âge max 24 h, 3 rejeux max, réclamation optimiste sur `attempts`, `rejoueDepuis` → pas de double action immédiate (`automationEngine.ts:613-629`) ni de double envoi (`dejaEnvoyeDepuis`).
- `traiterEvenementsBase` : vérifie l'outbox (`metadata->>evenement_base_id`) avant réémission si `attempts>0` (`evenementsBase.ts:154-165`), 5 tentatives max.
- `traiterEvenementsPipeline` : **pas de réclamation atomique**, marqué traité juste après `emit` (qui n'attend pas les écouteurs et ne lève pas) (`pipelineEvenements.ts:283-311`).

#### 5.4 Reprises des tâches

- Réclamation : `UPDATE … SET status='running', attempts+1, execute_at=now WHERE status='pending'` (`automationEngine.ts:1664-1686`) ; lot de **50 tâches par tick** (`:1541`).
- Échec : `nextStateAfterFailure(attempts, error)` (`:1447-1469`, non exporté) — 4 tentatives max (`MAX_TASK_ATTEMPTS` `:1305`), reprises à 5 min / 30 min / 2 h si `isTransientFailure` ; sinon `failed` + notification.
- Délai dépassé (5 s) : tâche mise en reprise, le résultat tardif complète le journal et annule la reprise + ouvre l'étape suivante s'il réussit (`:1968-2016`).
- Redémarrage : `recupererTachesFigees` remet `pending` les `running` depuis > 15 min (`:1477-1514`) ; outbox rejoue les événements non cochés ; la file base/pipeline reprend.
- Étape suivante d'un parcours ouverte **seulement sur succès** (`:2058-2076`) ; `planifierEtape` réessaie l'insertion 3× (0/500/2000 ms) puis journalise l'interruption (`automationSequences.ts:436-470`).

---

### 6. CYCLE DE VIE D'UNE RÈGLE

| État | Colonnes | Écrit par |
|---|---|---|
| Brouillon | `is_active=false`, `deleted_at null` | défaut à la création (`validation.ts:1261`, `automation-rules.ts:246`), duplication (`:746`), modèle (`:683`), restauration (`:861`) |
| Publiée | `is_active=true` | `changerPublication` (`server/lib/automations-publication.ts:564-622`, routes `server/routes/automation-publication.ts:24-50`), création/PATCH avec `is_active:true` (même contrôle `problemesBloquants`, `automation-rules.ts:225-228,555-558`) |
| Corbeille | `deleted_at` posé + `is_active=false` ; tâches `pending` annulées (client service) | `DELETE /automations/rules/:id` (`automation-rules.ts:766-845`) ; préréglage non supprimable (`:782-786`) |
| Purgée | `purged_at` posé (CHECK : seulement si `deleted_at`) ; journaux conservés | `DELETE …/definitivement` (`:892-914`) |
| Pause d'org | `company_settings.automations_paused` | `POST /automations/pause` (`:1074-1118`) |

Ce que le moteur vérifie :
- au déclenchement : `is_active=true AND deleted_at IS NULL` (`automationEngine.ts:1087-1097`) — `purged_at` non lu (implicite via `deleted_at`) ;
- à `demarrerRegle` : idem (`:1239-1246`) ;
- à chaque tâche : `motifAnnulationRegle` (brouillon/corbeille → `cancelled` avec motif), étape disparue → `cancelled` (`:1573-1604`).

Modification en cours de route :
- Les tâches déjà planifiées portent une **copie** de l'action (`action_config`, `:1029`, `automationSequences.ts:408-409`) : changer le texte ou le délai d'une règle ne modifie PAS les envois déjà en file (sauf étape supprimée → annulée). Les étapes SUIVANTES d'un parcours sont relues dans `steps` au moment de leur planification.
- Repasser en brouillon n'annule pas immédiatement : l'annulation se fait au tick où la tâche est due. Republier avant ce tick laisse partir ces tâches.
- Un PATCH sur une règle publiée qui AJOUTE un problème bloquant est refusé (`automation-rules.ts:570-577`) ; changer le déclencheur d'un préréglage est refusé (`:539-543`) ; modifier une copie liée la détache du modèle (`:533`) ; le contenu se propage aux copies des autres bureaux (`propagerAuxCopies`, `server/lib/automatisations-bureaux.ts:247`).
- Aucun trigger SQL n'annule les tâches (seul `trg_automation_rules_updated`). La RLS permet à `automations.update` un DELETE physique direct par PostgREST → tâches supprimées en CASCADE sans trace.
- Préréglages : `ensureAutomationPresets` (`server/lib/automationPresetSeeder.ts:64-222`), appelé à la création d'org (`server/routes/orgs.ts:534`, `server/lib/seedOrgDefaults.ts:257`).

---

### 7. VALIDATION

| Couche | Fonction / schéma | Où |
|---|---|---|
| Création | `automationRuleCreateSchema` (= `corpsAutomatisation` + `plafondActions`) | `server/lib/validation.ts:1238-1313` |
| Modification | `automationRuleUpdateSchema` (partiel, ne garde que les clés ENVOYÉES) | `validation.ts:1344-1363` |
| Déclencheur | `z.enum(CLES_DECLENCHEURS)` | `validation.ts:773-776` |
| Actions | `actionAutomatisation` : type ∈ catalogue + `log_activity`, `config` **strict**, champs obligatoires visibles (`champVisible`), `max`, `valeurValide` (bascule, nombre min/max, choix, membre UUID, url https + anti-interne), variantes `_en`, clés moteur `lien`/`depuis_role`/`vers_role`/`description` | `validation.ts:797-1011` |
| Conditions | `conditionsAutomatisation`, `conditionChampSchema` | `validation.ts:1022-1067` |
| Étapes | `etapeSequence` (discriminated union), `sequenceEtapes` (≤30) + `problemesDuGraphe` | `validation.ts:1076-1173` |
| Réglages | `automationSettingsSchema` strict (`reentree, arret_sur_reponse, fenetre 7-22, jours_ouvrables, delai_entre_passages_jours 1-365, marquer_lu (ignoré), arreter_si_resolu`) | `validation.ts:1190-1236` |
| Cohérence route | `verifierCoherence` : délai négatif seulement si `accepte_delai_negatif`, ≤ 30 j ; deux actions identiques refusées | `server/routes/automation-rules.ts:72-114` |
| Dossier | `dossierDuBureau` | `automation-rules.ts:207-211` |
| Cibles démarrer/arrêter | règle existante de l'org | `automation-rules.ts:~490-505` |
| Publication | `problemesAvantPublication(regle)` (catalogue, pur) → `problemesPublication` / `bloquantsPublication` (format d'origine toléré, action provisoire « À compléter » = vide) → `problemesBloquants` / `messageRefus` / `messagePublieeCassee` | `src/lib/automationCatalogue.ts:1326-1497`, `src/lib/publicationAutomatisation.ts:43-76`, `server/lib/automations-publication.ts:548-562` |
| Événements navigateur | `automationEventSchema` | `validation.ts:386` |

---

### 8. FONCTIONS PURES — cibles de tests unitaires

| Fonction | Signature | Fichier:ligne |
|---|---|---|
| `evaluateConditions` | `(conditions: Record<string,any>, event: CRMEvent) => boolean` | `server/lib/automationEngine.ts:177` |
| `regleViseCetEvenement` | `(rule: AutomationRule, event: CRMEvent) => boolean` | `automationEngine.ts:79` |
| `isQuietHours` | `(d?: Date, tz?: string) => boolean` | `automationEngine.ts:330` |
| `horsFenetre` | `(reglages: ReglagesRegle\|null\|undefined, d?: Date, tz?: string) => boolean` | `automationEngine.ts:345` |
| `nextSendTime` | `(from?: Date, reglages?, tz?: string) => Date` | `automationEngine.ts:429` |
| `estRegleDeRelanceFacture` | `(r: {trigger_event?, preset_key?}\|null\|undefined) => boolean` | `automationEngine.ts:544` |
| `motifAnnulationRegle` | `(regle: {is_active?, deleted_at?}\|null\|undefined) => string\|null` | `automationEngine.ts:1265` |
| `estDelaiDepasse` | `(e: unknown) => boolean` | `automationEngine.ts:1332` |
| `isTransientFailure` | `(error?: string\|null) => boolean` | `automationEngine.ts:1360` |
| `statutAvecAlias` | `(entityType: string, statut: string) => string\|string[]` | `automationEngine.ts:2199` |
| `DEBIT_SMS_PAR_MINUTE`, `RELANCE_FACTURE_DEJA_PARTIE` | constantes | `automationEngine.ts:516,550` |
| *(non exportées, à exporter pour tester)* `memeValeur`, `versNombreComparable`, `comparer`, `buildExecutionKey`, `shouldRespectQuietHours`, `corrigerChangementDHeure`, `decalageLocalMin`, `nextStateAfterFailure`, `delayToSeconds` | — | `automationEngine.ts:110,138,157,264,413,390,365,1447,1049` |
| `premiereEtape`, `premiereEtapeSansConfirmation`, `etapesDeConfirmation`, `trouverEtape`, `etapeSuivante` | `(steps: Etape[], …)` | `server/lib/automationSequences.ts:125,156,146,166,550` |
| `cleEtape` | `(ruleId, entityId, stepId, passage?) => string` | `automationSequences.ts:184` |
| `problemesDuGraphe` | `(steps: Etape[]) => string[]` | `automationSequences.ts:213` |
| `familleSortie`, `sortieCochee` | `(declencheur) => FamilleSortie\|null`, `(reglages, famille) => boolean` | `server/lib/sortie-parcours.ts:52,57` |
| `automatisationsActives` | `(env?: ProcessEnv) => boolean` | `server/lib/automations-interrupteur.ts:231` |
| `regleDansLaChaine` | `(metadata, ruleId) => boolean` | `server/lib/etiquettes.ts:89` |
| `objetDeLEntite` | `(entityType) => ObjetChamp\|null` | `server/lib/champs/automatisations.ts:24` |
| `evaluerCondition`, `evaluerConditions`, `familleDuType`, `normaliserTexte`, `normaliserTelephone` | `(type, valeur, c, ctx?)`… | `src/lib/champs/filtres.ts:174,261,40,152,158` |
| `formaterValeur`, `slugCle`, `lireBooleen`, `preparerValeur`, `lireValeur` | — | `src/lib/champs/valeurs.ts:199,247,53,73,178` |
| `variableModele` | `(objet, cle) => string` | `src/lib/champs/types.ts:119` |
| `resolveTemplate`, `echapperHtml`, `sansPrenomVide`, `accorderPluriels`, `messageEchecCourriel`, `identiteManquante`, `estEnvoye` | — | `server/lib/actions/index.ts:557,546,525,538,1135,1148,174` |
| `applyTemplate` | `(template, vars) => string` | `server/lib/notificationHelpers.ts:354` |
| `typeEnvoi`, `motifSaut`, `estStop`, `estStart` | — | `server/lib/desabonnement/index.ts:123,148,60,63` |
| `avecMentionCommerciale`, `segmentsSms` | — | `server/lib/desabonnement/mention-sms.ts:44,69` |
| `adresseAcceptable`, `resolutionPublique` (résolveur injectable), `posterSansSsrf` (fetch injectable) | — | `server/lib/url-sortante.ts:71,86,120` |
| `jourLocal`, `jourDecale` | `(d?) => 'AAAA-MM-JJ'` | `server/lib/rappels-dates.ts:36,43` |
| `reglagesInactivite` | `(conditions) => {mois, maxParHeure}` | `server/lib/client-inactif.ts:59` |
| `champsFiltrables`, `CHAMPS_RESERVES_MOTEUR` | `(corps: unknown) => Record<string,unknown>` | `server/routes/webhooks-entrants.ts:272-279` |
| `plafondRelanceJours`, `fenetreRelance`, `nettoyerLiensMorts` | — | `server/routes/reminders-cron.ts:90,107,232` |
| `classerJournal` | `(l) => 'envoye'\|'saute'\|'echec'\|null` | `server/routes/automation-stats.ts:94` |
| `addDelay`, `subtractDelay`, `computeNextRecurrenceDate`, `createFireDedup`, `OVERDUE_DAYS` | — | `server/lib/scheduler-utils.ts:10,20,34,71,63` |
| Catalogue : `trouverDeclencheur`, `declencheurOffert`, `actionCompatible`, `actionsPour`, `trouverAction`, `champVisible`, `configParDefaut`, `problemesAvantPublication` | — | `src/lib/automationCatalogue.ts:508,98,1173,1202,1206,1223,1267,1326` |
| `problemesPublication`, `bloquantsPublication` | `(regle: RegleAPublier)` | `src/lib/publicationAutomatisation.ts:43,74` |
| `estFormatOrigine`, `projeterFormatOrigine`, `insererEtape`, `retirerEtape`, `finDuParcours` | — | `src/lib/sequenceTypes.ts:284,308,125,183,233` |
| `messageRefus`, `messagePublieeCassee`, `problemesBloquants` | — | `server/lib/automations-publication.ts:548,553,560` |

Tests existants proches : `tests/automation/automation-engine.test.ts`, `tests/automation/scheduler.test.ts`, `tests/automation/sortie-parcours.test.ts`, `tests/automatisations-sequences.test.ts`, `tests/automatisations-filtres-dates.test.ts`, `tests/outbox-evenements.test.ts`, `tests/automations-interrupteur.test.ts`, `tests/heures-de-silence-fuseau-org.test.ts`, `tests/automation/launch-*.test.ts`, `tests/automation/filet-regression.test.ts`, `tests/automation/golden/`.

---

### 9. BOGUES / TROUS SUSPECTÉS (à confirmer par test)

#### Déclencheurs et files
1. **`si` ignore les filtres d'étiquettes** — l'étape `si` n'appelle que `evaluateConditions` (qui saute `client_a_etiquette/client_sans_etiquette`) + `conditionsChampsOk` : un filtre d'étiquette y vaut toujours VRAI (`server/lib/automationEngine.ts:1773-1781`, saut `:189`).
2. **`metadonneesFraiches` ne relit pas les rendez-vous** : la table `source` a la clé `appointment` mais l'entité arrive en `schedule_event` ; les `si` d'un parcours de rendez-vous sont jugés sur le contexte d'ORIGINE ; rien non plus pour `deal` (`automationEngine.ts:2146-2156`).
3. **Boucle possible via `move_deal_stage`** : aucune `chaine` sur `deal.stage_entered` (métadonnées = payload SQL) ; deux règles A→B / B→A se relancent à chaque tick (clé `enter:…:<stage_entered_at>` toujours nouvelle, anti-doublon immédiat = 2 min < tick 5 min) (`server/lib/pipelineEvenements.ts:288-295`, `automationEngine.ts:498`).
4. **`pipeline_events` sans réclamation atomique** et marqué traité même si le moteur demande un rejeu (emit n'attend pas les écouteurs, pas d'outbox pour `deal.*`) → deal perdu si règles illisibles ; doublon possible avec 2 instances hors verrou (`pipelineEvenements.ts:283-311`, `eventBus.ts:187-191`).
5. **`deal.stage_idle` rejoue les autres règles** : l'événement porte `rule_id` mais le moteur relit toutes les règles `deal.stage_idle` ; une règle sans `idle_days` ou « toutes étapes » part aussi sur l'événement d'une autre (`automationEngine.ts:1087-1133` vs payload `20261004200000:55-63`) ; `(conditions->>'idle_days')::integer` lève sur une valeur non numérique et fait échouer tout le tick (`20261004200000:32,49`) ; seuil non réglable dans l'éditeur (`src/lib/automationCatalogue.ts:427-442`).
6. **`rappels-dates`** : fuseau figé `America/Toronto` (`server/lib/rappels-dates.ts:33`) ; l'en-tête affirme que le jour entre dans `execution_key` — faux (`buildExecutionKey` `automationEngine.ts:288`) → un rejeu du cron le même jour (> 2 min) renvoie les messages immédiats ; route sans verrou (`server/routes/cron.ts:94-104`) ; 500 valeurs max par règle sans pagination (`rappels-dates.ts:182`).
7. **`invoice.sent` émis deux fois** pour une facture récurrente auto_send : trigger base (brouillon→sent) + `server/lib/recurringInvoicesEngine.ts:175`. Couvert par l'anti-doublon 2 min / index pending, **sauf** avec `settings.reentree` (clé aléatoire pour les tâches différées, `automationEngine.ts:289`).
8. **Clés d'événements base constantes** : `invoice.sent` clé `'envoi'`, `appointment.created` clé `'creation'` → une facture repassée en brouillon puis renvoyée n'émet plus rien (`20261003100000_…sql:99,189`) ; `job.completed`/`quote.*` en UPDATE seulement (un job créé directement `completed` n'émet rien, `:143-145,172-174`).
9. **Déclencheurs dépendant du navigateur (tire-et-oublie, non durables)** : `task.completed`, `client.tagged/untagged` depuis la fiche, `job.ready_for_invoicing`, `appointment-rescheduled` (replanification des rappels) (`src/lib/automationEventsApi.ts:21-33`). Un déplacement de visite par Lumi/import/SQL ne replanifie pas les rappels des règles simples à délai négatif.
10. **`invoice.paid` d'un dépôt arrive avec `entityType:'quote'`** (`server/routes/payments.ts:373-384`) : toute règle différée « Facture payée » déclenchée par un dépôt est annulée par la sortie de parcours (famille `null` ⇒ case cochée ; devis `approved` ∈ résolus) (`sortie-parcours.ts:127-137`, `automationEngine.ts:2429-2441`).
11. **Événements déclarés jamais émis** : `quote.created` écouté par `server/lib/d2d-pipeline-listener.ts:21` mais jamais émis (+ 8 autres, §1.4). `estimate.sent` : préréglage vivant sur une route sans appelant.
12. **`/automations/events/quote-sent`** accepte `entityId = quoteId || ''` sans vérifier l'appartenance ni la présence (`server/routes/automation-events.ts:299-305`).

#### Conditions et validation
13. `OPERATEURS_CONDITIONS` ne liste pas `gt/gte/lt/lte` alors que moteur et Zod les acceptent (`src/lib/automationCatalogue.ts:1291`).
14. `problemesAvantPublication` ne vérifie pas le renvoi `si_depasse` (`automationCatalogue.ts:1454`) — rattrapé par `problemesDuGraphe` côté serveur seulement.
15. `evaluateConditions` : texte comparé exactement (casse, espaces), pas de `contains` ; un filtre `montant__gte` avec métadonnée absente refuse la règle (voulu, mais surprenant pour `invoice.paid` sans `montant`).
16. `conditionsChampsOk` : champ archivé encore évalué ; clé de champ standard toujours fausse ; erreur → faux (branche « sinon » silencieuse) (`server/lib/champs/automatisations.ts:47,52-62`).
17. `demarrerRegle` n'évalue pas les conditions de la règle cible (`automationEngine.ts:1234-1258`).

#### Contrôles d'exécution
18. **Interrupteurs incomplets** : `AUTOMATIONS_ENABLED` et « Tout arrêter » ne couvrent ni `/api/cron/payment-reminders` (`server/routes/reminders-cron.ts:291`), ni l'ancienne table `automations` (`server/lib/scheduler.ts:820-858`), ni les factures récurrentes ; et les ÉVÉNEMENTS reçus pendant l'arrêt/pause sont perdus (l'outbox les coche) — seule la file de tâches est conservée (`automationEngine.ts:1062,1070`).
19. **Débit plafonné** : 50 tâches par tick de 5 min = 600/h max, toutes orgs confondues (`automationEngine.ts:1541`) ; le 1er pas d'un parcours (confirmation) attend le tick (≤ 5 min) et subit les heures calmes même pour un courriel (`:1619`), contrairement à une règle simple immédiate.
20. **Tâches en file figées sur l'ancienne config** : modifier le texte/délai d'une règle ne touche pas les tâches pending (copie dans `action_config`, `automationEngine.ts:1029`) ; brouillon → republication avant le tick laisse partir l'ancien contenu (`:1573`).
21. **Bail du verrou 10 min** : un tick plus long (50 × 5 s + balayages) peut être doublé par une 2e instance (`20260754000000_cron_locks_lease.sql:33-36`).
22. `annulerSequence` (`automationSequences.ts:564`) et `delayToSeconds` (`automationEngine.ts:1049`) : code mort. `eventBus` importé inutilement dans `server/routes/automation-test.ts:24`.
23. `relanceFactureDejaPartie` / `rafaleDeTextos` / `dejaPasseRecemment` : lecture ratée = envoi (choix assumé, fail-open).

#### Variables et actions (détail rapport actions)
24. **Clés du prototype** : `[constructor]`, `{toString}`… remontent à `Object.prototype` (`vars = {}` `server/lib/actions/index.ts:696`, rendu `:576`) → texte `function Object()…` envoyé, ou TypeError dans `echapperHtml` hors try (`:563,1173`).
25. `[50]`, `{0}` effacés (chiffres acceptés comme clé, inconnue → vide) (`actions/index.ts:570`).
26. Exemption d'échappement `_html` par NOM : un champ perso de clé `…_html` (ex. « Notes HTML ») est injecté sans échappement dans le courriel (`actions/index.ts:562-563,575`).
27. Double rendu dans `request_review` (texte rendu puis re-rendu par send_email/send_sms) (`actions/index.ts:1975,2016` puis `:1172-1173,1446`).
28. Rendez-vous : aucune variable `{{client.*}}`/`*_cf_*` ; `appointment_date/time` en `fr-CA` fixe même pour une org anglaise ; `invoice_total` toujours en CAD ; `quote_valid_until`/`invoice_due_date` en ISO brut (`actions/index.ts:1012-1013,1043-1059,902,834,953`).
29. `invoice_cf_internal_notes` exposable au client ; le webhook reçoit TOUTES les variables (`server/lib/champs/variablesSysteme.ts:163-177`, `actions/index.ts:2734`).
30. Demande d'avis immédiate, drapeau `auto_desabonnement_canal` OFF : `ctx.commercial` absent → ni consentement, ni lien de désabonnement (`automationEngine.ts:752-754`, `actions/index.ts:380,1253`).
31. SMS avec `{{client.lien_reservation}}` : nouveau jeton à chaque tentative → « déjà envoyé » (texte exact) ne le reconnaît jamais → doublon en reprise (`actions/index.ts:1445,1476`).
32. Classement `isTransientFailure` incohérent : plusieurs erreurs définitives sont reprises 4× (« No Google or Facebook review link configured », « Client has no email address or phone number », « Table not allowed », « Unknown action type »…), chaque reprise de `request_review` créant un nouveau sondage ; un échec DNS passager devient définitif (« Adresse refusée ») (`automationEngine.ts:1360-1384`, `actions/index.ts:1887,1916,1845`, `server/lib/url-sortante.ts:86-94`).
33. Webhook : délai propre 10 s > coupure moteur 5 s → reprise possible pendant que l'appel aboutit ; `Idempotency-Key` absente pour les actions immédiates ; 4xx repris (`url-sortante.ts:116`, `actions/index.ts:2717-2749`).
34. `create_notification` / `create_task` sans `title` → TypeError (`actions/index.ts:1637,1721`).
35. `arreter_automatisation` sans `ruleId` annule TOUTES les tâches de l'entité (`actions/index.ts:2770`) ; profondeur `demarrer` = 3 vs chaîne d'étiquettes = 5 (deux constantes).
36. Lectures service_role sans filtre `org_id` : deal dans `resolveEntityVariables` (`actions/index.ts:770`), `client_tags` dans `conditionsEtiquettesOk` (`server/lib/etiquettes.ts:77`).

#### Base / déploiement
37. Migrations d'automatisation ≥ `20261002500000` **absentes de SCHEMA_SNAPSHOT (2026-09-28)** : `automation_evenements_base` + triggers, `purged_at`, `relances_du_deal`, `trigger_cron_api` + 3 crons, politiques `20261003100100`. Le code s'en sert déjà (`automation-rules.ts:130,178,866,902` filtre `purged_at` → 42703 si la migration n'est pas appliquée ; `evenementsBase.ts:55-66` « repère illisible » toutes les 15 s). À vérifier en prod avant tout test d'intégration.
38. `lume_release_sms_numbers` actif en prod alors que la migration le désactive (SNAPSHOT:10304 vs `20260750000000:68-71`).
39. Échecs HTTP des crons pg_net invisibles (`net._http_response` non surveillé ; `check_failing_cron_jobs` ne lit que `cron.job_run_details`).
40. `clients_inactifs_declenches` PK sans `rule_id` : deux règles « client inactif » au même `mois` → la 2e ne part jamais (`20261001400000:22`).
41. Les annulations côté serveur (`DELETE` règle, `fermeture_bureau`) ne visent que `pending`, pas `running`.

---

# Partie 2 — Actions et chemins d'envoi

## Inventaire 2 — Actions d'automatisation et chemins d'envoi sortants

Source : code du worktree `wt-autotest` (HEAD 5487b250). Lecture seule. Chemins relatifs à la racine du repo.
Abréviations : `A` = `server/lib/actions/index.ts`, `E` = `server/lib/automationEngine.ts`, `M` = `server/lib/mailer.ts`.

---

### 0. Plomberie commune (à connaître avant d'écrire un test)

**Deux chemins d'exécution, comportements différents :**

| | Immédiat (`delay_seconds = 0`, sans `steps`) | Différé (file `automation_scheduled_tasks`) |
|---|---|---|
| Entrée | `handleEvent` E:1057 → `lancerRegle` E:1182 → `executeRuleActions` E:720 | `processScheduledTasks` E:1516 (tick 5 min) |
| `ctx.commercial` | **absent** (sauf drapeau `auto_desabonnement_canal` → = marketing) E:748-755 | `true` sauf report d'heures calmes ou étape de confirmation E:1922-1925 ; drapeau → = marketing E:1954-1957 |
| `ctx.marketing` | `typeEnvoi(...)` E:751 | `typeEnvoi(...)` E:1943-1950 |
| Anti-doublon | réservation `automation_execution_logs.execution_key = règle:entité:index@tranche2min` E:592-671 | index unique `(org_id, execution_key)` pending/running + prise atomique `status pending→running` E:1664-1686 |
| Reprise | **aucune** : un échec est journalisé, point (E:874-887) | 4 tentatives max (E:1305), 5/30/120 min (E:1462), si `isTransientFailure` E:1360 |
| Délai max | 5 s (`DELAI_MAX_ACTION_MS` E:1321), l'action continue, le résultat tardif complète la ligne E:841-863 | idem, tâche remise en reprise, close si le tardif réussit E:1968-2015 |
| Journal | `automation_execution_logs` (ligne réservée puis complétée) | `automation_execution_logs` (insert) E:2020 + `automation_scheduled_tasks.status/last_error` E:2039 |
| Échec définitif | rien d'autre | `notifications` type `automation_failed` E:1409-1445 |

- Gardes globales avant toute règle : `AUTOMATIONS_ENABLED=false` (`server/lib/automations-interrupteur.ts:42`) E:1062/1521 ; pause par org `company_settings.automations_paused` (`automations-pause-org.ts:65`) E:1070/1559 ; anti-boucle `regleDansLaChaine` E:1120 ; conditions E:1126-1133 ; `delai_entre_passages_jours` E:1136 ; règle brouillon/corbeille → tâches annulées E:1573.
- Variables : `resolveEntityVariables` A:690 (une fois par événement, E:709). Destinataire = **toujours** `vars.client_email` / `vars.client_phone` ; `config.to` ignoré (A:191-209, A:1167, A:1409).
- `ctx.twilio` = `{client: twilioClient, phoneNumber: TWILIO_PHONE_NUMBER}` ou `null` si l'une manque (`server/index.ts:1392`) → **sans `TWILIO_PHONE_NUMBER`, tout texto d'automatisation est sauté** même si l'org a un numéro.
- « Saut » = `{success:true, data:{saute, saute_code}}` A:138 ; codes A:125-135. Le parcours continue. `estEnvoye()` A:174 distingue saut et envoi.
- Drapeaux par org : `org_features` (`automations-drapeaux.ts:64`) : `auto_desabonnement_canal`, `auto_sortie_parcours`, `auto_consultation_documents`, `auto_paiement_echoue`, `auto_client_inactif` (l.30-34).

---

### 1. ACTIONS (dispatch `executeAction` A:2998-3062)

24 types (`ActionType` A:491-516). Pour chaque : config → écritures → données manquantes → erreurs.

#### 1.1 `send_email` — `executeSendEmail` A:1156-1366
- Config : `subject`, `body` (HTML), `subject_en`/`body_en` (via `champLocalise` A:183), `from_name`(+`_en`), `reply_to`, `preheader`(+`_en`), `type_envoi` (lu par `typeEnvoi`). `to` ignoré.
- Ordre des gardes : pas d'adresse → saut `sans_courriel` A:1168 ; `isMailerConfigured()` faux → échec `SMTP not configured` (définitif) A:1177 ; rebond/plainte (`email_deliveries.status in bounced,complained`, `adresseInjoignable` M:495) → saut `adresse_injoignable` A:1183 ; désabonné (`email_unsubscribes`, category ≠ `pending`) → saut (par canal : seulement si commercial) A:1205-1213 ; commercial LCAP sans nom OU adresse postale d'entreprise → saut `identite_manquante` A:1223-1226 ; consentement A:1231-1237 (erreur de lecture = échec transitoire) ; plafond fréquence → **échec** A:1243 ; « déjà envoyé » (si `dejaEnvoyeDepuis`) A:1316-1318 ; gel (dans `sendEmail` M:387-393 → échec `MESSAGE_GEL`).
- Écritures : `email_deliveries` (1 ligne/destinataire, `org_id, provider, message_id, to_email, subject[:500], entity_type, entity_id, status='sent'`) M:283-301 ; `activity_log` (`event_type='email_sent'`, `metadata {to, subject, source:'automation'}`, entity_*) A:1351-1360 ; si commercial : `email_unsubscribes` ligne `category='pending'` (porteur de jeton) via `getUnsubscribeUrl` (`notificationHelpers.ts:214-250`) + RPC `record_consent` → `consents` (fire-and-forget `void`, A:1240, A:462-483).
- HTML : `buildEmailLayout(company, apercu + body + pied, bouton)` A:1324 ; en-têtes `List-Unsubscribe` + `-Post` si commercial A:1335-1342 ; `cleIdempotence` (Resend) = `tâche:étape` en différé E:1933.
- Retour : `{to, subject}`. Exception → `messageEchecCourriel` A:1135.

#### 1.2 `send_sms` — `executeSendSms` A:1393-1522
- Config : `body` (+`body_en`), `sollicitation` (bool, forcé par `request_review`), `type_envoi`.
- Gardes : `ctx.twilio` null → saut `sms_non_configure` A:1405 ; pas de numéro → saut `sans_telephone` A:1410 ; `sms_opt_outs (org_id, phone=normalizeE164)` → saut (par canal : seulement commercial) A:1414-1427 — **erreur de lecture ignorée** (seul `data` est lu) ; consentement (SMS transactionnel non vérifié A:380) A:1431-1436 ; plafond → échec A:1441 ; mention LCAP ajoutée si marketing/sollicitation A:1449-1451 ; numéro d'expédition `getOrgSmsFromNumber` (`twilioProvisioning.ts:583` : `communication_channels` sms actif + forfait avec SMS) sinon saut A:1457-1468 ; gel → échec A:1470-1475 ; déjà envoyé A:1476-1478.
- Envoi : `ctx.twilio.client.messages.create({body, from: numéroOrg, to, statusCallback?})` A:1483.
- Écritures : `conversations` (via `findOrCreateConversation`) + `messages` (`conversation_id, org_id, client_id, phone_number (E.164), direction='outbound', message_text=body final, status='sent', provider_message_id=sid`, `sender_user_id` NULL) A:1494-1513 (best-effort).
- Twilio 21610 → saut seulement si drapeau par canal A:1519 ; sinon échec (transitoire → reprises inutiles).

#### 1.3 `create_notification` / `send_notification` (alias) — A:1632-1706
- Config : `title`, `body`, `title_en`/`body_en` (courriel seulement), `reference_id`, `destinataire` (`''`|`membre`|`responsable`|`proprietaire`|`equipe_du_deal`), `membre_id`, `lien`, `par_courriel` (`'true'`).
- Sans `destinataire` : 1 ligne `notifications` org-wide (`type='automation', title, body, reference_id, link`) A:1665-1672. Avec : 1 ligne par membre actif (`user_id, entity_type, entity_id, link, icon, message`) via `insertTargetedNotifications` (`notificationHelpers.ts:84-124`) ; résolution A:1538-1630, repli propriétaires. Push via trigger DB `fn_push_on_notification`.
- `par_courriel` : `envoyerNotificationParCourriel` (`notificationCourriel.ts:116`, `sendEmail` avec `suivi.orgId`, `reessayer:true`) aux membres.
- Titre/corps : `accorderPluriels(resolveTemplate(...))` (sans échappement HTML ; affichage React + gabarit qui échappe `intro`).

#### 1.4 `create_task` — A:1710-1823
- Config : `title`, `body`|`description`, `due_date`, `echeance_jours`, `priorite` (low|medium|high, sinon medium), `membre_id` (doit être membre de l'org sinon échec A:1802).
- Écrit `tasks (org_id, title, description, status='open', priority, assignee_user_id, linked_entity_type, linked_entity_id, created_by=propriétaire, due_date AAAA-MM-JJ)` A:1808. Types liables : client/lead/quote/invoice/job ; rendez-vous → job porteur ; autres → NULL A:1747-1773. Pas de propriétaire → échec A:1734.

#### 1.5 `update_status` — A:1839-1862
- Config : `table` ∈ {jobs, quotes, invoices, clients, tasks, schedule_events} A:1830, `status` (non validé : un statut hors CHECK → erreur Postgres). `UPDATE <table> SET status WHERE id=entité AND org_id` ; 0 ligne → échec.

#### 1.6 `move_deal_stage` — A:2176-2315
- Config : `stage_id` | `vers_role`/`depuis_role` | `cible` ∈ {`role`, `role_envoyee`, `gagne`}. Entité `deal` ou `quote` (deal lié : `dealDeLaSoumission` A:2155). Pas de deal (depuis soumission) → succès `{aucun_deal}`. Jamais en arrière, jamais vers étape archivée/autre pipeline.
- Écrit `deals.stage_id` A:2285 (triggers → `deal_stage_history`, événements) puis `deal_stage_history.actor_type='automation', motif` A:2305-2313.

#### 1.7 `request_review` — A:1871-2096
- Config : aucune (textes = `company_settings.review_*` ou gabarit `email_templates` type `review_request`, sinon défauts `server/lib/reviews.ts:55-67`).
- Gardes : `review_enabled=false` → échec A:1883 ; aucun lien Google/Facebook → échec A:1886 ; ni courriel ni tél → **échec** (transitoire, 4 essais) A:1915 ; anti-doublon 7 j sur `review_requests` → **échec** (transitoire) A:1925-1939 ; plafond fréquence appliqué avec `commercial:true` A:2001-2016.
- Écrit AVANT l'envoi `satisfaction_surveys (org_id, client_id, job_id, token)` A:1945 ; puis appelle `executeSendEmail` et `executeSendSms` (sollicitation) ; puis `review_requests (org_id, client_id, job_id, survey_id, subject_sent, status sent|failed, sent_at)` A:2026 ; `activity_log event_type='review_requested'` A:2058.
- URL : `${ctx.baseUrl}/survey/${token}` A:1959.

#### 1.8 `log_activity` — A:2100 : `activity_log (org_id, entity_type, entity_id, event_type=config.event_type, metadata=config.metadata)`.

#### 1.9 `update_custom_field` — `executerMajChamp` (`server/lib/champs/automatisations.ts:66-95`)
- Config : `field_id`, `value` (conversions number/monetary(cents)/dropdown/checkbox l.82-89). Entités : client/lead/deal/job/quote/invoice. RPC `cf_ecrire_valeur` (`champs/service.ts:460`) → `custom_field_values` (+ `custom_field_value_options`), `source:'automation'`.

#### 1.10 `envoyer_slack` — A:2695 : **toujours échec** (« pas encore disponible », définitif). Rien n'est publié.

#### 1.11 `ajouter_etiquette` / `retirer_etiquette` — A:2414 / A:2443
- Config : `etiquette` (templatable), `toutes='true'` (retrait). Client résolu par `clientDeLEntite` A:2336 ; absent → échec.
- `client_tags` upsert `(client_id, tag)` ignoreDuplicates / delete ; nouvelle étiquette → `annoncerEtiquette` (`server/lib/etiquettes.ts:35-41`) → événement `client.tagged`/`client.untagged` (bus → `domain_events`).

#### 1.12 `modifier_client` — A:2481 : `clients.status` (active|inactive|lead), `source` (60 car.), `value` (0..9 999 999 999). Tout vide → échec.

#### 1.13 `assigner_responsable` — A:2528 : `clients.assigned_to` (membre vérifié), `seulement_si_vide='true'` → filtre `is null` (0 ligne = succès `{ignore}`).

#### 1.14 `ajouter_note` — A:2573 : `notes (org_id, content, entity_type ∈ {client,job,lead,invoice,payment,team_member} sinon client ou NULL, entity_id)`.

#### 1.15 `modifier_statut_rendezvous` — A:2612 : `schedule_events.status` (valeur libre).

#### 1.16 `modifier_deal` — A:2638 : `deals.source`. `assigner_deal` — A:2663 : `deals.assigned_user_id, assigned_at`.

#### 1.17 `envoyer_facture` / `envoyer_soumission` — `envoyerDocument` A:2877-2927
- Config : `body` (texte brut, paragraphes échappés A:2911). Exige `invoice_link`/`quote_link` (sinon échec). Délègue à `executeSendEmail` (mêmes gardes). Toujours « transactionnel » (`typeEnvoi` `desabonnement/index.ts:133`).
- Si vraiment envoyé : `invoices.status draft→sent, issued_at, sent_at` ou `quotes.sent_via_email_at, last_sent_channel='email', status→awaiting_response` + émission `quote.sent` si sortait du brouillon A:2940-2980.

#### 1.18 `webhook` — `executeWebhook` A:2717-2749
- Config : `url`. POST JSON `{org_id, entity_type, entity_id, data: vars (TOUTES les variables : nom, courriel, tél, montants…), sent_at}` via `posterSansSsrf` (`server/lib/url-sortante.ts:121`, anti-SSRF, 3 redirections, 10 s). En-tête `Idempotency-Key` en différé. **Pas de signature HMAC** (contrairement à `webhookDispatcher`). Non-2xx → échec transitoire ; « Adresse refusée » → définitif.

#### 1.19 `arreter_automatisation` — A:2753 : `automation_scheduled_tasks.status='cancelled'` (pending, même entité, cette règle ou `portee='toutes'`).

#### 1.20 `demarrer_automatisation` — A:2805 : `rule_id` ; refuse soi-même, boucle (saut `boucle`), profondeur ≥ 3 (A:2803) ; brouillon/corbeille → échec ; `demarrerRegle` E:1234 (même entrée qu'un déclencheur).

#### 1.21 Étapes de parcours (pas des actions) — `server/lib/automationSequences.ts`
- `attendre` (`duree`|`reponse`|`avant_date`), `si`, `arreter` ; `planifierEtape` l.324 écrit `automation_scheduled_tasks (step_id, action_config={...action, event_metadata} ou {type:'__sequence__', etape,...}, execute_at, sequence_context)` ; 50 étapes max (l.122). Traitement des `si`/attentes : E:1766-1878. Étape suivante planifiée seulement sur succès E:2058.

#### 1.22 Système HÉRITÉ parallèle — `server/lib/scheduler.ts`
- Table `automations` (lue l.821, **aucun écrivain dans le code**), déclencheurs `days_after_quote_sent`… (l.842-859), SMS seulement via `sendOrgSms` l.72 → `sendSmsIfConfigured`. Vérifie STOP ; **ne vérifie pas** : kill switch, pause org, heures calmes (tick 5 min, date UTC l.47), consentement, mention STOP, plafond. `handleDaysAfterQuoteSent` lit… `invoices` (l.112-120). Journal : `notifications` (l.354).

---

### 2. CHEMINS D'ENVOI SORTANTS (tous, automatisation ou non)

#### 2.1 SMS — `messages.create` (Twilio). Client unique `twilioClient` (`server/lib/config.ts:209`, enveloppé QA)

| # | Site | Déclencheur | Destinataire | org_id connu ? | STOP | Gel |
|---|---|---|---|---|---|---|
| S1 | A:1483 | automatisation | client | oui `ctx.orgId` | oui | oui |
| S2 | `server/lib/notificationHelpers.ts:306` (`sendSmsIfConfigured`) | appelé par `scheduler.ts:105` (org connu, **non transmis**) et `routes/reminders-cron.ts:531` (org connu, non transmis) | client | **non** dans la fonction (gel vérifié sans org l.298) | à l'appelant | oui (toutes orgs gelées) |
| S3 | `server/lib/agent/tools-etendus.ts:1706` | Lumi/MCP `send_sms` | client | oui | oui (l.1665) | oui |
| S4 | `server/lib/mfa-sms.ts:118` | MFA | membre | non (numéro plateforme `TWILIO_PHONE_NUMBER`) | non | non |
| S5 | `server/lib/sms/bienvenue.ts:170` | achat du numéro | propriétaire | oui | oui (l.117) | non |
| S6 | `server/lib/sms/fil-lumi.ts:67` | Lumi par texto | membre | oui | non | non |
| S7 | `server/routes/agreements.ts:1089` | contrat par SMS | client | oui `agreement.org_id` | oui | oui |
| S8 | `server/routes/communications.ts:104` | SMS manuel | client | oui | oui | oui |
| S9 | `server/routes/messages.ts:91` | messagerie | client | oui | oui | oui |
| S10 | `server/routes/messages.ts:324` | confirmation STOP/START (drapeau par canal) | client | oui | n/a | non |
| S11 | `server/routes/messages.ts:575` | réponse « vocal illisible » | membre | oui | non | non |
| S12 | `server/routes/payment-requests.ts:224` | demande de paiement | client | oui | oui | oui |
| S13 | `server/routes/quotes.ts:527` | devis par SMS | client | oui | oui | oui |

Tous passent `from` = numéro de l'org (`getOrgSmsFromNumber`) sauf S4. **Le numéro `from` identifie donc l'org dans le proxy Twilio** (`communication_channels.phone_number` → `org_id`, cf. `desabonnement/sms.ts:370`), ce qui permet un routage « sandbox » au point unique sans toucher les 13 sites. Twilio REST hors SDK : seulement `integrations/providers/twilio.ts:53` (test de connexion, GET).

#### 2.2 Courriel — un seul point : `sendEmail` M:339 (Resend `fetch` M:254 / SES ou SMTP `transport.sendMail` M:426). `org_id` = `params.suivi?.orgId`.

| Site | Voix / destinataire | `suivi.orgId` passé ? | org connu dans la portée ? |
|---|---|---|---|
| A:1320 | entreprise → client (automatisation) | oui | oui |
| `routes/emails.ts:456` facture | → client | oui | oui |
| `routes/emails.ts:620` soumission | → client | oui (**`entityType:'invoice'` avec `quote.id`**) | oui |
| `routes/emails.ts:727` soumission mobile | → client | oui | oui |
| `routes/emails.ts:769` courriel libre (to libre, admin) | → n'importe qui | oui | oui |
| `routes/emails.ts:851` essai | → soi | **non** | oui `auth.orgId` |
| `routes/communications.ts:194` courriel manuel | → client | **non** | oui `orgId` |
| `routes/request-forms.ts:860` accusé formulaire public | → prospect | **non** | oui `orgId` |
| `routes/request-forms.ts:782` alerte nouvelle demande | → membre | non | oui |
| `routes/agreements.ts:953` contrat | → client | oui | oui |
| `routes/payment-requests.ts:157` | → client | oui | oui |
| `routes/quotes.ts:357` | → client | oui | oui |
| `routes/reminders-cron.ts:481` relances facture (`reessayer`) | → client | oui | oui |
| `lib/notificationCourriel.ts:116` (`reessayer`) | → membres | oui | oui |
| `lib/paiement-recu.ts:102` (`reessayer`) | → membre | oui | oui |
| `lib/scheduled-reports.ts:145` (`reessayer`) | → `recipient_email` | **non** | oui `report.org_id` |
| `lib/courriels/reprises.ts:160` rejeu file | selon ligne | oui (`suivi` rejoué) | oui |
| `lib/courriels/reprises.ts:180`, `lib/courriels/sante.ts:174`, `lib/security-alerting.ts:124`, `lib/support/tickets.ts:292/382` | Lume → exploitant/support | non (null) | n/a |
| `lib/support/tickets.ts:419`, `routes/lumi.ts:250`, `lib/billing-email.ts:107`, `lib/subscription-email.ts:121/281`, `lib/referral-rewards.ts:364`, `routes/billing.ts:606`, `routes/payments.ts:2407`, `routes/invitations.ts:398/717`, `routes/auth.ts:51/87/286/563`, `routes/marketing.ts:243/255` | Lume → abonné/prospect/membre | non | partiel |

**Hors `sendEmail` (non couverts par QA ni gel)** : `server/lib/email/send/gmail.ts:72` (API Gmail, via `POST /api/email/send` `routes/email-accounts.ts:250-299`, compte Gmail connecté d'un membre, org connu) ; courriels Supabase Auth (SMTP configuré côté Supabase, hors code).

#### 2.3 HTTP sortant vers une URL client
- `executeWebhook` A:2728 → `posterSansSsrf` (org connu `ctx.orgId`).
- `webhookDispatcher.dispatchWebhook(orgId, …)` (`server/lib/webhookDispatcher.ts:62`) → `webhook_deliveries` → `attemptDelivery` l.130 → `posterSansSsrf` l.195 avec `X-Lume-Signature` HMAC ; 5 tentatives, backoff 2^n min (l.81-83), cron `processPendingDeliveries` l.299. Appelants : `routes/leads.ts:162/174/502/512`, `routes/payments.ts:277/309`. org connu partout.
- `posterSansSsrf` (`url-sortante.ts:121`) ne reçoit **pas** l'org → point unique à paramétrer.
- Autres sorties (non client) : Expo push `pushNotifications.ts:54` (membres), Slack support `slack.ts`, Resend/SES.

#### 2.4 QA_REDIRECT_TO / QA_REDIRECT_EMAIL — `server/lib/qa-redirect.ts`
- SMS : `envelopperTwilio` l.144 (Proxy sur `messages.create`) appliqué à l'instanciation `config.ts:209` ; le corps devient `[QA → +1514…0123] …` l.101, `to` = cible.
- Courriel : `redirigerEmail` appelé dans `sendEmail` M:366 ; `to` = cible, objet préfixé `[QA → ma…@x.com]` l.132. `email_deliveries` garde le destinataire ORIGINAL M:449-456 ; `messages.phone_number` garde l'original (A:1501).
- Limites : (1) **global au processus** (toutes les orgs), pas par tenant ; (2) redirige vers un **vrai** numéro/adresse — coût réel, quotas SES/Twilio, pas un mock ; aucune capture structurée consultable par un test ; (3) décision SMS figée au démarrage (`if (!cibleSms()) return client` l.148) alors que le courriel relit l'env à chaque appel ; (4) le préfixe `→` (U+2192) fait passer **tout** texto redirigé en UCS-2 → segments différents de la prod ; (5) non couverts : Gmail API, webhooks sortants (action + dispatcher), Expo push, Slack, Supabase Auth ; (6) plusieurs destinataires fusionnés en un ; comparaison `to === cible` brute (l.96, l.127) ; (7) en mode QA la garde « liens non publics » est désactivée M:375 ; (8) les gardes métier (STOP, consentement, plafond, gel) s'évaluent sur le vrai destinataire — bien pour tester la logique.
- Piste sandbox : le gel (`migration/gel-communications.ts`, drapeau `org_features.communications_gelees`) est déjà une garde par org dans ~10 sites, mais il est basé sur le destinataire (bloque seulement un contact client de l'org), rend un ÉCHEC (`MESSAGE_GEL`, transitoire → 4 reprises puis notification d'échec) et n'est pas dans S4/S5/S6/S10/S11, Gmail, webhooks. Un flag `org_features.sandbox_envois` au niveau de `sendEmail` (via `suivi.orgId`, à ajouter aux 4 sites « non »), du proxy Twilio (via `from` → org) et de `posterSansSsrf` (paramètre org) couvrirait tout ; prévoir aussi `communication_channels` + forfait SMS + `TWILIO_PHONE_NUMBER` pour l'org de test, sinon les textos sont SAUTÉS avant d'atteindre Twilio.

---

### 3. CONFORMITÉ

#### 3.1 STOP SMS
- Table `sms_opt_outs (org_id, phone E.164, reason, opted_out_at)`, unique `(org_id, phone)`.
- Entrant : `routes/messages.ts:300-340`. Drapeau `auto_desabonnement_canal` ON → `appliquerMotCleSms` (`desabonnement/sms.ts:391`) : mots `MOTS_STOP`/`MOTS_START` (`desabonnement/index.ts:56-58`, normalisés sans accents/ponctuation), portée = org du numéro `To`, `consents` journalisé, confirmation envoyée (S10). OFF → `appliquerMotCleHerite` (`sms.ts:487`) : regex l.455-456 ; STOP → org du `To`, sinon **toutes** les orgs ayant une conversation avec ce numéro ; START seulement org du `To`.
- Vérifié avant envoi : S1 (A:1415), S2 via scheduler (`scheduler.ts:87`) et reminders-cron (l.509), S3, S5, S7, S8, S9, S12, S13. **Non vérifié** : S4 MFA, S6, S11 (membres), S10.
- Fail-open : `isSmsOptedOut` (`notificationHelpers.ts:141`) ; S1 ignore l'erreur (A:1415-1420).

#### 3.2 Désabonnement courriel
- Table `email_unsubscribes (org_id, email lower, token, category 'pending'|'all'…, unsubscribed_at, reason)`. `isEmailUnsubscribed` (`notificationHelpers.ts:176`, fail-open) ; `clients.email_opt_out_at` lu par le consentement (A:425) et `etatDesabonnement` (`desabonnement/index.ts:166`).
- Lien injecté : **seulement si `ctx.commercial`** (A:1253) → pied `<a href="${FRONTEND_URL}/api/unsubscribe/${token}">` (A:1278-1282, texte FR/EN selon langue entreprise) + `List-Unsubscribe` / `List-Unsubscribe-Post: One-Click` (A:1335-1342). Route `routes/unsubscribe.ts:133` (GET, page de choix courriel/texto) et l.227 (POST one-click) → `category='all'` + `consents` + éventuellement `sms_opt_outs`.
- Vérifié : automatisations (A:1205), `reminders-cron` (adresse injoignable l.436). Les routes manuelles (facture, soumission, contrat) ne le vérifient pas (transactionnel, voulu).

#### 3.3 Consentement (LCAP / Loi 25)
- `consentementCommercial` A:360-453 : destinataire retrouvé dans `clients` par courriel exact (lower) ou par 10 derniers chiffres du téléphone (préfiltre `ilike %4 derniers`, 50 lignes) ; inconnu du carnet + commercial → refus. Exprès : `clients.email_consent_at` / `sms_consent_at`. Tacite : `baseTacite` (`consentement/base-legale.ts:86-124`) — dernier job ou facture (`created_at`, tout statut, non supprimé) + 730 j ; sinon dernier devis + 182 j (l.39-41). Erreur de lecture → refus « technique » (échec transitoire) pour un commercial.
- Journal : RPC `record_consent` → `consents` (`method = crm-expres | lcap-tacite:<raison>`, `doc_version` = id de la pièce) A:462-483.
- Qui vérifie : S1 et le courriel d'automatisation seulement quand `ctx.commercial` (donc **jamais en immédiat sans drapeau**, même un envoi marketing). `request_review` immédiat : consentement non vérifié (ctx non commercial), seul le plafond l'est. Aucune route manuelle ni l'agent ne vérifient le consentement (hors STOP).
- Type d'envoi : `typeEnvoi` (`desabonnement/index.ts:123-145`) : choix explicite `config.type_envoi` > action (`request_review`=marketing ; `envoyer_*`=transactionnel) > preset (listes l.87-98) > déclencheur transactionnel (l.101-109) > accusé immédiat `lead.created`/`quote.sent` > `job.completed` < 7 j > défaut **marketing**.

#### 3.4 Contenu LCAP
- Texto marketing/sollicitation : `avecMentionCommerciale` (`desabonnement/index.ts:309`) ajoute `\n<Entreprise ≤40> - Répondez STOP pour ne plus recevoir.` si absents (détection STOP en MAJUSCULES l.297).
- Courriel marketing : exige `company_name` + `company_address` sinon saut (A:1148-1154, A:1223).

#### 3.5 Heures calmes
- Fenêtre 8 h–20 h (E:304-305) dans le fuseau `company_settings.timezone` (`fuseauOrg`, défaut `FUSEAU_DEFAUT`), réglable par règle `settings.fenetre {debut, fin}` + `jours_ouvrables` (E:345-362).
- Immédiat (`shouldRespectQuietHours` E:413-426) : `send_sms` et `request_review` toujours ; courriels seulement si délai ≠ 0 ou fenêtre réglée → tâche différée `report_heures_calmes:true` (reste transactionnelle) E:764-789.
- Différé : tout `ACTIONS_MESSAGE` (E:411) repoussé via `nextSendTime` (pas de 30 min, 24 h ou 72 h, repli = `from` si rien trouvé E:442) ; rappel annulé si la fenêtre tombe après `event_metadata.start_time|start_at` E:1632-1649.
- Absent : `scheduler.ts` hérité, `reminders-cron`, routes manuelles, agent. Pas de jours fériés.

---

### 4. RENDU DES COURRIELS D'AUTOMATISATION (marque)

- Enveloppe : `buildEmailLayout` (`routes/emails.ts:190-202`) → `rendreCourrielClient` (`server/lib/courriels/gabarit.ts:449-510`), `signature: null`.
- Marque (`getCompanySettings` `routes/emails.ts:84-152`, `company_settings` + `tax_configs`) : logo `logo_url` (alt = nom, l.468-474) sinon nom en texte ; filet 2 px + bouton + liens du pied à la couleur `brand_color` validée par contraste (`couleurBouton` l.204-212, repli `#111827`) ; pied : tél (tel:), courriel (mailto:), nom · adresse · site, réseaux sociaux, numéros de taxes (l.486-496). `<html lang>` = langue entreprise. Fond blanc, carte bordée.
- Mascotte Lume : **retirée** (commentaire l.497-500 « audit 2026-09-29, marque blanche »). `MOTS.envoyeAvec` (« Envoyé avec ») subsiste l.541-542 mais n'est utilisé nulle part.
- Traces Lume restantes dans un courriel client automatisé :
  1. Adresse d'expédition `<slug-entreprise>@<domaine de EMAIL_FROM>` (lumecrm.net) sauf domaine vérifié (`senderFor` `routes/emails.ts:236-248`, `senderForOrg` l.260) — nom affiché = entreprise ou `from_name`.
  2. Si le nom d'entreprise est vide (ou `getCompanySettings` a échoué → `{}` l.149-151) : `from` sans nom → `expediteurComplet` le rebaptise **« Lume CRM »** et Reply-To = `support@lumecrm.net` (`courriels/garde-envoi.ts:118-124`, M:346-351). Le commercial est alors sauté (identité manquante), mais le transactionnel part ainsi.
  3. Reply-To : `company_email` → courriel du propriétaire → (si expéditeur plateforme) `SUPPORT_EMAIL`.
  4. Liens : bouton / lien de secours / désabonnement / sondage sur le domaine `PUBLIC_URL`/`FRONTEND_URL` (`/quote/`, `/invoice/`, `/pay/`, `/survey/`, `/api/unsubscribe/`).
  5. `Message-ID`/en-têtes du fournisseur (Resend/SES) ; `User-Agent: Lume-Automations/1` sur les webhooks (`url-sortante.ts:145`).
  6. Courriel de demande d'avis : bloc HTML propre à `reviewEmail` (`reviews.ts:176-219`) imbriqué dans le gabarit (bouton `#171717` si pas de couleur).
- Bouton d'entité : `boutonPourEntite` (`courriels/bouton-automatisation.ts:92`) — quote : « Approuver la soumission » (ou « Voir » selon statut), invoice : « Payer la facture »/« Voir le reçu », void → aucun ; autres entités → pas de bouton.
- Préheader : `config.preheader` (div masqué, `<>` retirés A:1311-1314) sinon `preheaderDepuis(corps)` (gabarit l.171).
- Partie texte : `htmlVersTextePourEnvoi` (`courriels/texte.ts:120`) si absente.

---

### 5. LANGUE

- Messages client d'automatisation : langue de l'ORG (`company_settings.default_language === 'en'`, cache 5 min, défaut fr) E:459-475 → `champLocalise` prend `<champ>_en` s'il est non vide, sinon FR (A:183-189). Aucune langue par client.
- Bouton + pied de désabonnement + `<html lang>` : `langueEntreprise` = `langueDe` (`startsWith('en')`, gabarit l.545) — critère différent de `langueOrg` (`=== 'en'`) : `'en-CA'` donnerait corps FR + bouton EN.
- Montants : `fr-CA`/`en-CA` selon langue org (A:713-716). **Dates de rendez-vous toujours `fr-CA`** (A:1012-1013) ; `invoice_due_date`, `quote_valid_until` en ISO brut (A:834, A:953).
- `envoyer_facture/soumission` : textes par défaut FR/EN (A:2905-2919). `request_review` : courriel FR/EN (`reviewEmail` options.langue), **SMS toujours le défaut FR** (`reviewSmsBody` `reviews.ts:155-161` n'a pas de langue) ; replis « notre équipe », « votre projet » en FR (A:1969-1970).
- Notifications internes : `memberships.language` par membre (A:1548). STOP : `default_language` (`sms.ts:437`). Mention STOP : `ctx.langue` (A:1450).
- Messages d'erreur des routes d'automatisations : `Accept-Language` (`automations-langue.ts:31`), sans rapport avec les envois.
- SMS encodage/segments : **aucun calcul à l'envoi**. `segmentsSms(texte)` existe (`desabonnement/index.ts:334-345`, GSM-7 160/153, UCS-2 70/67, extension = 2 unités) mais n'est utilisé que par `tests/automation/conformite-envois-vague3.test.ts`. Table GSM-7 l.325-327 : contient é è ù ì ò à É Ç, **pas** ê â î ô û ç ë ï ni ’ « » – — → un seul de ces caractères passe le texto en UCS-2. `messageConfirmation` STOP FR contient « êtes » (UCS-2). La mention STOP est GSM-7.

---

### 6. PLAFONDS / ANTI-SPAM / ANTI-DOUBLON

| Mécanisme | Portée | Valeur | Où | Effet |
|---|---|---|---|---|
| Plafond commercial | destinataire, tous canaux… en fait **par canal** (SMS : `messages` outbound `sender_user_id` NULL ; courriel : `activity_log email_sent metadata->>to`) | 3 / 24 h (`AUTOMATION_MAX_COMMERCIAL_PER_DAY`) | A:233-280 | **échec** définitif (`frequency cap`) → parcours arrêté + notification d'échec ; fail-open |
| Débit texto | org | 30 textos réussis / min (`automation_execution_logs`) | E:516-531, E:791, E:1882 | report d'1 min |
| Relance facture | facture | 1 envoi / 20 h entre règles de relance | E:544-583 | saut `deja_envoye` |
| Anti-doublon immédiat | règle+entité+action | tranche 2 min | E:498, E:592-671 | ignoré |
| Rejeu outbox | idem | depuis `rejoueDepuis` | E:613-629 | ignoré |
| Clé d'exécution différée | règle+entité+index (+suffixe si `reentree`) | index unique pending/running | E:264-290 | insert 23505 ignoré |
| « Déjà envoyé » | même texte/objet au même destinataire depuis la 1re tentative | — | A:153-171 | saut |
| Idempotence Resend | tâche:étape | 24 h | E:1933, M:259 | — |
| Demande d'avis | client | 7 j (`review_requests`) | A:1925-1939 | échec |
| Passage par client | règle+entité | N jours (`settings.delai_entre_passages_jours`) | E:1280-1300 | ignoré |
| Chaînage | parcours | profondeur 3, pas de cycle | A:2803-2829 | saut `boucle` |
| Étapes | parcours | 50 | `automationSequences.ts:122` | abandon |
| Lot de visites | événement | `metadata.suppress_immediate` | E:1190, E:1216 | pas de confirmation |
| Gel | org (destinataire client de l'org gelée) | `org_features.communications_gelees`, cache 20 s | `migration/gel-communications.ts:31-136` | échec `MESSAGE_GEL` (transitoire) |
| Pause / arrêt | org / global | `automations_paused` / `AUTOMATIONS_ENABLED` | E:1062-1070 | rien traité, file conservée |

Pas de plafond quotidien par org ni par règle (choix F11).

---

### 7. INJECTION HTML dans les courriels

- `resolveTemplate(template, vars, {html})` A:557-579 : regex `\{\{objet.cle\}\}|\{(\w+)\}|\[(\w+)\]`, UNE passe, variable inconnue → `''`. Avec `html:true`, chaque valeur passe par `echapperHtml` (A:546-548 : `& < > " '`) **sauf si le nom de clé finit par `_html`** (A:562-563).
- Appliqué : corps `send_email` (A:1173, html:true) ; sujet sans échappement (en-tête, `nettoyerObjet` écrase `\s+` donc CRLF, `garde-envoi.ts:67`) ; `from_name` sans échappement, `<>"` retirés (A:1295-1300) ; préheader : `<>` retirés seulement (A:1313) ; `envoyer_*` : texte de l'auteur échappé puis variables échappées (A:2911, A:2921) ; `reviewEmail` échappe le paragraphe entier après résolution (`reviews.ts:206`) ; gabarit : `titre`, `intro`, `note`, `signature`, `lignes`, `montant`, URL du bouton échappés (`gabarit.ts:185-187`, l.243-277), `corpsHtml` inséré brut (l.441).
- Variables `_html` légitimes : `contract_html` (URL publique + jeton, A:624).
- Le corps HTML écrit dans la règle n'est pas assaini (contrairement aux routes manuelles `sanitizeHtml` `routes/emails.ts:26`) — c'est le contenu de l'entreprise elle-même.

---

### 8. FONCTIONS PURES (candidates aux tests unitaires)

- `resolveTemplate(template: string, vars: Record<string,string|null|undefined>, options?: {html?: boolean}): string` — A:557
- `echapperHtml(v: string): string` — A:546
- `sansPrenomVide(texte: string): string` — A:525 ; `accorderPluriels(texte: string, langue?: 'fr'|'en'): string` — A:538
- `messageEchecCourriel(brut: string|null|undefined): string` — A:1135 ; `identiteManquante(company: {company_name?, company_address?}): string|null` — A:1148
- `estEnvoye(r: ActionResult): boolean` — A:174
- `applyTemplate(template, vars): string` (variante qui GARDE les inconnues) — `notificationHelpers.ts:354`
- `evaluateConditions(conditions: Record<string,any>, event: CRMEvent): boolean` — E:177 ; `regleViseCetEvenement(rule, event): boolean` — E:79
- `isQuietHours(d?: Date, tz?: string): boolean` — E:330 ; `horsFenetre(reglages, d?, tz?): boolean` — E:345 ; `nextSendTime(from?, reglages?, tz?): Date` — E:429
- `isTransientFailure(error?: string|null): boolean` — E:1360 ; `motifAnnulationRegle(regle): string|null` — E:1265 ; `estRegleDeRelanceFacture(r): boolean` — E:544 ; `statutAvecAlias(entityType, statut)` — E:2199
- `typeEnvoi(p: {actionType, config?, declencheur?, delaiSecondes?, presetKey?}): 'transactionnel'|'marketing'` — `desabonnement/index.ts:123`
- `motCle(t)`, `estStop(t)`, `estStart(t)` — l.43-65 ; `messageConfirmation(genre, entreprise, langue)` — l.68 ; `motifSaut(canal)` — l.148 ; `motCleHerite(corps): 'stop'|'start'|null` — `desabonnement/sms.ts:466`
- `avecMentionCommerciale(corps: string, nomEntreprise: string|null|undefined, langue: 'fr'|'en'): string` — `desabonnement/index.ts:309` ; `phraseStop(langue)` — l.286
- `segmentsSms(texte: string): {encodage: 'GSM-7'|'UCS-2'; unites: number; segments: number}` — l.334
- `baseTacite(ancrages: AncragesTacite, maintenant?: Date): BaseLegale|null` — `consentement/base-legale.ts:86` ; `baseLegalePour(consentiLe, ancrages, maintenant?)` — l.132 ; `decrireBase(base)` — l.145 ; `methodePourJournal(base)` — l.153
- `redirigerSms(to, body): RedirectionSms` — `qa-redirect.ts:90` ; `redirigerEmail(to, subject): RedirectionEmail` — l.118 ; `envelopperTwilio(client)` — l.144
- `fournisseurCourriel(env?)`, `raisonSmtpMalgreResend(env?)`, `raisonSesSansSuivi(env?)` — M:111/140/162
- `liensNonPublics(...contenus): string[]`, `nettoyerObjet(o)`, `ecartsObjet(o)`, `premierObjetQuiTient(c)`, `decomposerExpediteur(from)`, `expediteurComplet(from, adressePlateforme, nomDeRepli?)`, `estAdressePlateforme(from, adr)` — `courriels/garde-envoi.ts:55-129`
- `rendreCourrielClient(c: CourrielClient): string`, `rendreCourrielLume(c)`, `couleurBouton(c)`, `preheaderDepuis(html)`, `echapper(s)`, `montant(cents, currency?, langue?)`, `dateLisible(iso, langue?, fuseau?)`, `langueDe(v)` — `courriels/gabarit.ts`
- `prefixeDepuisNom(nom): string|null`, `senderFor(company)`, `marqueDepuis(company)`, `langueEntreprise(company)`, `buildEmailLayout(company, bodyHtml, bouton?)` — `routes/emails.ts:155-248`
- `resolveReviewTemplate(t, vars)`, `reviewSmsBody(settings, vars)`, `reviewEmail(settings, vars, options)`, `reviewDestinations(settings)` — `server/lib/reviews.ts:117-219`
- `htmlVersTextePourEnvoi(html)`, `decoderEntites(s)`, `texteDeLien(href, libelle)` — `courriels/texte.ts`
- `delaiAvantTentative(n)`, `planifierPremiereReprise(d)`, `apresEchec(n, d, err)`, `apresSucces(n)`, `estAReprendre(ligne, d)`, `courrielAbandon(ligne, support?)` — `courriels/reprises.ts:63-109`
- `ipNonPublique(ip)`, `adresseAcceptable(url)` — `url-sortante.ts:26/71` ; `normalizeE164(phone)` — `helpers.ts:404`
- Séquences : `premiereEtape`, `etapesDeConfirmation`, `premiereEtapeSansConfirmation`, `trouverEtape`, `cleEtape`, `problemesDuGraphe`, `etapeSuivante` — `automationSequences.ts:125-550`

---

### 9. Défauts suspectés (à confirmer par test)

1. **Injection HTML via champ personnalisé** : une clé de champ finissant par `_html` (clé permise `^[a-z][a-z0-9_]{0,49}$`, `validation.ts:1393`) désactive l'échappement de sa valeur (`{{client.notes_html}}` / `{client_cf_notes_html}`) — A:562-563.
2. **Courriel marketing immédiat sans lien de désabonnement, sans consentement, sans plafond** (drapeau par canal OFF) : `ctx.commercial` absent en immédiat (E:752-754) alors que `ctx.marketing` est vrai ; le pied/`List-Unsubscribe` dépend de `ctx.commercial` (A:1253) — LCAP.
3. `resolveTemplate` efface `[50]`, `{0}` (`\w+` accepte les chiffres) — le défaut corrigé dans `applyTemplate` (`notificationHelpers.ts:342-345`) subsiste A:570 : « Rabais [50] % » → « Rabais  % ».
4. `request_review` : client sans prénom → « Bonjour Bonjour, » (repli `'Bonjour'` A:1920-1922 injecté dans `client_first_name` A:1967, gabarit `reviews.ts:65`) ; SMS toujours FR (`reviews.ts:156`) ; replis FR (A:1969-1970).
5. `request_review` : double résolution — sujet/corps déjà résolus sont re-résolus par `executeSendEmail`/`executeSendSms` (A:2010, A:2016) : un nom contenant `[client_email]` est substitué au 2e passage.
6. `request_review` : « pas de courriel ni de tél » (A:1916), « lien non configuré » (A:1887) et « déjà envoyé en 7 j » (A:1938) sont des échecs TRANSITOIRES → 4 tentatives + notification « Échec d'envoi » ; devraient être des sauts/définitifs. `satisfaction_surveys` est créé avant de savoir si quoi que ce soit part (A:1945).
7. Actions immédiates : aucune reprise sur échec transitoire (SMTP/Twilio) — confirmation perdue (E:874-887) ; `executeSendEmail` n'utilise pas non plus `reessayer`.
8. Dates de rendez-vous toujours formatées `fr-CA` pour une org anglaise (A:1012-1013) ; `invoice_due_date`/`quote_valid_until` en ISO brut (A:834, A:953).
9. `routes/emails.ts:624` : envoi de soumission journalisé `entityType:'invoice'` avec `entityId: quote.id` (badge « non livré » / ouverture mal rattachés).
10. `adresseInjoignable` utilise `ilike` sans échapper `_`/`%` (M:501) : `jean_x@…` matche `jeanAx@…`.
11. `sms_opt_outs` lu sans vérifier l'erreur dans l'action SMS (A:1415-1420) : panne de lecture = envoi à un désabonné (même fail-open que `isSmsOptedOut`, mais sans journal).
12. Système hérité `scheduler.ts` (table `automations`) : ignore kill switch, pause, heures calmes (date UTC `scheduler.ts:47`), consentement, mention STOP ; `handleDaysAfterQuoteSent` lit `invoices` (l.112-120). Aucun écrivain dans le code, lignes existantes éventuelles toujours actives.
13. Gel pendant import : échec transitoire (A:1474, M:391) → chaque parcours en cours consomme ses 4 tentatives puis s'arrête avec notification, au lieu d'attendre l'activation.
14. `langueOrg` (`=== 'en'`, E:469) vs `langueDe` (`startsWith('en')`, gabarit l.546) : valeur `en-CA` → corps FR, bouton/pied EN.
15. Agent `send_sms` : garde anti-exfiltration `ilike '%<10 chiffres>%'` (`tools-etendus.ts:1680`) rate les numéros stockés formatés « (819) 479-0116 » — le défaut déjà corrigé dans `consentementCommercial` (A:397-412).
16. `nextSendTime` retourne `from` (donc en pleine heure calme) si aucune fenêtre n'est trouvée, p. ex. `fenetre.debut >= fin` (E:442).
17. Tacite : un devis créé par l'entreprise (non demandé) compte comme « demande d'information » 6 mois ; un job/facture annulé ou brouillon compte comme relation d'affaires (A:337-358, `base-legale.ts:92-121`).
18. Envois sans `suivi.orgId` alors que l'org est connue (bloquant pour un flag sandbox et pour `email_deliveries.org_id`) : `routes/communications.ts:194`, `routes/request-forms.ts:860`, `routes/emails.ts:851`, `lib/scheduled-reports.ts:145` ; `sendSmsIfConfigured` n'a pas de paramètre org (`notificationHelpers.ts:285`).

---

# Partie 3 — Points d'entrée et systèmes adjacents

## Inventaire 3 — Points d'entrée et systèmes adjacents des automatisations (Lume CRM)

Source : le CODE du worktree `wt-autotest` (HEAD 5487b250, #808). Lecture seule, aucune base touchée.
Chemins relatifs à la racine du worktree. `⚠` = bug/écart suspecté (voir récap §8).
**Numéros de ligne = HEAD 5487b250.** Pendant l'inventaire, une autre session a modifié le worktree sans commit (`automationEngine.ts` passé de 2493 à 2503 lignes + réécriture CRLF, `actions/index.ts`, `mailer.ts`, `config.ts`, `url-sortante.ts`, `webhookDispatcher.ts` ; nouveaux `server/lib/bac-a-sable.ts`, `tests/automations-suite/`, `vitest.automations.config.ts`, migration `20261005100000_bac_a_sable_envois.sql`) : les lignes de `automationEngine.ts` peuvent être décalées d'environ 10 dans le working tree.

---

### 1. API — routes HTTP

#### 1.0 Montage et chaîne de middlewares (`server/index.ts`)
- `webhooksEntrantsRouter` monté TÔT : `server/index.ts:384` (avant rbac, public, corps brut).
- Limiteurs : `automationLimiter` 30/min sur `/api/automations/events` (`:652`, `:702`) ; `reglesLimiter` sur `/api/automations/rules` (`:704`).
- `app.use(rbacMiddleware())` `:815` → `subscriptionGuard()` `:819` → `featureGuard()` `:824` (préfixes `/api/automations/` et `/api/reminders/` exigent `includes_automations`, `server/lib/feature-guard.ts:65-69`).
- Routeurs : `automationTestRouter :845`, `automationEventsRouter :846`, `automationRulesRouter :847`, `automationPublicationRouter :848`, `automationStatsRouter :849`, `cronRouter :867`, `remindersCronRouter :868`, `remindersRouter :869`, `scheduledReportsRouter :872`, `lumiRouter :885`.
- `rbacMiddleware` (`server/lib/route-permissions.ts:493-537`) : clé cherchée dans `ROUTE_PERMISSIONS` par méthode+chemin (segments UUID/numériques/>10 car. remplacés par `:id`… `:449-475`) ; **route absente de la table = laissée passer** (`:514`) ; puis `requireAuthedClient` + `getUserContext` + `hasPermission` (un tableau = OU). Préfixes publics `:463-491` (`/api/webhooks/` etc., `/api/hooks/` n'y est PAS mais le routeur est monté avant rbac).
- Org : partout `requireAuthedClient(req,res)` → `auth.orgId` (org de la SESSION / bureau actif), jamais un org_id du corps.

#### 1.1 `server/routes/automation-rules.ts` (client de l'UTILISATEUR ⇒ RLS = garde de fond, `:23-27`)
| Méthode / chemin | Perm. rbac (`route-permissions.ts`) | Zod | Scoping / notes |
|---|---|---|---|
| GET `/api/automations/rules` `:118` | `automations.read` `:116` | — | `.eq('org_id', auth.orgId).is('purged_at', null)` `:125-130` ; renvoie aussi le catalogue filtré par drapeaux `catalogueOffert` `:151-157` |
| GET `/api/automations/editeur?rule_id=` `:168` | `automations.read` `:120` | regex uuid `:172` | règle + liste légère des autres publiées `:176-197` |
| POST `/api/automations/rules` `:213` | `automations.update` `:125` | `automationRuleCreateSchema` (`validation.ts:1313`) | `folder_id` vérifié dans le bureau `dossierDuBureau` `:207-211` ; `verifierCoherence` (délai négatif seulement pour déclencheur `accepte_delai_negatif`, actions identiques refusées) `:72-114` ; `is_active:true` ⇒ `problemesBloquants` `:225-228` ; `is_preset:false, preset_key:null` forcés `:247-248` |
| POST `/api/automations/rules/generer` `:310` | `automations.update` `:137` | aucun Zod (lecture manuelle `demande`≥10, `langue`, `echanges` ≤6, `parcours_actuel`) | `genererParcours` (Sonnet, budget Lumi) puis `sequenceEtapes.safeParse` `:371`, `trouverDeclencheur` `:384`, `refAutomatisationInventee` (règle citée par demarrer/arreter doit exister dans l'org) `:398,490-505` ; n'ENREGISTRE rien sauf `lumi_conversation` (≤40 tours) `:439-473` ; échec ⇒ `retirerBrouillonVide` (<10 min, sans étape) `:272-294` |
| PATCH `/api/automations/rules/:id` `:509` | `automations.update` `:126` | `automationRuleUpdateSchema` (seules les clés ENVOYÉES, `validation.ts:1345-1363`) | lecture `.eq('org_id')` `:516-521` ; preset : `trigger_event` immuable `:539-543` ; copie liée détachée (`modele_id=null`) `:533` ; publiée ⇒ refuse un parcours qui AJOUTE un problème `:570-577` ; propage aux copies des autres bureaux `:597-603` |
| GET `/api/automations/templates` `:615` | `automations.read` `:129` | — | catalogue global `MODELES_AUTOMATISATION` (cache 300 s) |
| POST `/api/automations/templates/utiliser` `:631` | `automations.update` `:130` | `automationModeleUtiliserSchema` (`templateId` seul, `.strict()`, `validation.ts:1333`) | copie profonde en BROUILLON dans l'org de session `:668-688` ; idempotence `Idempotency-Key` en MÉMOIRE 10 min `:628-646` (par instance) |
| POST `/api/automations/rules/:id/duplicate` `:713` | `automations.update` `:128` | — | copie `is_active:false, is_preset:false` `:730-751` |
| DELETE `/api/automations/rules/:id` `:766` | `automations.update` `:127` | — | preset refusé `:782-786` ; annule les tâches `pending` en **service_role** filtré org `:807-813` puis soft-delete `deleted_at` `:830-834` |
| POST `/api/automations/rules/:id/restaurer` `:855` | `automations.update` `:150` | — | revient en brouillon `:859-868` |
| DELETE `/api/automations/rules/:id/definitivement` `:892` | `automations.update` `:152` | — | `purged_at` (pas de DELETE réel) `:896-904` |
| GET/POST/PATCH/DELETE `/api/automations/folders[/:id]` `:926-1015` | read/update `:153-156` | `dossierCreateSchema`/`dossierUpdateSchema` | `.eq('org_id')` ; 409 sur nom dupliqué ; DELETE 0 ligne ⇒ 404 |
| GET `/api/automations/bureaux-cibles` `:1020` | `automations.update` `:135` | — | `bureauxCibles(user, org)` |
| POST `/api/automations/rules/:id/copier-bureaux` `:1031` | `automations.update` `:131` | `automationCopieBureauxSchema` (`org_ids` uuid ≤50) | `copierVersBureaux(jwt, user, org, id, org_ids)` — vérification d'appartenance des `org_ids` déléguée à `server/lib/automatisations-bureaux.ts` (client JWT de l'utilisateur) |
| GET/POST `/api/automations/pause` `:1054`, `:1074` | read / update `:163-164` | aucun (`paused === true`) | écrit `company_settings.automations_paused*` ; 0 ligne (RLS admin) ⇒ 403 `:1104-1110` ; `oublierPause(org)` vide le cache 15 s `:1114` |
| GET/POST/PATCH/DELETE `/api/automations/webhooks[/:id][/regenerer]` `:1159-1300` | read/update `:157-161` | aucun Zod (nom tronqué 80) | clé jamais relue (suffixe via service_role après garde RLS) `:1141-1157` ; régénération : droit vérifié par UPDATE RLS puis clé écrite en service_role `:1217-1248` |

#### 1.2 `server/routes/automation-publication.ts`
- POST `/api/automations/rules/publication` `:24` (lot, `publicationLotSchema`) et POST `/api/automations/rules/:id/publication` `:42` (`publicationSchema`) — perm. `automations.update` `route-permissions.ts:133-134` ; délèguent à `changerPublication(client, org, id, actif)` (`server/lib/automations-publication.ts:46-90`) : refuse de publier une règle en corbeille `:69-74` et un parcours avec `problemesBloquants` `:75-78` ; `.select()` pour détecter 0 ligne RLS.

#### 1.3 `server/routes/automation-stats.ts`
- GET `/api/automations/rules/stats` `:203` — `automations.read` `:118`.

#### 1.4 `server/routes/automation-test.ts`
- GET `/api/automations/test` `:36` — `automations.read` `:112` + garde owner/admin `isOrgAdminOrOwner` `:41-42` ; lecture service_role bornée à `auth.orgId`. En-tête `:1-20` prétend « simule des événements via l'event bus » : **aucun `eventBus.emit` ni écriture dans le fichier** (import inutilisé) — doc périmée.
- POST `/api/automations/rules/:id/apercu` `:316` (« Tester ») — `automations.read` `:124` ; règle + client d'exemple lus avec la session (RLS) `:322-333` ; RIEN n'est envoyé.

#### 1.5 `server/routes/automation-events.ts` (pont navigateur → moteur ; `automationEventSchema`)
| Route | Perm. | Comportement / scoping |
|---|---|---|
| POST `.../appointment-created` `:23`, `.../appointment-cancelled` `:33`, `.../quote-approved` `:313`, `.../invoice-paid` `:323` | `automations.update` / `financial.view_invoices` | **no-op** `{ok:true, via:'base'}` : l'événement naît d'un trigger SQL (`20261003100000_evenements_automatisations_par_la_base.sql:98-189`) |
| POST `.../appointment-rescheduled` `:52` | `['jobs.update','calendar.update']` `:169` | annule en service_role les tâches `pending` où `entity_id = eventId` ET `org_id = auth.orgId` `:71-84`, puis ré-émet `appointment.created` avec `entityId:eventId`, `job_id/client_id/start_time` DU CORPS, **sans vérifier que `eventId` appartient à l'org** `:102-114` ⚠ |
| POST `.../job-completed` `:124` | `jobs.complete` `:140` | job lu `.eq('org_id')` `:134-141` ; si `req.userContext.role==='technician'` émet `job.ready_for_invoicing` + notifie owners/admins `:164-215`. **`job.status` lu mais jamais vérifié** (`:136`) ⚠ |
| POST `.../deal-stage-changed` `:231` | `automations.update` `:141` | émet `pipeline_deal.stage_changed` (ANCIEN pipeline porte-à-porte, `eventBus.ts:16-20`) ; `dealId` non vérifié, lead lu avec filtre org |
| POST `.../quote-sent` `:293` | `automations.update` `:142` | émet `quote.sent` avec `entityId: quoteId || ''` **sans aucune lecture/vérification org du devis** `:299-305` ⚠ ; appelant front `emitQuoteSent` sans usage trouvé (le serveur émet déjà `quote.sent` : `server/routes/quotes.ts:421,575`, `server/lib/actions/index.ts:2969`) |
| POST `.../lead-created` `:332`, `.../lead-status-changed` `:367` | `automations.update` `:145-146` | lead lu `.eq('org_id')` mais **émis même si introuvable** (`lead` null ⇒ métadonnées vides, `entityId` du corps) `:340-364`, `:375-398` ⚠ ; doublon possible avec `server/routes/leads.ts:153,615` et `request-forms.ts:940` (le front n'appelle plus `emitLeadCreated/StatusChanged` : aucun usage dans `src/`) |
| POST `.../client-tagged` / `.../client-untagged` `:439-440` | `['clients.update','leads.update']` `:170-171` | client vérifié dans l'org + état réel de l'étiquette `:417-427` |
| POST `.../task-completed` `:446` | `['jobs.update','clients.update','leads.update']` `:174` | tâche `.eq('org_id')` + `status==='done'` `:453-465` ; client résolu par liens, tous filtrés org |
- Appelants front : `src/lib/automationEventsApi.ts:21-33` (fire-and-forget, `console.warn`), utilisés par `jobsApi.ts:1238`, `pipelineApi.ts:398,452`, `scheduleApi.ts`, `etiquettesApi.ts`, `tasksApi.ts`.
- `GET /api/automations/clients-inactifs/apercu` vit dans `server/routes/reservation.ts:133` (perm. `automations.read` `route-permissions.ts:122`).

#### 1.6 Webhook entrant public — `server/routes/webhooks-entrants.ts`
- POST `/api/hooks/:cle` `:118` ; corps brut ; clé = 64 hex `:131` ; limitation par IP et par clé `:122-140` ; lookup `automation_webhooks.api_key = cle` en service_role `:144-149` (égalité SQL, pas de comparaison à temps constant — acceptable, 256 bits) ; désactivé/inconnu ⇒ même 404 ; **garde de forfait** `horsForfaitPourOrg(hook.org_id,'includes_automations')` `:166-172` ; trace `automation_webhook_receipts` puis `eventBus.emit('webhook.received', entityType 'automation_webhook_receipt', entityId = id de la trace)` `:223-250`. L'org vient de la clé, jamais du corps.

#### 1.7 Schémas Zod clés (`server/lib/validation.ts`)
- `conditionsAutomatisation` `:1034-1067` : clé → valeur | `{eq,neq,in,not_in,gt,gte,lt,lte}` (`.strict()`) | tableau `champs_perso` (`conditionChampSchema` `:1023-1031`, 19 opérateurs de champs perso) ; ≤10 clés.
- `etapeSequence` `:1094-1148` : `action` (`actionAutomatisation` + `log_activity` hors catalogue `:1086-1092`), `attendre` (`mode: duree|reponse|avant_date`, `si_reponse`, `secondes_avant` ≤30 j, `si_depasse`), `si` (`conditions`, `alors`, `sinon`), `arreter`.
- `sequenceEtapes` ≤30 étapes + `problemesDuGraphe` (renvois, boucles) `:1165-1173`.
- `automationSettingsSchema` `.strict()` `:1190-1236` : `reentree`, `arret_sur_reponse`, `fenetre{debut 7..21, fin 8..22, debut<fin}`, `jours_ouvrables`, `delai_entre_passages_jours` 1..365, `marquer_lu` (accepté, IGNORÉ), `arreter_si_resolu`.
- `corpsAutomatisation` `:1238-1290` (`trigger_event` = `cleDeclencheur`, délai −30 j..+1 an, `actions` 1..20, ≤5 si pas de `steps` `:1303-1311`, `steps: []` ⇒ null).

---

### 2. UI — pages, éditeur, client API, et écarts UI ↔ moteur

#### 2.1 Routes et pages (`src/App.tsx`)
- `/automations` → `pages/Automations.tsx` (`App.tsx:1654`), `/automations/apercu` → `AutomationsApercu.tsx` (`:1663`), `/automations/reglages` → `AutomationsReglages.tsx` (`:1664`, perm. `automations.update`), `/automations/:id` (et `/automations/nouvelle`) → `AutomationBuilderPage.tsx` plein écran (`:1668`, perm. `automations.update`). Toutes derrière `Gated permission` + `PlanFeatureGate flag="includes_automations"` ; toutes en `lazyResilient` (`:104-107`). Entrée de menu `:1145`.
- **Liste** (`Automations.tsx`) : onglets `toutes | verifier | corbeille | modeles` (`:436-438`, `:1200`), dossiers, filtres/tri/pagination, sélection en lot (publication en lot), `BandeauPause` (« Tout arrêter », `:1251`), `BibliothequeModeles` (« Partir d'un modèle », `:1253-1260`), `CopierVersBureauxModal`, liens Aperçu/Réglages (`:1225`, `:1235`), création `/automations/nouvelle[?lumi=1]` (`:759`).
- **Éditeur plein écran** (`AutomationBuilderPage.tsx`) : onglets `parcours | reglages | historique | journaux` (`:98`, `:1557`) ; `SequenceCanvas` (`:1992`) ; `PanneauDeclencheur` ; `PanneauEtape` ; `ClavardageLumi` (« Construire avec Lumi », panneau latéral `:1721-1746`) ; « Tester » = `apercuAutomatisation` (`:1687`) ; `InterrupteurPublication` (`:1704`) ; règles à l'ancien format affichées en lecture seule et converties sur geste explicite (`estFormatOrigine` `:1194`, `convertirParcours` `:1229`) ; aperçu « X clients correspondent » pour `client.inactive` (`:1107`).
- **Autres composants** (`src/components/automations/`) : `OngletReglages.tsx` (réglages par règle), `OngletJournaux.tsx` (`OngletJournaux`, `OngletHistorique`), `AdressesDAppel.tsx` (webhooks entrants), `EmailPreviewEditor.tsx`, `MessageEditor.tsx`, `ChampAction.tsx`, `TiroirChoix.tsx`, `AutomationBuilder.tsx` (ancien assistant, crée avec `arreter_si_resolu` si drapeau `:285-286`), `src/components/champs/automatisations.tsx`.
- **Réglages hors page** : `SettingsReviews.tsx` / Messagerie utilisent `toggleAutomationRule` + `updateRuleMessage`.

#### 2.2 Clients API (`src/lib/`)
- `automationBuilderApi.ts` : `chargerAutomatisations` `:98`, `chargerEditeur` `:112`, `creerAutomatisation` `:123`, `modifierAutomatisation` `:133`, `changerPublication(EnLot)` `:151,167`, `chargerStatistiques` `:201`, `dupliquerAutomatisation` `:213`, `fetchModelesAutomatisation`/`utiliserModele` `:224-237`, bureaux `:259-266`, `supprimerAutomatisation` `:276`, `genererParcoursAvecLumi` `:352`, dossiers `:447-478`, `apercuAutomatisation` `:498`, `restaurer…` `:512`, `supprimerDefinitivement…` `:525`.
- `automationRulesApi.ts` : **écritures DIRECTES PostgREST** (sans Zod serveur) : `getAutomationRules` `:45`, `updateRuleMessage` `:83-139`, `setAutomationLanguage` `:265`, lectures d'échecs `:183-210`, `avisActives` `:298`. `toggleAutomationRule` passe maintenant par la route de publication `:66-68`.
- `automationJournauxApi.ts` (`lireJournaux` `:69`, `lireInscriptions` `:110`, `activiteParSemaine` `:365` — lectures directes des tables de logs/tâches), `automationWebhooksApi.ts` (webhooks + pause `:60-123`), `automationEventsApi.ts`, `automationCatalogue.ts` (catalogue PARTAGÉ serveur/front : `DECLENCHEURS` `:122-490`, `ACTIONS` `:690-1110`), `sequenceTypes.ts` (types d'étape `:15-80`, `projeterFormatOrigine` `:308`), `automationTemplates.ts`, `publicationAutomatisation.ts`, `reservationApi.ts:49`.

#### 2.3 Ce que l'UI permet de configurer
- **Déclencheurs** (catalogue `automationCatalogue.ts:122-458`) : quote.sent, quote.viewed (ouverture première/chaque, montant min/max, service, étape d'opportunité, étiquette), quote.approved/declined/changes_requested, invoice.sent/paid/overdue, payment.failed (drapeau `auto_paiement_echoue` `:219`), invoice.viewed (drapeau `auto_consultation_documents` `:227`), appointment.created/cancelled, job.completed, job.ready_for_invoicing, lead.created, lead.status_changed, client.replied, client.tagged/untagged (tag), client.inactive (mois, max/heure ; drapeau `auto_client_inactif` `:325`), agreement.signed, task.completed, note.added, webhook.received, date.reached (champ date, jours avant), deal.stage_entered (étape), deal.stage_idle (étape), custom_field.changed. Filtres d'étiquettes client ajoutés à tous sauf webhook (`:461-488`).
- **Conditions** : champs du déclencheur (stockés dans `conditions`, suffixe `__gte/__lte` pour les bornes), `champs_perso` (19 opérateurs), étape « si » en texte libre `champ = / != / > / >= / < / <= valeur` (`PanneauEtape.tsx:49-111`, exemples `statut`, `source`, `total_cents`, `created_at` `:688`). `in`/`not_in` non saisissables dans l'étape « si ».
- **Actions** (21, `automationCatalogue.ts:693-1110`) : send_email, send_sms, create_notification, request_review, envoyer_slack, ajouter/retirer_etiquette, modifier_client, assigner_responsable, ajouter_note, create_task, modifier_statut_rendezvous, move_deal_stage, modifier_deal, assigner_deal, envoyer_facture, envoyer_soumission, webhook, demarrer/arreter_automatisation, update_custom_field ; `type_envoi` (drapeau `auto_desabonnement_canal` `:613-614`).
- **Délais/attentes** : délai de règle simple (négatif = avant RDV), étape `attendre` durée / jusqu'à réponse (plafond) / X avant le RDV (seulement si déclencheur `appointment.created`, `PanneauEtape.tsx:642-647`).
- **Branches** : étape « si » alors/sinon ; « arrêter ».
- **Réglages** (`OngletReglages.tsx:126-277`) : ré-entrée, arrêt sur réponse, une fois par client tous les N jours, fenêtre d'envoi 7-22 h, jours ouvrables ; `arreter_si_resolu` dans `PanneauDeclencheur.tsx:93-96` (drapeau `auto_sortie_parcours`).
- **Objectifs (goal GHL)** : n'existent NI dans l'UI NI dans le moteur (grep `objectif|goal` vide dans `components/automations` et `automationEngine.ts`) — remplacés par la sortie auto `arreter_si_resolu` / `checkStopConditions`.

#### 2.4 Écarts UI ↔ MOTEUR (vérifiés dans le code)
1. ⚠ (gravité moyenne : seulement par saisie manuelle — ni le générateur Lumi ni les presets/modèles n'écrivent ces clés dans une étape « si ») **Étape « si » + conditions d'étiquettes ignorées.** `evaluateConditions` saute `client_a_etiquette`/`client_sans_etiquette` (`automationEngine.ts:189`) car jugées par `conditionsEtiquettesOk` — appelé seulement pour le déclencheur (`:1131-1133`), PAS pour une étape « si » (`:1773-1781` n'appelle que `conditionsChampsOk`). Une ligne `client_a_etiquette = VIP` tapée dans l'étape « si » est donc toujours VRAIE → branche « alors » systématique.
2. ⚠ **Étape « si » sur un parcours de rendez-vous ou d'opportunité jugée sur l'état d'origine.** `metadonneesFraiches` ne relit que `quote|invoice|job|lead|client|appointment` (`automationEngine.ts:2146-2153`) ; or les RDV sont émis avec `entityType 'schedule_event'` (`automation-events.ts:104`, trigger SQL `20261003100000…sql:99,107`) et les opportunités avec `'deal'` (`pipelineEvenements.ts`, `rappels-dates.ts:214`) → `source[...]` indéfini ⇒ retour du contexte figé (`:2155-2156`), sans trace. `statut = cancelled` sur un RDV ne devient jamais vrai.
3. ⚠ **`client.inactive` : plafond fusionné par seuil.** Le balayage prend le MIN de `max_par_heure` des règles de même `mois` et le met dans les métadonnées (`client-inactif.ts:96-99,135`) ; le moteur compare chaque clé de `conditions` par égalité (`automationEngine.ts:250`) ⇒ une règle dont `max_par_heure` diffère du min (ou hors bornes 1..1000 / `mois` hors 1..60, bornage `client-inactif.ts:61-62`) ne se déclenche JAMAIS. Même mécanisme pour `date.reached` : `jours_avant` borné ±365 et tronqué (`rappels-dates.ts:60-65`) vs valeur brute dans `conditions` (ex. « 3.5 », « 400 »).
4. **Opérateurs** : moteur `eq,neq,in,not_in,gt,gte,lt,lte` (`automationEngine.ts:170`) ; UI « si » n'offre que 6 (`PanneauEtape.tsx:51`) — `in/not_in` sans UI (sauf valeurs liste des champs du déclencheur). Opérateur inconnu ⇒ règle refusée (`:211-217`).
5. **Actions moteur sans UI** : `update_status`, `log_activity`, alias `send_notification` (`actions/index.ts:3012-3023`) ; `log_activity` accepté dans les étapes mais non proposé (`validation.ts:1078-1092`, `sequenceTypes.ts:386`).
6. **Réglage `marquer_lu`** accepté par Zod, ignoré par le moteur (`validation.ts:1219-1228`, `automationEngine.ts:319-320`) — retiré de l'UI.
7. ⚠ **`updateRuleMessage` (front) ignore `steps`.** Écrit seulement `actions` en PostgREST direct (`automationRulesApi.ts:107-134`) ; le moteur exécute `steps` quand ils existent (`automationEngine.ts:1188`). Depuis Réglages › Messagerie/Avis, modifier le texte d'un préréglage CONVERTI en parcours (ou d'un pack `pack_*`) répond « enregistré » et le client reçoit l'ancien texte. (L'outil Lumi équivalent a été corrigé : `tools-reglages.ts:508-524`.) Ne détache pas non plus `modele_id` ni ne propage aux copies (contrairement à PATCH `automation-rules.ts:533,597`).
8. **Filet légal fenêtre** : `horsFenetre` ne s'applique qu'aux tâches DIFFÉRÉES de type message (`automationEngine.ts:1619`, `ACTIONS_MESSAGE :411`) ; une action immédiate part hors fenêtre (voulu : confirmations).
9. **Fuseau** : moteur = `company_settings.timezone` via `fuseauOrg` (`automationEngine.ts:1616-1618`) ; actions : repli `America/Toronto` (`actions/index.ts:226,1011`). OK.
10. **Ré-entrée** : UI `reentree` → clé d'exécution suffixée (`automationEngine.ts:264-290,759,1020,1203`) — branché.
11. **PATCH peut publier une règle en corbeille** : `problemesBloquants({...existante,...patch})` sans `deleted_at` (`automation-rules.ts:518,555-558`), alors que `changerPublication` le refuse (`automations-publication.ts:69-74`). Sans effet d'envoi (le moteur filtre `deleted_at` `automationEngine.ts:1095`), mais état incohérent (publiée + corbeille).
12. **Préréglages et forfait** : le moteur ne vérifie ni `includes_automations` ni l'abonnement (aucune occurrence dans `automationEngine.ts`) ; les presets sont semés ACTIFS pour toute org (voir §4) alors que l'UI et `/api/automations/pause` sont bloqués par `PlanFeatureGate`/`featureGuard` (`feature-guard.ts:67`). ⚠ Une org sans `includes_automations` reçoit des envois automatiques qu'elle ne peut ni voir, ni modifier, ni « Tout arrêter » (à confirmer contre les données `plans`).

---

### 3. Outils Lumi (et MCP) sur les automatisations

Garde commune : `executerOutilGarde` / `outilsPermis` (`server/lib/agent/garde.ts:185-215`) ; outil sans clé = refusé. Écritures : proposition → carte → `POST /api/lumi/execute` (`server/routes/lumi.ts:845`), SAUF auto-exécution si `ECRITURES_ANODINES` ou mode personne `tout` (ou `argent` pour non-sensibles) : `server/lib/lumi/orchestrateur.ts:427-439`, `server/lib/lumi/execution.ts:87-105`. Les 5 écritures d'automatisation sont `sensible:true, reversible:true` (`tools-reglages.ts:1451-1455`) ⇒ carte obligatoire sauf mode `tout`. Idempotence `executerIdempotent`.

| Outil | Fichier | Perm. | Fait | Écritures DB |
|---|---|---|---|---|
| `list_automations` (read) | `agent/tools-etendus.ts:817-834` | `automations.read` (`garde.ts:47`) | liste 50 règles (id, nom, déclencheur, actif, preset) | — ⚠ ne filtre ni `deleted_at` ni `purged_at` (`:826-830`) : Lumi voit les règles à la corbeille / purgées |
| `get_automation_health` (read, identité) | `tools-etendus.ts:836-893` | `automations.read` (`garde.ts:48`) | 100 derniers logs, succès/échecs groupés par cause lisible | — (les « sauts » `success:true` comptent comme « partis ») |
| `toggle_automation_rule` | `agent/tools-reglages.ts:341-375` | `automations.update` (`:1484`) | `changerPublication` (mêmes gardes que l'UI) | `automation_rules.is_active` |
| `create_automation_from_text` | `tools-reglages.ts:402-481` | `automations.update` (`:1483`) | `genererParcours` (langue forcée `'fr'` `:438`) + `sequenceEtapes.safeParse` ; INSERT direct client utilisateur, `is_active:false`, `actions:[]`, `conditions:{}` `:452-466` | `automation_rules` (+ `ai_usage` via budget). ⚠ Contourne les gardes de la route `/generer` : pas de `trouverDeclencheur` (aucun CHECK en base sur `trigger_event`), pas de `refAutomatisationInventee`, pas de `verifierCoherence`, 2e automatisation (`autre`) et `une_fois_par_client_jours` ignorées |
| `update_automation_message` / `update_automation_sms_body` | `tools-reglages.ts:488-594` | `automations.update` (`:1485-1486`) | réécrit la SEULE étape d'envoi du type (refuse si 0 ou >1) + `actions` `:516-534` | `automation_rules.actions/steps`. Pas de Zod (longueurs tronquées 5000/1600), pas de détachement `modele_id`/propagation copies, pas de garde « publiée cassée » |
| `set_automation_language` | `tools-reglages.ts:596-621` | `automations.update` (`:1487`) | `company_settings.default_language` ; 0 ligne (RLS admin) ⇒ erreur | `company_settings` |
- Le `featureGuard` (`includes_automations`) ne couvre PAS ces outils (ils écrivent via `ctx.client`, hors préfixe `/api/automations/`) ni le MCP (`server/routes/mcp.ts`) ⚠ (à vérifier si un forfait avec Lumi peut exclure les automatisations).
- Routage : topic `rapports` (`tools-reglages.ts:1520-1522`), `server/lib/lumi/topics.ts:87` ; raccourci déterministe `actions-directes.ts:78,431,661` (bascule par nom).

**« Construire avec Lumi »** — `server/lib/lumi/generer-parcours.ts` (735 l.) : modèle `claude-sonnet-5` `:42`, `consignes(fr)` `:187-340` (catalogue d'actions, opérateurs, variables autorisées), `extraireJson` `:341`, `normaliserEtapes` `:433`, `contientTrou` `:103`, `ceQuiAChange` `:162`, budget réservé AVANT l'appel (`reserverBudget` `:500-501`), forfait sans Lumi ⇒ `sansLumi` (`:367`, `:487-489`), 2e automatisation `autre` `:65-80`. Entrées : route `POST /api/automations/rules/generer` (propose, n'enregistre pas) et l'outil `create_automation_from_text` (enregistre en pause).
- QA : `scripts/qa/evaluer-construire-lumi.mts`, `surveiller-construire-lumi.mts` (voir §7 ; script `qa:construire-lumi`).

---

### 4. Préréglages (presets)

(Détail vérifié par sous-agent, lignes citées.)
- **Semis — deux mécanismes, table `automation_rules`** :
  - Trigger SQL `trg_org_created_seed_automations` → `seed_automation_presets(p_org_id)` (`supabase/migrations/20260717150000_automation_presets_fr.sql:194-195`, dernière définition `20261003600000_courriels_prereglages.sql:23`) : INSERT `is_active=true, is_preset=true`, `ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING` ; index `idx_automation_rules_org_preset` (`20260401000000_dedup_automation_presets.sql:75`).
  - Filet serveur `ensureAutomationPresets(admin, orgId, {activateAll})` (`server/lib/automationPresetSeeder.ts:64`) : répare `quote_followup_1d` (`estimate.sent`→`quote.sent`, `:93-104`) et `google_review` (7200→0 s, `:109-120`) ; insère seulement les `preset_key` manquants (`:123-133`) de `AUTOMATION_PRESETS` + `PACK_PARCOURS` (`:131`) ; à la 1re initialisation : `PACK_ACTIF` actif, tout le reste en brouillon (`:175-189`), avis en brouillon si `review_enabled !== true` (`:197-210`), marque `orgs.automations_initialisees_le` (`:214-219`) ; sollicitations jamais activées (`:39-45` : `cross_sell_30d`, `seasonal_reminder_6m`, `lost_lead_reengagement`, `reengagement_90d`, `client_anniversary`).
  - Appelé via `seedOrgComplete` (`server/lib/seedOrgDefaults.ts:212,257`) depuis `POST /onboarding/complete` (`server/routes/onboarding.ts:37,86`), `POST /onboarding/seed-defaults` (`:123,129`), webhook de checkout (`server/routes/payments.ts:2289`), `POST /workspaces/create` (`server/routes/workspaces.ts:129-131`) ; `/orgs/create-office` direct (`server/routes/orgs.ts:534`).
  - **Changer de métier ne ressème rien** : `seedOrgFromIndustry` ne touche que `company_settings.industry/default_unit` et `predefined_services` (`server/lib/industryPresets.ts:174-229`).
- **Actifs à la création** (`PACK_ACTIF`, `server/lib/automationPack.data.ts:334-345`) : 5 `pack_*`, `payment_confirmation`, `deposit_received`, `thank_you_after_job`, `agreement_signed`, `quote_opened_notify`, `quote_opened_move_deal`, `quote_sent_move_deal`, `quote_approved_move_deal`.
- **Pack de base** (parcours à `steps`, `automationPack.data.ts`) :
  | Clé | Déclencheur | Réglages | Étapes |
  |---|---|---|---|
  | `pack_rendez_vous` `:311-313` | appointment.created | — | confirmation immédiate SMS+courriel ; `attendre avant_date` J-7 SMS+courriel, J-1 SMS+courriel, 2 h SMS ; `si_depasse` saute (`:76-98`) |
  | `pack_relance_devis` `:314-316` | quote.sent | `arret_sur_reponse` | +1/+2/+5/+10/+30 j ; branche `si channel = sms` SMS sinon courriel (`:123-130`), `[quote_link]` ; notif J5, tâche J10, notif J30 (`:191-222`) |
  | `pack_relance_facture` `:317-319` | invoice.sent | — | +3/+7/+14/+30 j courriel PUIS SMS (`:243`), `[invoice_link]` ; notif J7, tâche+notif J14 et J30 |
  | `pack_suivi_prospect` `:320-322` | lead.created | `source neq request_form`, `arret_sur_reponse` | bienvenue SMS+courriel+notif ; +1 j SMS ; J3 courriel ; J14 courriel+tâche+notif (`:246-273`) |
  | `pack_depot` `:323-325` | quote.approved | — | +1 h courriel+SMS dépôt `[quote_link]` ; +2 j SMS+notif (`:275-288`) |
- **Nettoyage / Construction** : AUCUNE automatisation ne dépend du métier. `industryPresets.ts:14-158` n'a que services/unités (`landscaping`, `snow_removal`, `residential_cleaning`, `commercial_cleaning`, `plumbing`, `electrical`, `roofing`, `hvac`, `window_cleaning`, `other`) ; **pas de clé `construction`/`renovation`/`pressure_washing`/`lavage`** (repli `other` `:161`, `/onboarding/complete` refuse hors liste `onboarding.ts:20-21`) ; `construction`/`renovation` n'existent qu'en marketing (`src/pages/marketing/Industries.tsx:25-26`) et modèle de pipeline (`src/lib/pipelineVentesApi.ts:1021`) ; modèles `industrie: null` (`server/lib/automationTemplates.ts:245`). ⇒ Nettoyage ET Construction reçoivent le même socle : les 13 actifs ci-dessus (+ `payment_confirmation` invoice.paid `payment_type neq deposit` SMS+courriel+notif ; `deposit_received` ; `thank_you_after_job` job.completed +1 h SMS ; `agreement_signed` SMS+courriel ; `quote_opened_notify` ; 3 `move_deal_stage`) ; ~30 autres presets en brouillon.
- **Configuration requise / comportement si absente** (`server/lib/actions/index.ts`) : un « saut » = `success:true` + `result_data.saute`, journalisé SANS notification (`:138-140`).
  - SMS : Twilio global (`server/index.ts:1392`) sinon saut `sms_non_configure` (`:1405`) ; numéro de l'org (`getOrgSmsFromNumber`) sinon saut / `plan_excludes_sms` (`:1457-1468`) ; sans téléphone (`:1410`), STOP (`:1421-1427`), sans consentement (`:1431-1436`) = sauts ; plafond 3 commerciaux/24 h (`AUTOMATION_MAX_COMMERCIAL_PER_DAY`, `:237-240`) = échec définitif (`:1441-1443`).
  - Courriel : `isMailerConfigured()` (Resend | SMTP | SES, `server/lib/mailer.ts:498-503`) sinon `SMTP not configured` = échec définitif (`:1177`, `automationEngine.ts:1364`) ; sans courriel / rebond = saut (`:1168`, `:1183-1185`) ; commercial sans nom/adresse d'entreprise = saut `identite_manquante` (`:1223-1226`).
  - Avis (`request_review`, `:1871`) : `review_enabled=false` = échec définitif (`:1883-1884`) ; ni Google ni Facebook ⇒ « No Google or Facebook review link configured » (`:1886-1887`) **absent de la liste des erreurs définitives** (`automationEngine.ts:1362-1381`) ⇒ en tâche différée : 4 tentatives puis notification. ⚠ `review_reminder_7d` (`automationPresets.data.ts:1136-1150`) = simple SMS avec `[google_review_url]` → **lien VIDE si seule la page Facebook est configurée** (`actions/index.ts:727`, `resolveTemplate :557-563`).
  - Liens `[quote_link]` / `[invoice_link]` vides si pas de `view_token`/`public_token` (`:838-839`, `:959-961`) — pas de saut, message avec lien vide.
  - Échec définitif notifié (`automation_failed`) seulement pour les tâches différées (`automationEngine.ts:1409-1445`) ; action immédiate : journal + `console.error` seulement (`:867-876`).
- **Bibliothèque « Partir d'un modèle »** : `server/lib/automationTemplates.ts` (META `:220-250`, 43 modèles sur 44 sources, `estimate_followup` exclu exprès `:12-15`, `META_ORPHELINES` vide `:256-257`, `completer()` `:195-206`) ; UI `BibliothequeModeles.tsx:197` ; catégories : soumissions 7, bienvenue 2, rendez_vous 6, facturation 11, apres_job 4, relance_clients 5, pipeline 8. Tous les types d'action utilisés sont gérés par `executeAction`.
- **Preset mort** : `estimate_followup` (`automationPresets.data.ts:325-330`, `estimate.sent`) — n'est émis que par `POST /emails/send-quote` (`server/routes/emails.ts:640`), que le front n'appelle plus (`src/lib/quotesApi.ts:726` utilise `/api/quotes/send-email`). Semé quand même (brouillon).

---

### 5. Systèmes adjacents

(Relevé par sous-agent, lignes citées ; constats transverses d'abord.)

#### 5.0 Socle commun
- **Verrou** `withAdvisoryLock` (`server/lib/advisory-lock.ts:10-33`) = bail de **10 min** dans `cron_locks` (`supabase/migrations/20260754000000_cron_locks_lease.sql:23-51`), sans renouvellement ni jeton de propriétaire ; `release_advisory_lock` supprime par clé sans condition ⚠ un passage >10 min peut être doublé (A dépasse, B prend, A libère le bail de B, C entre).
- **Pause entreprise** (`orgEnPause`, `server/lib/automations-pause-org.ts:57`, cache 15 s, fail-open) et **kill switch** `AUTOMATIONS_ENABLED` (`automations-interrupteur.ts:41`) : appelés UNIQUEMENT dans `automationEngine.ts:1062,1070,1521,1559` ⚠ relances de factures, factures récurrentes, jobs récurrents, rapports planifiés et table héritée `automations` les ignorent.
- **CRON_SECRET** : `server/routes/cron.ts:24-49` (en-tête `x-cron-secret`, 503 si absent, `crypto.timingSafeEqual` après test de longueur) ; `server/routes/reminders-cron.ts:40-65` (idem + `Authorization: Bearer`). `/api/cron/` hors subscription guard (`subscription-guard.ts:79`) et sans règle rbac.
- **pg_cron** (`SCHEMA_SNAPSHOT.md:10297-10310`) : `lume_payment_reminders 0 13 * * *` → `/api/cron/payment-reminders` ; `lume_release_sms_numbers`. Les 3 de `20261004200200_…sql:82-84` (`lume_rappels_dates` 15 12, `lume_recurring_invoices` 45 11, `lume_webhook_retries` */10) **absents du snapshot** (snapshot commité le 28/09, migration le 30/09 : non concluant) ⚠ à vérifier dans `cron.job` ; sinon `/api/cron/rappels-dates` et `/api/cron/recurring-invoices` sont SANS déclencheur.

#### 5.1 Relances de paiement
- **a1 — dunning des abonnements Lume (SaaS)** `server/lib/dunning-engine.ts` : `setInterval` 6 h + 30 s au démarrage, verrou `dunning-engine` + `withCronCheckIn` (`server/index.ts:1421-1428`) ; lit `subscriptions` (`past_due`), écrit `canceled` ; courriel `sendEmail` `reessayer:true` sans `suivi`, journal `billing_receipt_log` (select-puis-insert, clés `sub:relance:<jour UTC>` `:116`, `sub:suspended:…` `:102`). ⚠ courriel « accès suspendu » envoyé même si l'UPDATE garde `.eq('status','past_due')` n'a touché 0 ligne (client qui vient de payer) `:82-104` ; ⚠ relance QUOTIDIENNE J+3..J+6 (4 courriels) `:110` vs en-tête « une relance » ; doublon possible (échec transitoire → file de reprise + renvoi 6 h plus tard).
- **a2 — relances de factures clients** `POST /api/cron/payment-reminders` (`reminders-cron.ts:291`, verrou `cron-payment-reminders` `:312-314`), déclenché par pg_cron 13:00 UTC. Réglages `reminder_settings` (paliers J+1/7/14/30, canaux) via `GET/PATCH /api/reminders/settings` (`server/routes/reminders.ts:47-80` ; GET crée la ligne `enabled:true` ; PATCH admin/owner) et `GET /api/reminders/log` (`:140-144`, sans filtre org, RLS seule). Idempotence : lecture `reminder_log` (invoice, palier, canal) `:371-378` + index unique `reminder_log_org_invoice_day_channel_uq` (`supabase/baseline/01_schema.sql:36827`), écrit APRÈS l'envoi. Envois : courriel `sendEmail({suivi:{entityType:'reminder'}})` `:481`, SMS depuis le numéro de l'org `:513` ; `adresseInjoignable` `:436`, `isSmsOptedOut` `:508` ; demandes de paiement `createPaymentRequest`. Fuseau UTC (`fenetreRelance` `:107-119`). ⚠ Bugs : (1) plusieurs paliers la même nuit (fenêtre `[J-90 ; J-palier]` `:349-360`) ; (2) changer le canal d'un palier renvoie ce palier (canal dans la clé) ; (3) doublon avec l'automatisation `invoice.overdue` (`couvertureAutomatisations` évalue sans `days_overdue` `:208-213` ; `relanceFactureDejaPartie` `automationEngine.ts:552-583` ne lit pas `reminder_log`) ; (4) réponse envoyée 2 fois (`sendSafeError` dans le callback du verrou `:320` puis `res.json` `:629`) ; (5) pas de journal si canal sans adresse/mailer ⇒ retentative quotidienne + `createPaymentRequest` à chaque passage ; (6) `.limit(500)` sans `order` `:361` ; (7) 13:00 UTC = 5-6 h du matin à Vancouver, sans heures calmes ; (8) verrou 10 min.
- **a3 — outil Lumi `send_payment_reminders`** (`server/lib/agent/tools-etendus.ts:3404-3474`) : SMS seulement, ≤30, `executerIdempotent`, `sms_opt_outs`, perm. `messages.send` (`garde.ts:42`) ; ⚠ ni lit ni écrit `reminder_log` (doublon avec le cron). Lecture/écriture réglages : `get_reminder_settings` / `update_reminder_settings`.

#### 5.2 Factures récurrentes
- **b1 — `server/lib/recurringInvoicesEngine.ts`** (table `recurring_invoice_schedules`) : `POST /api/cron/recurring-invoices` (`cron.ts:69-84`, verrou `cron-recurring-invoices`), pg_cron 11:45 UTC (non déployé ?). **Aucune route HTTP « lancer maintenant »** (retirée, `server/index.ts:73`). Outils Lumi (`server/lib/agent/tools-argent.ts`) : `run_recurring_invoice_now` `:1470-1501` (`invoices.create`, sensible, non réversible), `create_` `:1320`, `update_` `:1387`, `delete_` `:1446` (désactive), `list_recurring_invoices` `:1293`. Écrit `invoices`, `invoice_items`, `applied_taxes`, RPC `recalculate_invoice_totals`, puis avance `next_run_date` (`:192-210`). Si `auto_send` : `executeEnvoyerFacture` (courriel), `status='sent'`, `invoice.sent` (`:165-187`). Aucune clé d'idempotence. ⚠ (1) avance APRÈS l'envoi ⇒ échec de l'UPDATE / crash = facture recréée ET renvoyée ; (2) rattrapage en rafale (1 facture/passage/planif., `start_date` passée acceptée `tools-argent.ts:1350`) ; (3) échéance calculée depuis le jour d'exécution `:62-66` ; (4) `run_recurring_invoice_now` marche sur une planification inactive/échue, sans verrou.
- **b2 — ancien système `invoices.is_recurring`** (`server/lib/scheduler.ts:474-582`, alimenté par `src/pages/InvoiceDetails.tsx:488`), à chaque tick 5 min : ⚠ INSERT sans `created_by` (NOT NULL, défaut `auth.uid()` nul en service_role) `:510-528` ⇒ échec 23502 probable à chaque tick ; pas de taxes, `due_date` nul, pas de filtre statut ; clone puis avance non atomique. Deux systèmes de récurrence coexistent.

#### 5.3 Récurrence des jobs — `server/lib/recurringJobScheduler.ts`
- `setInterval` 5 min + passage au démarrage sur chaque instance (`server/index.ts:1388`), garde locale + verrou `recurring-jobs` (`:37-54`). Table `job_recurrence_rules` (daily/weekly/biweekly/monthly/custom, `day_of_week[]`, `day_of_month`, `next_run_at`, `timezone`, `local_time`) ; index NON unique, aucune contrainte « une règle active par job » (`01_schema.sql:34965-34979`) ; RLS simple appartenance (`SCHEMA_SNAPSHOT.md:5864-5871`). Entrées : UI écrit direct `src/lib/recurringJobsApi.ts:111-159` ; Lumi `create_recurrence_rule` (`tools-terrain.ts:294-375`, `jobs.update`, refuse si une active), `deactivate_recurrence_rule` `:377`, `list_recurrence_rules` `:212`. Écrit `jobs` puis `schedule_events` (`:122-163`) puis avance la règle (`:200-207`, RPC `next_recurrence_at`). Aucun envoi direct : le trigger de `schedule_events` émet `appointment.created` → moteur (respecte la pause). ⚠ (1) fuseau de l'org PAS hérité (`timezone || 'America/Toronto'` `:254`, commentaire `:238` faux ; Lumi écrit `America/Montreal` `tools-terrain.ts:35,361`) ; (2) `day_of_week`/`day_of_month` ignorés ; (3) job créé seulement quand `now >= next_run_at` (jamais à l'avance) et `next_run_at` = `start_date` 05:00Z côté Lumi (`tools-terrain.ts:343`) ⇒ visite à ~1 h du matin, rappels J-7/J-1 impossibles, confirmation au moment de la visite ; (4) rattrapage : 1 occurrence/5 min avec visites dans le passé ; (5) `end_date` comparée en UTC `:108` ; (6) aucune idempotence (job sans lien vers la règle `:136`).

#### 5.4 Rapports planifiés
- `setInterval` 1 h sous verrou `scheduled-reports` (`server/index.ts:1538-1548`), **sans passage au démarrage** ⚠ (déploiements fréquents ⇒ peut ne jamais tourner). Routes `server/routes/scheduled-reports.ts` (service_role filtré org) : GET, POST, PUT `/:id`, DELETE `/:id`, POST `/:id/send-now` (`:100-115`), perm. `financial.view_reports` (`route-permissions.ts:298-302`). Lumi (`tools-reglages.ts:1118-1304`) : `list_/create_/update_/delete_scheduled_report`, `send_scheduled_report_now` (même perm. `:1500-1504` ; valident courriel et `day_of_month` 1-28, la route HTTP non). Idempotence `last_sent_at` (seuils 20/144/672 h) posé APRÈS l'envoi (`server/lib/scheduled-reports.ts:156-163`). Courriel `emailFrom` plateforme, `reessayer:true`, sans `suivi`, résultat non lu (`:145-153`). ⚠ jour/plages en UTC (`:122-135,170-172`) ⇒ hebdo/mensuel part ~20 h la veille à Montréal ; `day_of_month` 29-31 via API = mois sautés ; `send-now` pose `last_sent_at` et fait sauter le prochain envoi ; destinataire externe libre sans limite de débit (exfiltration de données financières).

#### 5.5 Rappels sur date — `server/lib/rappels-dates.ts`
- `POST /api/cron/rappels-dates` (`cron.ts:94-104`) **sans verrou** ; pg_cron 12:15 UTC (non déployé ?). Lit `automation_rules` (`date.reached`, actives), `custom_fields`, `custom_field_values` (`value_date = jourVise`, `limit 500` `:176-182`), `deals`/`pipeline_stages`, `clients` ; émet `date.reached` (`:212`, `:248`) ⇒ moteur (pause + consentement respectés). Fuseau fixe `America/Toronto` (`:33`), pas `fuseauOrg`. ⚠ L'anti-doublon annoncé (`:21-25`, « le jour entre dans la clé ») est faux : `buildExecutionKey` exclut la date (`automationEngine.ts:258-289`) ⇒ rejouer le cron le même jour >2 min après (fenêtre `FENETRE_ANTI_DOUBLON_MS` `:498`) renvoie tout ; pas de rattrapage d'un jour manqué ; `limit 500` sans pagination.

#### 5.6 Clients inactifs — `server/lib/client-inactif.ts`
- `setInterval` 1 h + 45 s, verrou `clients-inactifs` (`server/index.ts:1569-1576`) ; réservation `clients_inactifs_declenches` (PK org+client+seuil+période) AVANT émission `client.inactive` (`client-inactif.ts:118-139`) ; plafond horaire par org. Voir écart §2.4-3.

#### 5.7 Tick principal `server/lib/scheduler.ts` (5 min, verrou `automation-scheduler`, `:872-940`)
Ordre : ancienne récurrence de factures (`:747`) → `processScheduledTasks` (moteur) → `rejouerEvenementsOrphelins`/`menageOutbox` → `traiterEvenementsPipeline`/`detecterStagnation` → `detectOverdueInvoices` (`:593-687`, fuseau org, dédup `activity_log`, émet `invoice.overdue` aux paliers `OVERDUE_DAYS=[1,3,5,15,30]` `scheduler-utils.ts:63`) → `expireOverdueQuotes` (`:693-738`, ⚠ UPDATE sans garde de statut `:711-718`) → ménage fichiers → archivage devis → **table héritée `automations`** (`:820-858`) : ⚠ contourne pause ET kill switch, pas d'heures calmes, `days_after_quote_sent` lit `invoices` (`:119-124`), unité « heures » cassée (`scheduler-utils.ts:10-28`), `days_before_appointment` sans filtre `deleted_at`/statut (`:165-168`).
Événements de la base (`evenementsBase`) : 15 s, prise CAS sur `attempts` (`evenementsBase.ts:142-149`). Autres tâches sans verrou et à risque de doublon multi-instance : résumé quotidien support, santé des courriels (`resume-quotidien.ts:101`, `sante.ts:124`).

#### 5.8 Routes cron HTTP
`/api/cron/retention` `cron.ts:51`, `/purge-audit` `:60`, `/recurring-invoices` `:69` (verrou), `/rappels-dates` `:94` (**sans verrou**), `/webhook-retries` `:106` (verrou), `/release-sms-numbers` `:122`, `/lumi-bienvenue` `:145` (manuel), `/payment-reminders` `reminders-cron.ts:291` (verrou).

### 6. Permissions

- **Clés** : `automations.read`, `automations.update` (`src/lib/permissions.ts:74,320-323`) ; cascade `automations.update ⇒ automations.read` (`src/lib/permissionsCascade.ts:52`). `ROLE_PRESETS` (`permissions.ts:406-470`) : owner = tout ; admin = tout sauf `users.delete` ; `sales_rep` et `technician` : AUCUNE clé automations. Rapports planifiés : `financial.view_reports` (`route-permissions.ts:298-302`). Réglages de relance : `/api/reminders/` sous `includes_automations` (`feature-guard.ts:68`).
- **Serveur** : `ROUTE_PERMISSIONS` (`server/lib/route-permissions.ts:111-174`) — table complète en §1 ; `rbacMiddleware` `:493-537`. Garde Lumi `PERMISSION_PAR_OUTIL` (`garde.ts:47-48`, `tools-reglages.ts:1483-1487`).
- **RLS** (`supabase/SCHEMA_SNAPSHOT.md` §3) :
  - `automation_rules` (`:4640-4653`) : SELECT `member_has_permission(uid, org_id,'automations.read')` ; INSERT/UPDATE/DELETE `'automations.update'` ; + RESTRICTIVE `bureau_actif`.
  - `automation_folders` (`:4625-4638`) : idem read/update + `bureau_actif`.
  - `automation_scheduled_tasks` (`:4655-4661`) : **SELECT seul, `has_org_membership`** (tout membre, technicien compris, lit la file dont `action_config`/`sequence_context` = textes et métadonnées client) ; aucun grant d'écriture à `authenticated` (d'où le service_role dans DELETE, `automation-rules.ts:794-813`).
  - `automation_execution_logs` (`:4617-4623`) : **SELECT `has_org_membership`** (pas `automations.read`) ⚠ fuite de lecture vers technicien/rep (journal des envois, `action_config`).
  - `automation_webhooks` (`:4668-4674`) : SELECT `automations.read`, ALL `automations.update` (roles={public}) ; **pas de politique RESTRICTIVE `bureau_actif`** (contrairement aux autres tables) ; `api_key` non lisible par `authenticated` (migration `20261004100100_cle_webhook_non_choisie.sql`).
  - `automation_webhook_receipts` (`:4663-4666`) : SELECT `automations.read` ; pas de `bureau_actif`.
  - Table héritée `automations` (`:4676-4685`) : 4 politiques « tout membre » sans clé de permission ni statut d'adhésion ; **encore exécutée** par `server/lib/scheduler.ts:820-835` (`handleDaysAfterQuoteSent`…) alors qu'aucune UI ne l'écrit (grep `from('automations')` = scheduler seul).
- **Contraintes** (`SCHEMA_SNAPSHOT.md:7961-8015`) : FK composites same-org (`automation_scheduled_tasks_automation_rule_id_same_org`, `automation_execution_logs_*_same_org`, `automation_rules_pipeline_same_org`/`stage_same_org`) ; `automation_rules_org_id_id_uq` ; `status` CHECK des tâches ; **aucun CHECK sur `automation_rules.trigger_event`**.
- **pg_cron** (`SCHEMA_SNAPSHOT.md:10297-10310`, 11 tâches) : `lume_payment_reminders 0 13 * * *` y figure ; `lume_rappels_dates`, `lume_recurring_invoices`, `lume_webhook_retries` (créés par `supabase/migrations/20261004200200_crons_rappels_dates_factures_recurrentes_webhooks.sql:82-84`) **n'y figurent PAS** — mais le snapshot date du 28/09 (dernier commit) et la migration du 30/09 : on ne peut pas conclure ; ⚠ vérifier `cron.job` en prod (piège « migrations fantômes »). Si absentes, `/api/cron/rappels-dates` et `/api/cron/recurring-invoices` n'ont AUCUN déclencheur.

### 7. Tests & QA existants

(Relevé par sous-agent. NB : pendant l'inventaire, `git status` du worktree montrait du travail NON commité d'une autre session — `server/lib/actions/index.ts`, `mailer.ts`, `webhookDispatcher.ts`, `config.ts`, `url-sortante.ts` modifiés ; nouveaux `tests/automations-suite/harnais/bureau-test.ts`, `scripts/qa/bureau-test-automatisations.mts`, `server/lib/bac-a-sable.ts`, migration `20261005100000_bac_a_sable_envois.sql` — non inventoriés.)

#### 7.1 Configuration
- `vitest.config.ts` : `environment:'node'` `:6` (fichiers `.tsx` en jsdom via en-tête `// @vitest-environment jsdom`, pas de @testing-library : `createRoot`), `setupFiles ./vitest.setup.ts` `:9` (fausses clés Supabase `vitest.setup.ts:10-12` ⇒ aucun test CI n'a de vraie base), `include tests/**/*.test.ts(x)` `:10`, **`exclude … 'tests/quarantaine/**'`** `:18`, `testTimeout 10000`.
- `vitest.quarantaine.config.ts:14` → `npm run test:quarantaine` (package.json `:92`). ⚠ Des tests CI importent des aides de la quarantaine (`tests/quarantaine/_simulations.ts`, `automation/_enregistreur.ts`) : `golden/golden.test.ts:37,41`, `vague2-attente-reponse:10`, `vague2-delai-depasse:21-24`, `vague2-etalement-textos:13-14`, `launch-f18-f7:31`, `launch-echappement-html:21` — supprimer la quarantaine casserait la CI.
- `.github/workflows/ci.yml` : job `quality` bloquant = `npm run lint` (`tsc --noEmit`) `:36`, **`npm run test` (`vitest run`) `:39`** ← tous les tests d'automatisation hors quarantaine, `npm run build` `:42`, sans secret ; job `rls-isolation` `:57-107` = `test:rls` + `check:schema-refs` avec `secrets.RLS_TEST_DB_URL` (staging), échoue si secret absent hors fork ; job `audit` `continue-on-error` `:114`.
- `.github/workflows/lumi-eval.yml` : cron lundi 10:00 UTC + manuel (pas sur PR) : `evaluer-lumi.mjs`, `seed-outils-staging.mts`, **`executer-outils-staging.mts`** (`:131`) qui exécute RÉELLEMENT sur staging `list_automations`, `create_automation_from_text`, `toggle_automation_rule`, `update_automation_message/_sms_body`, `set_automation_language` (`executer-outils-staging.mts:115,302-309`), récurrences de jobs (`:178-180`), factures récurrentes dont `run_recurring_invoice_now` (`:222-226`), rapports planifiés (`:323-326`) ; `send_payment_reminders` exclu (`:219`) ; `evaluer-outils.mts` (seuil 5 %).
- Absents de toute CI : `qa:declencheurs`, `qa:actions`, `qa:pack`, `qa:outbox`, `qa:anti-doublon`, `qa:evenements-base`, `qa:automatisations`, `qa:workflow-bout-en-bout`, `qa:construire-lumi`, `test:quarantaine`.

#### 7.2 Scripts npm (package.json)
`test` `:20`, `test:rls` `:38`, `check:schema-refs` `:40`, `qa:envoi-reel` `:54`, `qa:automatisations` `:55`, `qa:parcours` `:56`, `qa:lumi-execution` `:62`, `qa:declencheurs` `:63`, `qa:actions` `:64`, `qa:anti-doublon` `:65`, `qa:outbox` `:66`, `qa:pack` `:67`, `qa:evenements-base` `:68`, `qa:lumi` `:69`, `qa:construire-lumi` `:70`, `qa:surveiller-construire-lumi` `:71`, `qa:workflow-bout-en-bout` `:73`, `qa:panneau-automatisation` `:74`, `qa:tout` `:79` (n'inclut AUCUN banc d'automatisation), `qa:verifier-filet` `:85`, `test:parcours` `:89`, `test:quarantaine` `:92`, `qa:parcours-client` `:95`. Rien pour dunning / récurrences / rapports.

#### 7.3 Tests en CI (types : U = unitaire vrai code + Supabase simulé ; S = lecture statique du source ; J = jsdom ; H = Express en mémoire ; T = tautologique, n'importe aucun code prod). Aucun test CI ne touche réseau/staging.
- **`tests/automation/`** (63 fichiers) — U : `scheduler` (scheduler-utils), `filet-regression` (28 déclencheurs × actions compatibles, instantanés `filet-regression/instantanes/*.json`), `golden/golden.test.ts` (39 presets, attendus), `pack-base` (5 parcours + publication à la création), `socle-une-seule-fois`, `vague2-prereglages-enregistrables`, `avis-suivent-reglage`, `bibliotheque-modeles` (+ route H, écran J), `client-inactif`, `facture-consultee`, `paiement-echoue`, `sortie-parcours`, `vague2-*` (attente réponse, réponse courriel, si état actuel, réentrée, fenêtre d'envoi, étalement textos, délai dépassé, une relance/jour, brouillon, envoyer document, N+1, webhook occurrences, migrations moteur S), `launch-*` (anti-doublon, démarrer, erreurs avalées, événements base, F18/F7, M10 temps, plan visites, rebonds, texto impossible, échappement HTML, réservation Lumi, relance unique H, dossier bureau H, pause honnête J+H, clé webhook J+H, sécurité aperçu, SSRF, lien facture S, retirer de l'horaire S, webhook entrant S, limiteurs S), `rbac-routes-automatisations` (S), `brouillon-annule`, `conformite-envois-vague3`, `consentement-commercial`, `desabonnement-canal` (H), `desabonnement-herite`, `reviews`, `suppressions-honnetes` (H), `file-bascule`. ⚠ **T (≈99 cas sans valeur)** : `automation-engine.test.ts` (fonctions RECOPIÉES `:9-30`), `actions.test.ts`, `event-wiring.test.ts`, `workflow-scenarios.test.ts`.
- **Racine `tests/`** : `automatisations-sequences` (57, graphe + modes d'attente), `-v4-parcours/-serveur/-api/-libelles`, `-chainer`, `-actions-nouvelles`, `-champs-serveur` (date.reached, custom_field.changed), `-filtres-dates` (opérateurs + inconnu refusé `:93`), `etiquettes-filtres-declencheurs`, `-rappels-dates` (fuseau), `heures-de-silence-fuseau-org`, `relances-plafond-age`, `automations-interrupteur` (kill switch), `-pause-org`, `-avant-publication`, `-publication-serveur` (H), `-personnalisees` (catalogue ↔ moteur, 43), `-coherence-declencheur-action`, `-format-origine`, `-statistiques` (H) ; S : `-arret-sur-reponse`, `-reglages-vivants`, `-robustesse`, `automations-robustesse`, `-apercu`, `-nom-francais`, `-p0-audit`, `-journaux-prospects`, `isolation-automatisations`, `destinataire-automatisations`, `actions-seulement-par-le-moteur`, `alerte-job-en-retard`, `boucle-infinie-taches`, `bureaux-automatisations-partagees` ; J (≈12) : `-editeur-launch`, `-liste-launch`, `-corbeille`, `-champs-editeur`, `-clavardage-lumi`, `-panneau-brouillon`, `-reglages-serialises`, `-apercu-launch`, `-v4-editeur/-liste/-apercu/-message` ; `emails/automation-moteur|presets|editeur|libelles` (S), `emails/automation-variables` (U/S), `emails/dunning` (S — dunning ABONNEMENT Lume, pas factures clients), `abonnements-figes` (S), `factures-recurrentes-taxes` (U, `runOneSchedule`) ; Lumi : `lumi-cree-automatisation` (S), `lumi-deuxieme-automatisation`, `lumi-parcours-audit-v2`, `lumi-parcours-montre-les-textes`, `lumi-outils-reglages` (`update_automation_*`, `set_automation_language`, `*_scheduled_report` `:197-346`), `lumi-outils-argent` (récurrentes, `update_reminder_settings`), `lumi-outils-terrain` (`*_recurrence_rule` `:203-268,533`), `lumi-actions-directes` (`toggle_automation_rule`) ; webhooks : `webhooks-entrants-forfait/-ip` (H), `-formats` (S), `webhook-dispatcher-ssrf` ; `migration/activer-compte-automatisations`, `courriels/*`, `rapports-*` (bibliothèque d'export).
- **Quarantaine (hors CI)** — `tests/quarantaine/README.md:20-22` : 47 échecs / 149 OK / 34 ignorés (2026-09-19). `automation/` (simulé) : declenchement-conditions, erreurs (reprises SMS T10.1), idempotence, temps (DST T9.x), cout-volume, isolation-tenant (T7.x), permissions, perf, conformite, `front-automations.unit.test.tsx` (J). `automation-integration/` (vraie base, opt-in `AUTOMATIONS_IT=1` ou `DB_URL`, `_fixtures.ts:26`) : conformite, cout-volume, declenchement, idempotence, isolation-tenant, perf, permissions, temps.

#### 7.4 Scripts QA (manuels, `.env.local` → staging)
- **ENVOIENT de vrais messages** ⚠ : `automatisations.mjs` (`qa:automatisations` ; API `localhost:3002`, vrai moteur ; garde `SUPABASE_PROJECT_REF_PROD` `:47` ; exige `QA_REDIRECT_TO` `:51-56` ; org `eeda2ab3…` `:72` et compte `willhebert30@gmail.com` `:84` en dur) ; `envoi-reel.mjs` (Twilio + courriel réels, redirigés `QA_REDIRECT_TO` obligatoire `:43-45`) ; `_ses-live.mts` (courriel SES réel à une adresse en dur, AUCUNE garde) ; `apercu-courriel-reel.mts` (lit la PROD en lecture seule, `--envoyer` envoie) ; `scripts/f7-alerter-proprietaires.mts` (`--envoyer` écrit aux propriétaires, marche avec `--prod`).
- **Bancs staging (écrivent, n'envoient pas)** : `eprouver-declencheurs.mts` (`qa:declencheurs` ; règle `create_task` par déclencheur ; garde = ref prod en dur `:26` ; **24/28 déclencheurs** — manquent `client.inactive`, `invoice.viewed`, `payment.failed`, `quote.viewed`) ; `eprouver-actions.mts` (`twilio:null`, client `@example.invalid`, garde `:42`) ; `eprouver-anti-doublon.mts` (`:19`) ; `eprouver-outbox.mts` (`:28`) ; `eprouver-pack-base.mts` (`:23`) ; `eprouver-evenements-base.mts` (`:22`) ; ⚠ `verifier-workflow-bout-en-bout.mjs` (7 actions via `executeAction`, `twilio:null`, nettoyage `:180-185`, **aucune garde prod**, prend la 1re org active `:45`) ; `verifier-moteur-pipeline.mjs` (`:30`) ; `bureaux-automatisations-partagees.mts` (`:28`).
- **Navigateur (Puppeteer, front `:5199`)** : `verifier-panneau-automatisation.mjs`, `verifier-corbeille-automatisations.mjs`, `verifier-declencheur-date.mjs` — pas de garde prod visible.
- **Lumi** : `evaluer-construire-lumi.mts` (vrai modèle, ~0,5-1 $/passe, n'écrit rien), `surveiller-construire-lumi.mts` (lecture `lumi_conversation`, `--prod` possible).
- **Anciens** ⚠ sans garde prod : `scripts/test-workflows.ts` (RPC `seed_automation_presets` `:133`), `scripts/seed-optional-workflows.cjs` (org en dur), `apply-presets.ts` (`exec_sql`).

#### 7.5 Trous de couverture
- **Aucun test qui exécute** : `recurringJobScheduler.processRecurringJobs` (non exporté ; statique seulement `emails/automation-moteur.test.ts:126`), `scheduled-reports.ts` (`processScheduledReports`, `sendScheduledReport`) et sa route, `computeNextRunDate`/`runDueSchedules` (`recurringInvoicesEngine.ts:29,249`), route `/api/cron/payment-reminders` hors plafond d'âge, `industryPresets.ts`, `get_automation_health`, `list_automations`, action `send_notification`, `CopierVersBureauxModal`/`InterrupteurPublication`/`TiroirChoix` (pas de rendu), `SequenceCanvas`/`ChampAction`/`EmailPreviewEditor` (statique seulement), table héritée `automations` du scheduler, ancien `invoices.is_recurring`.
- **Non couverts par les tests pour les écarts de ce rapport** : étape « si » sur `schedule_event`/`deal` (`vague2-si-etat-actuel` ne teste pas ces entités), conditions d'étiquettes dans une étape « si », `updateRuleMessage` sur une règle à `steps`, `max_par_heure` différent entre règles de même seuil.
- **Seulement en quarantaine / manuel** : isolation moteur multi-org (T7), permissions (F4/F15/F18), règle modifiée pendant l'attente (F16), DST (T9.2-9.5), reprises SMS (T10.1), exécution réelle de bout en bout.
- **Goals** : n'existent pas (types d'étape `automationSequences.ts:39`).

---

### 8. Récapitulatif des bugs / écarts suspectés (fichier:ligne)

**Moteur / UI**
1. Étape « si » : conditions d'étiquettes toujours vraies — `server/lib/automationEngine.ts:189` + `:1773-1781` (pas de `conditionsEtiquettesOk`).
2. Étape « si » sur RDV (`schedule_event`) et opportunité (`deal`) évaluée sur le contexte figé — `automationEngine.ts:2146-2156`.
3. `client.inactive` : règle dont `max_par_heure` ≠ min des règles de même seuil (ou hors bornes) ne se déclenche jamais — `server/lib/client-inactif.ts:96-99,135` vs `automationEngine.ts:250` ; idem `date.reached` `jours_avant` borné/tronqué — `server/lib/rappels-dates.ts:60-65`.
4. `updateRuleMessage` (Réglages › Messagerie/Avis) n'écrit que `actions`, pas `steps` — `src/lib/automationRulesApi.ts:107-134` (le moteur lit `steps`, `automationEngine.ts:1188`).
5. Moteur ne vérifie ni forfait `includes_automations` ni abonnement, presets semés actifs, mais UI/pause bloquées par forfait — `automationEngine.ts` (aucune occurrence), `server/lib/feature-guard.ts:67`, `automationPack.data.ts:334-345`.
6. PATCH peut publier une règle en corbeille — `server/routes/automation-rules.ts:518,555-558`.
7. `review_reminder_7d` part avec un lien vide si seule la page Facebook est configurée — `server/lib/automationPresets.data.ts:1136-1150`, `actions/index.ts:727`.
8. « No Google or Facebook review link configured » non classé définitif ⇒ 4 tentatives — `actions/index.ts:1886-1887`, `automationEngine.ts:1362-1381`.

**API**
9. `appointment-rescheduled` : `eventId`, `jobId`, `clientId` du corps non vérifiés avant ré-émission — `server/routes/automation-events.ts:52-114`.
10. `quote-sent` : émet sans vérifier que le devis existe dans l'org — `automation-events.ts:293-311`.
11. `lead-created` / `lead-status-changed` : émis même si le lead est introuvable — `automation-events.ts:340-364,375-398`.
12. `job-completed` : statut du job non vérifié avant `job.ready_for_invoicing` + notifications — `automation-events.ts:134-215`.
13. En-tête de `GET /automations/test` mensonger (aucune simulation) — `server/routes/automation-test.ts:1-20`.
14. Idempotence de « Utiliser ce modèle » en mémoire (par instance) — `automation-rules.ts:628-646`.

**Lumi**
15. `create_automation_from_text` contourne les gardes de `/generer` (déclencheur inconnu accepté — aucun CHECK en base —, règle référencée inventée, langue forcée `fr`, `autre` ignorée) — `server/lib/agent/tools-reglages.ts:433-466`.
16. `list_automations` liste corbeille/purgées — `server/lib/agent/tools-etendus.ts:826-830`.
17. Outils Lumi/MCP hors `featureGuard includes_automations` — `feature-guard.ts:65-69`.

**RLS**
18. `automation_execution_logs` et `automation_scheduled_tasks` lisibles par tout membre (`has_org_membership`, pas `automations.read`) — `supabase/SCHEMA_SNAPSHOT.md:4617-4661`.
19. `automation_webhooks` / `_receipts` sans politique RESTRICTIVE `bureau_actif` — `SCHEMA_SNAPSHOT.md:4663-4674`.
20. Table héritée `automations` : RLS « tout membre » ET encore exécutée par le scheduler, hors pause/kill switch — `SCHEMA_SNAPSHOT.md:4676-4685`, `server/lib/scheduler.ts:820-858`.

**Systèmes adjacents** (détail §5)
21. Pause entreprise / kill switch ignorés hors moteur — `automations-pause-org.ts:57` utilisé seulement `automationEngine.ts:1062,1070,1521,1559`.
22. Bail de verrou 10 min sans jeton — `server/lib/advisory-lock.ts:10-33`, `20260754000000_cron_locks_lease.sql:42-51`.
23. Relances de factures : paliers empilés la même nuit, doublon avec `invoice.overdue`, double réponse HTTP — `server/routes/reminders-cron.ts:349-360,208-213,320/629`.
24. Dunning SaaS : courriel de suspension même sans suspension, 4 relances J+3..J+6 — `server/lib/dunning-engine.ts:82-104,110`.
25. Factures récurrentes : avance après l'envoi (double facture), rattrapage en rafale — `server/lib/recurringInvoicesEngine.ts:165-210` ; ancien `is_recurring` sans `created_by` — `server/lib/scheduler.ts:510-528`.
26. Jobs récurrents : fuseau org non hérité, `day_of_week`/`day_of_month` ignorés, visites ~1 h du matin — `server/lib/recurringJobScheduler.ts:108,254`, `server/lib/agent/tools-terrain.ts:343`.
27. Rapports planifiés : UTC, pas de passage au démarrage, `send-now` décale le planning — `server/lib/scheduled-reports.ts:122-172`, `server/index.ts:1538-1548`.
28. Rappels sur date : anti-doublon annoncé faux, route sans verrou — `server/lib/rappels-dates.ts:21-25`, `server/routes/cron.ts:94-104`.
29. pg_cron `lume_rappels_dates` / `lume_recurring_invoices` / `lume_webhook_retries` absents du snapshot (à vérifier en prod) — `20261004200200_…sql:82-84`.

**Tests**
30. ≈99 cas tautologiques dans `tests/automation/{automation-engine,actions,event-wiring,workflow-scenarios}.test.ts` ; scripts sans garde prod : `scripts/qa/verifier-workflow-bout-en-bout.mjs:45`, `scripts/qa/_ses-live.mts`, `scripts/test-workflows.ts:133`.
