-- Per-job time tracking (a tech can time the work on a specific job, separate
-- from the shift clock in time_entries). The mobile app (mobile/src/lib/api/jobTime.ts)
-- already reads/writes this table, but it was created by hand in Supabase and
-- never captured in a migration — so it was invisible to the web schema and not
-- reproducible on a fresh database. This migration backfills that definition.
-- Idempotent — safe to run repeatedly against the live DB where the table exists.

CREATE TABLE IF NOT EXISTS public.job_time_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  job_id     uuid NOT NULL,
  user_id    uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  seconds    integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_time_logs_job_id_idx ON public.job_time_logs (job_id);
CREATE INDEX IF NOT EXISTS job_time_logs_user_active_idx
  ON public.job_time_logs (job_id, user_id) WHERE ended_at IS NULL;

ALTER TABLE public.job_time_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_time_logs_all ON public.job_time_logs;
CREATE POLICY job_time_logs_all ON public.job_time_logs FOR ALL
  USING      (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
