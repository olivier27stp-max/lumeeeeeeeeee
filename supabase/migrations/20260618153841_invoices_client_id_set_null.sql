-- invoices.client_id CASCADE -> SET NULL (conserver les factures à la suppression du client).
-- Le fix légal central. Idempotent. Appliqué prod 2026-06-18.
DO $$
DECLARE manquants int;
BEGIN
  -- garde-fou : snapshots présents et remplis
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='client_name_snapshot') THEN
    RAISE EXCEPTION 'PRÉREQUIS MANQUANT: invoices.client_name_snapshot absent.';
  END IF;
  SELECT count(*) INTO manquants FROM public.invoices WHERE client_id IS NOT NULL AND client_name_snapshot IS NULL;
  IF manquants > 0 THEN
    RAISE EXCEPTION 'PRÉREQUIS MANQUANT: % factures sans snapshot.', manquants;
  END IF;

  -- ne recréer que si pas déjà en SET NULL
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_client_id_fkey' AND conrelid='public.invoices'::regclass AND confdeltype <> 'n') THEN
    ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_client_id_fkey;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
END $$;
