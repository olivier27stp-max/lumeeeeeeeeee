# E — Échecs et reprise

Tests : `tests/automations-suite/integration/20-cde-reprise.test.ts` (vrai moteur, staging, bac à sable en mode `panne` / `delai`)
et `tests/automations-suite/unitaires/cde-classement-erreurs.test.ts` (fonctions pures).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| E-001 | tâche courriel | fournisseur en panne ×4 | reprises 5 / 30 / 120 min, puis `failed` + notification `automation_failed` ; 4 journaux d'échec | PASS |
| E-002 | tâche texto | fournisseur en délai dépassé, puis rétabli | reprise, puis 1 seul texto réussi | PASS |
| E-003 | tâche | erreur définitive (étiquette vide) | `failed` au 1er essai + notification | PASS (grâce au correctif `b73fc65f`) |
| E-004 | règle à 2 actions différées | 1 en panne | l'autre tâche faite | PASS |
| E-010 | parcours note → courriel → note | courriel en panne puis rétabli | reprise au courriel, 1re note non refaite, suite exécutée | PASS |
| E-011 | parcours | étape en échec définitif | parcours arrêté, suite jamais planifiée, notification | PASS |
| E-020 | redémarrage | tâche `running` figée 20 min | récupérée, exécutée 1 fois | PASS |
| E-021 | redémarrage | tâche `running` depuis 2 min | laissée tranquille | PASS |
| E-022 | redémarrage | délai de 3 j en attente | statut et échéance intacts après des ticks | PASS |
| E-023 | redémarrage | courriel envoyé puis processus coupé | récupéré sans 2e envoi | PASS |
| E-030 | action immédiate | courriel en panne | échec journalisé avec motif, action suivante faite ; le courriel (et lui seul) a sa reprise en file | PASS — depuis E-031, l'envoi en panne passagère est repris |
| E-031 | action immédiate | texto de confirmation en panne passagère | tâche de reprise dans `automation_scheduled_tasks` (attempts 1, +5 min, puis 30 min) ; au retour du fournisseur, UN seul texto | CORRIGÉ — `planifierRepriseImmediate` (envois : send_sms, send_email, request_review, envoyer_facture, envoyer_soumission, webhook) ; `20-cde-reprise.test.ts` + `unitaires/cde-classement-erreurs.test.ts` |
| E-034 | action immédiate | courriel, fournisseur en panne jusqu'au bout | reprises 5 / 30 / 120 min, puis `failed` + notification `automation_failed` ; 4 journaux d'échec (l'immédiat + 3 reprises) | PASS |
| E-035 | action immédiate | échec DÉFINITIF (webhook vers une adresse interne), ou action interne en échec | aucune reprise | PASS |
| E-036 | action immédiate | le même événement revient pendant qu'une reprise attend (nouvelle panne) | une seule reprise en file (clé d'exécution), un seul texto au retour du fournisseur | PASS |
| E-037 | action immédiate | règle repassée en brouillon pendant que la reprise attend | reprise annulée (« Automatisation en brouillon »), rien ne part | PASS |
| E-038 | reprise d'une action immédiate | hors de la fenêtre d'envoi | le courriel de confirmation repart sans attendre 8 h ; texto, demande d'avis et fenêtre réglée par l'entreprise attendent | PASS (unitaire `tacheAttendLaFenetre`) |
| E-032 | `sendEmail({ reessayer })` | fournisseur en panne | ligne `email_retry_queue` `pending`, 1re reprise à 5 min | PASS |
| E-033 | courriel d'automatisation | en panne | n'entre PAS dans `email_retry_queue` (reprise par la file des tâches) | PASS — règle du code |
| E-040 | `isTransientFailure` | 41 motifs définitifs réels | jamais repris | PASS après correctif `b73fc65f` (32 étaient repris 4 fois) ; + « Cette action ne vaut que pour une facture / une soumission / un rendez-vous / une opportunité » (action posée sur la mauvaise fiche, reprise 4 fois avant) |
| E-041 | `isTransientFailure` | 15 motifs passagers | repris (dont 408/429, délai 5 s) | PASS |
| E-042 | webhook | DNS `EAI_AGAIN` | erreur passagère, reprise | PASS après correctif `bca09a99` (avant : « Adresse refusée », définitif) |
| E-043 | webhook | DNS `ENOTFOUND` | reste « Adresse refusée », définitif | PASS |
| E-044 | délai dépassé réel (5 s) | action lente qui aboutit après | reprise annulée, étape suivante ouverte | NON COUVERT ici : le mode `delai` du bac à sable échoue tout de suite ; couvert par `tests/automation/vague2-delai-depasse.test.ts` |
