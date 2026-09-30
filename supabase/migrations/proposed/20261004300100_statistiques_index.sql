-- ============================================================================
-- PROPOSÉE — NE PAS APPLIQUER SANS L'ACCORD DE RAFBA (audit Statistiques, STATS_AUDIT.md §5 et §7)
-- Index des motifs de lecture de /insights, mesurés sur le tenant volumineux local
-- (50 000 jobs, 100 000 factures, 100 000 paiements) : tests/stats/performance.integration.test.ts
--
-- Aucun changement de données ni de comportement. Tables petites en prod (≤ 900 lignes par
-- entreprise au 2026-09-30) : création sans CONCURRENTLY, instantanée.
-- ============================================================================

-- rentabilite_jobs : « te.org_id = … and te.job_id in (…) » — aucun index sur job_id.
create index if not exists idx_time_entries_org_job
  on public.time_entries (org_id, job_id) where job_id is not null;

-- Facturé / émises (revenue_series, overview, invoices_summary, period_comparison) filtrent
-- sur coalesce(issued_at, created_at) : l'index (org_id, issued_at, status) ne sert pas.
create index if not exists idx_invoices_org_emission
  on public.invoices (org_id, (coalesce(issued_at, created_at))) where deleted_at is null;

-- Délai de paiement, factures importées payées : bornes sur paid_at.
create index if not exists idx_invoices_org_paid_at
  on public.invoices (org_id, paid_at) where deleted_at is null and paid_at is not null;

-- Valeur moyenne, fidélité, rentabilité : jobs COMPLÉTÉS bornés sur completed_at.
create index if not exists idx_jobs_org_completed_at
  on public.jobs (org_id, completed_at) where deleted_at is null and status = 'completed';

-- Revenu par service, équipes, conversions : jobs bornés sur created_at sans filtre de statut
-- (idx_jobs_active_org commence par status et ne sert qu'à « status = … »).
create index if not exists idx_jobs_org_created_at
  on public.jobs (org_id, created_at) where deleted_at is null;

-- Soumissions bornées sur created_at avec deleted_at is null.
create index if not exists idx_quotes_org_created_actives
  on public.quotes (org_id, created_at) where deleted_at is null;
