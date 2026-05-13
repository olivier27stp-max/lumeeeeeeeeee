-- ─────────────────────────────────────────────────────────────
-- Auto-pipeline_deal creation when a job or quote is created
-- WITH a salesperson_id assigned.
--
-- Why: the user wants every rep-attributed job/quote to surface in
-- the pipeline so the rep gets credit and visibility. Jobs/quotes
-- without a salesperson are ignored.
--
-- Strategy:
--   1. AFTER INSERT on jobs/quotes (where salesperson_id IS NOT NULL):
--      - If a deal already exists for the same lead_id, UPDATE it
--        (link job_id/quote_id, set rep_id, advance stage)
--      - Otherwise INSERT a new deal
--   2. Each table has its own trigger function.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_pipeline_deal_from_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_stage text;
  v_value numeric;
  v_value_cents integer;
BEGIN
  IF NEW.salesperson_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pick the right stage for a job
  v_stage := CASE
    WHEN NEW.status IN ('completed', 'closed', 'paid', 'invoiced') THEN 'won'
    WHEN NEW.status IN ('scheduled', 'in_progress') THEN 'scheduled'
    ELSE 'won'
  END;

  v_value := COALESCE(NEW.total_amount, 0);
  v_value_cents := COALESCE(NEW.total_cents, ROUND(v_value * 100)::integer, 0);

  -- 1. Reuse an existing deal for this lead, if any
  IF NEW.lead_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM pipeline_deals
    WHERE org_id = NEW.org_id
      AND lead_id = NEW.lead_id
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE pipeline_deals
       SET job_id = COALESCE(job_id, NEW.id),
           rep_id = COALESCE(rep_id, NEW.salesperson_id),
           stage = v_stage,
           value = GREATEST(value, v_value),
           value_cents = GREATEST(value_cents, v_value_cents),
           title = COALESCE(NULLIF(title, ''), NEW.title, 'Job'),
           won_at = CASE WHEN v_stage = 'won' AND won_at IS NULL THEN now() ELSE won_at END,
           updated_at = now()
     WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  -- 2. No existing deal — create one
  -- Re-check job uniqueness (pipeline_deals.job_id has UNIQUE constraint)
  IF EXISTS (SELECT 1 FROM pipeline_deals WHERE job_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO pipeline_deals (
    org_id, lead_id, client_id, job_id, rep_id,
    stage, title, value, value_cents, currency,
    source, created_by, won_at
  ) VALUES (
    NEW.org_id, NEW.lead_id, NEW.client_id, NEW.id, NEW.salesperson_id,
    v_stage,
    COALESCE(NEW.title, 'Job'),
    v_value, v_value_cents, COALESCE(NEW.currency, 'CAD'),
    'job', NEW.salesperson_id,
    CASE WHEN v_stage = 'won' THEN now() ELSE NULL END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_pipeline_deal_from_job ON public.jobs;
CREATE TRIGGER trg_auto_pipeline_deal_from_job
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION auto_pipeline_deal_from_job();


-- ─── Quotes ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_pipeline_deal_from_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_stage text;
  v_value_cents integer;
BEGIN
  IF NEW.salesperson_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A quote that's still a draft stays out of pipeline
  v_stage := CASE
    WHEN NEW.status IN ('accepted', 'signed', 'approved') THEN 'won'
    WHEN NEW.status IN ('sent', 'viewed') THEN 'proposal'
    WHEN NEW.status IN ('rejected', 'declined') THEN 'lost'
    ELSE NULL  -- draft / unknown
  END;

  IF v_stage IS NULL THEN
    RETURN NEW;
  END IF;

  v_value_cents := COALESCE(NEW.total_cents, 0);

  -- Reuse deal for the same lead
  IF NEW.lead_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM pipeline_deals
    WHERE org_id = NEW.org_id
      AND lead_id = NEW.lead_id
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE pipeline_deals
       SET quote_id = COALESCE(quote_id, NEW.id),
           rep_id = COALESCE(rep_id, NEW.salesperson_id),
           stage = v_stage,
           value_cents = GREATEST(value_cents, v_value_cents),
           value = GREATEST(value, v_value_cents / 100.0),
           title = COALESCE(NULLIF(title, ''), NEW.title, 'Quote'),
           won_at = CASE WHEN v_stage = 'won' AND won_at IS NULL THEN now() ELSE won_at END,
           lost_at = CASE WHEN v_stage = 'lost' AND lost_at IS NULL THEN now() ELSE lost_at END,
           updated_at = now()
     WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  -- Create a new deal (no existing for this lead)
  IF EXISTS (SELECT 1 FROM pipeline_deals WHERE quote_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO pipeline_deals (
    org_id, lead_id, client_id, quote_id, rep_id,
    stage, title, value, value_cents, currency,
    source, created_by, won_at, lost_at
  ) VALUES (
    NEW.org_id, NEW.lead_id, NEW.client_id, NEW.id, NEW.salesperson_id,
    v_stage,
    COALESCE(NEW.title, 'Quote'),
    v_value_cents / 100.0, v_value_cents, COALESCE(NEW.currency, 'CAD'),
    'quote', NEW.salesperson_id,
    CASE WHEN v_stage = 'won' THEN now() ELSE NULL END,
    CASE WHEN v_stage = 'lost' THEN now() ELSE NULL END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_pipeline_deal_from_quote ON public.quotes;
CREATE TRIGGER trg_auto_pipeline_deal_from_quote
  AFTER INSERT ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION auto_pipeline_deal_from_quote();


-- Also handle status transitions (quote moves from draft → sent, etc.)
CREATE OR REPLACE FUNCTION public.auto_pipeline_deal_from_quote_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only re-evaluate when status or salesperson changes
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.salesperson_id IS DISTINCT FROM OLD.salesperson_id THEN
    PERFORM auto_pipeline_deal_from_quote_impl(NEW);
  END IF;
  RETURN NEW;
END;
$$;

-- helper that does the actual work (callable from both INSERT and UPDATE)
CREATE OR REPLACE FUNCTION public.auto_pipeline_deal_from_quote_impl(NEW public.quotes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_stage text;
  v_value_cents integer;
BEGIN
  IF NEW.salesperson_id IS NULL THEN RETURN; END IF;
  v_stage := CASE
    WHEN NEW.status IN ('accepted', 'signed', 'approved') THEN 'won'
    WHEN NEW.status IN ('sent', 'viewed') THEN 'proposal'
    WHEN NEW.status IN ('rejected', 'declined') THEN 'lost'
    ELSE NULL
  END;
  IF v_stage IS NULL THEN RETURN; END IF;
  v_value_cents := COALESCE(NEW.total_cents, 0);

  -- Try to find by quote_id first (we set this on insert if no lead deal)
  SELECT id INTO v_existing_id FROM pipeline_deals
   WHERE org_id = NEW.org_id AND quote_id = NEW.id AND deleted_at IS NULL LIMIT 1;

  IF v_existing_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM pipeline_deals
     WHERE org_id = NEW.org_id AND lead_id = NEW.lead_id AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE pipeline_deals
       SET quote_id = COALESCE(quote_id, NEW.id),
           rep_id = COALESCE(rep_id, NEW.salesperson_id),
           stage = v_stage,
           value_cents = GREATEST(value_cents, v_value_cents),
           value = GREATEST(value, v_value_cents / 100.0),
           won_at = CASE WHEN v_stage = 'won' AND won_at IS NULL THEN now() ELSE won_at END,
           lost_at = CASE WHEN v_stage = 'lost' AND lost_at IS NULL THEN now() ELSE lost_at END,
           updated_at = now()
     WHERE id = v_existing_id;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_pipeline_deal_from_quote_update ON public.quotes;
CREATE TRIGGER trg_auto_pipeline_deal_from_quote_update
  AFTER UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION auto_pipeline_deal_from_quote_update();
