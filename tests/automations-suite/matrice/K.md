# Matrice K — Préréglages et systèmes adjacents

Fichiers : `40-iklm-prereglages.test.ts`, `40-iklm-adjacents.test.ts`. Bureau A semé par `seedOrgComplete` (industrie residential_cleaning), B (roofing). Chaque moteur tourne avec `{ orgId }`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| K-001 | Socle par métier | Nettoyage vs Toiture | même ensemble de préréglages et d'états | l'UI propose 10 métiers, aucun « construction » (seulement marketing/pipeline) |
| K-002 | Publiés d'office | création | = PACK_ACTIF ; sollicitations, avis, estimate_followup en brouillon | le trigger SQL sème 35 préréglages TOUS ACTIFS (sollicitations comprises) avant le filet serveur — observé sur nos bureaux ; non testé automatiquement (il faudrait créer une entreprise jetable) |
| K-003 | estimate_followup | — | mort : seul émetteur /emails/send-quote, jamais appelé par l'UI | brouillon |
| K-010 | lead.created | — | pack_suivi_prospect complet, aucun échec, envois simulés | |
| K-011 | quote.sent | — | pack_relance_devis + quote_sent_move_deal | temps compressé : plafond 3 messages/24 h ignoré (artefact) |
| K-012 | quote.approved (transition en base) | drapeau auto_sortie_parcours éteint | pack_depot doit demander le dépôt | ROUGE ATTENDU — décision : la tâche s'annule elle-même (condition d'arrêt « devis approuvé ») ; test existant fige « drapeau OFF → annulée » ; correctif prêt (exception comme lead perdu) |
| K-012a | quote.approved | — | quote_approved_move_deal | |
| K-013 | invoice.sent (transition en base) | — | pack_relance_facture | |
| K-014 | visite insérée (base) / job terminé / contrat signé | — | confirmation immédiate + rappel J-7 replanifié au bon moment ; thank_you_after_job ; agreement_signed | forcer l'échéance ne fait pas partir un rappel en avance (correct) |
| K-015 | quote.viewed | — | quote_opened_notify + move_deal | |
| K-016 | invoice.paid complet | payment_type full | payment_confirmation seulement | corrigé (a088fc77) — migration NON appliquée 20261006411000 |
| K-017 | invoice.paid dépôt | payment_type deposit | deposit_received seulement | idem |
| K-020 | Relances de factures | 3 j de retard | 1 courriel, reminder_log palier 1 | |
| K-021 | Relances | 40 j de retard, 4 paliers | 1 courriel (palier 30) | corrigé : 4 courriels le même soir (e0adcf93) |
| K-022 | Relances — idempotence | 2e passage | rien | |
| K-023 | Relances — négatif | payée / pas échue | rien | |
| K-024 | Relances — panne | fournisseur en panne | log « failed » + erreur, passage non interrompu | un « failed » n'est jamais retenté par le cron (la file de reprise du mailer s'en charge) |
| K-025 | Relances — isolation | facture de B | rien | |
| — | Relances — réponse HTTP | lecture des réglages en échec | une seule réponse | corrigé dans 97048c37 (non testé : panne de lecture non provoquable proprement) |
| K-030 | Factures récurrentes | échéance du jour | 1 brouillon, échéance +1 mois | |
| K-031 | Factures récurrentes — double exécution | 2 passages simultanés | 1 facture | PASS (n'a pas reproduit le doublon soupçonné) |
| K-032 | auto_send | — | courriel simulé + statut sent | |
| K-033 | « exécuter maintenant » (Lumi) | récurrence arrêtée | refus | corrigé (973bad9d) |
| K-034 | Isolation | B | rien | |
| K-040 | Jobs récurrents | occurrence due | 1 job + 1 visite ; règle avancée ; 2e passage rien | corrigé : la visite n'était JAMAIS créée (created_by), donc ni calendrier ni confirmation/rappels (0c668851) |
| K-041 | Jobs récurrents — fuseau | série sans fuseau, entreprise à Vancouver | 9 h reste 9 h locale | corrigé (638ffcff) |
| K-042 | Récurrence créée par Lumi | — | visite à une heure de jour | ROUGE ATTENDU — décision : next_run_at = date 05:00Z (~1 h du matin) ; quelle heure prendre (celle du job d'origine ?) |
| K-043 | Isolation | B | rien | |
| K-050 | Rapport planifié quotidien | dû | 1 courriel ; 2e passage rien | |
| K-051 | Rapport — rattachement | entreprise en bac à sable | consigné au nom de l'entreprise | corrigé : sans `suivi`, échappait au bac à sable et à email_deliveries (36bb050f) |
| K-052 | Rapport — isolation | B | rien | |
| K-053 | Rapport — panne | fournisseur en panne | non perdu (non marqué, ou en file de reprise) | |
| — | Rapports — UTC | hebdo/mensuel calculés en UTC | — | NON COUVERT : dépend du fuseau du processus (prod = UTC) ; signalé (inv-3 §5.4) |
| K-060 | Dunning | impayé 8 j | suspendu + 1 courriel ; 2e passage rien | |
| K-061 | Dunning | J+3..J+6 | une relance annoncée | ROUGE ATTENDU — décision : 4 courriels (un par jour) ; le code dit « une relance quotidienne », l'en-tête « J+3 — une relance » |
| K-062 | Dunning — isolation | A seulement | B intact | |
| — | Dunning — courriel de suspension sans suspension | course avec un paiement | — | NON COUVERT : course non provoquable de façon déterministe ; lu dans le code (l'UPDATE n'est pas vérifié par .select()) |
