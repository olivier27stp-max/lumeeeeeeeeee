# D2 — Plan de normalisation de l'argent stocké en JSON (NON EXÉCUTÉ)

**Statut : PLAN seulement.** Ce chantier touche le code de facturation et ne peut pas
être fait « sans rien briser » de façon autonome (pas de test possible ici). Il est
documenté pour être exécuté avec revue + tests applicatifs.

## Colonnes concernées (argent/taxes en `jsonb`)
| Colonne | Contenu | Table normalisée cible |
|---|---|---|
| `clients.line_items` | lignes tarifées (name/qty/unit_price_cents/total_cents) | nouvelle `client_line_items` (ou vue sur templates) |
| `invoice_templates.line_items` | lignes de gabarit de facture | nouvelle `invoice_template_items` |
| `invoice_templates.taxes` | taxes de gabarit | nouvelle `invoice_template_taxes` |
| `job_templates.line_items` | lignes de gabarit de job | nouvelle `job_template_items` |
| `recurring_invoice_schedules.items` | lignes générées sur facture | nouvelle `recurring_invoice_items` |
| `jobs.tax_lines` | taxes appliquées (name/rate/amount_cents) | `applied_taxes` existe déjà (l'utiliser) |

> Note : les **factures réelles** utilisent déjà `invoice_items` (normalisée). D2 ne
> concerne que les **gabarits / configs / snapshots**, ce qui limite le risque financier
> direct — mais le code qui lit/écrit ces JSON doit être réécrit.

## Pourquoi c'est un problème (rappel)
- Aucun `CHECK` possible (`unit_price_cents * quantity = total_cents`, `amount >= 0`).
- L'agrégation de revenu se fait en parsant du JSON côté app → dérive silencieuse vs
  les tables normalisées.
- Pas de FK vers `predefined_services` / `tax_configs` depuis les lignes JSON.

## Ordre d'exécution proposé (par colonne, une à la fois)
1. **Créer** la table enfant normalisée (org_id, parent_id, colonnes typées + CHECK
   non-négatif, FK composite `(org_id, parent_id)`), RLS forcée + policies org.
2. **Backfill** : `insert into <enfant> select ... from <parent>, jsonb_to_recordset(<col>)`.
3. **Adapter le code** (`src/lib/*Api.ts` + `server/routes/*`) pour lire/écrire la table
   au lieu du JSON — **c'est l'étape qui exige des tests**.
4. **Déprécier** la colonne JSON (garder en lecture le temps de la transition, puis drop).

## Risque
ÉLEVÉ sans tests : la génération de devis/factures/gabarits lit ces JSON. Une régression
produit des documents financiers erronés. À faire **colonne par colonne**, derrière des
tests, en pré-lancement idéalement.

## Effort estimé
2–4 jours (6 colonnes × création table + backfill + réécriture code + tests).
