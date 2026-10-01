# Matrice B — intégration (vrai moteur, staging, bureau de test en bac à sable)

Fichiers : `tests/automations-suite/integration/10-b-*.test.ts` (outils communs : `10-b-outils.ts`).
Lancer : `QA_AUTO_SUFFIXE=<s> npx vitest run --maxWorkers=4 --config vitest.automations.config.ts --project integration tests/automations-suite/integration/10-b-<fichier>.test.ts`

Principes : règles créées ET publiées par la vraie route de l'éditeur (`POST /api/automations/rules`) ; événements provoqués par le chemin de production (routes Express réelles montées en mémoire avec le RBAC, triggers SQL + `traiterEvenementsBase`, `pipeline_events` + `traiterEvenementsPipeline`, balayages), files traitées pour le bureau de test SEULEMENT (option `{ orgId }`). Témoin = `create_task` (ligne `tasks` exacte + journal `automation_execution_logs`). Une règle « vraie » et une « fausse » par cellule, la fausse créée d'abord (le moteur juge les règles par date de création).

## 1. Déclencheurs × condition vraie / fausse × témoin (`10-b-declencheurs.test.ts`, `10-b-webhooks-entrants.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-001 | lead.created — POST /api/leads/create | `email` = courriel du prospect | tâche liée `lead`/prospect, description rendue, 1 journal | PASS |
| B-002 | lead.created — POST /api/leads/create | `email` ≠ | aucun effet | PASS |
| B-003 | lead.status_changed — POST /api/leads/update-status | `new_status`=follow_up_1 ET `old_status`=new | tâche liée au prospect | PASS |
| B-004 | lead.status_changed | `new_status`=lost | aucun effet | PASS |
| B-005 | note.added — POST /api/activity-notes (client) | `note_sur`=client | tâche liée au client | PASS |
| B-006 | note.added | `note_sur`=job | aucun effet | PASS |
| B-007 | client.tagged — étiquette posée + POST …/client-tagged | `tag` visé | tâche liée au client | PASS |
| B-008 | client.tagged | autre `tag` | aucun effet | PASS |
| B-009 | client.untagged — POST …/client-untagged | `tag` visé | tâche liée au client | PASS |
| B-010 | client.untagged | autre `tag` | aucun effet | PASS |
| B-011 | task.completed — tâche `done` + POST …/task-completed | `task_title` exact | tâche liée au client de la tâche | PASS |
| B-012 | task.completed | autre titre | aucun effet | PASS |
| B-013 | job.ready_for_invoicing — technicien, POST …/job-completed | `job_name` | tâche liée au job | PASS |
| B-014 | job.ready_for_invoicing | autre `job_name` | aucun effet | PASS |
| B-015 | job.completed — jobs.status → completed (trigger SQL → file base) | `origine`=base ET `job_name` | tâche liée au job | PASS |
| B-016 | job.completed | autre `job_name` | aucun effet | PASS |
| B-017 | quote.sent — POST /api/quotes/send-email | `channel`=email ET `quote_number` | tâche liée au devis | PASS (courriel au client simulé) |
| B-018 | quote.sent | `channel`=sms | aucun effet | PASS |
| B-019 | quote.viewed — GET public /api/quotes/public/:jeton, vrai navigateur, anonyme | `ouverture`=premiere (liste) | tâche liée au devis | PASS |
| B-020 | quote.viewed | `is_first_view`=false | aucun effet | PASS |
| B-021 | quote.approved — acceptation signée (page publique) → trigger SQL | `origine`=base ET `quote_number` | tâche liée au devis | PASS |
| B-022 | quote.approved | autre `quote_number` | aucun effet | PASS |
| B-023 | quote.declined — refus (page publique) → trigger SQL | `client_id` | tâche liée au devis | PASS |
| B-024 | quote.declined | autre `client_id` | aucun effet | PASS |
| B-025 | quote.changes_requested — page publique | `quote_number` | tâche liée au devis | PASS |
| B-026 | quote.changes_requested | autre `quote_number` | aucun effet | PASS |
| B-027 | invoice.sent — brouillon → envoyée (trigger SQL) | `origine`=base ET `client_id` | tâche liée à la facture | PASS |
| B-028 | invoice.sent | autre `client_id` | aucun effet | PASS |
| B-029 | invoice.paid — POST /api/invoices/:id/mark-paid | `payment_type`=full, `provider`=manual, `amount_cents` | tâche liée à la facture | PASS |
| B-030 | invoice.paid | `payment_type`=deposit | aucun effet | PASS |
| B-031 | invoice.overdue — `detectOverdueInvoices` (J+1, fuseau du bureau) | `days_overdue`=1 | tâche liée à la facture | PASS |
| B-032 | invoice.overdue | `days_overdue`=3 | aucun effet | PASS |
| B-033 | invoice.viewed — drapeau `auto_consultation_documents`, GET public | `ouverture`=premiere | tâche liée à la facture | PASS |
| B-034 | invoice.viewed | `is_first_view`=false | aucun effet | PASS |
| B-035 | appointment.created — visite insérée (trigger SQL) | `title` | tâche liée au JOB porteur | PASS |
| B-036 | appointment.created | autre `title` | aucun effet | PASS |
| B-037 | appointment.cancelled — visite annulée (trigger SQL) | `job_id` | tâche liée au job | PASS |
| B-038 | appointment.cancelled | autre `job_id` | aucun effet | PASS |
| B-039 | agreement.signed — signature page publique du contrat | `signer_name` | tâche liée au job | PASS |
| B-040 | agreement.signed | autre signataire | aucun effet | PASS |
| B-041 | client.replied — texto entrant SIGNÉ Twilio (POST /api/messages/inbound) | `canal`=sms | tâche liée au client | PASS |
| B-042 | client.replied | `canal`=email | aucun effet | PASS |
| B-043 | client.inactive — drapeau `auto_client_inactif`, `balayerEntreprise` | `mois`=6 | tâche liée au client | PASS |
| B-044 | client.inactive | `mois`=12 | aucun effet | PASS |
| B-045 | custom_field.changed — PUT /api/custom-values (champ créé par la route des réglages) | `field_id` ET `new_value` | tâche liée au client | PASS |
| B-046 | custom_field.changed | autre `field_id` | aucun effet | PASS |
| B-047 | date.reached — `balayerRappelsDates` (champ date client = aujourd'hui) | `champ_id` ET `jours_avant`=0 | tâche liée au client | PASS |
| B-048 | date.reached | `jours_avant`=3 | aucun effet | PASS |
| B-049 | webhook.received — POST /api/hooks/:clé (clé créée par la route) | champ JSON `source`=site ET `webhook_id` | tâche sans lien (trace d'appel) | PASS |
| B-050 | webhook.received | `source`=facebook | aucun effet | PASS |
| B-051 | deal.stage_entered — deals.stage_id (trigger → pipeline_events) | `stage_id` visé | tâche sans lien (deal non liable), description = client du deal | PASS |
| B-052 | deal.stage_entered | autre étape | aucun effet | PASS |
| B-053 | deal.stage_idle — RPC `pipeline_detecter_stagnation` + file pipeline | `stage_id` ET `idle_days`=7 | tâche sans lien | PASS — la RPC balaie toutes les entreprises (pas de paramètre d'org) : le test refuse de l'appeler si une entreprise hors bac à sable a une règle active |
| B-054 | deal.stage_idle | autre étape | aucun effet | PASS |
| B-400 | lead.created — formulaire public POST /api/public/form/:clé/submit | `source`=request_form | tâche liée au prospect ; aucun appel réseau | PASS |
| B-401 | lead.created (formulaire) | `source`=site_web | aucun effet | PASS |
| B-402 | webhook Stripe — signature invalide | — | 400, aucun événement | PASS |
| B-403 | invoice.paid — `payment_intent.succeeded` SIGNÉ (secret de test) | `provider`=stripe ET `amount_cents__gte` | paiement écrit, facture `paid` solde 0, tâche liée | PASS |
| B-404 | invoice.paid (Stripe) | `provider`=manual | aucun effet | PASS |
| B-405 | invoice.paid — même événement Stripe rejoué | — | `already_processed`, 1 seule exécution | PASS |
| B-406 | invoice.paid — dépôt de soumission (`quote_deposit`) | `payment_type`=deposit | tâche liée au DEVIS, `deposit_status`=paid | PASS |
| B-407 | payment.failed — `payment_intent.payment_failed` (drapeau) | `raison_code`=insufficient_funds ET `montant_cents` | paiement `failed` + `failure_reason`, tâche liée à la facture | PASS |
| B-408 | payment.failed | `raison_code`=expired_card | aucun effet | PASS |
| B-409 | payment.failed — drapeau coupé | — | aucun déclenchement | PASS |
| B-410 | webhook.received sans règle | — | aucun envoi simulé | PASS |
| B-090 | estimate.sent, lead.converted, job.created, pipeline_deal.stage_changed | — | — | NON COUVERT : émis mais absents du catalogue (non créables à l'éditeur, refusés par Zod) — catégorie K (préréglages) |
| B-091 | client.replied par COURRIEL (synchro Gmail) | — | — | NON COUVERT : exige une boîte Gmail connectée (API Google, hors bac à sable) |
| B-092 | appointment.created ré-émis par POST …/appointment-rescheduled | — | — | NON COUVERT ici (pont navigateur) — catégorie C/J |

## 2. Actions × effet exact (`10-b-actions.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-100 | note.added | — | send_email : `envois_simules` courriel, destinataire = courriel du client, objet et HTML rendus, `meta.suivi`, sans List-Unsubscribe (transactionnel), `activity_log email_sent`, aucun fournisseur touché | PASS |
| B-101 | note.added | — | send_sms : destinataire E.164, corps final exact, `from` = numéro du bureau, `messages` sortant `SM_SIMULE_…` | PASS |
| B-102 | note.added | — | send_sms marketing : mention STOP ajoutée | PASS |
| B-103 | note.added | — | create_notification (équipe) : `notifications` type automation, titre/corps rendus, reference_id | PASS |
| B-104 | note.added | — | create_notification destinataire propriétaire : 1 ligne `user_id` = propriétaire | PASS |
| B-105 | note.added | — | send_notification (alias préréglages) | PASS |
| B-106 | note.added | — | envoyer_slack : échec propre « pas encore disponible », rien publié | PASS |
| B-107 | note.added | — | webhook : envoi simulé POST, corps JSON = org, entité, variables résolues | PASS |
| B-110 | note.added | — | create_task : priorité, échéance J+2, responsable, lien client | PASS |
| B-111 | note.added | — | create_task avec membre d'une autre entreprise : échec, aucune tâche | PASS |
| B-112 | note.added | — | ajouter_etiquette : ligne `client_tags` | PASS |
| B-113 | note.added | — | retirer_etiquette : ligne supprimée | PASS |
| B-114 | note.added | — | modifier_client : statut, source rendue, valeur | PASS |
| B-115 | note.added | — | assigner_responsable « seulement si vide » : assigne / respecte l'existant | PASS |
| B-116 | note.added | — | ajouter_note : `notes` rendue, rattachée au client | PASS |
| B-117 | note.added | — | update_custom_field : `value_text` écrit, aucun custom_field.changed relancé | PASS |
| B-118 | job.completed | — | request_review : sondage, courriel + texto simulés (lien /survey/jeton), `review_requests` | PASS |
| B-119 | note.added | — | request_review sur un déclencheur client : rattachée au client, anti-doublon 7 j | FAIL → CORRIGÉ (fa923eb9) |
| B-120 | appointment.created | `title` | modifier_statut_rendezvous : `schedule_events.status` | PASS |
| B-121 | custom_field.changed (job) | `field_id` | update_status : `jobs.status` ; table hors liste blanche refusée | PASS |
| B-122 | note.added | — | log_activity : `activity_log` type + métadonnées | PASS |
| B-123 | deal.stage_entered | `stage_id` | move_deal_stage : deal déplacé, historique `automation` | PASS |
| B-124 | deal.stage_entered | `stage_id` | modifier_deal : `deals.source` rendue | PASS |
| B-125 | deal.stage_entered | `stage_id` | assigner_deal : `assigned_user_id`, `assigned_at` | PASS |
| B-126 | custom_field.changed (facture brouillon) | `field_id` | envoyer_facture : courriel avec lien public, facture `sent` | PASS |
| B-127 | custom_field.changed (devis brouillon) | `field_id` | envoyer_soumission : courriel, `awaiting_response`, quote.sent émis → règle quote.sent suit (combinaison) | PASS |
| B-130 | note.added | — | demarrer_automatisation : la règle cible agit sur la même entité | PASS |
| B-131 | note.added | — | arreter_automatisation (toutes) : tâches prévues de l'entité `cancelled` | PASS |

## 3. Conditions (`10-b-conditions.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-200 | webhook.received (JSON réel) | texte, égalité simple (casse comprise) | vrai → tâche / `laval` → rien | PASS |
| B-201 | idem | `eq` | vrai / faux | PASS |
| B-202 | idem | `neq` | vrai / faux | PASS |
| B-203 | idem | `in` | vrai / faux | PASS |
| B-204 | idem | `not_in` | vrai / faux | PASS |
| B-205 | idem | `gt` nombre | vrai / faux | PASS |
| B-206 | idem | `gte` | vrai / faux | PASS |
| B-207 | idem | `lt` | vrai / faux | PASS |
| B-208 | idem | `lte` | vrai / faux | PASS |
| B-209 | idem | suffixe `montant__gte` | vrai / faux | PASS |
| B-210 | idem | deux opérateurs (entre) | vrai / faux | PASS |
| B-211 | idem | booléen | vrai / faux | PASS |
| B-212 | idem | date ISO `gt` | vrai / faux | PASS |
| B-213 | idem | métadonnée liste (contient) | vrai / faux | PASS |
| B-214 | idem | nombre en texte = nombre | vrai / faux | PASS |
| B-215 | idem | plusieurs clés = ET | vrai / faux | PASS |
| B-216 | idem | clé absente + `gt` | faux | PASS |
| B-220 | note.added (fiche client) | champ case `is` | vrai / faux | PASS |
| B-221 | idem | champ texte `is` normalisé | vrai / faux | PASS |
| B-222 | idem | texte `contains` / `not_contains` | vrai / faux | PASS |
| B-223 | idem | texte `is_not` | vrai / faux | PASS |
| B-224 | idem | courriel `is` (casse) | vrai / faux | PASS |
| B-225 | idem | téléphone `is` (E.164) | vrai / faux | PASS |
| B-226 | idem | nombre `gt` / `lt` | vrai / faux | PASS |
| B-227 | idem | nombre `eq` / `neq` | vrai / faux | PASS |
| B-228 | idem | montant `between` (cents) | vrai / faux | PASS |
| B-229 | idem | liste simple `any_of` / `none_of` | vrai / faux | PASS |
| B-230 | idem | liste multiple `any_of` | vrai / faux | PASS |
| B-231 | idem | date `today` / `yesterday` | vrai / faux | PASS |
| B-232 | idem | date `after` / `before` | vrai / faux | PASS |
| B-233 | idem | date `in_last` / `more_than_ago` | vrai / faux | PASS |
| B-234 | idem | fichier `is_empty` / `is_not_empty` | vrai / faux | PASS |
| B-235 | idem | deux champs = ET | vrai / faux | PASS |
| B-236 | idem | `client_a_etiquette` (insensible à la casse) / `client_sans_etiquette` | vrai / faux | PASS |
| B-237 | idem | métadonnée + champ + étiquette combinés | vrai / faux | PASS |

## 4. Parcours et délais (`10-b-parcours.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-300 | note.added — action → attendre 1 j → action | — | 1re étape en file (execute_at ≈ maintenant), 2e à +1 j, `franchies`=2, exécution quand due | PASS |
| B-301 | note.added — si / alors | `statut`=active (état actuel) | branche « alors » | PASS |
| B-302 | note.added — si / sinon | fiche passée inactive après le déclenchement | branche « sinon » | PASS |
| B-303 | note.added — si sur `champs_perso` | case cochée après le déclenchement | branche « alors » | PASS |
| B-304 | note.added — si → arrêter | — | rien après « arrêter » | PASS |
| B-310 | note.added — attendre réponse (2 j) | — | échéance +2 j ; vrai texto entrant signé → réveil → branche `si_reponse` | PASS |
| B-311 | note.added — attendre réponse, sans réponse | — | relance (`suivant`) | PASS |
| B-312 | appointment.created — attendre 1 j avant | — | échéance = début − 24 h ; rendez-vous avancé → rappel | PASS |
| B-313 | appointment.created — 1 j avant, réservé dans 2 h | — | branche `si_depasse` | PASS |
| B-314 | appointment.created — avant la date, annulé | — | parcours arrêté | PASS |
| B-315 | appointment.created — délai −1 j (règle simple) | — | tâche datée début − 24 h | PASS |
| B-316 | note.added — délai +1 h | — | tâche datée +1 h, exécutée quand due | PASS |
| B-320 | note.added — sans ré-entrée | — | 2e déclenchement = pas de 2e passage | PASS |
| B-321 | note.added — ré-entrée | — | 2 passages distincts | PASS |
| B-322 | note.added — arrêt sur réponse | — | texto de relance annulé « le client a répondu » | PASS |
| B-323 | invoice.sent — sortie de parcours (drapeau) | facture payée pendant l'attente | relance annulée avec motif | PASS |
| B-324 | note.added — règle repassée en brouillon | — | tâche annulée « en brouillon » | PASS |

## 5. Combinaisons à risque (`10-b-combinaisons.test.ts`)

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| B-500 | client.inactive — deux règles même seuil, plafonds 25 et 50 | `mois`, `max_par_heure` | les deux partent | FAIL → CORRIGÉ (7546372e) |
| B-501 | deal.stage_idle — règles 3 j et 7 j sur la même étape, deal endormi 5 j | `stage_id`, `idle_days` | seule la règle 3 j part | FAIL → CORRIGÉ (fe0a7efc) |
| B-502 | client.tagged → ajouter_etiquette | — | la règle ne se relance pas elle-même | PASS |
| B-503 | client.tagged (A pose une étiquette) → règle B | `tag` relais | B suit, A dans la chaîne | PASS |
| B-504 | deal.stage_entered — e2→e3 et e3→e2 (ré-entrée) | `stage_id` | pas de va-et-vient après la fenêtre anti-doublon | FAIL → CORRIGÉ (584e934b) — test de 2 min 30 |
| B-590 | produit cartésien complet 28 × 24 × conditions | — | — | NON COUVERT : ≈ 700 cellules × 2 ; couverture raisonnée ci-dessus (chaque déclencheur × vrai/faux × témoin, chaque action × déclencheur représentatif, combinaisons à risque) |
| B-591 | invoice.paid Stripe/PayPal sans `payment_type` | `payment_type`=full | — | NON COUVERT (écart signalé) : mark-paid porte `payment_type: 'full'`, Stripe n'en porte aucun ; une règle filtrée sur `full` ne part pas pour un paiement en ligne. Aucun champ de l'éditeur ne l'expose : décision produit |
