# Matrice L — Observabilité

Fichier : `40-iklm-observabilite.test.ts` (vrai moteur, bureau A ; outil Lumi par la vraie garde).

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| L-001 | lead.created → create_notification | — | journal : org, règle, événement, entité, action, config, succès, durée, clé d'exécution | ce que `automation_execution_logs` contient |
| L-002 | lead.created → send_sms | fournisseur en PANNE | ligne result_success=false, result_error = erreur du fournisseur | la ligne passe d'abord par « en cours » (réservation) |
| L-003 | lead.created → send_sms | client sans téléphone | succès technique, result_data.saute_code = sans_telephone | |
| L-004 | règle écartée par ses CONDITIONS | source ≠ attendue | UNE ligne `automation_execution_logs` : `action_type = 'conditions'`, `result_success = true`, `result_data = { saute: 'Conditions non remplies : source', saute_code: 'conditions' }` ; ni déclenchement ni saut dans les statistiques ; un rejeu du même événement n'en écrit pas une 2e | CORRIGÉ — `journaliserRegleEcartee` (moteur) ; `40-iklm-observabilite.test.ts`, `unitaires/iklm-regle-ecartee.test.ts`, `tests/automatisations-statistiques.test.ts` |
| L-008 | règle écartée par un filtre d'étiquette | le client n'a pas l'étiquette | la trace nomme le filtre (« étiquette du client ») | PASS |
| L-009 | règle qui ne VISE pas l'événement | autre étiquette posée (`client.tagged`) | aucune ligne (pas de bruit) ; la règle visée dont un filtre échoue en a une | PASS — clés de ciblage : `CLES_DE_CIBLAGE` (jalon de retard, date, étiquette, champ, étape, adresse d'appel…) |
| L-010 | « une fois par client tous les N jours » | 1er événement écarté par les conditions, 2e conforme | le 2e part : un passage écarté ne compte pas | PASS |
| L-005 | get_automation_health | après la panne | échec compté avec sa cause | |
| L-006 | get_automation_health | envoi sauté | « sautes » + motif, pas compté « parti » | corrigé (« partis » mentait) ; « en cours » exclu des échecs |
| L-007 | get_automation_health / RLS | identité du bureau B | ne voit rien du journal de A | |
| — | Manques relevés | — | — | non journalisés : étapes « si » (branche prise), attentes replanifiées (seulement logger.info), refus du plafond 3 messages/24 h classé ÉCHEC (result_success=false) alors que c'est une protection voulue. `get_automation_health` (outil Lumi, non modifié) range les lignes « conditions » parmi les envois sautés |
