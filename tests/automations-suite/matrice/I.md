# Matrice I — Lumi et les automatisations

Vrai chemin : `POST /api/lumi/chat` (orchestrateur, routeur actif, vrai modèle) → carte → `POST /api/lumi/execute`, JWT du propriétaire du bureau A. Fichiers : `40-iklm-lumi-demandes`, `40-iklm-lumi-reglages`, `40-iklm-lumi-outils`, `unitaires/iklm-lumi-aiguillage`.

| ID | Déclencheur/sujet | Condition | Action/effet attendu | Remarque |
|---|---|---|---|---|
| I-001 | FR « relance de soumission à J+3 » | — | quote.sent → attente 3 j → texto ; règle en pause | vrai modèle |
| I-002 | FR « rappel par texto la veille de chaque RDV » | — | appointment.created → attente avant_date 86400 → texto | corrigé : la FAQ « SMS » interceptait la demande (a78e61f7) |
| I-003 | FR « avis Google après job terminé » | — | job.completed → demande d'avis | |
| I-004 | FR « étiquette VIP si facture > 5 000 $ payée » | montant > 5000 | invoice.paid → si montant > 5000 → ajouter_etiquette VIP | corrigé : aucune condition de montant (d2319854) |
| I-005 | FR parcours 3 étapes prospect, attente de réponse | sans réponse 2 j | texto → attente réponse 2 j → courriel → 5 j → tâche | corrigé (9d0abe1c, d2319854) ; 1 rejet de validation non reproduit en 3 passes (motif désormais journalisé, 7b720931) |
| I-006 | EN « thank-you email when quote approved » | — | quote.approved → courriel immédiat EN | corrigé : messages forcés en français (46a9fc92) |
| I-007 | EN « text 2 h before appointment » | — | avant_date 7200 → texto EN | idem |
| I-008 | EN « 7 days after invoice sent, if unpaid, email with link » | impayée | attente 7 j → si unpaid → courriel [invoice_link] EN | idem |
| I-009 | FR « quand j'ajoute l'étiquette VIP, notifie l'équipe » | tag = VIP | client.tagged → si tag VIP → notification | corrigé : aucun filtre, partait pour toute étiquette (d2319854) |
| I-010 | FR « 1 jour après job terminé, courriel satisfaction » | — | attente 1 j → courriel | |
| I-011 | FR « nouveau prospect → tâche » | — | lead.created → create_task, aucun message client | |
| I-012 | EN « text new lead, again if no reply after 1 day » | sans réponse | texto → attente (réponse) 1 j → texto EN | corrigé (langue + attente réponse) |
| I-013 | FR « 2 j après refus, courriel » | — | quote.declined → 2 j → courriel | |
| I-014 | FR « texto de remerciement au paiement » | — | invoice.paid → texto | |
| I-015 | EN 2 relances de devis à 5 et 10 j si non accepté | toujours envoyé | 5 j → si sent → courriel → 5 j → si sent → courriel | |
| I-016 | FR « RDV annulé → texto pour reprendre » | — | appointment.cancelled → texto | |
| I-017 | FR « courriel de bienvenue à la signature » | — | agreement.signed → courriel | |
| I-018 | FR parcours facture : 3 j si impayée texto + lien, 4 j si impayée tâche | impayée | … | corrigé : routé vers « facturation » sans l'outil (2c3b4f01) |
| I-019 | EN « Google review when job completed » | — | job.completed → avis | |
| I-020 | FR « nouveau prospect : notifie-moi, 1 j après courriel » | — | notification → 1 j → courriel | |
| I-021 | Ambigu « Fais-moi une automatisation pour mes clients » | — | une question, aucune carte, aucune règle | |
| I-022 | Ambigu « Automatise mes rappels » | — | idem | |
| I-023 | Coût de la passe « demandes » | — | < 60 ¢ | mesuré 25,5 / 36,8 / 29,7 ¢ |
| I-024 | « Active l'automatisation X » | — | toggle → is_active true, et le moteur l'inscrit (tâche planifiée) | |
| I-025 | « Mets en pause X » | — | is_active false | |
| I-026 | « Change le texto de X pour … » | — | steps : corps exact | |
| I-027 | « Change objet et texte du courriel de X » | — | steps : objet + corps | |
| I-028 | « Messages automatiques en anglais » | — | company_settings.default_language = en | |
| I-029 | Coût de la passe « réglages » | — | < 20 ¢ | 4,1 ¢ |
| I-030 | Outil : déclencheur inventé par le modèle | — | refusé, rien en base | corrigé (54dabf74) |
| I-031 | Outil : « démarrer » une règle inexistante | — | refusé | corrigé (54dabf74) |
| I-032 | Outil : 2e automatisation (client.replied) | 1×/7 j par client | créée en pause, delai_entre_passages_jours 7 | corrigé (54dabf74) |
| I-033 | Outil : langue de l'entreprise = en | — | consignes anglaises au générateur | corrigé (46a9fc92) |
| I-034 | list_automations | corbeille / purgée | non listées | corrigé (d6b41e5b) |
| I-035 | Redemander la même automatisation < 24 h après l'avoir supprimée | suppression définitive ; corbeille (`deleted_at`) ; témoin : la règle existe toujours | recréée (nouvelle règle, en pause) ; témoin : « déjà fait », aucun doublon, modèle non rappelé | CORRIGÉ — `40-iklm-lumi-outils.test.ts` [I-035] (3) : `executerIdempotent` accepte `encoreValable` (replacé dans la boucle de main #849 : empreinte de 10 min par personne). Intégration verte le 2026-10-01 AVANT la fusion de main ; non revérifiée après (staging dégradé) |
| I-036 | Déclencheur en rodage non offert à l'entreprise (`payment.failed`, drapeau `auto_paiement_echoue`) | drapeau éteint, puis allumé | éteint : refusé par l'outil de Lumi, par la création, par le changement de déclencheur (code `declencheur_non_offert`), rien en base ; allumé : accepté | CORRIGÉ — l'éditeur cachait ces déclencheurs, mais le prompt de Lumi liste tout le catalogue et l'API acceptait : la règle était créée et ne partait jamais |
| I-040 | « Crée … » / « Create … » | — | jamais de réponse FAQ | corrigé (a78e61f7) |
| I-041 | Vraie question produit | — | garde sa FAQ | |
| I-042 | « crée un parcours / automatise / workflow » | — | indice → create_automation_from_text | corrigé (9d0abe1c) |
