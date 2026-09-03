-- 52 FK org_id manquantes : CASCADE (opérationnel) / RESTRICT (financier) / SET NULL (invoice_templates).
-- Idempotent (skip si une FK org_id existe déjà). Appliqué prod 2026-06-18.
DO $$
DECLARE
  t text;
  fin text[] := ARRAY[
    'invoices','invoice_items','invoice_send_events','payments','payment_requests',
    'payment_requirements','payment_providers','subscriptions','billing_profiles',
    'billing_receipt_log','processed_checkout_sessions','provisioning_events',
    'org_invoice_sequences','org_billing_settings','connected_accounts'
  ];
  all_tbls text[] := ARRAY[
    'a2p_registrations','agent_messages','alert_rules','approvals','audit_events',
    'billing_profiles','billing_receipt_log','connected_accounts','contacts','courses',
    'decision_logs','field_pin_entity_links','field_rep_performance','field_schedule_slots',
    'field_territory_assignments','goals','invoice_items','invoice_send_events',
    'invoice_templates','invoices','job_intents','job_line_items','job_time_logs',
    'location_tracking_settings','memberships','notifications','org_billing_settings',
    'org_features','org_invoice_sequences','org_job_counters','payment_providers',
    'payment_requests','payment_requirements','payments','payroll_settings',
    'processed_checkout_sessions','properties','provisioning_events','quote_measurements',
    'quotes','scenario_options','scenario_runs','scheduled_reports','sms_opt_outs',
    'subscriptions','tags','team_availability','team_capabilities','teams',
    'tracking_events','tracking_live_locations','tracking_points'
  ];
  rule text;
BEGIN
  FOREACH t IN ARRAY all_tbls LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.contype='f' AND c.conrelid=('public.'||t)::regclass AND a.attname='org_id'
    ) THEN CONTINUE; END IF;

    IF t = 'invoice_templates' THEN rule := 'SET NULL';
    ELSIF t = ANY(fin) THEN rule := 'RESTRICT';
    ELSE rule := 'CASCADE';
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE %s',
      t, t||'_org_id_fkey', rule
    );
  END LOOP;
END $$;

-- Index sur les 24 FK org_id ajoutées (toutes les requêtes filtrent par org_id)
CREATE INDEX IF NOT EXISTS idx_agent_messages_org_id ON public.agent_messages (org_id);
CREATE INDEX IF NOT EXISTS idx_approvals_org_id ON public.approvals (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_id ON public.audit_events (org_id);
CREATE INDEX IF NOT EXISTS idx_billing_receipt_log_org_id ON public.billing_receipt_log (org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org_id ON public.contacts (org_id);
CREATE INDEX IF NOT EXISTS idx_field_schedule_slots_org_id ON public.field_schedule_slots (org_id);
CREATE INDEX IF NOT EXISTS idx_goals_org_id ON public.goals (org_id);
CREATE INDEX IF NOT EXISTS idx_invoice_send_events_org_id ON public.invoice_send_events (org_id);
CREATE INDEX IF NOT EXISTS idx_invoice_templates_org_id ON public.invoice_templates (org_id);
CREATE INDEX IF NOT EXISTS idx_job_intents_org_id ON public.job_intents (org_id);
CREATE INDEX IF NOT EXISTS idx_job_line_items_org_id ON public.job_line_items (org_id);
CREATE INDEX IF NOT EXISTS idx_job_time_logs_org_id ON public.job_time_logs (org_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_org_id ON public.payment_requests (org_id);
CREATE INDEX IF NOT EXISTS idx_payment_requirements_org_id ON public.payment_requirements (org_id);
CREATE INDEX IF NOT EXISTS idx_processed_checkout_sessions_org_id ON public.processed_checkout_sessions (org_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_events_org_id ON public.provisioning_events (org_id);
CREATE INDEX IF NOT EXISTS idx_quote_measurements_org_id ON public.quote_measurements (org_id);
CREATE INDEX IF NOT EXISTS idx_scenario_options_org_id ON public.scenario_options (org_id);
CREATE INDEX IF NOT EXISTS idx_scenario_runs_org_id ON public.scenario_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_org_id ON public.scheduled_reports (org_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_id ON public.subscriptions (org_id);
CREATE INDEX IF NOT EXISTS idx_team_availability_org_id ON public.team_availability (org_id);
CREATE INDEX IF NOT EXISTS idx_team_capabilities_org_id ON public.team_capabilities (org_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_org_id ON public.tracking_events (org_id);
