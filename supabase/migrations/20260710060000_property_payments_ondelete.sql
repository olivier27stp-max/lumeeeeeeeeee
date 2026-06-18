-- =============================================================================
-- Migration — property_id (préserver jobs/factures) + payments (protéger l'argent)
-- =============================================================================
-- Décisions (voir MATRICE_INTEGRITE_REFERENTIELLE.md) :
--
-- 1) Supprimer une PROPRIÉTÉ ne doit pas effacer des faits historiques/financiers.
--    Actuel -> Cible :
--      invoices.property_id : CASCADE -> SET NULL  (facture survit)
--      quotes.property_id   : CASCADE -> SET NULL  (devis survit)
--      jobs.property_id     : CASCADE -> SET NULL  (job survit) + DROP NOT NULL
--
-- 2) Supprimer une FACTURE ne doit pas détacher silencieusement un paiement.
--      payments.invoice_id : SET NULL -> RESTRICT  (bloque si paiement existe)
--
-- Tout en transaction.
-- =============================================================================

BEGIN;

-- 1a) invoices.property_id -> SET NULL (déjà nullable)
ALTER TABLE public.invoices DROP CONSTRAINT invoices_property_id_fkey;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;

-- 1b) quotes.property_id -> SET NULL (déjà nullable)
ALTER TABLE public.quotes DROP CONSTRAINT quotes_property_id_fkey;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;

-- 1c) jobs.property_id -> SET NULL (rendre nullable d'abord : il est NOT NULL)
ALTER TABLE public.jobs ALTER COLUMN property_id DROP NOT NULL;
ALTER TABLE public.jobs DROP CONSTRAINT jobs_property_id_fkey;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;

-- 2) payments.invoice_id -> RESTRICT (un paiement bloque la suppression de sa facture)
ALTER TABLE public.payments DROP CONSTRAINT payments_invoice_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT;

COMMIT;

-- =============================================================================
-- ⚠️ IMPACT : supprimer une facture ayant des paiements sera désormais BLOQUÉ
--    (voulu). Et invoices a déjà deleted_at -> on soft-delete les factures de
--    toute façon. Si une purge réelle est nécessaire, traiter les paiements d'abord.
--
-- DOWN : recréer chaque contrainte avec sa règle d'origine (CASCADE / SET NULL).
-- =============================================================================
