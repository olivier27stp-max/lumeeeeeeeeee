# D — Idempotence et concurrence

Tests : `tests/automations-suite/integration/20-cde-idempotence.test.ts` (vrai moteur, staging, bureau A en bac à sable).
« Faire passer le temps » : les journaux sont vieillis (horodatage + tranche de la clé anti-doublon) pour simuler un tick de 5 min.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| D-001 | rejeu outbox | même `domain_events.id`, règle déjà cochée | aucun second effet | PASS |
| D-002 | rejeu outbox | traitement coupé (règle non cochée), 5 min plus tard | l'action réussie n'est pas refaite (`rejoueDepuis`) | PASS |
| D-003 | note.added ×2 | double clic | 1 note, 1 courriel | PASS |
| D-004 | note.added ×6 | `Promise.all`, même entité | 1 effet par action | PASS |
| D-005 | note.added ×6 | `Promise.all`, 6 entités | 6 effets, aucun perdu | PASS |
| D-006 | règle différée | même événement ×2 | 1 seule tâche (`idx_scheduled_tasks_dedup`) | PASS |
| D-010 | reprise de tâche courriel | récupérée après envoi (running figée) | saut `deja_envoye`, pas de 2e courriel | PASS |
| D-011 | reprise de tâche texto | idem | saut `deja_envoye`, pas de 2e texto | PASS |
| D-012 | webhook en reprise | panne puis succès | même `Idempotency-Key` (`<tâche>:action`) aux deux essais | PASS |
| D-020 | 3 workers `processScheduledTasks` concurrents | 8 tâches dues | chaque tâche exécutée 1 fois (`attempts=1`), 8 notes | PASS |
| D-021 | 2 workers concurrents | parcours | l'étape suivante planifiée 1 fois | PASS |
| D-030 | ré-entrée | sans / avec `reentree`, tâche en attente | refusé / 2 passages (clés distinctes) | PASS |
| D-031 | ré-entrée immédiate | `reentree`, 2 émissions simultanées | 1 seul effet | PASS |
| D-032 | `delai_entre_passages_jours=1` | 2e passage 5 min après / 2 j après | sauté, avec une ligne `une_fois_par_client` au journal / repart ; témoin sans réglage repart | PASS |
| D-040 | boucle d'étiquettes | A retire X ↔ B remet X | A 1 fois, B 1 fois, chaîne `[]→[A]→[A,B]`, arrêt | PASS |
| D-041 | boucle `demarrer_automatisation` | A → B → A | 2e démarrage sauté `boucle` | PASS |
| D-042 | boucle de deal | A : S1→S2, B : S2→S1, 6 ticks de 5 min | 2 déplacements puis arrêt, deal en S1 | PASS après correctif `e163a414` (avant : 6 déplacements en 6 ticks, sans fin) |
| D-043 | `pipeline_events` sans réclamation atomique | 2 instances hors verrou | — | NON COUVERT : le tick est sous `withAdvisoryLock` ; deux consommateurs concurrents exigeraient d'appeler la file hors verrou (inv-1 §9.4), non reproduit |
| D-044 | `rappels-dates` rejoué le même jour | champ date = aujourd'hui, balayage passé 3 fois | une seule tâche créée, une seule ligne d'action au journal | l'anti-doublon est la clé d'exécution du moteur (règle + fiche + jour) ; `10-b-declencheurs.test.ts` |
