# B — Carte du moteur (pour AUTOMATIONS_MAP.md)

Agent B, 2026-10-01. Code lu dans `D:/lume-final/wt-b` (branche `mission/auto-finale-b`, partie de origin/main `11e75ebc`).
Les numéros de ligne sont ceux de ce commit. Les preuves « prod » sont des lectures seules du 2026-10-01 entre 22:40 et
23:20 UTC (comptes agrégés, aucune donnée de client). « Vrais bureaux » = entreprises absentes de `orgs_envois_simules`
(7 sur 13) ; les bureaux de test de la mission précédente y sont inscrits.

Ce que `AUTOMATIONS_INVENTORY.md` établit déjà (opérateurs, variables, validation, cycle de vie) n'est pas recopié : cette
carte ajoute le PRODUCTEUR réel de chaque déclencheur, sa fréquence, la preuve qu'il tourne en prod et ce qui se passe s'il
rate un passage.

## 1. Le modèle de données : un seul modèle vivant, deux restes

| Modèle | Tables | Lu par | Écrit par | État en prod |
|---|---|---|---|---|
| **Vivant** : règles | `automation_rules` (une ligne = une automatisation ; `trigger_event` = UN déclencheur ; deux formes dans la même ligne : `actions` + `delay_seconds` « à plat », ou `steps` = parcours) | moteur (`server/lib/automationEngine.ts:1426`, `:1959`), page, Lumi, préréglages, API | éditeur (`server/routes/automation-rules.ts`), Lumi, semeur de préréglages | 593 règles ; publiées dans les vrais bureaux : 192, dont 1 seul parcours |
| Vivant : file | `automation_scheduled_tasks` | `processScheduledTasks` (`automationEngine.ts:1938`) | moteur seulement | 254 `pending` (115 dans de vrais bureaux), 0 `running`, 0 en retard de plus de 10 min |
| Vivant : journal | `automation_execution_logs` | Historique, Journaux, statistiques | moteur | — |
| Vivant : files d'événements | `domain_events` (outbox), `automation_evenements_base` (triggers SQL), `pipeline_events` (deals) | moteur | bus, triggers SQL | 0 événement non traité dans les trois files |
| **Ancien, encore exécuté** : table `automations` | `automations` | `server/lib/scheduler.ts:850-888` à CHAQUE tick de 5 min | personne (aucun écran, aucune route, aucun outil : `grep from('automations')` = `scheduler.ts:851` seul) | **0 ligne** |
| **Ancien, encore exécuté** : factures récurrentes « is_recurring » | colonnes `invoices.is_recurring`, `next_recurrence_date` | `scheduler.ts:497-605` (`handleRecurringInvoices`) à chaque tick | `src/pages/InvoiceDetails.tsx`, `src/lib/invoicesApi.ts` | **0 facture** `is_recurring` |
| **Parallèle, vivant** : relances de paiement | `reminder_settings`, `reminder_log` | `POST /api/cron/payment-reminders` (`server/routes/reminders-cron.ts:310`) | `src/pages/PaymentSettings.tsx`, outils Lumi `update_reminder_settings` | 3 réglages (2 actifs) ; `reminder_log` : 5 lignes, toutes de bureaux de test |

Dans une même ligne `automation_rules`, `steps` l'emporte sur `actions` (`automationEngine.ts:1542`) : c'est la double
représentation relevée dans `notes/P1-1-piste.md`. Côté moteur, les deux formes n'ont PAS le même comportement :

| | Règle « à plat » (`actions`) | Parcours (`steps`) |
|---|---|---|
| Première action | exécutée tout de suite, en ligne (`automationEngine.ts:1579`) | passe par la file : part au tick suivant, 0 à 5 min plus tard (`:1548`) |
| Fenêtre 8 h-20 h pour un courriel sans délai | NON respectée (`shouldRespectQuietHours`, `:567-580`) | respectée (toute tâche de la file, `:2050`) |
| Ce que crée l'éditeur plein écran, Lumi (`create_automation_from_text`), la bibliothèque | — | oui |
| Ce que portent les préréglages semés, l'API sans `steps` | oui | — |

### Code mort ou parallèle à retirer (P6)

