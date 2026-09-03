-- Snapshot client sur invoices (colonnes + backfill). Idempotent. Appliqué prod 2026-06-18.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_name_snapshot  text,
  ADD COLUMN IF NOT EXISTS client_email_snapshot text;

COMMENT ON COLUMN public.invoices.client_name_snapshot IS 'Nom du client figé à l''émission. Survit à la suppression du client (conservation fiscale + Loi 25).';
COMMENT ON COLUMN public.invoices.client_email_snapshot IS 'Courriel du client figé à l''émission. Survit à la suppression du client.';

UPDATE public.invoices i
SET
  client_name_snapshot = COALESCE(
    NULLIF(
      CASE
        WHEN c.display_as_company AND c.company IS NOT NULL AND c.company <> '' THEN c.company
        ELSE NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
      END, ''),
    c.company,
    'Client supprimé'
  ),
  client_email_snapshot = c.email
FROM public.clients c
WHERE c.id = i.client_id
  AND i.client_name_snapshot IS NULL;
