-- ============================================================================
-- PROPOSÉE — NE PAS APPLIQUER SANS L'OK DE RAFBA (audit commissions 2026-09-30)
--
-- Performance : aucune requête de période n'avait d'index. Toutes les lectures
-- de la page, de la Paie, du rapport et le cumul des paliers filtrent par
-- (org_id, triggered_at) — et (org_id, user_id, triggered_at) pour un rep.
--
-- Mesuré (EXPLAIN ANALYZE, tenant de 220 000 commissions, base locale = prod) :
--   liste du mois             145 ms → 3,3 ms   (seq scan → index scan)
--   cumul du mois d'un rep     20 ms → 0,36 ms
--   même lecture sous RLS     193 ms → 8 ms
--
-- Additive, aucune donnée touchée. CONCURRENTLY : pas de verrou d'écriture sur
-- la table pendant la construction — donc HORS transaction : appliquer ce
-- fichier seul (db:apply envoie une requête par fichier).
-- ============================================================================

create index concurrently if not exists idx_fs_commission_entries_org_periode
  on public.fs_commission_entries (org_id, triggered_at, id)
  where deleted_at is null;

create index concurrently if not exists idx_fs_commission_entries_org_rep_periode
  on public.fs_commission_entries (org_id, user_id, triggered_at)
  where deleted_at is null;

-- Retour arrière :
--   drop index concurrently if exists public.idx_fs_commission_entries_org_periode;
--   drop index concurrently if exists public.idx_fs_commission_entries_org_rep_periode;
