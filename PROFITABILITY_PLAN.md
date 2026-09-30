# Rentabilité — audit et plan (2026-09-30)

Mission : une action déterministe `analyze_profitability`, source unique pour Lumi, le MCP et l'écran ; dossier de champs « Dépenses » ; coûts API réduits. Le LLM ne calcule rien.

## 1. Inventaire

| Élément | Où | État |
|---|---|---|
| `get_job_profitability` (outil Lumi + MCP) | `server/lib/agent/tools-etendus.ts` | Appelle `rpc_insights_job_profitability` : **agrégat seulement** (pas par job, pas de filtre job/tech/rep/client/service), période par défaut = mois courant. Depuis #770 le calcul est juste, mais une question « mes jobs les moins rentables » sans période ne regarde que le mois courant (constat de l'évaluation du 2026-09-30, LUMI-RAP-004). |
| `rentabilite_jobs` (SQL, #770) | migration `20261002750000` | Par job : revenu = `jobs.subtotal_cents`, main-d'œuvre = pointages liés × taux, dépenses = `jobs.expenses_cents`. **Ignore** les factures (revenu réel), les remboursements, les commissions, les champs personnalisés, les matériaux. Utilisé par la carte Rentabilité (Statistiques) et la fiche de job. |
| `rpc_insights_job_profitability` | SQL | Agrège `rentabilite_jobs` ; lu par l'outil ci-dessus et le rapport PDF financier (`tools-rapports.ts`). |
| `set_job_expenses` | `tools-etendus.ts` | Écrit `jobs.expenses_cents` (total qui REMPLACE). Aussi saisi dans la carte Rentabilité (`updateJobExpenses`). |
| `set_hourly_rate` | `tools-equipe.ts` | Écrit `team_members.hourly_rate_cents`. |
| Pointages | `time_entries` (`job_id`, `punch_in_at/out_at`, `breaks`) | Pauses déduites dans la paie depuis #763 ; deux formats de pause. |
| Commissions | `fs_commission_entries` (+ `fs_commission_rules`, `commission_settings`) ; moteur `server/lib/field-sales/commission-engine.ts` | Entrée « projetée » à la création du job (`pending`, sans facture), **confirmée** (pas dupliquée) quand la facture est payée. `amount` en DOLLARS (numeric). |
| Factures / paiements / remboursements | `invoices` (`subtotal_cents`, `discount_cents`, `tax_cents`, `status`), `payments.refunded_cents` (#774) | Revenu réel disponible par job (`invoices.job_id`). |
| Soumissions | `quotes.job_id`, `subtotal_cents`, `discount_cents` | Estimation de repli. |
| Matériaux | `job_materials` (`quantity × unit_cost_cents`) | Table existante, **aucun écran ne l'alimente** (0 ligne en prod). |
| Coût des services | `predefined_services.default_cost_cents` | Les lignes de job (`job_line_items`) n'ont **pas** de lien vers le service : impossible d'en tirer un coût fiable. |
| Champs personnalisés | `custom_field_folders.cle_systeme` (dossiers système), `custom_fields.field_type = 'monetary'`, `custom_field_values.value_money_cents` | Les dossiers système sont gardés (ni supprimés, ni renommés) ; il n'y a pas de dossier Dépenses. |
| Routeur avant le LLM | `server/lib/lumi/actions-directes.ts` (motifs → outil + gabarit, 0 token), `raccourcis.ts`, `routeur.ts` (topics) | Existe : on y branche rentabilité / marge / profit / rentable. |

## 2. Données réelles (prod, 2026-09-30, comptes agrégés)

| Mesure | Valeur | Conséquence |
|---|---:|---|
| Jobs terminés | 636 | — |
| Factures liées à un job | 639 / 663 | Revenu réel disponible presque partout. |
| Pointages / liés à un job | **9 / 1** | La main-d'œuvre n'est presque jamais mesurable. |
| Techniciens actifs / avec taux horaire | 1 / **0** (1 membre en tout a un taux) | Même un pointage ne se chiffre pas. |
| Visites avec technicien assigné | **0 / 982** (15 avec une équipe, 0 affectation d'équipe) | Le repli « durée planifiée × techniciens » est impossible aujourd'hui. |
| Jobs avec dépenses saisies | **0** | — |
| Matériaux saisis | 0 | — |
| Champs « montant » sur les jobs | 0 | — |
| Commissions / règles / jobs avec vendeur | 27 / 1 / 14 | Commissions utilisables quand elles existent. |

**Conclusion** : aujourd'hui, la vraie rentabilité d'un job est rarement calculable. L'action doit le dire (« insuffisante ») et nommer LA donnée qui manque, plutôt que d'afficher une marge de 100 %.

## 3. Ce qui marche / cassé / manque

- **Marche** : revenu par les factures ; pointages et taux quand ils existent ; commissions stockées sans doublon ; pauses déduites.
- **Cassé / trompeur** :
  1. `rentabilite_jobs` prend le prix du job (estimation) comme revenu, même quand une facture existe, et n'enlève pas les remboursements.
  2. Aucune notion de complétude : un job sans coût saisi affiche 100 % de marge, présenté comme réel.
  3. La projection de commission se calcule sur le total **taxes comprises** (`projectCommissionForJob`, `baseCents = job.total_cents`). Hors scope ici ; signalé.
- **Manque** : filtres par technicien / rep / client / service ; attribution par technicien ; dépenses détaillées ; statut de complétude ; résumé déterministe.

## 4. Doublons à fusionner

- **`get_job_profitability` → remplacé par `analyze_profitability`** (même topic, même permission `financial.view_margins`). Pas d'outil parallèle. Le rapport PDF financier appelle la nouvelle action.
- **`rentabilite_jobs` (SQL)** : la carte des Statistiques et la fiche de job passent par la nouvelle route `GET /api/profitability` (même calculateur). La fonction SQL devient inutilisée ; sa suppression est une migration (à approuver plus tard, pas dans ce lot).
- **`set_job_expenses` vs dossier Dépenses** — décision :
  - La dépense saisie « en un total » devient le champ **Autres dépenses** (`depense_autres`) du dossier Dépenses. Après la migration, `set_job_expenses` et la saisie de la carte Rentabilité écrivent ce champ.
  - `jobs.expenses_cents` n'est plus lu que comme **repli historique** : seulement pour un job qui n'a AUCUNE valeur dans le dossier Dépenses. Jamais additionné aux champs → aucun double compte (test dédié).
  - Le backfill recopie les `expenses_cents > 0` dans `depense_autres` (0 job concerné en prod aujourd'hui).
  - Tant que la migration n'est pas approuvée, `set_job_expenses` continue d'écrire `jobs.expenses_cents` (le calculateur lit le repli).

## 5. Simplifications qui rendraient l'action plus fiable (à décider, hors de ce lot)

1. **Assigner les visites à des personnes** : 0 visite sur 982 en a une. Sans ça, ni main-d'œuvre planifiée, ni attribution par technicien.
2. **Taux horaire obligatoire** pour un membre qui pointe (ou alerte dans Équipe) : 0 technicien actif n'en a.
3. **Pointer sur le job** : le pointage n'a de `job_id` que si on le rattache à la main (1 sur 9). Proposer le job de la visite en cours au moment du pointage.
4. **Lier les lignes de job au service** (`job_line_items.source_service_id`, comme les lignes de soumission) : donnerait le coût des services et une rentabilité par service exacte au lieu d'une attribution par nom.
5. **Commission de projection sur le sous-total** (avant taxes).
6. `job_materials` n'a pas d'écran : soit l'exposer, soit le retirer au profit du dossier Dépenses (Matériaux).

## 6. Écarts de données relevés

Pointages sans job (8/9), techniciens sans taux (1/1), visites sans technicien (982/982), jobs avec vendeur mais sans commission stockée (à mesurer par l'action : « commission non calculée pour X »).

## 7. Plan d'exécution (fait dans ce lot)

1. `server/lib/rentabilite/` : **calculateur pur** (`calcul.ts`, sans accès réseau, testé sur fixtures), **chargeur** (`charger.ts`, org de la session uniquement), **service** (`index.ts` : permission, cache, rédaction pour un technicien).
2. Outil `analyze_profitability` (Lumi + MCP) à la place de `get_job_profitability` ; rapport PDF financier branché dessus.
3. Route `GET /api/profitability` (permission `financial.view_margins`) ; carte des Statistiques et fiche de job branchées dessus.
4. Routeur avant le LLM : motifs rentabilité / marge / profit / rentable (FR/EN) → action + résumé gabarit (0 token) quand la question est simple.
5. Migrations **écrites, non appliquées** : dossier système Dépenses (renommable, non supprimable) + 10 champs pour les nouvelles entreprises ; backfill des entreprises existantes et des `expenses_cents`.
6. Mesure avant/après des coûts API sur les 5 questions.

## 8. Règles de calcul retenues (résumé ; spec complète dans la PR)

- Montants **avant taxes**.
- Revenu : factures émises non annulées (`sous-total − rabais`) − part HT des remboursements ; sinon prix du job (estimation) ; sinon soumission acceptée (estimation).
- Main-d'œuvre : heures pointées sur le job × taux ; sans pointage, durée des visites × technicien assigné (estimation) ; un taux absent n'est jamais inventé (données manquantes).
- Commissions : entrées stockées non annulées du job ; un vendeur payé à la commission sans entrée = donnée manquante.
- Dépenses : champs « montant » du dossier Dépenses + matériaux chiffrés ; `jobs.expenses_cents` seulement en repli (jamais cumulé).
- Profit = revenus − coûts ; marge % seulement si revenus > 0 ; avec des coûts manquants, la marge est un **maximum**.
- Période : un job compte s'il est terminé dans la période, ou, s'il a plusieurs visites, au prorata de ses visites dans la période (pointages : exacts à la date).
- Par technicien : revenu au prorata des heures ; son salaire + sa part des dépenses et commissions au prorata des heures.
