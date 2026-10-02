# Suite des automatisations — chiffres transmis par la session 98 (à citer avec cette source)

Source : `npm run test:automations -- --prod`, passe du 2026-10-01 18:22 UTC. Fichiers : `rapports/automatisations/synthese.json`, `RAPPORT.md` (copie : `D:/lume-qa/wt-prod/rapports/automatisations/`). Rapport final : `AUTOMATIONS_TEST_REPORT.md`, qui arrive sur main avec la PR de finition (branche `qa/automatisations-finition`).

- Tests : 3 398 joués, 3 388 réussis, 10 en échec, 0 ignoré.
- Matrice (707 cas) : 688 PASS, 5 FAIL, 14 NON COUVERT.
- Les 5 FAIL (B-407, B-408, J-065, K-014, I-021) : attentes de test périmées ou sensibles à la charge selon la session 98, pas des défauts du produit ; correctifs en re-vérification (K-014 repassé vert). Les 5 autres échecs sont hors matrice (délais dépassés sous charge du poste).
- NE PAS écrire « tout vert » : citer 688 / 5 / 14 à 18:22 UTC, « correctifs en re-vérification ».

## Lumi ↔ automatisations (catégorie I) : 38 cas, 37 PASS, 1 FAIL

- `create_automation_from_text` : I-001 à I-020 (20 demandes FR/EN, vrai modèle) PASS ; I-021 FAIL ; I-022 PASS (demandes ambiguës) ; I-030, I-032, I-033, I-035 (garde-fous) PASS ; I-040 à I-042 (routage « crée… » jamais vers la FAQ) PASS.
- `toggle_automation_rule` : I-024 (activer, le moteur inscrit la tâche), I-025 (pause), I-031 (règle inexistante refusée) PASS.
- `update_automation_sms_body` : I-026 PASS. `update_automation_message` : I-027 PASS.
- `set_automation_language` : I-028 PASS.
- `list_automations` : I-034 PASS. Coûts : I-023 (< 60 ¢, mesuré 25 à 37 ¢) et I-029 (4,1 ¢) PASS.
- I-021 = « Fais-moi une automatisation pour mes clients » : Lumi a refusé de deviner et n'a rien créé, mais a demandé des précisions sans point d'interrogation ; le test exigeait un « ? ». Formulation, pas une règle créée à tort.

Chiffres définitifs attendus de la session 98 après re-vérification.

## Chiffres DÉFINITIFS (session 98, 19:10 UTC — source : AUTOMATIONS_TEST_REPORT.md à la racine de main, PR #873)

- Passe complète contre la prod, 18:22 UTC : 3 398 tests joués, 3 388 réussis, 10 échecs dont aucun défaut du produit (4 attentes de test corrigées et rejouées vertes en prod ; 6 tests unitaires sensibles à la charge du poste, verts seuls).
- Matrice après reprises ciblées en prod et 3 cas ajoutés : 709 cas, 696 PASS, 0 FAIL, 13 NON COUVERT.
- Lumi (catégorie I) : 39 / 39 PASS (I-021 repassé vert, I-036 ajouté).
- Changements pour Lumi dans #873 : list_automations ne liste plus le préréglage retiré `estimate_followup` ; create_automation_from_text refuse un déclencheur dont le drapeau d'entreprise est éteint.
