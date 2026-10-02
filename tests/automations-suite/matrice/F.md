# Matrice F — Sécurité / multi-tenant (suffixe `secu`)

Fichiers : `integration/30-fgh-rls.test.ts`, `integration/30-fgh-routes.test.ts`, `integration/30-fgh-moteur.test.ts`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| F-001 | RLS `automation_rules` | proprio B, JWT réel | ne lit/insère/modifie/supprime rien de A ; A voit sa ligne | PASS |
| F-002 | RLS `automation_folders` | idem | idem | PASS |
| F-003 | RLS `automation_scheduled_tasks` | idem | idem | PASS |
| F-004 | RLS `automation_execution_logs` | idem | idem | PASS |
| F-005 | RLS `automation_webhooks` | idem | idem | PASS |
| F-006 | RLS `automation_webhook_receipts` | idem | idem | PASS |
| F-007 | RLS `automations` (table héritée) | idem | idem | PASS — policies « tout membre », mais bornées à l'org |
| F-008 | RLS `email_unsubscribes` | idem | idem | PASS |
| F-009 | RLS `sms_opt_outs` | idem | idem | PASS |
| F-010 | RLS `consents` | idem | idem | PASS |
| F-011 | RLS `org_features` | idem | B ne bascule pas les drapeaux de A | PASS |
| F-012 | RLS `review_requests` | idem | idem | PASS |
| F-013 | RLS `satisfaction_surveys` | idem | idem | PASS |
| F-014 | `pipeline_events`, `domain_events` | proprio B / A | aucune ligne de A pour B ; outbox illisible pour authenticated | PASS |
| F-015 | `automation_evenements_base` | A et B | lecture et écriture refusées (serveur seulement) | PASS |
| F-016 | `clients_inactifs_declenches` | A et B | idem | PASS |
| F-017 | `paiements_echoues_traites` | A et B | idem | PASS |
| F-018 | `envois_simules` | A et B | idem | PASS |
| F-019 | `orgs_envois_simules` | A et B | idem (une org ne s'inscrit ni ne se retire elle-même) | PASS |
| F-020 | `orgs_envois_simules` | B supprime la ligne de A | 0 ligne, A reste en bac à sable | PASS |
| F-021 | RBAC par la RLS, technicien A | lecture règles / dossiers / adresses d'appel / reçus | 0 ligne | PASS |
| F-022 | RBAC par la RLS, technicien A | créer / publier / réécrire les actions / supprimer | refusé, règle intacte | PASS |
| F-023 | RBAC par la RLS, technicien A | file planifiée + journal (contenus, destinataires) | 0 ligne ; le proprio les lit | PASS — DÉCISION : c'était bien une fuite (textes, montants, destinataires) ; fermée par la migration 20261003100100, appliquée sur staging (prouvé ici) |
| F-024 | `automation_webhooks.api_key` | même le proprio | colonne illisible (privilège de colonne) | PASS |
| F-030 | en-tête x-org-id = bureau B | proprio A | 403 `org_forbidden` | PASS |
| F-031 | GET rules / editeur?rule_id=<B> | proprio A | la règle de B n'est jamais renvoyée | PASS |
| F-032 | PATCH / DELETE / duplicate / restaurer / definitivement (règle de B) | proprio A | 404, B intacte, aucune copie | PASS |
| F-033 | publication unitaire et en lot (règle de B) | proprio A | 404 / `ok:false`, B en brouillon | PASS |
| F-034 | POST /rules/:id/apercu (règle de B) | proprio A | 404 | PASS |
| F-035 | copier-bureaux | règle A → org B ; règle B → A | `sans_droit` ; 404 | PASS |
| F-036 | dossiers de B | PATCH / DELETE | 404, intact | PASS |
| F-037 | adresses d'appel de B | PATCH / regenerer / DELETE / liste | 404, clé inchangée, jamais listée | PASS |
| F-038 | POST /automations/pause | proprio A | B non touché | PASS |
| F-040 | events/lead-created | client de B | 404, aucune règle de A ne tourne | PASS après a45918c3 (FAIL avant : règles de A exécutées sur le client de B) |
| F-041 | events/lead-status-changed | client de B | 404 | PASS après a45918c3 (FAIL avant : tâche créée dans A, liée au client de B) |
| F-042 | events/quote-sent | devis de B | 404 | PASS après a45918c3 |
| F-043 | events/appointment-rescheduled | rendez-vous de B | 404, le rappel de B reste `pending` | PASS après a45918c3 |
| F-044 | events/client-tagged, job-completed, task-completed | objets de B | 404 | PASS |
| F-050 | GET /automations/rules | technicien A | 403 | PASS |
| F-051 | créer / modifier / publier (unitaire, lot) / dupliquer / supprimer / modèle / pause / webhook | technicien A | 403, rien d'écrit | PASS |
| F-052 | events lead-created / quote-sent | technicien A | 403 | PASS |
| F-053 | témoin | proprio B dans son bureau | lit sa règle | PASS |
| F-060 | événement de B | règle active de A | la règle de A ne tourne pas (témoin A : elle tourne) | PASS |
| F-061 | variables d'un deal de B | événement de A | aucune donnée du client de B | PASS après d0f32844 (FAIL avant : courriel du client de B résolu depuis A) |
| F-062 | demarrer_automatisation vers une règle de B | règle de A | échec, B ne tourne pas | PASS |
| F-063 | arreter_automatisation (toutes) | même entity_id qu'une tâche de B | tâche de B intacte | PASS |
| F-070 | injection prénom / nom `<script>`, `<img onerror>` | courriel | échappés dans envois_simules.corps ; expéditeur sans balise | PASS |
| F-071 | injection par champ perso à clé `…_html` | courriel | échappé | PASS après 66fbe647 (FAIL avant : `<img onerror>` actif) |
| F-080 | plafond par client, texto commercial | 4 envois / 24 h | 3 partent, le 4e est sauté (`plafond_frequence`), sans échec | PASS |
| F-081 | plafond par client, courriel commercial | 4 envois / 24 h | idem | PASS |
| F-082 | étalement par bureau | 30 textos dans la minute | le suivant est reporté (+60 s, `report_rafale`) | PASS |
| F-083 | mesure du plafond global | règle ayant déjà 500 textos aujourd'hui | le 501e part | PASS (mesure) |
| F-084 | rafale de textos : alerte au propriétaire | 30 textos partis dans la minute, 2 étiquettes posées | les 2 textos sont reportés (prévus, pas perdus) ; UNE notification `automation_burst` au nom de l'automatisation, lien /automations, « Tout arrêter » ; pas de 2e alerte même depuis un autre processus | CORRIGÉ — décision du 2026-10-01 : pas de plafond (la décision du 2026-09-23 tient : tout part, étalé à 30/min), mais le propriétaire est prévenu dès le premier report. Avant : 5 000 clients étiquetés = 5 000 textos en ≈ 2 h 47 sans que personne ne soit averti |
| F-085 | fournisseurs réels | tout le fichier moteur | 0 appel Twilio, 0 appel HTTP | PASS |
| F-090 | events/deal-stage-changed (ancien pipeline porte-à-porte) | `dealId` d'un autre bureau | — | NON COUVERT : émet `pipeline_deal.stage_changed` (table `pipeline_deals`, ancien pipeline) ; le lead est filtré par org, aucune variable de B ne sort, mais `dealId` reste non vérifié — à traiter avec le retrait de l'ancien pipeline |
