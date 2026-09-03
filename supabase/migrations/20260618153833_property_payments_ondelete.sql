-- property_id (invoices/quotes/jobs) CASCADE->SET NULL + payments.invoice_id SET NULL->RESTRICT.
-- Idempotent (vérifie la règle actuelle avant de recréer). Appliqué prod 2026-06-18.
DO $$
BEGIN
  -- invoices.property_id -> SET NULL
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_property_id_fkey' AND conrelid='public.invoices'::regclass AND confdeltype <> 'n') THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_property_id_fkey;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;

  -- quotes.property_id -> SET NULL
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quotes_property_id_fkey' AND conrelid='public.quotes'::regclass AND confdeltype <> 'n') THEN
    ALTER TABLE public.quotes DROP CONSTRAINT quotes_property_id_fkey;
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;

  -- jobs.property_id -> SET NULL (+ nullable)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_property_id_fkey' AND conrelid='public.jobs'::regclass AND confdeltype <> 'n') THEN
    ALTER TABLE public.jobs ALTER COLUMN property_id DROP NOT NULL;
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_property_id_fkey;
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;

  -- payments.invoice_id -> RESTRICT
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_invoice_id_fkey' AND conrelid='public.payments'::regclass AND confdeltype <> 'r') THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_invoice_id_fkey;
    ALTER TABLE public.payments ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT;
  END IF;
END $$;
