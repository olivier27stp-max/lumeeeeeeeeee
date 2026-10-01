-- ============================================================================
-- Audit commissions 2026-09-30 — approuvée par Rafba le 2026-09-30.
-- Appliquée après la sauvegarde complète prod-20261001-0010.dump (268 tables, relue).
--
-- Problème (bug B-05) : l'index unique fs_commission_entries_uniq_job_rep
-- (org_id, job_id, user_id) interdit une 2e commission pour le même rep sur le
-- même job. Or une facture refaite sur un job (payée → remboursée → annulée →
-- supprimée → nouvelle facture payée) est légitime : l'ancienne commission
-- reste en base, « reversed », et bloque la nouvelle. L'insertion échoue et
-- le rep n'est jamais payé (prouvé par le tenant de test, facture RF2).
--
-- Correctif : l'index n'a de sens que pour les ESTIMATIONS (une seule
-- projection par job et par rep). Les commissions confirmées sont déjà
-- protégées contre les doublons par fs_commission_entries_uniq_invoice_rep
-- (org_id, invoice_id, user_id).
--
-- Vérifié localement (schéma identique à la prod) : suite d'exactitude 12/12,
-- idempotence (relances en série et en parallèle) sans doublon.
-- Aucune donnée modifiée. Réversible (voir bas du fichier).
-- ============================================================================
begin;

drop index if exists public.fs_commission_entries_uniq_job_rep;

create unique index fs_commission_entries_uniq_job_rep
  on public.fs_commission_entries (org_id, job_id, user_id)
  where deleted_at is null and job_id is not null and invoice_id is null;

comment on index public.fs_commission_entries_uniq_job_rep is
  'Une seule ESTIMATION (sans facture) par job et par rep. Les commissions confirmées sont uniques par facture (uniq_invoice_rep).';

commit;

-- Retour arrière :
--   drop index if exists public.fs_commission_entries_uniq_job_rep;
--   create unique index fs_commission_entries_uniq_job_rep on public.fs_commission_entries
--     (org_id, job_id, user_id) where deleted_at is null and job_id is not null;
-- (échoue si des factures refaites ont été commissionnées entre-temps — c'est voulu.)
