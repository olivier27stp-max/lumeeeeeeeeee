-- Index sur les FK org_id + REVOKE EXECUTE sur le trigger snapshot. Idempotent. Prod 2026-06-18.
-- (Recoupe volontairement 20260618153814 ; tout est IF NOT EXISTS -> no-op si déjà fait.)
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_invoice_client_snapshot' AND pronamespace='public'::regnamespace) THEN
    REVOKE EXECUTE ON FUNCTION public.set_invoice_client_snapshot() FROM anon, authenticated, public;
  END IF;
END $$;
