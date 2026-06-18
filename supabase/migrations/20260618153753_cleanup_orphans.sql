-- Nettoyage des orphelins org_id (archive puis suppression). Idempotent. Prod 2026-06-18.
-- Note : le trigger d'audit memberships est désactivé le temps du DELETE (il réinsère
-- l'org_id supprimé dans security_events -> échouerait sur un org_id orphelin).
CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS archive.orphans_memberships_20260710 AS
  SELECT * FROM public.memberships m
  WHERE m.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=m.org_id);

ALTER TABLE public.memberships DISABLE TRIGGER USER;
DELETE FROM public.memberships m
  WHERE m.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=m.org_id);
ALTER TABLE public.memberships ENABLE TRIGGER USER;

CREATE TABLE IF NOT EXISTS archive.orphans_org_invoice_sequences_20260710 AS
  SELECT * FROM public.org_invoice_sequences x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);
DELETE FROM public.org_invoice_sequences x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);

CREATE TABLE IF NOT EXISTS archive.orphans_billing_profiles_20260710 AS
  SELECT * FROM public.billing_profiles x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);
DELETE FROM public.billing_profiles x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);

UPDATE public.invoice_templates SET org_id = NULL
  WHERE org_id = '00000000-0000-0000-0000-000000000000';
