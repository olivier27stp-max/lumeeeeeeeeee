-- Materials / expenses a technician used on a job. The desktop tracks job line
-- items (what's billed) but there was no place for a tech to log materials
-- consumed on site. This adds one. Org-scoped; insert requires created_by =
-- auth.uid() (same pattern as job_line_items). Idempotent.

CREATE TABLE IF NOT EXISTS public.job_materials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL DEFAULT auth.uid(),
  name            text NOT NULL,
  quantity        numeric NOT NULL DEFAULT 1,
  unit            text,
  unit_cost_cents integer,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_materials_job_idx ON public.job_materials (job_id);

ALTER TABLE public.job_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_materials_select ON public.job_materials;
CREATE POLICY job_materials_select ON public.job_materials
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS job_materials_insert ON public.job_materials;
CREATE POLICY job_materials_insert ON public.job_materials
  FOR INSERT WITH CHECK (
    public.has_org_membership(auth.uid(), org_id) AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS job_materials_delete ON public.job_materials;
CREATE POLICY job_materials_delete ON public.job_materials
  FOR DELETE USING (public.has_org_membership(auth.uid(), org_id));
