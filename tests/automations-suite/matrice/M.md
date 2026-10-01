# Matrice M — Charge

Fichier : `40-iklm-charge.test.ts`. Règle note.added → log_activity (aucun envoi), bureau A.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| M-001 | rafale 1 000 × note.added (50 en vol) | — | 1 000 effets, 0 perte, 0 doublon, 0 échec | mesuré 2026-09-30 : 1 000 / 1 000 en 264 s |
| M-002 | latence émission → effet | — | mesurée et rapportée | p50 139 s, p95 232 s, max 245 s (file d'écouteurs non bornée : les 1 000 handlers concourent) |
| M-003 | requêtes PostgREST par événement | — | constant (pas de N+1) | ≈ 19/événement, identique à 3 ou 1 000 ; ≈ 10 sont des lectures de variables (client, deal, champs perso) faites même pour une action sans variable — piste d'optimisation |
| M-004 | file planifiée : 120 tâches dues | — | tâches par passage | 50 par passage (`limit(50)`) = 600/h pour TOUTES les entreprises avec le tick de 5 min — plafond confirmé (décision de capacité) |
