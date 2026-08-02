/* ═══════════════════════════════════════════════════════════════
   Migration — Seed d'automatisations : version canonique + rattrapage.

   Constat prod (audit 2026-08-02) :
   - La fonction seed_automation_presets déployée en prod est la version
     du 20260331 (21 presets, 7 actifs, quote_followup_1d déclenché sur
     'estimate.sent' — événement jamais émis, bug corrigé au repo par
     20260401100000 mais absent de prod). Les orgs créées par le trigger
     trg_org_created_seed_automations héritent donc d'un seed périmé.
   - Les orgs créées entre ~avril et le 2026-07-17 (avant le trigger)
     n'ont AUCUNE règle d'automatisation (page Automatisations vide,
     aucun envoi) : Visionlavage, PostPay Co, etc.

   Cette migration :
   1. Répare les règles quote_followup_1d encore sur 'estimate.sent'.
   2. Redéfinit seed_automation_presets = union canonique des 34 presets
      (les 24 du 20260611 + les 10 avancés du 20260401200000), tous
      actifs par défaut (décision du 20260611), en ON CONFLICT DO NOTHING
      pour ne JAMAIS écraser les choix (is_active) ni les textes FR
      d'une org existante. google_review reprend la variante sans SMS
      anglais (request_review seul), le patch FR ne couvrant pas ce key.
   3. Re-seed toutes les orgs (comble les orgs sans règles et les presets
      manquants) puis applique le patch FR sur les nouvelles règles.
   ═══════════════════════════════════════════════════════════════ */

-- ── 1. Réparation : quote_followup_1d sur un événement jamais émis ──
UPDATE public.automation_rules
SET trigger_event = 'quote.sent',
    name = 'Quote Follow-Up — 1 Day After Sent',
    description = 'Follow up on a quote 1 day after sending it'
WHERE preset_key = 'quote_followup_1d'
  AND trigger_event = 'estimate.sent';

-- ── 1b. L'ON CONFLICT (org_id, preset_key) exige un index unique partiel.
-- Prod ayant un drift de migrations, on le crée s'il manque (sous l'un ou
-- l'autre des deux noms historiques). L'audit prod confirme zéro doublon.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'automation_rules'
      AND indexname IN ('idx_automation_rules_org_preset', 'automation_rules_org_preset_key')
  ) THEN
    CREATE UNIQUE INDEX idx_automation_rules_org_preset
      ON public.automation_rules (org_id, preset_key)
      WHERE preset_key IS NOT NULL;
  END IF;
END $$;

