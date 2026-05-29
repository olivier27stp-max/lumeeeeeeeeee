-- Job ↔ technician assignments (many techs per job, a tech can be on many jobs).
-- Separate from jobs.salesperson_id (who sold) — this tracks who executes the work.

CREATE TABLE IF NOT EXISTS public.job_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  job_id      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  role        text NOT NULL DEFAULT 'technician',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_job_assignments_org  ON public.job_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_job_assignments_job  ON public.job_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_job_assignments_user ON public.job_assignments(user_id);

ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_assignments_select_org ON public.job_assignments;
CREATE POLICY job_assignments_select_org ON public.job_assignments
  FOR SELECT USING (has_org_membership((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS job_assignments_insert_org ON public.job_assignments;
CREATE POLICY job_assignments_insert_org ON public.job_assignments
  FOR INSERT WITH CHECK (has_org_membership((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS job_assignments_update_org ON public.job_assignments;
CREATE POLICY job_assignments_update_org ON public.job_assignments
  FOR UPDATE USING (has_org_membership((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS job_assignments_delete_org ON public.job_assignments;
CREATE POLICY job_assignments_delete_org ON public.job_assignments
  FOR DELETE USING (has_org_membership((SELECT auth.uid()), org_id));
