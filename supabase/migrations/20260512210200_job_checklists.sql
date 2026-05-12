-- ────────────────────────────────────────────────────────────────────
-- Job Checklists / Forms — admin-defined templates, technician-filled
-- instances attached to jobs. Jobber-parity feature.
-- ────────────────────────────────────────────────────────────────────

-- Checklist templates per org (per service type / job type)
CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  job_type text, -- optional: auto-attach to jobs of this type
  items jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{id, type:'checkbox'|'text'|'number'|'photo'|'signature', label, required}]
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checklist_templates_org_idx ON public.checklist_templates (org_id) WHERE is_active = true;

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_templates_org_read ON public.checklist_templates;
CREATE POLICY checklist_templates_org_read ON public.checklist_templates
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS checklist_templates_org_write ON public.checklist_templates;
CREATE POLICY checklist_templates_org_write ON public.checklist_templates
  FOR ALL USING (public.has_org_admin_role(auth.uid(), org_id))
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));

-- Instance: a filled-in checklist attached to a specific job
CREATE TABLE IF NOT EXISTS public.job_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  -- Snapshot of items at time of attach so changes to the template don't mutate history.
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb, -- {item_id: value}
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_checklists_job_idx ON public.job_checklists (job_id);
CREATE INDEX IF NOT EXISTS job_checklists_org_idx ON public.job_checklists (org_id);

ALTER TABLE public.job_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_checklists_org_all ON public.job_checklists;
CREATE POLICY job_checklists_org_all ON public.job_checklists
  FOR ALL USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

NOTIFY pgrst, 'reload schema';
