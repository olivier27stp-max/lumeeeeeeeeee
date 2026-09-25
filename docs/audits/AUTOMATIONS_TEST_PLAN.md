# AUTOMATIONS_TEST_PLAN.md — Suite de tests du moteur d'automatisations

Phase 3. Conçu en lecture seule, rien d'écrit sous `tests/` encore. Chaque cas dit ce qu'on teste, le montage, l'assertion, et **le bug réel que ça attrape** (numéros `F` = findings de `AUTOMATIONS_AUDIT.md`). Les cas marqués **ROUGE ATTENDU** échoueront sur le code actuel : c'est voulu (R14), ils documentent le défaut jusqu'au correctif.

Les migrations SQL nécessaires aux correctifs sont regroupées en fin de document, **écrites et commentées, non exécutées** (R1).

---

## 0. Infrastructure : rien de nouveau, trois niveaux

| Niveau | Outil | Base | Où | Quand |
|---|---|---|---|---|
| **U** unitaire | vitest, modules **réels** importés (`server/lib/automationEngine.ts`, `server/lib/actions/index.ts`, `server/lib/eventBus.ts`, `server/lib/scheduler.ts`), client Supabase **factice** (le `clientFactice` de `tests/lumi-rapports.test.ts:21-35` : chaînable, répond par table/RPC, enregistre les écritures), `vi.mock('twilio')`/`vi.mock('../mailer')`, `vi.useFakeTimers()` + `vi.setSystemTime()` | aucune | `tests/automation/*.test.ts` (fichiers existants conservés, nouveaux à côté) | à chaque `npm test`, CI « Lint · Test · Build » |
| **I** intégration | vitest, moteur réel + **staging** Supabase par `service_role`, deux orgs de test générées avec préfixe `qa-auto-<stamp>-` (même recette que `scripts/debug-rls-leak.mjs:14-40` et `scripts/qa/verifier-rls-roles.mjs:39-51`), fournisseurs mockés | staging (`RLS_TEST_DB_URL` / `.env.local`), **jamais prod** : garde `SUPABASE_PROJECT_REF_PROD` comme dans `scripts/qa/evaluer-lumi.mjs:38-41` | `tests/automation-integration/*.test.ts`, `describe.skipIf(!process.env.DB_URL && !process.env.VITE_SUPABASE_URL?.includes(staging))` | CI job « RLS cross-tenant isolation » (déjà branché sur staging), et localement |
| **E** bout en bout | robots `scripts/qa/*.mjs` (pattern `automatisations.mjs` : entité de test `[QA]`, vrai événement HTTP, avance d'échéance, dépilage), `QA_REDIRECT_TO` armé | staging + serveur local | `scripts/qa/` | à la main, avant un déploiement du moteur |

Règles communes (R2) : chaque suite I/E crée ses orgs, ses utilisateurs, ses clients et les **supprime** dans `afterAll` (ordre : logs, tâches, règles, entités, memberships, orgs, users — les FK `on delete cascade` sur `org_id` font l'essentiel). Aucun test ne lit ni n'écrit une org qui n'a pas le préfixe. Aucun envoi réel : Twilio et `sendEmail` sont remplacés par des enregistreurs (`vi.mock`) au niveau U et I ; au niveau E, détournés par `QA_REDIRECT_TO`.

Données de test minimales par org (I/E) : 1 owner, 1 technicien, 1 client avec téléphone + courriel, 1 client sans contact, 1 client `sms_opt_outs`, 1 job avec 1 visite `schedule_events` (start_at dans 3 jours), 1 devis `sent`, 1 facture `sent` avec `due_date` passée, les 35 presets semés par `ensureAutomationPresets(admin, orgId, { activateAll: true })`.

Contrainte d'ordre (mission) : **T7 et T4 d'abord**, en Phase 4.

---

## T7. Isolation multi-tenant — bloquant V1

Niveau **I** (deux orgs réelles, RLS et `service_role` réels). Montage : orgs A et B avec des entités aux UUID générés ; on garde les ids de B.

| Cas | Montage | Assertion | Bug attrapé |
|---|---|---|---|
| T7.1 | Membre de A appelle `POST /api/automations/events/appointment-created { eventId: <visite de B> }` (via `supertest` sur l'app Express, ou `fetch` sur un serveur local) | réponse 404 ; aucune ligne `automation_scheduled_tasks` ni `automation_execution_logs` avec `entity_id` de B ; l'enregistreur Twilio/mailer n'a rien reçu | **F1** — **ROUGE ATTENDU** (aujourd'hui : 200, règle `appointment_confirmation` de A exécutée avec le client de B) |
| T7.2 | idem avec `invoice-paid { invoiceId: <facture de B> }`, `lead-created { leadId: <lead de B> }`, `lead-status-changed`, `appointment-cancelled`, `appointment-rescheduled` | 404 partout ; pour `appointment-rescheduled` : aucune tâche de B annulée | F1 — ROUGE ATTENDU |
| T7.3 | `resolveEntityVariables(admin, orgA, 'schedule_event', <visite de B>)` appelé directement | retourne `{}` (aucune variable client de B) | F1 (garde en profondeur) — ROUGE ATTENDU |
| T7.4 | idem pour `'invoice'`, `'job'`, `'client'`, `'lead'`, `'quote'` (ce dernier doit déjà passer) | `{}` sauf `company_*` de A | F1 |
| T7.5 | `checkStopConditions(admin, 'invoice', <facture payée de B>)` | `false` ou refus explicite, jamais « cancel » basé sur l'état de B | F1 |
| T7.6 | Événement légitime de A (`appointment.created` sur sa propre visite) | tâches et logs portent `org_id = A` ; `messages`/`notifications`/`tasks` créés avec `org_id = A` ; `SELECT` par le user de B via PostgREST (jeton anon + JWT) sur `automation_scheduled_tasks`, `automation_execution_logs`, `automation_rules` ne renvoie **rien** de A | cloisonnement des logs (R8) |
| T7.7 | Deux orgs avec un **même** `preset_key` et des règles créées à la même seconde ; événement dans A | seule la règle de A s'exécute (filtre `org_id` de `handleEvent`) | régression du filtre `:421` |
| T7.8 | Variables de gabarit : règle de A avec corps `[client_email] [company_phone]` ; événement sur une entité de A dont le client a le même numéro qu'un client de B | le texte résolu contient les valeurs de A (jointure par `id`, pas par téléphone) | traversée par valeur partagée |
| T7.9 | Technicien de A (jeton JWT) tente par PostgREST `update automation_rules set is_active`, `insert automation_rules`, `delete automation_execution_logs`, `update automation_scheduled_tasks set execute_at` sur A | 0 ligne touchée (RLS) | **F4** — **ROUGE ATTENDU** jusqu'à la migration M1 |
| T7.10 | Membre de B tente les mêmes écritures sur les lignes de A | 0 ligne | RLS de base (doit déjà passer) |

Données : deux orgs, UUID proches non nécessaires (les UUID sont aléatoires ; le test T7.7 couvre la collision de clé fonctionnelle).

## T4. Idempotence et reprise — le bloc le plus important

| Cas | Niveau | Montage | Assertion | Bug attrapé |
|---|---|---|---|---|
| T4.1 | U | `eventBus.emit('appointment.created', même payload)` **deux fois** ; règle immédiate `appointment_confirmation` | Twilio mock appelé **une** fois, un seul log | **F3** — ROUGE ATTENDU |
| T4.2 | I | `POST /automations/events/appointment-created` deux fois avec le même corps (double clic) | une tâche/une exécution par action, un seul SMS | F3 — ROUGE ATTENDU |
| T4.3 | U | règle différée, événement émis deux fois | une seule ligne `automation_scheduled_tasks` (23505 absorbé, `:392`) | régression de `idx_scheduled_tasks_dedup` / `buildExecutionKey` sans date |
| T4.4 | I | tâche `pending` échue ; on simule le crash : `status='running'`, `execute_at = now - 16 min`, `attempts=1`, **et** une ligne `messages.provider_message_id` déjà écrite pour cette clé | `processScheduledTasks` remet en file puis **ne renvoie pas** ; tâche `completed` | **F5** — ROUGE ATTENDU |
| T4.5 | U | Twilio mock lève un timeout **après** avoir enregistré l'appel ; retry (`nextStateAfterFailure`) | à la reprise, second appel Twilio porte la **même** clé d'idempotence, ou n'a pas lieu | F5 — ROUGE ATTENDU |
| T4.6 | I | deux appels concurrents à `processScheduledTasks` (Promise.all) sur la même tâche échue | un seul `claimed`, un seul envoi (`:621-643`) | régression de la prise atomique |
| T4.7 | U | tâche `running` depuis 14 min | non reprise ; à 16 min : reprise | seuil `TACHE_FIGEE_MS` |
| T4.8 | U | même événement rejoué le **lendemain** (renvoi d'un devis) alors que la relance J+3 est encore `pending` | pas de seconde tâche (clé sans date) ; après `completed`, un nouvel envoi crée une nouvelle tâche | comportement voulu vs `20260810140000` |
| T4.9 | I | `request_review` exécuté deux fois à 1 min d'intervalle pour le même job | un seul sondage, second refusé « already sent in the last 7 days » | anti-doublon `review_requests` |
| T4.10 | U | log d'exécution : insert échoue (mock retourne `error`) | l'action **n'est pas rejouée**, l'erreur est loggée en console | comportement `:256-258` |

## T1. Déclenchement

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T1.1 | U | `lead.status_changed` avec `new_status:'lost'` | `lost_lead_reengagement` planifiée ; avec `'won'` : rien | conditions `eq` |
| T1.2 | U | job sauvegardé sans changement (`rpc_schedule_job` renvoie `updated:true`, photo identique) — simulé par le hook `syncJobSchedule` logique extraite | aucun événement émis | **F12** ; aujourd'hui géré côté client `jobsApi.ts:258-296`, à tester là où la détection vivra |
| T1.3 | I | visite créée, puis `appointment-created` ré-émis à l'identique 1 h plus tard | pas de seconde confirmation | F12/F3 — ROUGE ATTENDU |
| T1.4 | I | visite déplacée (`appointment-rescheduled`) | anciennes tâches `cancelled` avec motif « Rendez-vous déplacé », nouvelles tâches calées sur la nouvelle date | régression `:140-193` |
| T1.5 | U | `event.metadata.suppress_immediate: true` | règles à délai 0 sautées, règles négatives planifiées | `:434-441` |
| T1.6 | U | règle `is_active=false` | jamais sélectionnée | filtre `:423` |
| T1.7 | U | événement dont le type n'est écouté par aucune règle | zéro requête d'action, une ligne `activity_log` | coût d'un événement mort |

## T2. Conditions

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T2.1 | U | `evaluateConditions` **importé** (pas recopié) : `{a:'3'}` vs `metadata.a=3` → vrai ; `{a:{neq:'x'}}` vs `undefined` → vrai ; `{a:'null'}` vs `null` → faux ; `{a:{in:[1,'2']}}` vs `2` → vrai ; `{a:{not_in:[…]}}` ; chaîne vide vs `0` → faux | valeurs exactes | `memeValeur` ; **F23** (le test existant recopie la fonction) |
| T2.2 | U | opérateur inconnu `{a:{gt:5}}` | règle **non** exécutée, `console.warn` appelé | faux positif historique `:73-84` |
| T2.3 | U | deux clés (AND) dont une fausse | faux | AND implicite |
| T2.4 | U | `metadata.old_status='new', new_status='lost'` avec condition `{old_status:'new', new_status:'lost'}` | vrai | seule forme d'ancienne valeur disponible |
| T2.5 | U | date passée/future : condition `{due_date:'2026-01-01'}` vs `'2026-01-01'` | vrai (chaîne) ; documenter qu'aucune comparaison temporelle n'existe | limite S3 |

## T3. Actions

Niveau **U** avec `clientFactice` enregistrant les inserts, Twilio/mailer mockés.

| Cas | Montage | Assertion | Bug |
|---|---|---|---|
| T3.1 `send_sms` | client avec téléphone, org avec numéro | `messages.create` appelé une fois avec `from` = numéro de l'org, `to` E.164 ; ligne `messages` avec `sender_user_id` null et `provider_message_id` | régression numéro plateforme |
| T3.2 `send_sms` opt-out | `sms_opt_outs` contient le numéro | aucun appel Twilio, `error` contient « opted out », `isTransientFailure` = faux | CASL à l'exécution |
| T3.3 `send_sms` plafond | 3 `messages` sortants sans `sender_user_id` sur 24 h, `ctx.commercial=true` | refus « Frequency cap » ; avec `commercial` absent : envoi | plafond |
| T3.4 `send_email` | corps FR/EN, `ctx.langue='en'` avec `body_en` | `sendEmail` reçoit `body_en` ; sans `body_en` : repli FR ; `List-Unsubscribe` présent ; `activity_log email_sent` écrit | `champLocalise` |
| T3.5 `send_email` désabonné | `isEmailUnsubscribed` vrai | refus, aucun envoi | CASL |
| T3.6 `create_task` | entité `schedule_event` liée à un job | `tasks.linked_entity_type='job'`, `created_by` = owner ; entité `payment` → lien null | CHECK `tasks` `:663-699` |
| T3.7 `create_task` sans owner | `memberships` sans `owner` | échec propre « No org owner » | |
| T3.8 `update_status` | table hors liste blanche | refus ; table autorisée + 0 ligne → `success:false` | `:737-753` |
| T3.9 `update_status` statut invalide | `invoices.status='banane'` | **doit** être refusé | **F15** — ROUGE ATTENDU |
| T3.10 `request_review` | `review_enabled=false` → refus ; sans lien → refus ; avec courriel + SMS → 2 envois, `satisfaction_surveys` + `review_requests(status='sent')` ; aucun canal parti → `review_requests(status='failed')` | | `:764-957` |
| T3.11 vocabulaire | pour chaque preset FR : le corps résolu ne contient ni `undefined`, ni `[` orphelin, ni « Bonjour , », ni statut anglais (`scheduled`, `completed`), ni `$1,234.56` | regex sur le texte | qualité des gabarits ; **F8** (variables vides) — ROUGE ATTENDU pour `job` supprimé |
| T3.12 paramètre invalide | `config.body` absent | `success:false` sans écriture partielle (aucun insert `messages`) | pas de demi-état |
| T3.13 `create_notification` | insert enregistré avec `org_id`, `type:'automation'`, `reference_id` = entité | | régression `message NOT NULL` (15 échecs en juillet) |

## T5. Boucles et récursion

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T5.1 | U | règle `update_status` qui, via un émetteur de test, ré-émet le même événement sur la même entité | arrêt au 2e passage (clé d'idempotence ou profondeur) | **F12c/F13** — ROUGE ATTENDU (aujourd'hui : boucle jusqu'au `MAX_ETAPES`… qui n'existe pas : boucle infinie bornée seulement par le plafond 3/24 h **si** l'action est commerciale) |
| T5.2 | U | A émet X → règle → B émet Y → règle → A | détecté par `metadata.__depth` > 3 | ROUGE ATTENDU |
| T5.3 | U | profondeur max respectée : 3 niveaux légitimes passent, le 4e est refusé et loggé | | |

## T6. Volume

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T6.1 | I | 200 `lead.created` en rafale sur une org (boucle `emit`) | comportement **défini** : soit 200 exécutions avec un compteur d'org qui bloque au plafond (après M4), soit 200 envois assumés — le test fige la décision | **F11** — ROUGE ATTENDU tant que la décision n'est pas implémentée |
| T6.2 | U | même montage, `clientFactice` compte les requêtes | ≤ N requêtes par événement, où N est mesuré et figé (baseline), plus une alerte si +30 % | **F24**, mesure du N+1 |
| T6.3 | I | 600 tâches échues | 12 ticks les vident, aucune perte, aucune tâche `running` orpheline | débit `limit(50)` |
| T6.4 | U | 10 visites en lot (`suppress_immediate`) | 0 confirmation, 30 rappels planifiés | `:434-441` |

## T8. Permissions

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T8.1 | I | technicien crée par PostgREST une règle `update_status invoices paid` | refusé (RLS après M1) | F4 — ROUGE ATTENDU |
| T8.2 | I | technicien écrit `config.to` dans une règle existante | refusé | F4/F18 — ROUGE ATTENDU |
| T8.3 | U | règle avec `config.to='+15145550100'` | après correctif : ignoré ou refusé ; aujourd'hui : envoyé | F18 — ROUGE ATTENDU |
| T8.4 | I | membre `status='inactive'` (ou retiré) appelle un hook d'événement | 403 | `has_org_membership` sans statut — ROUGE ATTENDU si la fonction n'est pas corrigée |
| T8.5 | U | contexte d'exécution documenté : les écritures (`tasks.created_by`, `messages`) portent l'owner/aucun user, jamais l'acteur | | documentation A4 |

## T9. Temps

Niveau **U** avec `vi.useFakeTimers()` et `vi.setSystemTime()` ; les dates de RDV sont fixées en ISO.

| Cas | Montage | Assertion | Bug |
|---|---|---|---|
| T9.1 | visite `2026-09-13T13:00:00Z` (9 h Montréal) | `appointment_time` = « 09:00 » ou « 9 h », `appointment_date` = « 2026-09-13 » | **F2** — ROUGE ATTENDU (aujourd'hui « 13:00 » sur un serveur UTC) — le test force `process.env.TZ='UTC'` pour reproduire Railway |
| T9.2 | rappel −86400 s sur une visite le 2026-11-02 10:00 Montréal (lendemain du retour à l'heure normale) | `execute_at` = 2026-11-01 10:00 Montréal, pas 11:00 | dérive DST de `resolveExecuteAt` — ROUGE ATTENDU probable |
| T9.3 | rappel −7200 s, visite 2026-03-08 03:30 Montréal (printemps) | exécuté 01:30, jamais dans le trou 02:00-03:00 | `nextSendTime` pas à pas |
| T9.4 | `isQuietHours` à 07:59, 08:00, 19:59, 20:00 Montréal, en été et en hiver | faux/vrai exacts | bornes |
| T9.5 | rappel « 2 h avant » un RDV à 7 h ; il tombe en heures calmes | **abandonné**, pas reporté après le RDV | A3 (report après RDV) — ROUGE ATTENDU |
| T9.6 | RDV créé pour demain 9 h ; règle J-7 | aucune tâche (créneau dépassé > 30 min) ; règle J-1 : tâche à demain 9 h − 24 h ; retard de 10 min : exécution immédiate | `resolveExecuteAt` |
| T9.7 | date source changée après planification (I) : `appointment-rescheduled` | recalcul (cf. T1.4) ; **sans** appel du hook (update SQL direct de `start_at`) : les tâches restent sur l'ancienne date — documenter | limite serveur (S5) |
| T9.8 | règle désactivée pendant l'attente (I) | tâche **non exécutée**, `cancelled` avec motif | **F16** — ROUGE ATTENDU |
| T9.9 | texte modifié pendant l'attente (I) | le texte **nouveau** part | F16 — ROUGE ATTENDU |
| T9.10 | entité supprimée pendant l'attente : facture, devis, visite (`deleted_at`), lead, **job** | `cancelled`, jamais d'envoi « Bonjour , » | F16 (job) — ROUGE ATTENDU pour job |
| T9.11 | `detectOverdueInvoices` à 23:30 Montréal le jour J (= J+1 UTC) | `days_overdue` calculé en date de Montréal | **F14** — ROUGE ATTENDU |
| T9.12 | `todayDateString()` remplacé par `dateOrg()` : même valeur que le SQL `now() at time zone 'America/Toronto'` | | F14 |

## T10. Erreurs et dépendances externes

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T10.1 | U | Twilio mock rejette (`ECONNRESET`) | tâche `pending` avec `execute_at = +5 min`, `attempts=1`, `last_error` « reprise 1/4 » ; puis +30 min, +2 h ; 4e échec → `failed` | `nextStateAfterFailure` |
| T10.2 | U | erreur définitive « No recipient phone » | `failed` immédiat, aucune reprise | `isTransientFailure` |
| T10.3 | U | après `failed` définitif | une notification à l'admin existe (après correctif S12) | ROUGE ATTENDU |
| T10.4 | U | `sendEmail` timeout 30 s (fake timers) | l'action retourne `success:false` en moins de 35 s, la tâche est reprise, aucune autre tâche du tick n'est bloquée | timeout d'appel sortant — à vérifier : `mailer.ts` a-t-il un timeout ? sinon ROUGE |
| T10.5 | I | `request_review` : insert `satisfaction_surveys` réussit, `review_requests` échoue (colonne piégée) | état cohérent ou rollback ; aujourd'hui : sondage créé, suivi absent → **documenter** l'absence de transaction | R6 — ROUGE ATTENDU |
| T10.6 | U | 3 tâches dans le tick, la 2e lève une exception | la 1re et la 3e sont exécutées, la 2e est `failed`/reprise | isolation entre tâches `:645-739` |
| T10.7 | U | `handleEvent` : la 1re règle lève | les règles suivantes du même événement s'exécutent quand même | aujourd'hui : `catch` global `:458` arrête tout — ROUGE ATTENDU |
| T10.8 | U | lecture `invoices` en erreur dans `checkStopConditions` | tâche conservée, pas annulée | régression `:761-774` |
| T10.9 | U | `engineConfig` null (événement avant `initAutomationEngine`) | événement perdu → après correctif : mis en file | F9 — ROUGE ATTENDU |

## T11. Conformité

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T11.1 | I | client sans consentement (`marketing_consent='none'` après M5), règle commerciale (`cross_sell_30d`) | aucun envoi, log « no consent » | **F7** — ROUGE ATTENDU |
| T11.2 | I | même client, règle transactionnelle (`appointment_confirmation`) | envoi | distinction transactionnel/commercial |
| T11.3 | I | STOP reçu **après** la planification d'une relance | à l'exécution : refus | `sms_opt_outs` à l'exécution (doit passer) |
| T11.4 | I | désabonnement courriel après planification | refus | doit passer |
| T11.5 | U | `lost_lead_reengagement` sur un lead jamais client | refusé ou preset inactif par défaut | F7 — ROUGE ATTENDU |
| T11.6 | U | `request_review` : courriel + SMS le même instant | compté dans le plafond commercial | F7 — ROUGE ATTENDU |
| T11.7 | I | log d'exécution d'un envoi | contient `recipient`, `actor_id`, `event_id`, `rule_snapshot` (après M3) ; ne contient **pas** le corps complet | F8 — ROUGE ATTENDU |
| T11.8 | I | purge : logs > 12 mois | supprimés par `purge_automation_logs()` (M6) ; < 12 mois conservés | F21 — ROUGE ATTENDU |

## T12. Coût

| Cas | Niveau | Montage | Assertion | Bug |
|---|---|---|---|---|
| T12.1 | I | plafond org à 5 SMS/jour (M4) ; 6e envoi | reporté au lendemain (`execute_at` = 8 h le lendemain), notification admin, **aucun** dépassement | F13 — ROUGE ATTENDU |
| T12.2 | I | 80 % du plafond | notification « 4/5 » | ROUGE ATTENDU |
| T12.3 | U | `AUTOMATIONS_ENABLED=false` | `handleEvent` ne planifie ni n'exécute ; `processScheduledTasks` ne prend rien ; les tâches restent `pending` intactes | **F6** — ROUGE ATTENDU |
| T12.4 | I | `company_settings.automations_paused_at` posé sur A | A muette, B continue | F6 — ROUGE ATTENDU |
| T12.5 | I | `dry_run` sur A | log avec `result_data.dry_run=true`, aucun appel Twilio/mailer | F6 — ROUGE ATTENDU |

## T13. Front

Niveau **U**, jsdom + `react-dom/client` + `act` (correction : React Testing Library n'est PAS installée dans le dépôt — `node_modules/@testing-library` absent — et `tests/agent-office-isolation.test.tsx` ne rend aucun composant ; la première version de ce plan l'affirmait à tort). `automationRulesApi`, `sonner`, `usePermissions` et `src/lib/supabase` mockés.

**Livré (2026-09-14)** : `tests/automation/front-automations.unit.test.tsx` — 24 cas, 20 verts, 4 rouges attendus (tous F22) : `agreement.signed` et « Contract Signed » affichés bruts en français, variable inconnue `[prenom]` non signalée alors que le serveur l'enverra vide (`resolveTemplate`, `server/lib/actions/index.ts:124`), aucune raison d'échec lisible. T13.5 est couvert par T9.8 (intégration, rouge F16). Le cliquet d'accessibilité reste à 0 sur la page et les deux éditeurs.

| Cas | Assertion | Bug |
|---|---|---|
| T13.1 chargement | spinner puis liste | |
| T13.2 vide | « Aucune automatisation » ; avec recherche : « Aucun résultat » | |
| T13.3 erreur de chargement | toast d'erreur, page utilisable | |
| T13.4 toggle | optimiste ; `toggleAutomationRule` rejeté → rollback + toast ; réussi → toast succès ; l'API vérifie la ligne retournée (`.select('is_active')`) | faux succès RLS |
| T13.5 toggle réellement appliqué (I) | après toggle off, une tâche pending de cette règle n'est pas exécutée | **F16** — ROUGE ATTENDU |
| T13.6 badge échec | 3 échecs mockés sur 7 j → badge « 3 échec » avec title lisible | |
| T13.7 déclencheur lisible | `agreement.signed` affiché « Contrat signé », pas la clé brute ; aucun libellé pour un événement inexistant | F22 |
| T13.8 éditeur | variables insérées, enregistrement appelle `updateRuleMessage(id,'send_sms',body)` ; courriel : `subject` transmis ; variable inconnue affichée **visible** dans l'aperçu (après correctif) | |
| T13.9 accessibilité | `node scripts/accessibilite-mesure.mjs` reste à 0 sur les nouveaux composants | cliquet existant |
| T13.10 historique | (après S15) un échec s'affiche en français : « Impossible d'envoyer à Marc T. — pas de numéro », jamais `SMTP not configured` | F22 |

## T14. Non-régression — golden set

Niveau **U**, rejoué en CI. Fichier `tests/automation/golden/<preset_key>.json` : `{ event, entity_fixture, expected: { scheduled: [{action, execute_at_relative}], immediate: [{action, to, body}] } }`.

- Un cas par preset (35), généré une fois à partir d'un jeu de données fixe (client « Marie Tremblay », visite `2026-09-15T13:00:00Z`, devis 1 626,90 $, facture INV-000042 due `2026-09-01`), horloge figée `2026-09-13T15:00:00Z`.
- Assertion : le corps résolu est **exactement** celui du fichier (texte FR, montants « 1 626,90 $ », heure « 9 h »), les délais sont exacts, le canal est celui attendu.
- Toute modification de gabarit ou du moteur qui change une sortie fait échouer le cas : on met à jour le fichier **sciemment** (commit revu), jamais par script.
- 16 presets n'ont jamais tourné en prod : le golden set est la seule preuve qu'ils produisent un message juste avant qu'un client le reçoive.

---

## Ce que chaque bloc exige

| Bloc | Niveau | Base dédiée | Fixtures |
|---|---|---|---|
| T7 | I (+U pour 7.3-7.5) | staging, 2 orgs | 2 orgs complètes |
| T4 | U + I | staging pour 4.2, 4.4, 4.6, 4.9 | 1 org |
| T1, T2, T3, T5 | U | non | `clientFactice` |
| T6 | I (6.1, 6.3) + U | staging | 1 org, 200 leads générés |
| T8 | I | staging | 2 orgs, 1 technicien |
| T9 | U (+I 9.7-9.10) | staging pour I | fake timers |
| T10 | U (+I 10.5) | | mocks fournisseurs |
| T11 | I + U | staging | consentement (M5) |
| T12 | I + U | staging | plafond (M4), interrupteurs (M2) |
| T13 | U (+I 13.5) | | RTL |
| T14 | U | non | golden files |

Ordre Phase 4 : **T7 → T4 → T9 (F2 en tête) → T3.11/T14 → T1/T2 → T10 → T12/T6 → T11 → T8 → T13**. Un bloc à la fois, résultat + liste des rouges, arrêt.

---

## Migrations SQL — M1 à M7 ÉCRITES ET APPLIQUÉES SUR STAGING le 2026-09-14 (`supabase/migrations/20260914120100` → `120700`) ; M8/M9 deuxième vague ; M10 sur demande. Prod : après merge, `npm run db:apply:prod`.

(Texte d'origine conservé ci-dessous : les fichiers réels priment.)

## Migrations SQL — écrites, commentées, NON exécutées (R1)

Toutes sont des fichiers `supabase/migrations/<horodatage>_*.sql` à appliquer **staging d'abord** (`npm run db:apply`), puis prod (`db:apply:prod`), suivies de `check:broken-objects`, `check:db-coherence`, `check:schema-refs`, et régénération du baseline. Aucune ne s'exécute dans ce plan. Les tests marqués « après Mn » restent rouges tant que la migration correspondante n'est pas appliquée.

### M1 — RLS admin-only sur les tables du moteur (F4, T7.9, T8.1-8.2)

```sql
-- 2026xxxx_automation_rls_admin.sql
-- Les règles se lisent par tout membre, s'écrivent par les admins (owner/admin) ;
-- les tâches et les logs se lisent par les membres, s'écrivent par le serveur seul.
-- has_org_admin_role(uid, org) existe déjà (utilisée par batch_restore).

begin;

-- automation_rules ─────────────────────────────────────────────
drop policy if exists automation_rules_insert_org on public.automation_rules;
drop policy if exists automation_rules_update_org on public.automation_rules;
drop policy if exists automation_rules_delete_org on public.automation_rules;

create policy automation_rules_insert_admin on public.automation_rules
  as permissive for insert to authenticated
  with check (public.has_org_admin_role((select auth.uid()), org_id));

create policy automation_rules_update_admin on public.automation_rules
  as permissive for update to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));

create policy automation_rules_delete_admin on public.automation_rules
  as permissive for delete to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));

-- automation_scheduled_tasks / automation_execution_logs : lecture seule ──
drop policy if exists automation_scheduled_tasks_insert_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_update_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_delete_org on public.automation_scheduled_tasks;
drop policy if exists automation_execution_logs_insert_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_update_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_delete_org on public.automation_execution_logs;

-- Ceinture et bretelles : les GRANT par défaut de Supabase donnent ALL à
-- authenticated ; sans REVOKE, une future policy permissive rouvrirait tout
-- (voir mémoire secdef-lume-moindre-privilege).
revoke insert, update, delete on public.automation_scheduled_tasks from authenticated, anon;
revoke insert, update, delete on public.automation_execution_logs from authenticated, anon;

-- Hygiène : la policy SELECT des règles teste memberships sans statut.
-- Option : remplacer par has_org_membership + statut actif quand la fonction
-- le fera (voir M7). Laissé tel quel ici pour ne pas coupler les deux.

commit;
```

Vérification après application : `npm run qa:rls-roles` (ajouter les 3 tables à la matrice), T7.9/T8.1.

### M2 — Interrupteurs et dry-run (F6, T12.3-12.5)

```sql
-- 2026xxxx_automation_switches.sql
-- Pause par org et mode simulation. Le kill switch GLOBAL est une variable
-- d'environnement (AUTOMATIONS_ENABLED), pas une ligne en base : il doit
-- marcher même si la base est en cause.
alter table public.company_settings
  add column if not exists automations_paused_at timestamptz,
  add column if not exists automations_dry_run boolean not null default false;
comment on column public.company_settings.automations_paused_at is
  'Non nul = aucune automatisation ne part pour cette org ; les tâches restent pending.';
comment on column public.company_settings.automations_dry_run is
  'true = le moteur journalise ce qu''il aurait envoyé (result_data.dry_run) sans appeler Twilio/SMTP.';
```

### M3 — Trace d'exécution complète (F8, T11.7)

```sql
-- 2026xxxx_automation_logs_trace.sql
alter table public.automation_execution_logs
  add column if not exists event_id uuid,                 -- activity_log.id de l'événement déclencheur
  add column if not exists actor_id uuid,                 -- qui a provoqué l'événement (null = système)
  add column if not exists recipient text,                -- destinataire résolu (E.164 ou courriel), jamais le corps
  add column if not exists rule_snapshot jsonb,           -- {trigger_event, conditions, delay_seconds, action} au moment de l'exécution
  add column if not exists conditions_evaluated jsonb,    -- {clé: {attendu, réel, ok}} — ce qui a matché
  add column if not exists dry_run boolean not null default false;

-- Les non-matchs ne sont PAS journalisés ici (volume) : ils vont dans
-- automation_events (M8) avec matched_rules = '[]'.

-- Retirer le corps des messages des logs existants (PII sans finalité) :
-- à faire en une fois, puis le serveur cesse d'écrire result_data.body.
-- update public.automation_execution_logs
--    set result_data = result_data - 'body'
--  where result_data ? 'body';
```

### M4 — Plafonds par org (F11/F13, T12.1-12.2, T6.1)

```sql
-- 2026xxxx_automation_send_counters.sql
create table if not exists public.automation_send_counters (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  day      date not null,                          -- date de Montréal
  sms      integer not null default 0,
  email    integer not null default 0,
  primary key (org_id, day)
);
alter table public.automation_send_counters enable row level security;
alter table public.automation_send_counters force row level security;
create policy automation_send_counters_select_org on public.automation_send_counters
  as permissive for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_id));
revoke insert, update, delete on public.automation_send_counters from authenticated, anon;

-- Incrément atomique appelé par le serveur (service_role) avant chaque envoi ;
-- renvoie le nouveau total pour comparaison au plafond du plan.
create or replace function public.automation_bump_counter(p_org uuid, p_canal text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v integer;
begin
  insert into public.automation_send_counters (org_id, day, sms, email)
  values (p_org, (now() at time zone 'America/Toronto')::date,
          case when p_canal = 'sms' then 1 else 0 end,
          case when p_canal = 'email' then 1 else 0 end)
  on conflict (org_id, day) do update
    set sms = public.automation_send_counters.sms + excluded.sms,
        email = public.automation_send_counters.email + excluded.email
  returning case when p_canal = 'sms' then sms else email end into v;
  return v;
end;
$$;
revoke all on function public.automation_bump_counter(uuid, text) from public, anon, authenticated;
grant execute on function public.automation_bump_counter(uuid, text) to service_role;

alter table public.plans
  add column if not exists automation_daily_sms_cap integer not null default 0,
  add column if not exists automation_daily_email_cap integer not null default 0;
-- Valeurs à décider (proposition) : starter 0/0, pro 100/300, autopilot 300/1000.
-- update public.plans set automation_daily_sms_cap = 100, automation_daily_email_cap = 300 where slug = 'pro';
-- update public.plans set automation_daily_sms_cap = 300, automation_daily_email_cap = 1000 where slug = 'autopilot';
```

### M5 — Consentement commercial (F7, T11.1, T11.5)

```sql
-- 2026xxxx_clients_marketing_consent.sql
-- À CONFIRMER AVANT : vérifier qu'aucune colonne équivalente n'existe déjà
-- (grep SCHEMA_SNAPSHOT.md : consent, marketing, opt_in) — sinon réutiliser.
alter table public.clients
  add column if not exists marketing_consent text not null default 'implied'
    check (marketing_consent in ('express', 'implied', 'none')),
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_consent_source text;   -- 'form', 'quote_accepted', 'manual', 'import'
comment on column public.clients.marketing_consent is
  'LCAP/CASL : express = consentement exprès ; implied = relation d''affaires (2 ans après le dernier achat) ; none = aucun envoi commercial. Les messages transactionnels (confirmation, reçu, rappel de RDV) ne sont pas concernés.';
-- Backfill proposé : 'implied' pour les clients avec au moins une facture payée
-- ou un devis approuvé ; 'none' pour les leads jamais convertis.
-- update public.clients c set marketing_consent = 'none'
--  where status = 'lead' and not exists (select 1 from public.invoices i where i.client_id = c.id);
```

### M6 — Purge (F21, T11.8)

```sql
-- 2026xxxx_automation_purge.sql
-- Appelée par le cron serveur existant (server/routes/cron.ts), pas par pg_cron.
create or replace function public.purge_automation_history(p_months integer default 12)
returns table (logs_supprimes bigint, taches_supprimees bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare l bigint; t bigint;
begin
  delete from public.automation_execution_logs
   where created_at < now() - make_interval(months => p_months);
  get diagnostics l = row_count;
  delete from public.automation_scheduled_tasks
   where status in ('completed', 'cancelled', 'failed')
     and coalesce(completed_at, created_at) < now() - make_interval(months => p_months);
  get diagnostics t = row_count;
  return query select l, t;
end;
$$;
revoke all on function public.purge_automation_history(integer) from public, anon, authenticated;
grant execute on function public.purge_automation_history(integer) to service_role;
-- R7 : ce sont des journaux techniques, pas des données métier ; la suppression
-- physique est acceptable ici parce que la rétention est la finalité même.
```

### M7 — Appartenance active seulement (T8.4)

```sql
-- 2026xxxx_has_org_membership_active.sql
-- has_org_membership(p_user, p_org) ne teste pas memberships.status : un membre
-- retiré (status <> 'active') garde l'accès tant que sa ligne existe.
-- À CONFIRMER AVANT : quelles valeurs prend memberships.status (grep SCHEMA_SNAPSHOT),
-- et si le retrait d'un membre supprime la ligne ou change le statut.
create or replace function public.has_org_membership(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = p_user and m.org_id = p_org
       and coalesce(m.status, 'active') = 'active'
  );
$$;
-- Impact large (toutes les policies has_org_membership) : à tester avec
-- qa:rls-roles et test:rls avant prod.
```

### M8 — Outbox d'événements (F9/F10/F12, T10.9, T1.3) — deuxième vague

```sql
-- 2026xxxx_automation_events_outbox.sql
-- Persiste chaque événement AVANT tout traitement ; le tick le consomme.
-- Remplace l'écriture activity_log faite par eventBus.emit (qui reste pour la timeline).
create table if not exists public.automation_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  type          text not null,
  entity_type   text not null,
  entity_id     uuid not null,
  actor_id      uuid,
  metadata      jsonb not null default '{}'::jsonb,
  fingerprint   text not null,                      -- hash(type, entity_id, métadonnées décisives) → dédup 24 h
  depth         integer not null default 0,         -- profondeur de récursion (max 3)
  status        text not null default 'pending' check (status in ('pending','processing','done','skipped','failed')),
  matched_rules jsonb,                              -- ids des règles ayant matché (vide = non-match journalisé)
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create unique index if not exists automation_events_fingerprint_24h
  on public.automation_events (org_id, fingerprint)
  where status <> 'skipped' and created_at > now() - interval '24 hours';
  -- NB : un prédicat non immuable est refusé par Postgres ; utiliser à la place
  -- une colonne day_bucket date generated always as ((created_at at time zone 'America/Toronto')::date) stored
  -- et l'index unique (org_id, fingerprint, day_bucket).
create index if not exists automation_events_pending on public.automation_events (created_at) where status = 'pending';
alter table public.automation_events enable row level security;
alter table public.automation_events force row level security;
create policy automation_events_select_org on public.automation_events
  as permissive for select to authenticated using (public.has_org_membership((select auth.uid()), org_id));
revoke insert, update, delete on public.automation_events from authenticated, anon;

-- Émission côté base pour les entités dont le statut change sans passer par le
-- serveur (job terminé hors ligne, import) — remplace la fonction orpheline
-- automation_job_completed() qui référence un schéma périmé.
create or replace function public.automation_emit_job_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status and new.deleted_at is null then
    insert into public.automation_events (org_id, type, entity_type, entity_id, actor_id, metadata, fingerprint)
    values (new.org_id, 'job.completed', 'job', new.id, null,
            jsonb_build_object('job_name', new.title, 'client_id', new.client_id, 'source', 'db'),
            md5('job.completed:' || new.id::text || ':completed'));
  end if;
  return new;
end;
$$;
-- create trigger trg_automation_emit_job_completed after update of status on public.jobs
--   for each row execute function public.automation_emit_job_completed();
-- (trigger commenté : à activer seulement quand le tick consomme la table ET que
--  le hook navigateur job-completed a été retiré, sinon double émission.)
```

### M9 — Historique des gabarits (S11) — plus tard

```sql
-- 2026xxxx_automation_rule_history.sql
create table if not exists public.automation_rule_history (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  rule_id     uuid not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  before      jsonb not null,
  after       jsonb not null
);
create index if not exists automation_rule_history_rule on public.automation_rule_history (org_id, rule_id, changed_at desc);
alter table public.automation_rule_history enable row level security;
alter table public.automation_rule_history force row level security;
create policy automation_rule_history_select_admin on public.automation_rule_history
  as permissive for select to authenticated using (public.has_org_admin_role((select auth.uid()), org_id));
revoke insert, update, delete on public.automation_rule_history from authenticated, anon;

alter table public.automation_rules add column if not exists updated_by uuid;

create or replace function public.automation_rules_track_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.actions is distinct from new.actions or old.is_active is distinct from new.is_active
     or old.conditions is distinct from new.conditions or old.delay_seconds is distinct from new.delay_seconds then
    insert into public.automation_rule_history (org_id, rule_id, changed_by, before, after)
    values (new.org_id, new.id, coalesce(new.updated_by, auth.uid()),
            jsonb_build_object('actions', old.actions, 'is_active', old.is_active, 'conditions', old.conditions, 'delay_seconds', old.delay_seconds),
            jsonb_build_object('actions', new.actions, 'is_active', new.is_active, 'conditions', new.conditions, 'delay_seconds', new.delay_seconds));
  end if;
  return new;
end; $$;
create trigger trg_automation_rules_history after update on public.automation_rules
  for each row execute function public.automation_rules_track_history();
```

### M10 — Nettoyage des implémentations mortes (F20) — sur demande seulement (R13)

```sql
-- 2026xxxx_automation_retrait_orphelins.sql
-- Fonctions trigger jamais attachées, schéma périmé (table automation_executions inexistante).
-- grep préalable obligatoire (règle 4 du CLAUDE.md) : aucune référence dans le code ni les migrations actives.
-- drop function if exists public.automation_job_completed();
-- drop function if exists public.automation_lead_stage_change();
-- La table `automations` (0 ligne, plus aucune écriture) : à retirer avec le
-- polling de scheduler.ts:684-762 dans le même commit, pas avant.
-- drop table if exists public.automations;
```

### Pas de migration nécessaire pour

- F1 (filtres `org_id` : code seulement), F2/F14 (fuseau : code), F3/F5 (file et idempotence : code, l'index unique existe), F15/F16/F17/F18/F19 (code), les index (déjà corrects).
- Les tests eux-mêmes : les fixtures I/E se créent par `service_role` dans des orgs préfixées et se suppriment ; aucune table de test.

Fin de la Phase 3. J'attends le go pour la Phase 4 — tests uniquement, T7 puis T4, un bloc à la fois.