-- ── 2. Fonction canonique (34 presets, tous actifs, idempotente) ──
CREATE OR REPLACE FUNCTION public.seed_automation_presets(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  QUOTE FOLLOW-UPS (5)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 1 Day', 'Friendly follow-up 1 day after quote sent', 'quote.sent', '{}'::jsonb, 86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just following up on the quote we sent yesterday. Have you had a chance to review it? Let us know if you have any questions! — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Following up on your quote","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote yesterday and wanted to make sure you received it.</p><p>If you have any questions or would like to discuss the details, we''re happy to help.</p><p>Best regards,<br/>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_1d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 3 Days', 'Gentle reminder 3 days after quote sent', 'quote.sent', '{}'::jsonb, 259200,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we wanted to check in about the quote we sent a few days ago. — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Still interested in our quote?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote a few days ago and haven''t heard back yet.</p><p>We''re here if you have any questions.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_3d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 7 Days', 'Follow-up 7 days after quote sent', 'quote.sent', '{}'::jsonb, 604800,
    '[{"type":"send_email","config":{"subject":"[company_name] — Your quote is still available","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your quote is still available. Let us know if you''d like to move forward!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_7d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 14 Days', 'Last chance follow-up 14 days after quote sent', 'quote.sent', '{}'::jsonb, 1209600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Last follow-up on your quote","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We wanted to reach out one last time about the quote we sent two weeks ago.</p><p>If now isn''t the right time, no worries — we''re here whenever you''re ready.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_14d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Estimate Follow-Up (3 days)', 'Follow-up 3 days after estimate sent', 'estimate.sent', '{}'::jsonb, 259200,
    '[{"type":"send_email","config":{"subject":"[company_name] — Following up on your estimate","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you an estimate a few days ago and wanted to follow up.</p><p>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], just following up on the estimate we sent. Let us know if you have any questions! — [company_name]"}}]'::jsonb,
    true, true, 'estimate_followup')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  INVOICE REMINDERS (5)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES
    (p_org_id, 'Invoice Reminder — 1 Day', 'Reminder 1 day after invoice sent', 'invoice.sent', '{}'::jsonb, 86400,
     '[{"type":"send_email","config":{"subject":"[company_name] — Invoice [invoice_number] Reminder","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a friendly reminder about invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong>.</p><p>Thank you,<br/>[company_name]</p></div>"}}]'::jsonb,
     true, true, 'invoice_sent_reminder_1d'),
    (p_org_id, 'Invoice Reminder — 3 Days', 'Reminder 3 days after invoice sent', 'invoice.sent', '{}'::jsonb, 259200,
     '[{"type":"send_email","config":{"subject":"[company_name] — Invoice [invoice_number] Reminder","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Reminder about invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong>.</p><p>Thank you,<br/>[company_name]</p></div>"}}]'::jsonb,
     true, true, 'invoice_sent_reminder_3d'),
    (p_org_id, 'Invoice Reminder — 7 Days', 'Reminder 7 days after invoice sent', 'invoice.sent', '{}'::jsonb, 604800,
     '[{"type":"send_email","config":{"subject":"[company_name] — Invoice [invoice_number] Past Due","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is now 7 days past due.</p><p>Please arrange payment.</p><p>[company_name]</p></div>"}}]'::jsonb,
     true, true, 'invoice_sent_reminder_7d'),
    (p_org_id, 'Invoice Reminder — 30 Days', 'Final reminder 30 days after invoice sent', 'invoice.sent', '{}'::jsonb, 2592000,
     '[{"type":"send_email","config":{"subject":"[company_name] — Urgent: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is now 30 days past due.</p><p>Please arrange payment immediately.</p><p>[company_name]</p></div>"}},
       {"type":"create_notification","config":{"title":"Invoice [invoice_number] — 30 days overdue","body":"[client_name] has an invoice overdue for 30 days."}},
       {"type":"create_task","config":{"title":"Follow up: Invoice [invoice_number] — 30 days overdue"}}]'::jsonb,
     true, true, 'invoice_sent_reminder_30d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  LEADS (3)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Welcome New Lead', 'Send welcome message when a new lead is created', 'lead.created', '{}'::jsonb, 0,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thank you for reaching out to [company_name]! We''ll get back to you shortly."}},
      {"type":"create_notification","config":{"title":"New lead: [client_name]","body":"A new lead has been created."}}]'::jsonb,
    true, true, 'welcome_new_lead')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Stale Lead — 7 Days', 'Alert when a lead has no activity for 7 days', 'lead.status_changed', '{}'::jsonb, 604800,
    '[{"type":"create_notification","config":{"title":"Stale lead: [client_name]","body":"This lead has had no activity for 7 days."}},
      {"type":"create_task","config":{"title":"Follow up with stale lead: [client_name]"}}]'::jsonb,
    true, true, 'stale_lead_7d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lost Lead Re-engagement', 'Re-engage leads marked as lost after 30 days', 'lead.status_changed', '{"new_status":"lost"}'::jsonb, 2592000,
    '[{"type":"send_email","config":{"subject":"[company_name] — We''d love to help","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been a while since we last connected. If your needs have changed, we''d love to help.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'lost_lead_reengagement')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  JOBS & SCHEDULING (4)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 7 Days Before', 'Reminder 7 days before appointment', 'appointment.created', '{}'::jsonb, -604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just a reminder that your appointment with [company_name] is in 7 days on [appointment_date]. See you soon!"}}]'::jsonb,
    true, true, 'job_reminder_7d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 1 Day Before', 'Reminder 1 day before appointment', 'appointment.created', '{}'::jsonb, -86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], your appointment with [company_name] is tomorrow! See you at [appointment_time]. — [company_name]"}}]'::jsonb,
    true, true, 'job_reminder_1d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Appointment Confirmation', 'Confirm appointment immediately', 'appointment.created', '{}'::jsonb, 0,
    '[{"type":"send_email","config":{"subject":"[company_name] — Appointment Confirmed","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your appointment is confirmed for [appointment_date] at [appointment_time].</p><p>See you soon!<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you there!"}}]'::jsonb,
    true, true, 'appointment_confirmation')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'No-Show Follow-Up', 'Follow up when appointment is cancelled or no-show', 'appointment.cancelled', '{}'::jsonb, 3600,
    '[{"type":"send_email","config":{"subject":"[company_name] — We missed you!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We noticed your appointment was cancelled. We''d love to reschedule at your convenience.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'no_show_followup')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  PAYMENTS (2)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Payment Confirmation', 'Confirm payment received', 'invoice.paid', '{}'::jsonb, 0,
    '[{"type":"send_email","config":{"subject":"[company_name] — Payment Received","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''ve received your payment. Thank you!</p><p>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Payment received! Thank you, [client_first_name]. — [company_name]"}}]'::jsonb,
    true, true, 'payment_confirmation')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Deposit Received', 'Notify when deposit is received', 'invoice.paid', '{}'::jsonb, 0,
    '[{"type":"create_notification","config":{"title":"Deposit received from [client_name]","body":"Deposit payment has been received."}}]'::jsonb,
    true, true, 'deposit_received')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  FOLLOW-UP (3)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Thank You After Job', 'Send thank you message after job completion', 'job.completed', '{}'::jsonb, 7200,
    '[{"type":"send_sms","config":{"body":"Thank you for choosing [company_name], [client_first_name]! We hope you''re happy with the work. Don''t hesitate to reach out if you need anything!"}},
      {"type":"send_email","config":{"subject":"[company_name] — Thank you!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Thank you, [client_first_name]!</h2><p>We hope you''re satisfied with the work. Don''t hesitate to reach out anytime.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'thank_you_after_job')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Cross-Sell — 30 Days', 'Cross-sell offer 30 days after job', 'job.completed', '{}'::jsonb, 2592000,
    '[{"type":"send_email","config":{"subject":"[company_name] — A special offer for you","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been about a month since we worked together. Did you know we also offer other services?</p><p>Feel free to reach out!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'cross_sell_30d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Post-Appointment Survey', 'Send satisfaction survey after service', 'job.completed', '{}'::jsonb, 86400,
    '[{"type":"send_email","config":{"subject":"[company_name] — How was your experience?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''d love to hear your feedback about our recent service. Your opinion helps us improve!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'post_appointment_survey')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  CLIENT ENGAGEMENT (2)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Client Anniversary', 'Send anniversary message on client creation date', 'lead.created', '{}'::jsonb, 31536000,
    '[{"type":"send_email","config":{"subject":"[company_name] — Happy Anniversary!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Happy Anniversary, [client_first_name]!</h2><p>It''s been a year since we started working together. Thank you for your trust!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'client_anniversary')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Seasonal Reminder — 6 Months', 'Seasonal check-in 6 months after last service', 'job.completed', '{}'::jsonb, 15552000,
    '[{"type":"send_email","config":{"subject":"[company_name] — Time for a check-up?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been about 6 months since your last service with us. Time for a seasonal check-up?</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'seasonal_reminder_6m')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  PRESETS AVANCÉS (10) — réintégrés du 20260401200000
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 21 Days (Final)', 'Final follow-up before closing the file', 'quote.sent', '{}'::jsonb, 1814400,
    '[{"type":"send_email","config":{"subject":"[company_name] — Closing your quote file","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''ve followed up several times about your quote and understand you may have gone in a different direction.</p><p>We''ll be closing this file shortly. If you''d like to revisit the project in the future, don''t hesitate to reach out — we''d be happy to help.</p><p>All the best,<br/>[company_name]</p></div>"}},
      {"type":"create_notification","config":{"title":"Quote closed — no response after 21 days","body":"[client_name] never responded. File being closed."}},
      {"type":"log_activity","config":{"event_type":"follow_up_final","metadata":{"type":"quote_followup_21d"}}}]'::jsonb,
    true, true, 'quote_followup_21d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Invoice Reminder — 14 Days', 'Urgent reminder — creates follow-up task', 'invoice.sent', '{}'::jsonb, 1209600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Urgent: Invoice [invoice_number] Past Due","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is now 14 days past due.</p><p>We kindly ask that you arrange payment as soon as possible. If there is an issue, please contact us so we can find a solution.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], invoice [invoice_number] is 14 days overdue. Please arrange payment or contact us. — [company_name]"}},
      {"type":"create_task","config":{"title":"Follow up: Invoice [invoice_number] — 14 days overdue","description":"Client [client_name] has not paid invoice [invoice_number] after 14 days. Call them directly."}},
      {"type":"create_notification","config":{"title":"Invoice [invoice_number] — 14 days overdue","body":"[client_name] invoice overdue 14 days. Task created for follow-up."}},
      {"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":14}}}]'::jsonb,
    true, true, 'invoice_sent_reminder_14d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Follow-Up — 1 Day', 'Check-in 1 day after lead created', 'lead.created', '{}'::jsonb, 86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], this is [company_name]. We got your request and wanted to confirm — we''ll be in touch soon with next steps!"}},
      {"type":"log_activity","config":{"event_type":"lead_followup","metadata":{"type":"lead_followup_1d"}}}]'::jsonb,
    true, true, 'lead_followup_1d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Follow-Up — 3 Days', 'Service presentation email 3 days after lead created', 'lead.created', '{}'::jsonb, 259200,
    '[{"type":"send_email","config":{"subject":"[company_name] — Here''s what we can do for you","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Thanks again for your interest in [company_name].</p><p>We specialize in delivering top-quality service, and we''d love to help you with your project.</p><p>Ready to move forward? Just reply to this email or give us a call at [company_phone].</p><p>Best,<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"lead_followup","metadata":{"type":"lead_followup_3d"}}}]'::jsonb,
    true, true, 'lead_followup_3d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Final Follow-Up — 14 Days', 'Last attempt + task to rep', 'lead.created', '{}'::jsonb, 1209600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Still interested?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We reached out a couple of times and haven''t heard back.</p><p>If you''re still interested, we''d love to help. If not, no worries at all — feel free to reach out anytime in the future.</p><p>Best,<br/>[company_name]</p></div>"}},
      {"type":"create_task","config":{"title":"Lead going cold: [client_name]","description":"Lead [client_name] has not responded in 14 days. Make a final call or close the lead."}},
      {"type":"create_notification","config":{"title":"Lead cold — 14 days","body":"[client_name] is going cold. Task assigned."}},
      {"type":"log_activity","config":{"event_type":"lead_followup_final","metadata":{"type":"lead_followup_14d"}}}]'::jsonb,
    true, true, 'lead_followup_14d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 2 Hours Before', 'SMS reminder 2 hours before appointment', 'appointment.created', '{}'::jsonb, -7200,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just a heads up — we''ll be there in about 2 hours for your [appointment_time] appointment. See you soon! — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"reminder_sent","metadata":{"type":"job_reminder_2h"}}}]'::jsonb,
    true, true, 'job_reminder_2h')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Review Request — After Job', 'Send review request email 2 hours after job completion', 'job.completed', '{}'::jsonb, 7200,
    '[{"type":"request_review","config":{}},
      {"type":"log_activity","config":{"event_type":"review_requested"}}]'::jsonb,
    true, true, 'google_review')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Review Reminder — 7 Days', 'Reminder SMS if client has not left a review after 7 days', 'job.completed', '{}'::jsonb, 604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we hope you''re enjoying the results! If you have a moment, we''d really appreciate a quick review: [google_review_url] — Thank you! [company_name]"}},
      {"type":"log_activity","config":{"event_type":"review_reminder_sent"}}]'::jsonb,
    true, true, 'review_reminder_7d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Deposit Reminder — Quote Approved', 'Remind client about required deposit after quote approval', 'quote.approved', '{}'::jsonb, 3600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Deposit Required to Get Started","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Great news — your quote has been approved!</p><p>To get started, a deposit is required. Please complete your payment at your earliest convenience so we can schedule your appointment.</p><p>If you have any questions, we''re here to help.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], your quote is approved! A deposit is required to proceed. Please check your email for details. — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"deposit_reminder_sent"}}]'::jsonb,
    true, true, 'deposit_reminder')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Deposit Follow-Up — 2 Days', 'Follow up if deposit not paid 2 days after quote approved', 'quote.approved', '{}'::jsonb, 172800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just a reminder that a deposit is needed to schedule your appointment. Let us know if you need help! — [company_name]"}},
      {"type":"create_notification","config":{"title":"Deposit pending — [client_name]","body":"Client [client_name] approved quote but deposit not yet received (2 days)."}},
      {"type":"log_activity","config":{"event_type":"deposit_followup_sent"}}]'::jsonb,
    true, true, 'deposit_followup_2d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Re-Engagement — 90 Days', 'Check in with client 90 days after last job', 'job.completed', '{}'::jsonb, 7776000,
    '[{"type":"send_email","config":{"subject":"[company_name] — It''s been a while!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been a few months since we last worked together, and we wanted to say hi!</p><p>If you need anything — maintenance, a new project, or just advice — we''re always here for you.</p><p>Hope to hear from you soon!<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], it''s been a while! Just checking in to see if you need anything. We''re here if you do! — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"reengagement_sent","metadata":{"days":90}}}]'::jsonb,
    true, true, 'reengagement_90d')
  ON CONFLICT (org_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_automation_presets(uuid) FROM anon, authenticated, public;

-- ── 3. Rattrapage : re-seed de toutes les orgs + patch FR ──
DO $$
DECLARE
  v_org record;
BEGIN
  FOR v_org IN SELECT id FROM public.orgs LOOP
    PERFORM public.seed_automation_presets(v_org.id);
    PERFORM public.apply_automation_presets_fr(v_org.id);
  END LOOP;
END $$;
