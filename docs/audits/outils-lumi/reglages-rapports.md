# Audit — réglages, automatisations, rapports, porte-à-porte, formations, lectures (2026-09-30)

## Critiques
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| create_scheduled_report / update_scheduled_report | tools-reglages.ts:1450-1451,1149-1150 ; routes/scheduled-reports.ts:44 ; lib/scheduled-reports.ts:60-78 | Sans carte (non sensibles), destinataire libre, actif dès la création : revenus, impayés et meilleurs clients envoyés chaque semaine à une adresse externe (injection ou confusion). | sensible:true ; destinataire membre de l'org ou « adresse externe » sur la carte ; créé désactivé. |

## Élevés
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| get_revenue_summary | tools.ts:645-694 ; routes/lumi.ts:249 | Pas de `last_month` : « le mois passé » répond le mois courant ; bornes en UTC. | Enum avec last_month/last_year, from/to ; bornes locales. |
| compare_revenue | tools-etendus.ts:1038-1060 | « Période précédente » = même durée juste avant, pas le mois précédent ; pas d'encaissé ; « nouveaux clients » = prospects. | Mode mois civil ; bornes renvoyées ; libellés. |
| get_morning_briefing | tools-etendus.ts:2028-2074 | Total en retard = somme des 5 plus anciennes factures. | rpc_invoices_kpis_30d. |
| remember_this / recall_notes | registre.ts:272 ; orchestrateur.ts:242,257-259 ; tools-etendus.ts:2126-2156 | Mémoire sans carte, injectée dans le PROMPT SYSTÈME : un texto client peut devenir une consigne permanente pour toute l'org. | Carte si la note ne vient pas de l'utilisateur ; souvenirs encadrés comme données ; created_by. |
| update_automation_message / sms_body | tools-reglages.ts:495-518 ; automationEngine.ts:977 | Réécrit `actions` alors que le moteur suit `steps` : ancien texte envoyé. | Réécrire l'étape. |
| create_automation_from_text | tools-reglages.ts:452-479 | La condition demandée est perdue (conditions: {} en dur) ; la 2e automatisation est jetée. | Conditions générées, ou refus nommé. |
| cartes (toggle_automation_rule, taxes, modèles, objectifs, rapports) | fiches.ts:134-146 ; CarteAutorisation.tsx:229-231 | « is active: true », cartes vides, « rate 9.975 » sans laquelle ni l'ancien taux ; pas d'irréversible. | Aperçus composés ; `reversible` transmis à la carte. |
| create/update/set_default_email_template | tools-reglages.ts:210,1428-1430 | Non sensibles alors que le modèle actif EST le courriel client ; create actif par défaut. | Sensibles ; aperçu ; créé inactif. |
| create_tax_config | tools-reglages.ts:721-731 ; routes/taxes.ts | Pas de contrôle de doublon : double TVQ sur tous les documents ; note fausse sur les groupes régionaux. | Refuser le doublon ; carte avec le groupe et les taxes résultantes. |
| update_d2d_pipeline_item | tools-d2d-formations.ts:554-586 | Écriture directe : un vendeur passe le deal d'un collègue en gagné et se l'attribue. | Passer par la route. |
| update_house | tools-d2d-formations.ts:334-344 | Pin et pipeline non synchronisés (bug D9 reproduit). | Même effet de bord que la route. |
| build_report | tools-rapports.ts:86-90,187-191,207 | Une lecture ratée devient « Aucune facture en retard. 🎉 ». | Erreur par section. |

## Moyens / bas (résumé)
build_report (troncatures, bornes UTC, jobs.scheduled_at) ; get_top_services (UTC, « revenue » = valeur créée) ; briefing gardé par jobs.read (demandes et clients en retard visibles aux techniciens) ; notifications / briefing / souvenirs non balisés ; set_automation_language (touche tous les courriels, clé automations.update) ; list_automations (corbeille listée) ; notes de taxes fausses (groupes régionaux) ; taux fractionnaires (0.05) ; fuseau codé en dur ; sessions terrain avec lat/lng inventées ; clés de lecture pour set_goal/delete_goal/rapports ; ecrituresSensiblesPour ne lit pas `steps` ; get_recent_agent_actions (« 24 h » non filtré) ; notifications d'org lues pour tous ; montants en cents bruts sur les cartes ; cache goals ; search_help sans seuil.

À vérifier : create_automation_from_text « publiée active » non reproduit dans le code (is_active:false depuis #646) ; savoir d'équipe (📌 Slack) indexé pour toutes les orgs.