| Quoi | Où | Pourquoi |
|---|---|---|
| Lecture de `automations` et ses 5 traitements `days_after_quote_sent`, `days_before_appointment`, `on_invoice_due_date`, `days_after_invoice_due`, `days_after_job_completed` | `server/lib/scheduler.ts:41-59` (types), `:135-330` (traitements), `:361-495` (`hasFired`, `runAutomationOnce`, `notifyAutomationResult`), `:850-888` (boucle) | table vide en prod, aucun écran ; hors pause d'entreprise et hors `AUTOMATIONS_ENABLED` ; envoie ses textos par un chemin à lui (`sendOrgSms`, `scheduler.ts:95`), sans fenêtre d'envoi, sans consentement ni plafond du moteur |
| Ancien clonage `invoices.is_recurring` | `scheduler.ts:497-605`, appelé `:772` | 0 facture ; remplacé par `recurring_invoice_schedules` (`server/lib/recurringInvoicesEngine.ts`, cron pg_cron 11:45 UTC) |
| `server/lib/scheduler-utils.ts` : `addDelay`, `subtractDelay`, `computeNextRecurrenceDate` | utilisés seulement par les deux blocs ci-dessus | à retirer avec eux ; garder `OVERDUE_DAYS` et `createFireDedup` (détecteur de retard) |
| `delayToSeconds` | `automationEngine.ts:1388` | jamais appelé |
| `annulerSequence` | `server/lib/automationSequences.ts:581` | jamais appelé |
| Déclencheur `estimate.sent` et son arrêt | `server/routes/emails.ts:643`, `automationEngine.ts:2923-2934`, `server/lib/sortie-parcours.ts:161-165` | route sans appelant dans `src/` ; 5 règles encore publiées dans des bureaux hors bac à sable, qui ne peuvent jamais partir |
| Écouteur `quote.created` | `server/lib/d2d-pipeline-listener.ts:21` | événement jamais émis |
| Tables `automations` (et ses 4 politiques « tout membre ») | base | à proposer à Rafba, ne pas supprimer sans son accord |

Le système des relances de paiement (`reminder_settings`) n'est PAS mort : c'est un second système pour le même besoin que
le déclencheur « Facture en retard ». Les deux se coordonnent par `couvertureAutomatisations`
(`reminders-cron.ts:349`) et `relanceFactureDejaPartie` (`automationEngine.ts:778`). Décision de produit : en garder un.

## 2. Qui fait tourner quoi, en prod

Tout le moteur vit DANS le processus Express de Railway (aucun worker séparé, aucun `railway.json`/`railway.toml` dans le
dépôt, aucun cron Railway). Les seuls planificateurs externes sont des tâches pg_cron de la base.

