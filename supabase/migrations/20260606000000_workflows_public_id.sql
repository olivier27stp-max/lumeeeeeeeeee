-- Add public_id and enhanced columns to workflows table

ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS public_id text NOT NULL DEFAULT '';

-- Backfill existing workflows
DO $$
DECLARE
  r RECORD;
  counter integer := 1000;
BEGIN
  FOR r IN SELECT id FROM public.workflows ORDER BY created_at ASC
  LOOP
    counter := counter + 1;
    UPDATE public.workflows SET public_id = 'WF-' || counter WHERE id = r.id AND public_id = '';
  END LOOP;
END;
$$;

-- Auto-increment trigger
CREATE OR REPLACE FUNCTION public.generate_workflow_public_id()
RETURNS trigger AS $$
DECLARE
  next_num integer;
BEGIN
  SELECT COALESCE(MAX(
    CAST(REPLACE(public_id, 'WF-', '') AS integer)
  ), 1000) + 1
  INTO next_num
  FROM public.workflows
  WHERE org_id = NEW.org_id
    AND public_id LIKE 'WF-%';
  NEW.public_id := 'WF-' || next_num;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflows_public_id ON public.workflows;
CREATE TRIGGER trg_workflows_public_id
  BEFORE INSERT ON public.workflows
  FOR EACH ROW
  WHEN (NEW.public_id IS NULL OR NEW.public_id = '')
  EXECUTE FUNCTION public.generate_workflow_public_id();

ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS wf_type text NOT NULL DEFAULT 'System';
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS delay_value integer NOT NULL DEFAULT 0;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS delay_unit text NOT NULL DEFAULT 'immediate' CHECK (delay_unit IN ('immediate', 'minutes', 'hours', 'days'));
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS actions_config jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS workflows_public_id_idx ON public.workflows (org_id, public_id);
