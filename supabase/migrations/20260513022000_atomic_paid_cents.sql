-- ════════════════════════════════════════════════════════════════════════════
-- Atomic invoice.paid_cents update — fix race condition
-- ════════════════════════════════════════════════════════════════════════════
-- Previous code: SELECT paid_cents → JS compute → UPDATE. Two concurrent
-- webhook events overwrite each other. Replace with a single atomic UPDATE.

CREATE OR REPLACE FUNCTION public.apply_invoice_payment(
  p_invoice_id uuid,
  p_org_id uuid,
  p_amount_cents int
)
RETURNS TABLE(
  id uuid,
  paid_cents int,
  balance_cents int,
  status text,
  total_cents int
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.invoices
  SET
    paid_cents = LEAST(total_cents, COALESCE(paid_cents, 0) + p_amount_cents),
    balance_cents = GREATEST(0, total_cents - LEAST(total_cents, COALESCE(paid_cents, 0) + p_amount_cents)),
    status = CASE
      WHEN total_cents - LEAST(total_cents, COALESCE(paid_cents, 0) + p_amount_cents) <= 0 THEN 'paid'
      ELSE 'partial'
    END,
    paid_at = CASE
      WHEN total_cents - LEAST(total_cents, COALESCE(paid_cents, 0) + p_amount_cents) <= 0 THEN now()
      ELSE paid_at
    END,
    updated_at = now()
  WHERE id = p_invoice_id AND org_id = p_org_id
  RETURNING id, paid_cents, balance_cents, status, total_cents;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_invoice_payment(uuid, uuid, int) FROM anon, authenticated, PUBLIC;


CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  p_invoice_id uuid,
  p_org_id uuid,
  p_amount_cents int
)
RETURNS TABLE(
  id uuid,
  paid_cents int,
  balance_cents int,
  status text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.invoices
  SET
    paid_cents = GREATEST(0, COALESCE(paid_cents, 0) - p_amount_cents),
    balance_cents = GREATEST(0, total_cents - GREATEST(0, COALESCE(paid_cents, 0) - p_amount_cents)),
    status = CASE
      WHEN GREATEST(0, COALESCE(paid_cents, 0) - p_amount_cents) <= 0 THEN 'sent'
      ELSE 'partial'
    END,
    paid_at = NULL,
    updated_at = now()
  WHERE id = p_invoice_id AND org_id = p_org_id
  RETURNING id, paid_cents, balance_cents, status;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_invoice_payment(uuid, uuid, int) FROM anon, authenticated, PUBLIC;