| Mécanisme | Où | Fréquence | Verrou | Surveillance | Preuve en prod |
|---|---|---|---|---|---|
| Bus d'événements → `handleEvent` | `automationEngine.ts:3008-3018`, `server/index.ts:1416` | temps réel | — | aucune | 2 542 lignes dans l'outbox (14 jours), 0 non traitée |
| Tick du planificateur | `scheduler.ts:902-970` (`setInterval`), passage au démarrage puis toutes les 5 min | 5 min | `cron_locks` clé `automation-scheduler` (bail 10 min) | **aucune** (pas de `withCronCheckIn`, `/api/health` n'en dit rien) | verrou pris à 22:35:08 UTC, 1 s après le démarrage du serveur ; latence médiane de la file des deals : 51 s, aucune au-delà de 10 min depuis le 24 sept. |
| └ contenu du tick, dans l'ordre | `scheduler.ts:769-892` | | | | ancien clonage de factures → `viderFile` (lots de 50, 3 min au plus, `:26-39`) → rejeu de l'outbox + ménage → file des deals + détection de stagnation → factures en retard → devis expirés → ménage de fichiers → archivage des devis → ancienne table `automations` |
| File « événements de la base » | `server/lib/evenementsBase.ts:202-210` | 15 s | prise par ligne (`attempts`) | aucune | 276 événements, 0 non traité, 0 abandonné |
| Clients inactifs | `server/index.ts:1599-1607` | 1 h (+45 s après le démarrage) | `clients-inactifs` | `withCronCheckIn` | 9 événements (bureaux de test) |
| Jobs récurrents | `server/lib/recurringJobScheduler.ts:46` | 5 min | `recurring-jobs` | aucune | hors périmètre (crée des visites ; le trigger SQL fait le reste) |
| pg_cron `lume_rappels_dates` → `POST /api/cron/rappels-dates` | `cron.job` n° 43, `15 12 * * *` ; `trigger_cron_api` (`supabase/migrations/20261004200200_…sql:27-66`) ; route `server/routes/cron.ts:94` | 1 fois par jour, 12:15 UTC | **aucun** | aucune | 1 passage (2026-10-01, créé le 30 sept.), `succeeded` |
| pg_cron `lume_payment_reminders` → `POST /api/cron/payment-reminders` | `cron.job` n° 42, `0 13 * * *` | 1 fois par jour, 13:00 UTC | `cron-payment-reminders` | aucune | 6 passages sur 6 réussis depuis le 26 sept. |
| pg_cron `lume_recurring_invoices` → `POST /api/cron/recurring-invoices` | n° 44, `45 11 * * *` | 1 fois par jour | `cron-recurring-invoices` | aucune | 1 passage, réussi |
| pg_cron `lume_webhook_retries` → `POST /api/cron/webhook-retries` | n° 45, `*/10 * * * *` | 10 min | `cron-webhook-retries` | aucune | 172 réussis, 7 « job startup timeout » ; les 6 réponses HTTP gardées par pg_net : **200** |
| pg_cron `lume_release_sms_numbers` | n° 34, `10 8 * * *` | 1 fois par jour | — | — | 49 sur 49 |

Qui appelle `/api/cron/*` : **pg_cron + pg_net**, par `trigger_cron_api` et `trigger_payment_reminders`, avec les secrets
Vault `cron_secret` et `app_base_url` (présents tous les deux en prod, noms vérifiés, valeurs non lues). pg_net ne garde les
réponses qu'une heure : la réponse HTTP des trois tâches quotidiennes n'est pas prouvée directement, mais elles passent par
la même fonction, le même secret et la même adresse que `webhook-retries`, dont les six dernières réponses sont des 200.
`cron.job_run_details` dit « succeeded » dès que la requête est mise en file : un 401 ou un 502 de l'API n'y paraît pas
(aucune surveillance de `net._http_response`).

Fournisseurs (lecture de configuration) : `/api/health` → `fournisseur: ses`, `ses_variables: true`, pas de redirection QA.
Courriels sur 14 jours : 21 accusés « delivered », 1 rebond. Numéro texto : 1 vrai bureau sur 7 a un canal `sms` actif
(`communication_channels`), les 4 autres canaux sont fictifs (bureaux de test). `company_settings` : 3 vrais bureaux en ont
une ligne, 1 seul avec un courriel d'entreprise ; tous en `America/Toronto` ; aucun en pause.

## 3. Chaque déclencheur du catalogue (28) → son producteur réel

Catalogue : `src/lib/automationCatalogue.ts:148-479`. « Événements 14 j » = lignes de `domain_events` + `pipeline_events`
en prod, tous bureaux. « Réel » = ce qui existe pour de vrais bureaux (`activity_log`, `automation_execution_logs`).

Rattrapage commun aux événements émis par le bus : outbox `domain_events` — un événement consigné mais non coché est rejoué
au tick, après 3 min, 3 fois au plus, pendant 24 h (`server/lib/outbox.ts:36-47,85-158`). Voir le constat B-13 pour le trou.

| Déclencheur | Producteur réel (fichier:ligne) | Type | Fréquence / latence | Événements 14 j | Réel en prod | Si le producteur rate |
|---|---|---|---|---|---|---|
| `quote.sent` Devis envoyé | `server/routes/quotes.ts:421` (courriel), `:575` (texto) ; `server/lib/actions/index.ts:3213` (action « Envoyer le devis ») ; `server/routes/automation-events.ts:409` (sans appelant dans `src/`) | route | immédiat | 19 | 4 émissions (dernière 2026-09-11) ; 39 règles publiées ; 0 exécution journalisée | outbox |
| `quote.viewed` Devis ouvert | `server/lib/vuesSoumission.ts:153` (page publique servie) | route | immédiat | 11 | 14 règles publiées, 0 exécution | outbox |
| `quote.approved` Devis accepté | trigger SQL `trg_automation_evenements_devis` (`supabase/migrations/20261003100000_…sql:148-172`) → `automation_evenements_base` → `server/lib/evenementsBase.ts:174` | trigger SQL + boucle 15 s | ≤ 15 s | 22 | 4 émissions (dernière 2026-09-24) | file durable, 5 tentatives |
| `quote.declined` Devis refusé | même trigger | trigger SQL | ≤ 15 s | 5 | — | idem |
| `quote.changes_requested` | `server/routes/quotes.ts:1501` (page publique) | route | immédiat | 5 | — | outbox |
| `invoice.sent` Facture envoyée | trigger SQL `trg_automation_evenements_facture` (`…sql:179-199`, brouillon → envoyée) ; renvoi `server/routes/emails.ts:512` ; `server/lib/recurringInvoicesEngine.ts:175` | trigger SQL + routes | ≤ 15 s | 114 | 25 règles publiées, 0 exécution | file durable |
| `invoice.paid` Facture payée | `server/lib/payments.ts:1026` ; `server/routes/invoice-mark-paid.ts:132` ; dépôt Stripe `server/routes/payments.ts:374` (entité `quote`) | route / webhook | immédiat | 49 | 2 émissions (2026-09-28), 7 exécutions | outbox |
| `invoice.overdue` Facture en retard | **`detectOverdueInvoices`, `server/lib/scheduler.ts:616-712`**, appelé par le tick (`:812`) | `setInterval` du serveur | toutes les 5 min, jour et nuit ; émet seulement aux jalons J+1, 3, 5, 15, 30 (`scheduler-utils.ts:63`), le jour étant compté dans le fuseau de l'entreprise → à minuit, heure locale | 10 | **42 émissions réelles** (2026-04-10 → 2026-09-27, toutes à 20 h Toronto : avant le correctif de fuseau du 28 sept.) ; le seul jalon attendu depuis le 20 sept. a été émis ; les 5 factures aujourd'hui sur un jalon l'ont été ; **aucune règle publiée dans un vrai bureau** (1 brouillon, celui de Rafba) | tick suivant, le même jour ; anti-doublon durable = `activity_log` (index unique). Un jour ENTIER sans tick, une pause d'entreprise ou l'arrêt global ce jour-là : le jalon est perdu (égalité stricte, `scheduler.ts:667`) |
| `payment.failed` Paiement échoué (drapeau) | `server/lib/paiement-echoue.ts:150`, depuis le webhook Stripe `server/routes/payments.ts:71` | webhook | immédiat | 7 | drapeau éteint | outbox ; Stripe réessaie son webhook |
| `invoice.viewed` Facture consultée (drapeau) | `server/lib/vuesFacture.ts:85` | route publique | immédiat | 5 | drapeau éteint | outbox |
| `appointment.created` Rendez-vous planifié | trigger SQL `trg_automation_evenements_visite` (`…sql:85-119`, INSERT) ; réémis au déplacement par `server/routes/automation-events.ts:185` (appel du navigateur ou de Lumi) | trigger SQL + boucle 15 s | ≤ 15 s | 114 | 154 exécutions réelles, dernière 2026-10-01 (texto à 8 h) | file durable. Le DÉPLACEMENT dépend d'un appel HTTP non durable : constat B-02 |
| `appointment.cancelled` Rendez-vous annulé | même trigger (statut → `cancelled`) ; `20261003100010_retirer_de_l_horaire_emet_l_annulation.sql` | trigger SQL | ≤ 15 s | 9 | 6 règles publiées | file durable |
| `job.completed` Job terminé | trigger SQL `trg_automation_evenements_job` (`…sql:124-143`, UPDATE du statut) | trigger SQL | ≤ 15 s | 14 | 5 émissions (dernière 2026-09-25), 33 exécutions | file durable |
| `job.ready_for_invoicing` | `server/routes/automation-events.ts:277` (navigateur, acteur technicien ; Lumi `server/lib/agent/tools-etendus.ts:1674`) | appel du navigateur | immédiat | 5 | — | **rien** : appel « tire et oublie » (`src/lib/automationEventsApi.ts:25-37`) |
| `lead.created` Nouveau prospect | `server/routes/leads.ts:153` ; formulaire public `server/routes/request-forms.ts:940` ; `automation-events.ts:460` | route | immédiat | 52 | 31 émissions (dernière 2026-09-23), 88 exécutions | outbox. Prospects créés par le porte-à-porte (`server/routes/field-sales.ts:316`, `server/lib/fieldPinSync.ts:358`, `server/lib/leadClientSync.ts:74`) : aucun `emit` — NON VÉRIFIÉ par exécution |
| `lead.status_changed` | `server/routes/leads.ts:615` ; `automation-events.ts:496` | route | immédiat | 5 | 6 règles publiées | outbox |
| `client.replied` Le client répond | texto : `server/routes/messages.ts:637` ; courriel : `server/lib/email/sync/gmail.ts:262` | webhook Twilio / synchro Gmail | immédiat | 15 | — | outbox ; texto entrant : `withDeadLetter` |
| `client.tagged` / `client.untagged` | `server/lib/etiquettes.ts:41` (`annoncerEtiquette`) : actions du moteur, route `automation-events.ts` appelée par le navigateur, Lumi `server/lib/agent/tools-leads.ts:1344,1379` | route / action | immédiat | 140 / 13 | 2 émissions réelles (2026-09-30) | outbox ; depuis la fiche : appel du navigateur non durable |
| `client.inactive` Client inactif (drapeau) | `server/lib/client-inactif.ts:137`, balayage `server/index.ts:1599-1607` | `setInterval` du serveur | 1 h, seulement de 9 h à 19 h (fuseau de l'entreprise), 25 par heure par défaut | 9 | drapeau éteint | passage suivant (la requête retrouve les mêmes clients) |
| `agreement.signed` Contrat signé | `server/routes/agreements.ts:606` | route publique | immédiat | 9 | 2 émissions (dernière 2026-09-24) | outbox |
| `task.completed` Tâche terminée | `server/routes/automation-events.ts:628`, appelé SEULEMENT par `src/lib/tasksApi.ts:198,232` | appel du navigateur | immédiat | 18 | — | **rien** ; et jamais émis si la tâche est terminée ailleurs (Lumi) : constat B-14 |
| `note.added` Note ajoutée | `server/routes/activity-notes.ts:100` (fil d'activité, `src/components/events/EventsPanel.tsx`) | route | immédiat | 1 422 | — | outbox. L'onglet Notes des fiches (`specific_notes`) et Lumi `add_note` n'émettent rien : constat B-14 |
| `webhook.received` | `server/routes/webhooks-entrants.ts:234` | route publique | immédiat | 15 | — | outbox ; trace `automation_webhook_receipts` |
| `date.reached` Date atteinte | `server/lib/rappels-dates.ts:260` (deal), `:300` (client), par `POST /api/cron/rappels-dates` | **pg_cron** `lume_rappels_dates` | 1 fois par jour à 12:15 UTC (8 h 15 à Montréal l'été, 7 h 15 l'hiver) | 22 | 0 règle publiée dans un vrai bureau | **aucun rattrapage** : seule la date du jour visé est lue (`value_date = jour`) ; un passage manqué = les rappels de ce jour sont perdus (constat B-18) |
| `deal.stage_entered` | trigger SQL `trg_deals_emettre_evenements` (`supabase/migrations/20260925230000_pipelines_facon_ghl.sql:1308-1361`) → `pipeline_events` → `server/lib/pipelineEvenements.ts:101` | trigger SQL + tick | ≤ 5 min (médiane mesurée 51 s) | 160 | 30 événements réels (dernier 2026-09-26) | file durable, 4 tentatives |
| `deal.stage_idle` Opportunité qui dort | RPC `pipeline_detecter_stagnation()` (`supabase/migrations/20261004200000_deal_sans_mouvement_regle_editeur.sql:18-72`), appelée au tick par `pipelineEvenements.ts:163` | tick | 5 min ; une alerte par règle, par deal et par étape, pour toujours | 34 | 0 règle publiée dans un vrai bureau | tick suivant. À l'activation : toutes les opportunités déjà dormantes (constat B-06) |
| `custom_field.changed` | `server/lib/champs/service.ts:487` (valeur vraiment changée, et pas par une automatisation) | route | immédiat | 433 | — | outbox |

### Déclencheur du catalogue que rien ne produit
Aucun des 28 n'est sans producteur. Trois ne sont produits que par UN chemin, alors que le geste se fait aussi ailleurs :
`note.added` (fil d'activité seulement), `task.completed` et `job.ready_for_invoicing` (appel du navigateur seulement).

### Événement produit que le catalogue n'offre pas
| Événement | Émetteur | Remarque |
|---|---|---|
| `deal.stage_exited` | même trigger SQL que `deal.stage_entered` | 59 événements en 14 jours, 7 réels ; aucune règle ne peut l'écouter |
| `estimate.sent` | `server/routes/emails.ts:643` | route sans appelant ; 5 règles publiées dessus dans des bureaux hors bac à sable |
| `lead.converted`, `job.created` | `server/routes/leads.ts:734`, `:750` | écoutés par le pipeline porte-à-porte seulement |
| `pipeline_deal.stage_changed` | `server/routes/automation-events.ts:371` | ancien pipeline porte-à-porte |

## 4. Conditions : les opérateurs

| Où | Opérateurs | Jugé sur | Fichier |
|---|---|---|---|
| Conditions du déclencheur et étape « si » | égalité simple ; `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte` ; suffixes `cle__gt/gte/lt/lte` ; ET entre les clés ; opérateur inconnu ou comparaison impossible = faux | métadonnées de l'ÉVÉNEMENT (déclencheur) ; état relu de l'entité (étape « si ») | `automationEngine.ts:214-316`, `:2226-2244`, `:2603-2668` |
| Champs personnalisés (`champs_perso`) | par famille : `is_empty`, `is_not_empty` ; case `is` ; texte `is`, `is_not`, `contains`, `not_contains` ; nombre `eq`, `neq`, `gt`, `lt`, `between` ; liste `any_of`, `none_of` ; date `today`, `yesterday`, `in_last`, `more_than_ago`, `less_than_ago`, `before`, `after`, `between` | valeurs ACTUELLES en base | `server/lib/champs/automatisations.ts:40-63`, `src/lib/champs/filtres.ts:174-271` |
| Étiquettes du client (`client_a_etiquette`, `client_sans_etiquette`) | a / n'a pas, une étiquette par clé | étiquettes actuelles | `server/lib/etiquettes.ts:65-86` |
| Portée pipeline (`pipeline_id`, `stage_id` en colonnes) | égalité | métadonnées de l'événement | `automationEngine.ts:80-86` |
| « Une fois par client tous les N jours » | — | journaux + tâches de la règle | `automationEngine.ts:1634-1656` |

Ces conditions sont jugées UNE fois, à l'arrivée de l'événement. Elles ne sont pas rejugées avant une action différée
(constat B-04). Seule une étape « si » d'un parcours relit l'état.

## 5. Actions (21 au catalogue, 3 de plus dans le moteur)

Répartiteur : `server/lib/actions/index.ts:3272-3323`. Catalogue : `src/lib/automationCatalogue.ts:764-1200`.

| Famille | Actions | Passent par la fenêtre d'envoi | Étalement |
|---|---|---|---|
| Messages au client | `send_email`, `send_sms`, `request_review`, `envoyer_facture`, `envoyer_soumission` | oui dans la file ; en immédiat : texto et demande d'avis seulement | texto : 30 par minute et par bureau, mesuré à 30 par TICK (constat B-10) ; courriel : aucun |
| Équipe | `create_notification` (alias moteur `send_notification`), `create_task`, `envoyer_slack` (toujours en échec : « pas encore disponible ») | non | — |
| Fiche | `ajouter_etiquette`, `retirer_etiquette`, `modifier_client`, `assigner_responsable`, `ajouter_note`, `update_custom_field` | non | — |
| Rendez-vous, opportunité | `modifier_statut_rendezvous`, `move_deal_stage`, `modifier_deal`, `assigner_deal` | non | — |
| Extérieur | `webhook` | non | — |
| Enchaînement | `demarrer_automatisation`, `arreter_automatisation` | non | — |
| Moteur seulement (pas dans l'éditeur) | `update_status`, `log_activity` | non | — |

## 6. Étapes de contrôle

| Étape | Ce qu'elle fait | Où | Prouvé par |
|---|---|---|---|
| Délai d'une règle à plat (`delay_seconds` > 0) | une tâche par action, à maintenant + délai ; la tâche porte une COPIE de l'action | `automationEngine.ts:1346-1382` | C-010 à C-013, E-022 |
| Délai négatif (« X avant le rendez-vous ») | calé sur `start_at` de la visite, lu UNE fois à la planification ; corrigé du changement d'heure | `automationEngine.ts:1256-1322` | A-294, B11-11 ; non relu ensuite : constat B-02 |
| `attendre` (durée) | pas une tâche : le délai est ajouté à l'étape suivante | `automationSequences.ts:359-368` | B-300 |
| `attendre` jusqu'à la réponse | tâche-échéance, réveillée par `client.replied` | `automationSequences.ts:411-413`, `automationEngine.ts:2282-2319`, `:2765` | B-322, D-07 |
| `attendre` avant la date | date relue à l'échéance : annulé, replanifié, dépassé (`si_depasse`), ou suite | `automationSequences.ts:504-559` | A-300, A-304, B-314 |
| `si` / sinon | conditions jugées sur l'état relu (devis, facture, job, client, rendez-vous, opportunité), champs et étiquettes | `automationEngine.ts:2219-2268` | vague2-si-etat-actuel, J-061, J-062 |
| `arreter` | fin du parcours | `automationSequences.ts:370` | — |
| Démarrer une autre automatisation | même entrée qu'un déclencheur, SANS rejuger les conditions de la règle cible ; boucle et profondeur 3 refusées | `actions/index.ts:3049` (`executeDemarrerAutomatisation`), `automationEngine.ts:1588-1612` | B-130, D-041, F-062 |
| Arrêter une automatisation | annule les tâches `pending` de l'entité (cette règle ou toutes) | `actions/index.ts:2997` (`executeArreterAutomatisation`) | 10-b-actions |
| Sortie de parcours (avant chaque tâche) | règle en brouillon ou à la corbeille ; étape supprimée ; client (entité `client`/`lead`) supprimé ; facture payée / annulée ; devis accepté, refusé, expiré, converti, archivé ; rendez-vous annulé ou supprimé ; prospect converti ou perdu ; « arrêter quand le client répond » | `automationEngine.ts:2002-2033`, `:2133-2210`, `:2870-3004` ; drapeau `auto_sortie_parcours` : `server/lib/sortie-parcours.ts:119-194` | C-010, C-011, C-024, C-032, B-322, B-323 ; trous : constats B-01, B-03, B-04 |
| Ré-entrée | sans réglage : un seul passage tant qu'une tâche de la même clé est en attente (index unique partiel) ; `settings.reentree` : chaque passage a ses clés | `automationEngine.ts:433-459`, `automationSequences.ts:185` | D-030, D-031 |
| Fenêtre d'envoi | 8 h-20 h par défaut, fuseau de l'entreprise ; `settings.fenetre` (7 h-22 h) et `jours_ouvrables` par automatisation ; report par pas de 30 min | `automationEngine.ts:499-616`, `:2050-2091` | B11-00, B11-02, B11-10 ; A-2xx |
| Anti-boucle | chaîne des règles (5 au plus), profondeur de démarrage (3), `source = automation` pour les champs | `server/lib/etiquettes.ts:89-92` | D-040, D-041, D-042 |
| Interrupteurs | `AUTOMATIONS_ENABLED`, pause par entreprise (« Tout arrêter »), drapeaux `org_features` | `server/lib/automations-interrupteur.ts`, `automations-pause-org.ts`, `automations-drapeaux.ts` | tests/automations-interrupteur, -pause-org |

Plusieurs déclencheurs sur une automatisation : impossible (`trigger_event` est un texte ; le champ `triggers` envoyé à la
route est ignoré — test B18-01). Objectifs (« goals ») : n'existent pas.

## 7. Ce que deviennent les files à un redémarrage (prouvé en tuant le processus — `scripts/qa/finale/b/redemarrage.mts`)

| Ce qui était en cours | Après le redémarrage | Preuve |
|---|---|---|
| Tâche `pending` | intacte, traitée au premier tick | 36 sur 36 traitées, 0 en double |
| Tâche `running` (le processus est mort dessus) | ignorée pendant 15 min (`TACHE_FIGEE_MS`), puis remise en file et exécutée une fois | 1 sur 1, 0 courriel en double ; E-020, E-023 |
| Événement consigné, écouteurs pas finis | rejoué par l'outbox après 3 min | 12 orphelins sur 12 cochés |
| Action immédiate RÉSERVÉE (« en cours ») mais pas encore exécutée | **jamais exécutée** : le rejeu la croit faite ; la ligne reste « en cours » | 1 à 2 confirmations perdues sur 12 à chaque essai — constat B-13 |
| Événement pas encore consigné (la route n'a pas fini) | perdu, sauf s'il vient d'un trigger SQL | 18 sur 30 dans l'essai (la requête de l'utilisateur échoue avec lui) |
