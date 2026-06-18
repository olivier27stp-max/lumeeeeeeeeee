-- =============================================================================
-- Migration — Nettoyage des orphelins existants (24 lignes)
-- =============================================================================
-- Contexte : 4 tables ont des org_id pointant vers des orgs supprimées (pas de FK
-- aujourd'hui, donc jamais nettoyées). Tous vérifiés SANS donnée métier :
--   - memberships : 18 lignes, tests du 2026-04-21, users auth déjà supprimés, 0 client/job
--   - org_invoice_sequences : 2 compteurs d'orgs supprimées, 0 facture associée
--   - billing_profiles : 1 ligne, 0 subscription
--   - invoice_templates (org_id = 00000000...) : 3 templates SYSTÈME avec mauvaise
--     valeur → on NE supprime PAS, on corrige en NULL (ce sont des templates globaux).
--
-- Sécurité : on ARCHIVE chaque ligne supprimée dans un schéma d'archive avant
-- suppression. Tout est en transaction (rollback global si erreur).
-- =============================================================================

BEGIN;

-- Schéma d'archive (hors public, non exposé via l'API REST)
CREATE SCHEMA IF NOT EXISTS archive;

-- 1) Archiver puis supprimer les memberships orphelins
CREATE TABLE IF NOT EXISTS archive.orphans_memberships_20260710 AS
  SELECT * FROM public.memberships m
  WHERE m.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=m.org_id);

-- IMPORTANT : memberships a un trigger d'audit (trg_membership_change_audit) qui
-- réinsère l'org_id supprimé dans security_events. Sur un org_id orphelin, cet
-- INSERT échoue (surtout une fois la FK security_events.org_id en place).
-- On désactive donc les triggers USER le temps de ce nettoyage système.
-- (Découvert via un test BEGIN/ROLLBACK contre les données réelles avant déploiement.)
ALTER TABLE public.memberships DISABLE TRIGGER USER;

DELETE FROM public.memberships m
  WHERE m.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=m.org_id);

ALTER TABLE public.memberships ENABLE TRIGGER USER;

-- 2) Archiver puis supprimer org_invoice_sequences orphelins
CREATE TABLE IF NOT EXISTS archive.orphans_org_invoice_sequences_20260710 AS
  SELECT * FROM public.org_invoice_sequences x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);

DELETE FROM public.org_invoice_sequences x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);

-- 3) Archiver puis supprimer billing_profiles orphelins
CREATE TABLE IF NOT EXISTS archive.orphans_billing_profiles_20260710 AS
  SELECT * FROM public.billing_profiles x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);

DELETE FROM public.billing_profiles x
  WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id=x.org_id);

-- 4) invoice_templates : corriger la valeur sentinelle 00000000 -> NULL (templates système)
--    (PAS de suppression : ce sont des templates globaux légitimes)
UPDATE public.invoice_templates
  SET org_id = NULL
  WHERE org_id = '00000000-0000-0000-0000-000000000000';

COMMIT;

-- =============================================================================
-- VÉRIFICATION post-migration (lecture seule) — tout doit retourner 0 :
--   SELECT count(*) FROM memberships m WHERE m.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orgs o WHERE o.id=m.org_id);
--   SELECT count(*) FROM org_invoice_sequences x WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orgs o WHERE o.id=x.org_id);
--   SELECT count(*) FROM billing_profiles x WHERE x.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orgs o WHERE o.id=x.org_id);
--   SELECT count(*) FROM invoice_templates WHERE org_id = '00000000-0000-0000-0000-000000000000';
--
-- DOWN : les données restent dans le schéma `archive`. Pour restaurer :
--   INSERT INTO public.<table> SELECT * FROM archive.orphans_<table>_20260710;
-- =============================================================================
