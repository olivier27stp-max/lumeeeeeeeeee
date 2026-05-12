-- ─────────────────────────────────────────────────────────────────────────────
-- Automated Payment Reminders (Jobber-parity)
-- ─────────────────────────────────────────────────────────────────────────────
-- Two tables:
--   reminder_settings — org-level config: enabled flag + schedule (jsonb)
--   reminder_log      — audit + dedupe of reminders actually sent
-- A cron job (POST /api/cron/payment-reminders) reads settings, scans overdue
-- invoices, dispatches email/SMS, and logs results idempotently.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reminder_settings (
  org_id uuid PRIMARY KEY REFERENCES public.orgs(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  -- Schedule entries: {days_after_due:int, channel:'email'|'sms'|'both', template_id?:uuid}
  schedule jsonb NOT NULL DEFAULT '[
    {"days_after_due": 1, "channel": "email"},
    {"days_after_due": 7, "channel": "email"},
    {"days_after_due": 14, "channel": "both"},
    {"days_after_due": 30, "channel": "both"}
  ]'::jsonb,
  custom_email_subject text,
  custom_email_body text,
  custom_sms_body text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_settings_org_read ON public.reminder_settings;
CREATE POLICY reminder_settings_org_read ON public.reminder_settings
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS reminder_settings_org_write ON public.reminder_settings;
CREATE POLICY reminder_settings_org_write ON public.reminder_settings
  FOR ALL USING (public.has_org_admin_role(auth.uid(), org_id))
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));


CREATE TABLE IF NOT EXISTS public.reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  days_after_due integer NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','both')),
  sent_to text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error_message text,
  UNIQUE (invoice_id, days_after_due, channel)
);

CREATE INDEX IF NOT EXISTS reminder_log_org_idx ON public.reminder_log (org_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS reminder_log_invoice_idx ON public.reminder_log (invoice_id);

ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_log_org_read ON public.reminder_log;
CREATE POLICY reminder_log_org_read ON public.reminder_log
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

-- service_role bypasses RLS; only reads are exposed to org members.

COMMENT ON TABLE public.reminder_settings IS 'Org-level configuration for automated payment reminders.';
COMMENT ON TABLE public.reminder_log IS 'Audit trail + dedupe log of payment reminders sent (UNIQUE on invoice_id+days_after_due+channel).';

NOTIFY pgrst, 'reload schema';
