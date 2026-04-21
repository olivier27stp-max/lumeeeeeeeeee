-- Run this in Supabase Dashboard > SQL Editor

-- 1. Add missing columns to company_settings
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS review_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS review_template_id uuid DEFAULT NULL;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS review_widget_settings jsonb NOT NULL DEFAULT '{"theme":"light","filter":"all","layout":"cards","max_display":6}';

-- 2. Create email_templates table
CREATE TABLE IF NOT EXISTS public.email_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id),
  name            text NOT NULL,
  type            text NOT NULL DEFAULT 'generic'
                  CHECK (type IN ('invoice_sent', 'invoice_reminder', 'quote_sent', 'review_request', 'generic')),
  subject         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  variables       jsonb NOT NULL DEFAULT '[]',
  is_active       boolean NOT NULL DEFAULT true,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_org ON public.email_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_type ON public.email_templates(org_id, type) WHERE is_active = true;

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_templates_select_org" ON public.email_templates;
CREATE POLICY "email_templates_select_org" ON public.email_templates
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS "email_templates_insert_org" ON public.email_templates;
CREATE POLICY "email_templates_insert_org" ON public.email_templates
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS "email_templates_update_org" ON public.email_templates;
CREATE POLICY "email_templates_update_org" ON public.email_templates
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS "email_templates_delete_org" ON public.email_templates;
CREATE POLICY "email_templates_delete_org" ON public.email_templates
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS "email_templates_service" ON public.email_templates;
CREATE POLICY "email_templates_service" ON public.email_templates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_email_templates_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_email_templates_updated ON public.email_templates;
CREATE TRIGGER trg_email_templates_updated
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_email_templates_updated_at();

