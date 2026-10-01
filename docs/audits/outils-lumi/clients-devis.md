# Audit — clients, prospects, pipeline, devis (2026-09-30)

Isolation entre entreprises et bureaux : tient (org_id = ctx.orgId partout, policy restrictive bureau_actif, FK même-org). Les écarts de l'évaluation viennent de ce que les outils ne disent pas au modèle et de ce que la carte ne montre pas.

## Critiques
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| delete_client, delete_lead, delete_deal, delete_quote, cancel_quote, convert_*, update_client | fiches.ts:134-146 ; CarteAutorisation.tsx:229-231,72 | Carte sans la fiche ciblée (« Lumi veut la suppression de clients ») ; avec 3 « Tremblay », on confirme sans voir lequel. | Aperçu « fiche cible » + bandeau irréversible. |
| delete_client, merge_clients, delete_lead, delete_deal | CarteAutorisation.tsx:356-358 ; routes/lumi.ts:966-967 ; execution.ts:150 | « Toujours confirmer » / mode « tout » : suppression ou fusion sans carte. | Jamais d'office pour reversible:false. |
| delete_deal | tools-leads.ts:1140-1141 ; routes/leads.ts:294-301 | `also_delete_lead:true` supprime le client lié même s'il est devenu client actif (jobs et factures orphelins). | Refuser si status ≠ lead. |
| search_clients | tools.ts:141-160 | Le résultat ne nomme pas le bureau consulté ; pas de recherche dans l'adresse ni sans accents : « Marie Tremblay de Lévis » → 0 → le modèle retire la ville et agit sur celle de Québec. | `portee` + consigne « bureau non accessible » ; recherche adresse/propriétés, sans accents. |

## Élevés
| Outil | Fichier:ligne | Constat | Correction |
|---|---|---|---|
| create_quote | tools-etendus.ts:1591 ; tools.ts:774-787 | total renvoyé avant taxes (200 $ pour 229,95 $) ; pas d'option « taxes incluses » ; carte ≠ devis. | Relire les totaux ; `prices_include_taxes` ; même taux pour la carte. |
| list_quotes → actions sur devis | tools.ts:478,487 | Pas de client dans le résultat ni de filtre client. | Joindre le client ; filtre client_id. |
| update_client, create_client, convert_lead_to_client, update_lead_status, set_custom_field, update_deal_stage | registre.ts:32-34 ; tools-leads.ts:1304-1320 | Non sensibles : sans carte en mode argent, modifient la mauvaise fiche immédiatement. | Carte nominative pour toute écriture sur une fiche existante. |
| get_client_profile | tools-etendus.ts:1953-1991 | lifetime_value = 5 derniers jobs ; unpaid = total au lieu du solde. | Agrégat en base ; balance_cents. |

## Moyens / bas (résumé)
Champs de formulaires publics non balisés (injection) ; list_request_submissions (count de page) ; create_client (« doublons fusionnés » faux) ; create_quote (brouillon vide laissé si les lignes échouent) ; cancel_quote (devis converti archivable, pas d'historique) ; convert_quote_to_* (incertain non géré, lignes non vérifiées, verrou « converti » sans facture) ; convert_lead_* sans contrôle de statut ; delete_client (cascade non transactionnelle) ; merge_clients (note fausse si lignes non déplacées) ; propriété principale (index unique) ; update/delete_note (jobs.read) ; montants en dollars non masqués (list_deals, search_leads, list_custom_fields) ; delete_quote non marqué irréversible ; filtre de statut brut ; set_custom_field (clé par objet) ; `.single()` ; adresse absente de la carte de devis ; tri et recherche ; message Postgres brut.

À vérifier : « client d'une autre entreprise révélé » (probablement une fiche du bureau dont `company` porte le nom de l'autre entreprise) ; process_request_submission (équipe/utilisateur d'évaluation dans l'org).
