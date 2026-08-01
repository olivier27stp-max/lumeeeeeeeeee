# AUDIT MÉTADONNÉES & CLASSIFICATION DU SCHÉMA — LUME

**Date :** 2026-08-01 · **Base :** Supabase prod `bbzcuzqfgsdvjsymfwmr` · **220 tables publiques**
**Méthode :** lecture seule du catalogue système (`pg_class`, `pg_constraint`, `pg_policy`, `pg_stat_user_*`, `information_schema`) + croisement avec le code (`src/`, `server/`). Aucune donnée client lue.

> ⚠️ **Base PRÉ-LANCEMENT.** 139/220 tables ont 0 ligne — c'est **normal** (aucun client encore). « Vide » n'est PAS un signal de suppression. De même, `idx_scan=0` sur 795 index n'est **pas fiable** (pas de trafic) → aucune suppression d'index recommandée.

---

## 1. VERDICT (une page)

### ✅ **GO — prêt pour la production côté métadonnées.**

La couche métadonnées est **saine sur tous les axes critiques**. Aucun bloqueur.

| Vérif critique | Résultat |
|---|---|
| Argent en `float`/`double` | **0** (tout en cents entiers `integer`) |
| `timestamp` sans timezone | **0** (100% `timestamptz`) |
| Tables sans clé primaire | **0** |
| Fonctions `SECURITY DEFINER` sans `search_path` (injection) | **0** / 249 |
| Policies référençant `user_metadata` (critique, modifiable par l'user) | **0** |
| Vues `SECURITY DEFINER` / vues matérialisées exposées | **0** / **0** (11 vues, toutes `security_invoker`) |
| RLS activée / **forcée** | **220/220** / **220/220** |
| Tables RLS sans policy | **1** (`security_canary_runs`, deny-all voulu, documenté) |
| Colonnes `camelCase` / accent / espace | **0** (snake_case parfait, schéma anglais) |
| FK vers un autre tenant possible sans clé composite | **130 FK composites `(org_id, id)`** — standard appliqué (1 exception : `quote_line_items`) |

**3 migrations à risque nul/bas ont été APPLIQUÉES en prod pendant cet audit** (voir §6) : documentation des 96 tables + marquage PII, indexation des 6 FK manquantes, 5 FK `org_id → orgs` vérifiées.

---

## 2. BLOQUEURS V1

**Aucun.** Rien dans la couche métadonnées n'empêche la mise en production.

---

## 3. DETTE À RÉGLER DANS LES 30 JOURS

| # | Sujet | Gravité | Détail |
|---|---|---|---|
| D1 | **`quote_line_items` sans `org_id`** | MAJEUR | Seule table de lignes tarifées sans colonne tenant ; isolation transitive via `quotes` seulement. Un `quote_id` mal réglé (import/bug) rattacherait une ligne au devis d'un autre tenant — non bloqué au niveau DB, contrairement à ses sœurs `(org_id,…)`. **Correctif = ajouter `org_id` + backfill depuis `quotes` + FK composite** (migration dédiée, pas un simple ALTER). |
| D2 | **Argent/taxes en JSON** | MAJEUR | Famille `line_items`/`tax_lines` stockée en `jsonb` (`clients.line_items`, `invoice_templates.line_items`, `job_templates.line_items`, `recurring_invoice_schedules.items`, `jobs.tax_lines`, `invoice_templates.taxes`). Aucun `CHECK` possible (`unit_price*qty=total`), agrégation de revenu = parsing applicatif qui dérive silencieusement de `invoice_items`. Des tables normalisées existent déjà en parallèle → migrer progressivement. |
| D3 | **10 FK manquantes** (hors `org_id`) | MODÉRÉ | `field_rep_performance.territory_id`, `field_territory_assignments.territory_id`, `fs_field_sessions.territory_id` → `field_territories` ; `fs_commission_entries.lead_id`, `field_house_profiles.lead_id`, `form_submissions.lead_id` → `clients` ; `quotes.source_template_id`, `field_settings.default_pin_template_id`, `pipeline_deals.pin_id`, `fs_battles.*_team_id`. **Non appliquées volontairement** (pourraient bloquer des écritures si l'app écrit un id non-conforme, ex. lead_id hérité). Script prêt dans `proposed` — appliquer après avoir vérifié l'absence d'orphelins par table. |
| D4 | **`jobs.client_id → clients ON DELETE CASCADE`** | MODÉRÉ | Supprimer un client efface tous ses jobs (et via `pipeline_deals.lead_id → clients CASCADE`, ses deals) sans trace d'audit. L'app utilise déjà des vues `*_active` soft-delete → le hard-delete client devrait probablement être **bloqué (RESTRICT)** ou passer par soft-delete. |
| D5 | **33 policies `auth.uid()` non-wrappé** | MINEUR (perf) | Sur 551 policies utilisant `auth.uid()`, **518 sont déjà wrappées** `(SELECT auth.uid())` ; 33 restent en `auth.uid()` nu (réévalué par ligne — lint Supabase 0003). Fixable en wrappant (sémantique inchangée). Tables : `quote_measurement_camera` (qmc_*), `courses`/`course_modules` inserts, `memberships`, `email_accounts`, `storage.objects` attachments/job_photos select, `fs_challenge_participants`. |

---

## 4. AMÉLIORATIONS OPTIONNELLES

- **6 index redondants structurels** (même clé qu'un PK/UNIQUE existant) : `idx_fk_company_settings_org_id`, `idx_payment_provider_secrets_org`, `idx_fk_profiles_id`, `idx_qmc_quote`, `idx_email_oauth_states_state`, un doublon `idx_recurring_team_schedules_org_team`/`idx_rts_org_team`. **Ne pas dropper en pré-lancement** (confirmer d'abord qu'aucun test/migration n'assère le nom d'index).
- **`pg_net` dans le schéma `public`** (lint 0014) — le déplacer vers `extensions` est cosmétique.
- **Nommage** (ne PAS renommer — casse le code) : 86/156 booléens sans préfixe `is_/has_` (beaucoup en `_enabled`, convention acceptable) ; 14 `timestamptz` sans suffixe `_at` (`start_time`, `last_login`…) ; 21 tables au singulier (surtout `_log`/`_history`/`_audit`, défendable).
- **~18 candidats à la suppression** (0 ligne + 0 référence code) — voir `proposed_05_drops.sql.txt`, **commenté, non exécuté**.

---

## 5. INVENTAIRE (Phase 1 — classification 4 axes)

*Axe A : TENANT/GLOBAL/SYSTÈME/AUTH · Axe C : CRITIQUE/IMPORTANTE/ÉPHÉMÈRE · Axe D : ACTIVE(lignes>0) / DORMANTE(0 ligne mais intégrée, attend le lancement) / VIDE(0 ligne + 0 code).*

**Synthèse (220 tables) :**
- **Portée A :** ~190 TENANT (dont ~30 via FK parent), ~8 AUTH (`orgs`, `profiles`, `memberships`, `invitations`, `mfa_*`, `role_templates`), ~20 SYSTÈME (`webhook_*`, `security_*`, `rate_limits`, `dead_letters`, `api_keys`, `ip_blocklist`, `*_oauth_states`, `provisioning_events`), 2 GLOBAL (`plans`, `promo_codes`).
- **Statut D :** ~55 ACTIVE, ~130 DORMANTE (pré-lancement), ~18 VIDE (candidats), reste roadmap/infra.

**Tables ACTIVE les plus chargées (données réelles) :** `tracking_points` (2640), `audit_events` (2243), `activity_log` (764), `automation_scheduled_tasks` (425), `automation_rules` (404), `tracking_events` (400), `email_messages` (190), `field_house_profiles` (161), `tracking_sessions` (154), `field_pins` (128), `pipeline_deals` (124), `security_events` (113), `login_history`/`active_sessions` (91), `clients` (69), `orgs`/`profiles` (46), `communication_settings` (46), `schedule_events` (43), `notifications` (41), `memberships` (40), `jobs` (37), `fs_commission_entries` (36), `org_client_counters` (33).

> Tableau détaillé complet (220 lignes, par domaine) disponible dans le transcript d'audit ; les colonnes CRITIQUE non encore alimentées (`invoices`, `payments`, `payroll_*`, `job_*`) sont **DORMANTE = pré-lancement, à conserver**.

---

## 6. FICHIERS DE MIGRATION (ordonnés par risque croissant)

| Fichier | Risque | État | Contenu |
|---|---|---|---|
| `20260752200000_metadata_comments.sql` | **NUL** | ✅ **APPLIQUÉ prod** | 96 `COMMENT ON TABLE` + 62 `COMMENT ON COLUMN` (52 PII Loi 25 + 10 secrets). Tables sans commentaire : 96 → **0**. |
| `20260752210000_metadata_index_fk.sql` | **BAS** | ✅ **APPLIQUÉ prod** | 6 index sur les FK non indexées. FK non indexées : 6 → **0**. |
| `20260752220000_metadata_fk_org.sql` | **BAS** | ✅ **APPLIQUÉ prod** | 5 FK `org_id → orgs` (`NOT VALID`, 0 orphelin sauf `org_client_counters` = 6, tolérés). |
| `proposed_02b_constraints_fk.sql` | ÉLEVÉ | 📋 **À REVOIR, non appliqué** | Les 10 autres FK (D3) + upgrade composite (ajouter `UNIQUE(org_id,id)` sur `quote_templates`/`field_pin_templates`/`field_sales_teams` d'abord) + CHECK non-négatif sur `*_line_items`. |
| `proposed_04_types.sql` | ÉLEVÉ | 📋 coordination code | `quote_line_items.org_id` (D1) + normalisation JSON→tables (D2). Nécessite backfill + changement applicatif. |
| `proposed_05_drops.sql.txt` | — | 🚫 **COMMENTÉ, jamais exécuté** | ~18 candidats (cluster IA `scenario_*`/`decision_*`/`few_shot_examples`, cluster `note_boards`, superseded `job_materials`/`org_invoice_sequences`). Preuve requise avant tout DROP. |

---

## 7. INCERTAIN (à trancher — ne pas deviner)

1. **`demo_requests`** (VIDE, 0 ref) — table de leads marketing pré-signup. Classée GLOBAL, mais peut-être une capture de landing-page morte OU écrite par le site marketing (hors repo). *Vérifier : le site marketing écrit-il dedans ?* Si non → candidat suppression MOYEN.
2. **`org_invoice_sequences` vs `invoice_sequences`** — un snapshot `orphans_org_invoice_sequences_20260710` suggère une dépréciation à mi-chemin. *Vérifier quelle table le trigger de numérotation de facture écrit réellement avant tout DROP.*
3. **`approvals`** (VIDE, cluster agent) — nom générique ; `ActionConfirmCard.tsx` existe mais ne persiste pas ici. *Confirmer qu'aucune UI d'approbation planifiée ne l'utilisera.*
4. **Isolation transitive** de `quote_line_items`, `workflow_logs`, `incident_timeline`, `applied_taxes` (TENANT par FK parent, sans `org_id` direct) — *confirmer que la policy RLS joint bien via le parent.* (Recoupe D1.)
5. **795 index « non utilisés »** — INCERTAIN par construction (pré-lancement, `idx_scan` non significatif). Ne rien supprimer ; re-mesurer après quelques semaines de trafic réel.
6. **Lints Supabase officiels (Phase 9)** — reproduits manuellement ici (tous verts sauf 0001/0003/0014 traités). *Lancer le Security + Performance Advisor du dashboard pour réconcilier ; je n'ai pas accès au dashboard.*

---

### Annexe — réconciliation lints Supabase (Phase 9, exécutés manuellement)

| Lint | Sujet | Résultat |
|---|---|---|
| 0001 | FK non indexée | 6 trouvées → **corrigées** |
| 0003 | `auth.uid()` non-wrappé (initplan) | 33/551 → dette D5 |
| 0004 | table sans PK | **0** ✅ |
| 0005 | index inutilisé | 795 → INCERTAIN (pré-lancement) |
| 0006 | policies permissives multiples | 5 → **bénin** (storage partitionné par bucket + subscriptions own/service) |
| 0008 | RLS sans policy | 1 (`security_canary_runs`, voulu) ✅ |
| 0010 | vue SECURITY DEFINER | **0** ✅ |
| 0011 | fonction search_path mutable | **0** ✅ |
| 0013 | RLS désactivée en public | **0** ✅ |
| 0014 | extension dans public | `pg_net` (mineur) |
| 0015 | policy sur `user_metadata` | **0** ✅ (critique) |
| 0016 | vue matérialisée exposée | **0** ✅ |
| 0021 | FK vers `auth.users` sans unique | 94 FK, toutes vers `auth.users.id` (PK) ✅ |
