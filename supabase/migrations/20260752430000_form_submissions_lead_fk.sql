-- ============================================================================
-- Complète les FK manquantes : form_submissions.lead_id -> clients (2026-08-02)
-- ============================================================================
-- Skippée lors de l'audit métadonnées (11 orphelins). Analyse : les orphelins
-- pointent vers RIEN (ni clients ni pipeline_deals) => ce sont des lead_id qui
-- étaient valides à l'écriture puis dont le client a été supprimé SANS nettoyage
-- (justement l'absence de cette FK). L'app écrit des id valides.
--
-- La FK ON DELETE SET NULL corrige la cause racine (une future suppression de
-- client annulera le lien au lieu de le laisser pendre). NOT VALID tolère les 11
-- orphelins existants et n'affecte pas l'app (écritures toujours valides).
-- Aucune donnée modifiée.
-- ============================================================================

alter table public.form_submissions
  add constraint form_submissions_lead_id_fkey
  foreign key (lead_id) references public.clients(id) on delete set null not valid;
