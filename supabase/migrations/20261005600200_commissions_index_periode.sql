-- Audit commissions 2026-09-30 — approuvée par Rafba le 2026-09-30.
-- Index de période : toutes les lectures de la page, de la Paie et du rapport
-- filtrent par (org_id, triggered_at). Mesuré sur 220 000 commissions :
-- liste du mois 145 ms → 3,3 ms ; même lecture sous RLS 193 ms → 8 ms.
-- CONCURRENTLY = pas de verrou d'écriture ; une seule instruction par fichier
-- (db:apply envoie le fichier en une requête, hors transaction explicite).
-- Retour arrière : drop index concurrently if exists public.idx_fs_commission_entries_org_periode;
create index concurrently if not exists idx_fs_commission_entries_org_periode
  on public.fs_commission_entries (org_id, triggered_at, id)
  where deleted_at is null;
