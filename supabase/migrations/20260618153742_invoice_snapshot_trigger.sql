-- Trigger auto-remplissage du snapshot client à l'insertion d'une facture. Idempotent. Prod 2026-06-18.
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

REVOKE EXECUTE ON FUNCTION public.set_invoice_client_snapshot() FROM anon, authenticated, public;
