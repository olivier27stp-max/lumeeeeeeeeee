# Audit DB multi-tenant Lume — Rapport exécutif

**Date :** 2026-07-08 · **Portée :** 202 tables, 11 vues, 207 fonctions, RLS, intégrité, perf, idempotence, Loi 25 · **Méthode :** introspection lecture seule via `pg_catalog` (prod, session pooler).

## Synthèse

**La DB est structurellement saine et sécurisée.** RLS activé sur 100% des tables, clés primaires partout, argent en cents/`numeric` (jamais en float), tous les timestamps en `timestamptz`, index `org_id` sur toutes les grosses tables tenant, infrastructure d'idempotence présente (webhook dedup + compteurs par org).

**UNE fuite inter-tenant critique a été trouvée ET corrigée pendant l'audit** (voir CRITIQUE #1). Le reste = optimisations et durcissements, sans urgence.

| Sévérité | Nb | Statut |
|---|---|---|
| 🔴 CRITIQUE | 2 | ✅ **CORRIGÉS + vérifiés** |
| 🟠 ÉLEVÉ | 1 | migration prête (staging d'abord) |
| 🟡 MOYEN | 2 | documenté, à planifier |
| ⚪ FAIBLE / OK | — | conforme |

---

## 🔴 CRITIQUE #1 — Fuite inter-tenant via la vue `properties_active` — ✅ CORRIGÉ
**Problème :** vue sans `security_invoker` → tournait en tant que `postgres` (BYPASSRLS), ignorant le RLS de `properties`.
**Risque (prouvé) :** un user authentifié d'un org voyait **48 propriétés de 14 orgs** (adresses + GPS de tous les tenants) via l'API publique. Violation Loi 25.
**Fix appliqué :** `alter view public.properties_active set (security_invoker = on);` — vérifié : le user ne voit plus que son org (1).
**Effort :** S.

## 🔴 CRITIQUE #2 — Lecture anonyme cross-tenant sur `satisfaction_surveys` — ✅ CORRIGÉ
**Problème :** policy `surveys_select_anon` = `SELECT to anon USING(true)` → visiteur non authentifié lisait tous les sondages (feedback, client_id, org_id) de tous les tenants.
**Fix appliqué :** `drop policy surveys_select_anon` — l'app lit ces sondages uniquement côté serveur (service_role). Vérifié retiré.
**Effort :** S.

> Migration : `supabase/migrations/proposed/20260725000000_CRITICAL_rls_leak_fixes.sql` (appliquée manuellement le 2026-07-08).

## 🟠 ÉLEVÉ #3 — Clés étrangères manquantes (intégrité)
**Problème :** 24 colonnes `*_id` sur de vraies tables n'ont pas de FK → rien n'empêche les lignes orphelines.
**État :** 21 colonnes ont 0 orphelin (FK ajoutable direct) ; 6 refs client orphelines à nullifier d'abord.
**Fix :** `supabase/migrations/20260724000000_fk_hardening.sql` (PR #49) — `NOT VALID` + `VALIDATE`.
**⚠️ Pourquoi pas appliqué automatiquement :** ajouter une FK bloque les hard-deletes d'un parent ayant des enfants. L'app soft-delete (faible risque) mais **à valider en staging** — un flux de suppression pourrait casser. Décision dev.
**Effort :** M.

## 🟡 MOYEN #4 — 492 policies avec `auth.uid()` non-wrappé (perf à l'échelle)
**Problème :** 492 policies sur 187 tables appellent `auth.uid()`/`auth.jwt()` sans `(select ...)` → réévalué **par ligne** au lieu d'une fois par requête (best practice Supabase).
**Risque :** négligeable à 10 clients, dégrade les grosses requêtes à l'échelle.
**Fix :** réécriture mécanique `auth.uid()` → `(select auth.uid())`. **NON fait à l'aveugle** : malformer une policy sur 492 = risque de verrouiller des users ou rouvrir une fuite. À faire par génération + tests RLS (voir #6), en staging.
**Effort :** L (mécanique mais volumineux + test obligatoire).

## 🟡 MOYEN #5 — Modèle « personne » éclaté sur 4 tables
Identité dupliquée (`profiles`/`memberships`/`team_members`/`field_sales_reps`), 0 lien entre les 2 systèmes de membres. Spec de refonte : `docs/schema-person-model-refactor.md` (PR #48). Chantier dev (36 fichiers) — hors périmètre d'un fix DB seul.

## ⚪ Points SAINS (vérifiés conformes)
- 0 table tenant sans RLS · 10/11 vues avec `security_invoker` (la 11e corrigée) · 207/207 fonctions SECDEF avec `search_path` fixé.
- Argent : 0 colonne en float (tout cents/numeric). Timestamps : 100% `timestamptz`.
- UNIQUE : les contraintes globales sont sur des tokens/slugs (correct par design).
- Idempotence : `processed_checkout_sessions`, `webhook_events`, `org_invoice_sequences`, `org_job_counters` présents.

## À faire (recommandations, ordre)
1. ✅ ~~Fuites RLS~~ — **FAIT**.
2. **Suite de tests RLS en CI** (2 JWT, par table tenant) — protège tout le futur. Le plus haut ROI restant.
3. FK hardening (#3) — après validation staging des flux de delete.
4. Wrapping `auth.uid()` (#4) — génération + tests, staging.
5. Refonte modèle personne (#5) — chantier dev.
6. Loi 25 : voir `docs/audit/pii_registry.md` (52 tables PII) + procédure d'anonymisation à concevoir.

## Note d'accès
Audit fait avec la connection string DB fournie (rôle postgres, pooler ca-central-1). **À révoquer / reset après** (Settings → Database → Reset password).
