-- Fix: completing a job from mobile failed with
--   "SELECT FOR UPDATE is not allowed in a non-volatile function"
--
-- finish_job_and_prepare_invoice() does `SELECT … FOR UPDATE` on the job, but the
-- live function was marked non-VOLATILE (STABLE). PostgREST runs STABLE functions
-- in a READ-ONLY transaction, so the row lock (and the nested INSERTs) are
-- rejected. Marking it VOLATILE makes PostgREST run it read-write. The repo
-- already defaults these to VOLATILE; this aligns the live DB. Idempotent.

ALTER FUNCTION public.finish_job_and_prepare_invoice(uuid, uuid) VOLATILE;
ALTER FUNCTION public.create_invoice_from_job(uuid, uuid, boolean) VOLATILE;
ALTER FUNCTION public.create_invoice_from_job(uuid, uuid) VOLATILE;
