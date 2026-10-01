-- Audit commissions 2026-09-30 — approuvée par Rafba le 2026-09-30.
-- Index de période par représentant : vue d'un rep, relevé, cumul des paliers
-- (mesuré : cumul du mois d'un rep 20 ms → 0,36 ms). Une instruction par fichier.
-- Retour arrière : drop index concurrently if exists public.idx_fs_commission_entries_org_rep_periode;
create index concurrently if not exists idx_fs_commission_entries_org_rep_periode
  on public.fs_commission_entries (org_id, user_id, triggered_at)
  where deleted_at is null;
