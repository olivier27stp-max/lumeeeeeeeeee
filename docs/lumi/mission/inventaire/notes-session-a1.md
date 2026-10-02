# Notes de coordination — session lumeeeeeeeeee-a1 (2026-10-01, ~14:20 UTC)

Mesures et faits transmis par l'autre session Lumi. À VÉRIFIER avant de les citer dans un livrable.

## Passe prod (54 cas, ZZ QA Champs)
- 51/54 bons au juge, 0 faux « c'est fait », 0 erreur, 0,74 $ (1,37 ¢/demande).
- 2 des 3 ratés sont des faux négatifs du juge (refus corrects : remboursement sans paiement, suppression en masse).
- 1 VRAI défaut : « Le client m'a payé la facture n° 1 au complet en argent comptant. » → réponse FAQ toute faite à 0 ¢ (« la facture apparaît en retard… »).
- Résultats : `C:\Users\Rafba\lume-outils\evals\lumi-tools\resultats\prod-2026-10-01.json` (pas poussé).

## Runner prod
- `evals/lumi-tools/run.mts --prod --org <id> --compte <courriel> --sortie <fichier>` (branche `chore/eval-lumi-prod`, commit 0b0be082, pas sur main).
- Vise https://lumecrm.net ; exige une org dont le nom dit QA/TEST/banc ; refuse --forfait/--budget ; 1 cas à la fois (limite 60 tours/h par personne) ; met le compte en lumi_mode « demander » puis le remet.
- Coût relu dans `ai_usage` par conversation.
- Cas prod : `evals/lumi-tools/cas-prod/prod.json` (54 cas écrits pour les fiches de ZZ QA Champs).
- Les 459 cas de `evals/lumi-tools/cas/` visent les fiches de l'org QA de STAGING : pas rejouables tels quels en prod.

## Ce qu'elle touche (PR « perf(lumi): repérage »)
- Nouveau `server/lib/lumi/reperage.ts` + `tests/lumi-reperage.test.ts` (fiches citées trouvées par code → bloc VARIABLE du prompt ; coupe-circuit `LUMI_REPERAGE=0`).
- `server/routes/lumi.ts` (2 ajouts autour de tourLumi), `server/lib/support/faq.ts` (MARQUES_DONNEES), `server/lib/lumi/demande-action.ts` (motif EVENEMENT), `evals/lumi-tools/run.mts` + `cas-prod/`.
- Aucun changement au prompt stable ni aux descriptions d'outils.

## Mesures de coût (prod, 2026-10-01)
- Répartition du coût agent : 56 % écriture de cache 5 min, 32 % lecture de cache, 11 % sortie, 1 % entrée.
- Préfixe (outils + prompt) en TTL 5 min, UN préfixe par sous-agent : demande isolée à froid 3 à 5 ¢ (list_invoices-1 : 5,17 ¢), 0,6 à 1,3 ¢ à chaud.
- Tailles (count_tokens) : prompt stable 4 567 ; outils : base 3 070, communications 3 519, rapports 4 932, devis 6 638, equipe 8 062, terrain 8 204, clients 8 949, planification 11 805, facturation 12 457.
- Proposition sans recherche 0,56–0,63 ¢ ; avec une recherche 1,15–1,31 ¢ ; avec deux 1,5–2,1 ¢ ; 74 % des actions font au moins une recherche.
- Routeur Haiku : 0,15 ¢/demande (~10 % du coût), tranche seul ~4 % des demandes.

## Défauts connus ouverts
- LUMI_TOOLS_AUDIT.md : schedule_job, mode par défaut, permission send_email, limiteur SMS.
- 3 mauvais choix d'outil (staging) : set_default_email_template-3, duplicate_email_template-3 (lit list_invoice_templates), resend_payment_request-1 (propose create_payment_request).

## Partage du terrain convenu
- À elle jusqu'à sa 2e mesure : reperage.ts, routes/lumi.ts, faq.ts, demande-action.ts, run.mts.
- À moi : prompt stable, descriptions d'outils, TTL de cache, journalisation, tests critiques, rapport de coût. Pas de modif de prompt/outils avant sa 2e mesure.

## Mesures hors ligne de a1 (2026-10-01, ~15:20 UTC) — à citer dans LUMI_COST_REPORT
1. Diète du prompt : presque rien à gagner. Prompt stable 4 567 tokens (Rôle 551, Sécurité 389, Trouver le bon outil 785, consignes collègue 1 803). Non raccourci.
2. Descriptions d'outils : la moitié des tokens d'outils est la STRUCTURE des schémas. Facturation : 12 464 pleins ; 10 418 avec descriptions à une phrase ; 10 288 sans descriptions de paramètres ; 6 622 en squelette nu. Gain max ≈ 15 %, risque réel sur le choix d'outil.
3. Noyau + tool_search : rejeté par mesure (définitions insérées AVANT le prompt, 27–30 k tokens relus plein tarif, 6–7 ¢ le tour). Prédicteur « noyau » : 10 % des cas, 20 % d'outil manquant.
4. Haiku pour les lectures : NON à faible trafic (caches par modèle : deux écritures à froid au lieu d'une).
5. Routeur : une règle par mots-clés donne le même sujet que Haiku dans 96,2 % des cas où elle tranche (64 % des énoncés, 453 énoncés). Gain ≈ 0,1 ¢/demande + 0,7 s. Levier suivant de a1.
6. TTL adaptatif par préfixe (idée pour mon chantier) : si le dernier appel sur CE préfixe date de plus de 5 min et de moins de 60 min → écrire en 1 h pour ce préfixe pendant ~2 h ; sinon 5 min. Regret borné 0,75 × préfixe par épisode, gain 1,15 × préfixe par écriture évitée ; rentable si P(autre appel dans l'heure) > ~40 %.
7. PR #831 ouverte (pas de a1) : « borner les résultats d'outils », vise l'écriture de conversation.
- Levier 1 de a1 = PR #850 : `CONSIGNES_COLLEGUE_LUMI` (les « attends un OUI » du MCP contredisaient « la carte EST le oui »), VERSION_PROMPT v2026-10-01.1. Passe prod de 57 cas ensuite.
- 2e passe de a1 : 8 écritures de préfixe à froid (7 000–18 000 tokens, moy. 12 100) = 44 % du coût Sonnet ; les 63 autres appels 0,51 ¢ en moyenne (lecture 54 %, écriture conversation 28 %, sortie 18 %) ; routeur 12 %.

## Preuves rejouées après déploiement (7411f024, 15:17 UTC)
- /api/org-knowledge : technicien → 403 (lecture, écriture, suppression).
- Canari bac à sable, vraie adresse : `envois_simules.org_id` = bureau de test, raison « entreprise », id fournisseur « simule-… ». PHASE 0 : canari VERT.
