# Matrice M — Charge

Fichier : `40-iklm-charge.test.ts`. Règle note.added → log_activity (aucun envoi), bureau A.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| M-001 | rafale 1 000 × note.added (50 en vol) | — | 1 000 effets, 0 perte, 0 doublon, 0 échec | mesuré 2026-09-30 : 1 000 / 1 000 en 264 s |
| M-002 | latence émission → effet | — | mesurée et rapportée | p50 139 s, p95 232 s, max 245 s (file d'écouteurs non bornée : les 1 000 handlers concourent) |
| M-003 | requêtes PostgREST par événement | — | constant (pas de N+1) | ≈ 19/événement, identique à 3 ou 1 000 ; CORRIGÉ : une règle sans variable ne lit plus les variables (≈ 10 requêtes de moins) — garde perf-actions-sans-variables.test.ts |
| M-004 | file planifiée : 120 tâches dues | — | tâches par passage | mesure par APPEL (50 = un lot) ; CORRIGÉ au niveau du tick : viderFile dépile par lots, voir M-005 |
| M-005 | file planifiée : 120 tâches dues, un tick | — | toutes traitées en un passage (3 lots) | 50-m-file-planifiee.test.ts — avant : 50 par tick de 5 min = 600/h plateforme |
| M-006 | entreprise en pause avec 55 tâches dues + une autre avec 1 | — | la tâche de l'autre passe, la file en pause est conservée | 50-m-file-planifiee.test.ts — avant : la pause bloquait toute la file |
