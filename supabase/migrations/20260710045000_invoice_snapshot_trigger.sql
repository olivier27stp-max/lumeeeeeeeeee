-- =============================================================================
-- Migration — Trigger : remplir automatiquement le snapshot client des factures
-- =============================================================================
-- Pourquoi un trigger (et non du code TS) : la création de facture passe par des
-- RPC SQL (rpc_create_invoice_draft, finish_job_and_prepare_invoice) et peut aussi
-- venir d'imports/scripts. Un trigger BEFORE INSERT garantit que le snapshot est
-- TOUJOURS rempli, quelle que soit la voie d'insertion — impossible à oublier.
--
-- Logique de nom alignée sur toClientDisplayName() (invoicesApi.ts) :
--   "first last" (trim) sinon company sinon 'Unknown client'.
--
-- PRÉREQUIS : colonnes snapshot (migration 20260710000000). Ce trigger les remplit
-- pour toute NOUVELLE facture. Le backfill des anciennes est déjà fait par 20260710000000.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_invoice_client_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  v_email text;
BEGIN
  -- Ne (re)remplit que si vide et qu'un client est rattaché
  IF NEW.client_id IS NOT NULL AND (NEW.client_name_snapshot IS NULL OR NEW.client_name_snapshot = '') THEN
    SELECT
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
        NULLIF(c.company, ''),
        'Unknown client'
      ),
      c.email
    INTO v_name, v_email
    FROM public.clients c
    WHERE c.id = NEW.client_id;

    NEW.client_name_snapshot  := COALESCE(NEW.client_name_snapshot,  v_name);
    NEW.client_email_snapshot := COALESCE(NEW.client_email_snapshot, v_email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_client_snapshot ON public.invoices;
CREATE TRIGGER trg_invoice_client_snapshot
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_client_snapshot();

COMMIT;

-- =============================================================================
-- VÉRIFICATION : insérer une facture de test et confirmer que le snapshot se remplit.
-- DOWN :
--   DROP TRIGGER IF EXISTS trg_invoice_client_snapshot ON public.invoices;
--   DROP FUNCTION IF EXISTS public.set_invoice_client_snapshot();
-- =============================================================================
