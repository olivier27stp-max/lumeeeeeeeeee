-- form_submissions.deal_id NO ACTION -> SET NULL (ne bloque plus la cascade des deals).
-- Idempotent. Appliqué prod 2026-06-18.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='form_submissions_deal_id_fkey' AND conrelid='public.form_submissions'::regclass AND confdeltype <> 'n') THEN
    ALTER TABLE public.form_submissions DROP CONSTRAINT form_submissions_deal_id_fkey;
    ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.pipeline_deals(id) ON DELETE SET NULL;
  END IF;
END $$;
