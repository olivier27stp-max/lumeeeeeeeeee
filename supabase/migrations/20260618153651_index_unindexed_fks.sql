-- Index sur 17 FK non indexées (idempotent). Appliqué en prod le 2026-06-18.
CREATE INDEX IF NOT EXISTS idx_bookings_job_id ON public.bookings (job_id);
CREATE INDEX IF NOT EXISTS idx_bookings_lead_id ON public.bookings (lead_id);
CREATE INDEX IF NOT EXISTS idx_commission_settings_default_rule_id ON public.commission_settings (default_rule_id);
CREATE INDEX IF NOT EXISTS idx_demo_requests_converted_user_id ON public.demo_requests (converted_user_id);
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_client_id ON public.email_campaign_recipients (client_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_by ON public.email_campaigns (created_by);
CREATE INDEX IF NOT EXISTS idx_form_submissions_client_id ON public.form_submissions (client_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_deal_id ON public.form_submissions (deal_id);
CREATE INDEX IF NOT EXISTS idx_job_checklists_completed_by ON public.job_checklists (completed_by);
CREATE INDEX IF NOT EXISTS idx_job_checklists_template_id ON public.job_checklists (template_id);
CREATE INDEX IF NOT EXISTS idx_job_materials_org_id ON public.job_materials (org_id);
CREATE INDEX IF NOT EXISTS idx_jobs_lead_id ON public.jobs (lead_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoice_schedules_last_inv ON public.recurring_invoice_schedules (last_invoice_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoice_schedules_tmpl_inv ON public.recurring_invoice_schedules (template_invoice_id);
CREATE INDEX IF NOT EXISTS idx_request_forms_created_by ON public.request_forms (created_by);
CREATE INDEX IF NOT EXISTS idx_subscriptions_scheduled_plan_id ON public.subscriptions (scheduled_plan_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_id ON public.webhook_deliveries (endpoint_id);
