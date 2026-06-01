-- Ensure time_entries can be linked to a job/contract and a team.
-- The punch-in endpoint already writes these, but no migration created the
-- columns explicitly. Idempotent — safe to run repeatedly.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS job_id  uuid REFERENCES public.jobs(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_job  ON public.time_entries(job_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_emp_date ON public.time_entries(employee_id, date);
