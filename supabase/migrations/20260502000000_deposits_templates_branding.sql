-- ============================================================
-- Migration: Deposits on Jobs + Template extensions + Branding
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Add deposit columns to jobs table
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_type text CHECK (deposit_type IS NULL OR deposit_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS deposit_value numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS require_payment_method boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_status text DEFAULT 'not_required'
    CHECK (deposit_status IN ('not_required','pending','paid','waived'));

-- ============================================================
-- 2. Add deposit_cents + deposit_status to quotes
-- ============================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status text DEFAULT 'not_required'
    CHECK (deposit_status IN ('not_required','pending','paid','waived'));

-- ============================================================
-- 3. Add primary_color to company_settings for branding
-- ============================================================

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#1a1a2e',
  ADD COLUMN IF NOT EXISTS secondary_color text DEFAULT '#6b7280',
  ADD COLUMN IF NOT EXISTS quote_footer_text text DEFAULT '',
  ADD COLUMN IF NOT EXISTS job_footer_text text DEFAULT '';

-- ============================================================
-- 4. Extend email_templates for job types
-- ============================================================

-- Drop and recreate the check constraint to add new types
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_type_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_type_check
  CHECK (type IN (
    'invoice_sent', 'invoice_reminder',
    'quote_sent', 'quote_accepted', 'quote_declined',
    'job_confirmation', 'job_reminder', 'job_completed',
    'review_request', 'generic'
  ));

-- ============================================================
-- 5. Payment requirements table (entity-agnostic deposits)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_requirements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  entity_type         text NOT NULL CHECK (entity_type IN ('quote','job','invoice')),
  entity_id           uuid NOT NULL,
  requirement_type    text NOT NULL CHECK (requirement_type IN ('deposit','full_payment','payment_method_on_file')),
  amount_cents        integer DEFAULT 0,
  currency            text NOT NULL DEFAULT 'CAD',
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','authorized','paid','waived','failed','not_applicable')),
  due_at              timestamptz,
  payment_method_required boolean NOT NULL DEFAULT false,
  payment_id          uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_requirements_entity
  ON public.payment_requirements (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_payment_requirements_org
  ON public.payment_requirements (org_id, status);

ALTER TABLE public.payment_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_requirements_select ON public.payment_requirements;
CREATE POLICY payment_requirements_select ON public.payment_requirements
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));
DROP POLICY IF EXISTS payment_requirements_insert ON public.payment_requirements;
CREATE POLICY payment_requirements_insert ON public.payment_requirements
  FOR INSERT WITH CHECK (public.has_org_membership(auth.uid(), org_id));
DROP POLICY IF EXISTS payment_requirements_update ON public.payment_requirements;
CREATE POLICY payment_requirements_update ON public.payment_requirements
  FOR UPDATE USING (public.has_org_membership(auth.uid(), org_id));

-- ============================================================
-- 6. Insert default email templates for quotes and jobs
-- ============================================================

-- These use org_id from the first org (will be applied per-org)
-- Quote sent template
INSERT INTO public.email_templates (org_id, name, type, subject, body, variables, is_default, is_active)
SELECT o.id, 'Quote Sent', 'quote_sent',
  'Quote #{{quote_number}} from {{company_name}}',
  'Hello {{client_name}},

{{company_name}} has prepared a quote for you.

Quote #: {{quote_number}}
Amount: {{total}}
Valid until: {{valid_until}}

Please click the link below to view your quote and accept or decline it.

Thank you,
{{company_name}}',
  '["client_name","company_name","quote_number","total","valid_until"]'::jsonb,
  true, true
FROM public.orgs o
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates et WHERE et.org_id = o.id AND et.type = 'quote_sent' AND et.is_default = true
)
LIMIT 1;

-- Job confirmation template
INSERT INTO public.email_templates (org_id, name, type, subject, body, variables, is_default, is_active)
SELECT o.id, 'Job Confirmation', 'job_confirmation',
  'Job Confirmed — {{job_title}} | {{company_name}}',
  'Hello {{client_name}},

Your job has been confirmed with {{company_name}}.

Job: {{job_title}}
Date: {{job_date}}
Address: {{job_address}}

{{#if deposit_required}}
A deposit of {{deposit_amount}} is required before the scheduled date.
{{/if}}

If you have any questions, please contact us:
Phone: {{company_phone}}
Email: {{company_email}}

Thank you for choosing {{company_name}}!',
  '["client_name","company_name","job_title","job_date","job_address","deposit_required","deposit_amount","company_phone","company_email"]'::jsonb,
  true, true
FROM public.orgs o
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates et WHERE et.org_id = o.id AND et.type = 'job_confirmation' AND et.is_default = true
)
LIMIT 1;

-- Job reminder template
INSERT INTO public.email_templates (org_id, name, type, subject, body, variables, is_default, is_active)
SELECT o.id, 'Job Reminder', 'job_reminder',
  'Reminder: {{job_title}} — {{job_date}} | {{company_name}}',
  'Hello {{client_name}},

This is a friendly reminder about your upcoming appointment with {{company_name}}.

Job: {{job_title}}
Date: {{job_date}}
Address: {{job_address}}

Please ensure the area is accessible for our team.

If you need to reschedule, please contact us at {{company_phone}}.

See you soon!
{{company_name}}',
  '["client_name","company_name","job_title","job_date","job_address","company_phone"]'::jsonb,
  true, true
FROM public.orgs o
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates et WHERE et.org_id = o.id AND et.type = 'job_reminder' AND et.is_default = true
)
LIMIT 1;

COMMIT;
