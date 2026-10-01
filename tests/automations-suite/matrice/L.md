# Matrice L — Observabilité

Fichier : `40-iklm-observabilite.test.ts` (vrai moteur, bureau A ; outil Lumi par la vraie garde).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| L-001 | lead.created → create_notification | — | journal : org, règle, événement, entité, action, config, succès, durée, clé d'exécution | ce que `automation_execution_logs` contient |
| L-002 | lead.created → send_sms | fournisseur en PANNE | ligne result_success=false, result_error = erreur du fournisseur | la ligne passe d'abord par « en cours » (réservation) |
| L-003 | lead.created → send_sms | client sans téléphone | succès technique, result_data.saute_code = sans_telephone | |
| L-004 | règle écartée par ses CONDITIONS | source ≠ attendue | une trace devrait dire pourquoi | ROUGE ATTENDU — décision : aucune ligne n'est écrite (les conditions évaluées ne sont journalisées nulle part, seulement l'action) ; volume à arbitrer |
| L-005 | get_automation_health | après la panne | échec compté avec sa cause | |
| L-006 | get_automation_health | envoi sauté | « sautes » + motif, pas compté « parti » | corrigé (« partis » mentait) ; « en cours » exclu des échecs |
| L-007 | get_automation_health / RLS | identité du bureau B | ne voit rien du journal de A | |
| — | Manques relevés | — | — | non journalisés : conditions évaluées (L-004), étapes « si » (branche prise), attentes replanifiées (seulement logger.info), refus du plafond 3 messages/24 h classé ÉCHEC (result_success=false) alors que c'est une protection voulue |