-- 3. Create review_requests table
CREATE TABLE IF NOT EXISTS public.review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  survey_id       uuid REFERENCES public.satisfaction_surveys(id) ON DELETE SET NULL,
  email_template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  subject_sent    text DEFAULT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'clicked', 'submitted', 'failed')),
  sent_at         timestamptz DEFAULT NULL,
  clicked_at      timestamptz DEFAULT NULL,
  submitted_at    timestamptz DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_requests_org ON public.review_requests(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_client ON public.review_requests(client_id, created_at DESC);

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_requests_select_org" ON public.review_requests;
CREATE POLICY "review_requests_select_org" ON public.review_requests
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

DROP POLICY IF EXISTS "review_requests_service" ON public.review_requests;
CREATE POLICY "review_requests_service" ON public.review_requests
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Seed default email templates
INSERT INTO public.email_templates (org_id, name, type, subject, body, variables, is_active, is_default) VALUES
('4d885f6c-e076-4ed9-ab09-23637dbee6cd', 'Invoice Sent (Default)', 'invoice_sent',
  'Invoice {invoice_number} — {invoice_amount}',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hello {client_name},</h2><p>Please find below the details for your invoice.</p><table style="width:100%;border-collapse:collapse;margin:20px 0;"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Invoice #</td><td style="padding:8px;border:1px solid #ddd;">{invoice_number}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Amount</td><td style="padding:8px;border:1px solid #ddd;">{invoice_amount}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Due Date</td><td style="padding:8px;border:1px solid #ddd;">{due_date}</td></tr></table><p style="text-align:center;margin:30px 0;"><a href="{payment_link}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">View Invoice</a></p><p>Thank you,<br/>{company_name}</p></div>',
  '["client_name","company_name","invoice_number","invoice_amount","due_date","payment_link"]'::jsonb,
  true, true),
('4d885f6c-e076-4ed9-ab09-23637dbee6cd', 'Invoice Reminder (Default)', 'invoice_reminder',
  'Reminder: Invoice {invoice_number} Past Due',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hello {client_name},</h2><p>This is a friendly reminder that invoice <strong>{invoice_number}</strong> for <strong>{invoice_amount}</strong> is past due.</p><p>Please arrange payment at your earliest convenience.</p><p style="text-align:center;margin:30px 0;"><a href="{payment_link}" style="background:#dc2626;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Pay Now</a></p><p>Thank you,<br/>{company_name}</p></div>',
  '["client_name","company_name","invoice_number","invoice_amount","due_date","payment_link"]'::jsonb,
  true, true),
('4d885f6c-e076-4ed9-ab09-23637dbee6cd', 'Quote Sent (Default)', 'quote_sent',
  'Estimate from {company_name}',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hello {client_name},</h2><p>We have prepared an estimate for you. Please review the details below:</p><p><strong>Amount:</strong> {invoice_amount}</p><p style="text-align:center;margin:30px 0;"><a href="{payment_link}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">View Estimate</a></p><p>Best regards,<br/>{company_name}</p></div>',
  '["client_name","company_name","invoice_amount","payment_link"]'::jsonb,
  true, true),
('4d885f6c-e076-4ed9-ab09-23637dbee6cd', 'Review Request (Default)', 'review_request',
  '{company_name} — How was your experience?',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hi {client_name},</h2><p>We recently completed <strong>{job_name}</strong> and would love to hear your feedback!</p><p>Please take a moment to rate your experience:</p><p style="text-align:center;margin:30px 0;"><a href="{review_link}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Rate Your Experience</a></p><p>Thank you for choosing {company_name}!</p></div>',
  '["client_name","company_name","job_name","review_link"]'::jsonb,
  true, true)
ON CONFLICT DO NOTHING;

-- 5. Fix pipeline_deals.job_id — must be nullable (leads have no job until converted)
-- Previous migrations set job_id NOT NULL which blocks every new lead creation.
ALTER TABLE public.pipeline_deals ALTER COLUMN job_id DROP NOT NULL;

-- Replace the unconditional unique constraint with a partial one (only unique when job_id IS NOT NULL).
ALTER TABLE public.pipeline_deals DROP CONSTRAINT IF EXISTS pipeline_deals_job_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_deals_job_id
  ON public.pipeline_deals (job_id)
  WHERE job_id IS NOT NULL;

-- 6. Fix set_deal_stage RPC — old version only knew legacy title-case stages
--    ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') and rejected
--    everything else ('Won', 'New', 'Contacted', 'Estimate Sent', 'Follow-Up').
CREATE OR REPLACE FUNCTION public.set_deal_stage(
  p_deal_id uuid,
  p_stage text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deal public.pipeline_deals%rowtype;
  v_stage text;
BEGIN
  v_stage := CASE lower(trim(coalesce(p_stage, '')))
    WHEN 'new'           THEN 'new'
    WHEN 'contacted'     THEN 'contacted'
    WHEN 'estimate_sent' THEN 'estimate_sent'
    WHEN 'estimate sent' THEN 'estimate_sent'
    WHEN 'follow_up'     THEN 'follow_up'
    WHEN 'follow-up'     THEN 'follow_up'
    WHEN 'won'           THEN 'won'
    WHEN 'closed'        THEN 'closed'
    WHEN 'lost'          THEN 'lost'
    -- Legacy title-case mappings
    WHEN 'qualified'     THEN 'new'
    WHEN 'contact'       THEN 'contacted'
    WHEN 'quote sent'    THEN 'estimate_sent'
    WHEN 'quote_sent'    THEN 'estimate_sent'
    ELSE NULL
  END;

  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Invalid stage: %', p_stage;
  END IF;

  SELECT * INTO v_deal
  FROM public.pipeline_deals
  WHERE id = p_deal_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_deal.id IS NULL THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  UPDATE public.pipeline_deals
  SET stage = v_stage,
      lost_at = CASE
        WHEN v_stage = 'lost' THEN now()
        WHEN v_deal.lost_at IS NOT NULL THEN NULL
        ELSE lost_at
      END,
      updated_at = now()
  WHERE id = v_deal.id;

  RETURN (
    SELECT jsonb_build_object(
      'id', pd.id,
      'stage', pd.stage,
      'lost_at', pd.lost_at,
      'updated_at', pd.updated_at
    )
    FROM public.pipeline_deals pd
    WHERE pd.id = v_deal.id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_deal_stage(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_deal_stage(uuid, text) TO authenticated, service_role;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- 6. Fix create_pipeline_deal RPC — stage names were outdated
-- The function was mapping all inputs to legacy title-case values
-- ('Qualified', 'Contact', etc.) which fail the current constraint:
-- check (stage in ('new','contacted','estimate_sent','follow_up','won','closed','lost'))
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_pipeline_deal(
  p_lead_id    uuid,
  p_title      text,
  p_value      numeric,
  p_stage      text    DEFAULT 'new',
  p_notes      text    DEFAULT NULL,
  p_pipeline_id uuid   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_lead  public.leads%rowtype;
  v_stage text;
  v_deal_id uuid;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- Normalise incoming stage to the current constraint values.
  v_stage := CASE lower(trim(coalesce(p_stage, '')))
    WHEN 'new'           THEN 'new'
    WHEN 'contacted'     THEN 'contacted'
    WHEN 'estimate_sent' THEN 'estimate_sent'
    WHEN 'estimate sent' THEN 'estimate_sent'
    WHEN 'follow_up'     THEN 'follow_up'
    WHEN 'follow-up'     THEN 'follow_up'
    WHEN 'won'           THEN 'won'
    WHEN 'closed'        THEN 'closed'
    WHEN 'lost'          THEN 'lost'
    -- Legacy mappings (old title-case or slug names)
    WHEN 'qualified'     THEN 'new'
    WHEN 'contact'       THEN 'contacted'
    WHEN 'quote_sent'    THEN 'estimate_sent'
    WHEN 'quote sent'    THEN 'estimate_sent'
    ELSE 'new'
  END;

  INSERT INTO public.pipeline_deals (
    org_id, created_by, lead_id, client_id, stage, value, title, notes, lost_at
  )
  VALUES (
    coalesce(v_lead.org_id, public.current_org_id()),
    coalesce(auth.uid(), v_lead.created_by),
    v_lead.id,
    v_lead.converted_to_client_id,
    v_stage,
    coalesce(p_value, 0),
    coalesce(nullif(trim(p_title), ''), 'New deal'),
    nullif(trim(p_notes), ''),
    CASE WHEN v_stage = 'lost' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_pipeline_deal(uuid, text, numeric, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_pipeline_deal(uuid, text, numeric, text, text, uuid) TO authenticated, service_role;


-- ============================================================
-- 8. Auto-recalculate job totals when line items change
-- Ensures DB is the source of truth even if client forgets to persist.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalculate_job_totals_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_job_id uuid;
  v_subtotal_cents bigint;
BEGIN
  -- Determine which job was affected
  IF TG_OP = 'DELETE' THEN
    v_job_id := OLD.job_id;
  ELSE
    v_job_id := NEW.job_id;
  END IF;

  IF v_job_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Sum all line items for this job
  SELECT COALESCE(SUM(GREATEST(ROUND(qty * unit_price_cents), 0)), 0)
  INTO v_subtotal_cents
  FROM public.job_line_items
  WHERE job_id = v_job_id;

  -- Update the parent job's subtotal and total_cents.
  -- tax_total and total are left as-is if already set (taxes are client-configured).
  -- If subtotal changed, recalculate total = subtotal + tax_total.
  UPDATE public.jobs
  SET subtotal      = v_subtotal_cents / 100.0,
      total_cents   = v_subtotal_cents + COALESCE(ROUND(tax_total * 100), 0),
      total_amount  = (v_subtotal_cents + COALESCE(ROUND(tax_total * 100), 0)) / 100.0,
      total         = (v_subtotal_cents + COALESCE(ROUND(tax_total * 100), 0)) / 100.0,
      updated_at    = now()
  WHERE id = v_job_id;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_job_line_items_recalc_totals ON public.job_line_items;
CREATE TRIGGER trg_job_line_items_recalc_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.job_line_items
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_job_totals_from_items();

-- Ensure job financial columns exist with correct types
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS subtotal numeric(12,2) DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_total numeric(12,2) DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS total numeric(12,2) DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_lines jsonb DEFAULT '[]';

NOTIFY pgrst, 'reload schema';
