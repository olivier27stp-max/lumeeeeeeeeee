-- ORDER_HINT: 2/2 — timestamp collision with 20260401100000_fix_job_completed_trigger.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

/* ═══════════════════════════════════════════════════════════════
   Migration — Fix quote_followup_1d trigger event.

   The preset was seeded with trigger_event = 'estimate.sent'
   but the event actually emitted by the system is 'quote.sent'.
   This caused quote follow-ups to NEVER trigger.

   Also adds missing preset rules for additional workflows.
   ═══════════════════════════════════════════════════════════════ */

-- Fix the quote follow-up trigger from estimate.sent → quote.sent
UPDATE public.automation_rules
SET trigger_event = 'quote.sent',
    name = 'Quote Follow-Up — 1 Day After Sent',
    description = 'Follow up on a quote 1 day after sending it'
WHERE preset_key = 'quote_followup_1d'
  AND trigger_event = 'estimate.sent';

-- Also update the seed function so new orgs get the correct trigger
CREATE OR REPLACE FUNCTION public.seed_automation_presets(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN

  -- 1. JOB REMINDER — 1 WEEK BEFORE
  INSERT INTO public.automation_rules (
    org_id, name, description, trigger_event, conditions,
    delay_seconds, actions, is_active, is_preset, preset_key
  ) VALUES (
    p_org_id,
    'Job Reminder — 1 Week Before',
    'Send SMS + email reminder 1 week before a scheduled job',
    'appointment.created', '{}'::jsonb, -604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], this is a reminder that your appointment is scheduled for [appointment_date]. Reply if you have any questions. — [company_name]"}},{"type":"send_email","config":{"subject":"[company_name] — Appointment Reminder","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>This is a reminder that your appointment is scheduled for <strong>[appointment_date]</strong> at <strong>[appointment_time]</strong>.</p><p>See you soon!<br/>[company_name]</p></div>"}},{"type":"log_activity","config":{"event_type":"reminder_sent","metadata":{"type":"job_reminder_7d"}}}]'::jsonb,
    true, true, 'job_reminder_7d'
  ) ON CONFLICT DO NOTHING;

  -- 2. JOB REMINDER — 1 DAY BEFORE
  INSERT INTO public.automation_rules (
    org_id, name, description, trigger_event, conditions,
    delay_seconds, actions, is_active, is_preset, preset_key
  ) VALUES (
    p_org_id,
    'Job Reminder — 1 Day Before',
    'Send SMS + email reminder 1 day before a scheduled job',
    'appointment.created', '{}'::jsonb, -86400,
    '[{"type":"send_sms","config":{"body":"Reminder: your appointment is scheduled for tomorrow, [appointment_date]. Please reply if you need anything. — [company_name]"}},{"type":"send_email","config":{"subject":"[company_name] — Your appointment is tomorrow","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a reminder that your appointment is <strong>tomorrow</strong>, [appointment_date] at [appointment_time].</p><p>See you then!<br/>[company_name]</p></div>"}},{"type":"log_activity","config":{"event_type":"reminder_sent","metadata":{"type":"job_reminder_1d"}}}]'::jsonb,
    true, true, 'job_reminder_1d'
  ) ON CONFLICT DO NOTHING;

  -- 3. QUOTE FOLLOW-UP — 1 DAY (FIXED: trigger = quote.sent, NOT estimate.sent)
  INSERT INTO public.automation_rules (
    org_id, name, description, trigger_event, conditions,
    delay_seconds, actions, is_active, is_preset, preset_key
  ) VALUES (
    p_org_id,
    'Quote Follow-Up — 1 Day After Sent',
    'Follow up on a quote 1 day after sending it',
    'quote.sent', '{}'::jsonb, 86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just following up on the quote we sent yesterday. Let us know if you have any questions! — [company_name]"}},{"type":"send_email","config":{"subject":"[company_name] — Following up on your quote","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote recently and wanted to follow up.</p><p>If you have any questions or would like to proceed, please don''t hesitate to reach out.</p><p>Best regards,<br/>[company_name]</p></div>"}},{"type":"log_activity","config":{"event_type":"follow_up_sent","metadata":{"type":"quote_followup_1d"}}}]'::jsonb,
    true, true, 'quote_followup_1d'
  ) ON CONFLICT DO NOTHING;

  -- 4-7. INVOICE REMINDERS (1d, 3d, 7d, 30d)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES
    (p_org_id, 'Invoice Reminder — 1 Day After Sent', 'Gentle reminder 1 day after invoice is sent', 'invoice.sent', '{}'::jsonb, 86400,
     '[{"type":"send_email","config":{"subject":"[company_name] — Payment Reminder: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a friendly reminder that invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is awaiting payment.</p><p>Thank you,<br/>[company_name]</p></div>"}},{"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":1}}}]'::jsonb,
     true, true, 'invoice_sent_reminder_1d'),
    (p_org_id, 'Invoice Reminder — 3 Days After Sent', 'Follow-up reminder 3 days after invoice is sent', 'invoice.sent', '{}'::jsonb, 259200,
     '[{"type":"send_email","config":{"subject":"[company_name] — Payment Reminder: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Reminder that invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> remains unpaid.</p><p>Thank you,<br/>[company_name]</p></div>"}},{"type":"send_sms","config":{"body":"Hi [client_first_name], reminder that invoice [invoice_number] for [invoice_total] is awaiting payment. — [company_name]"}},{"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":3}}}]'::jsonb,
     true, true, 'invoice_sent_reminder_3d'),
    (p_org_id, 'Invoice Reminder — 7 Days After Sent', 'Stronger reminder 7 days after invoice is sent', 'invoice.sent', '{}'::jsonb, 604800,
     '[{"type":"send_email","config":{"subject":"[company_name] — Invoice [invoice_number] Still Unpaid","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> was sent 7 days ago and remains unpaid.</p><p>Thank you,<br/>[company_name]</p></div>"}},{"type":"send_sms","config":{"body":"Hi [client_first_name], invoice [invoice_number] for [invoice_total] is now 7 days unpaid. — [company_name]"}},{"type":"create_notification","config":{"title":"Invoice [invoice_number] — 7 days unpaid","body":"[client_name] has not paid invoice [invoice_number] after 7 days."}},{"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":7}}}]'::jsonb,
     true, true, 'invoice_sent_reminder_7d'),
    (p_org_id, 'Invoice Final Reminder — 30 Days After Sent', 'Final reminder 30 days after invoice is sent', 'invoice.sent', '{}'::jsonb, 2592000,
     '[{"type":"send_email","config":{"subject":"[company_name] — Final Reminder: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is still outstanding after 30 days.</p><p>Please review and arrange payment as soon as possible.</p><p>Thank you,<br/>[company_name]</p></div>"}},{"type":"send_sms","config":{"body":"Hi [client_first_name], invoice [invoice_number] is still outstanding after 30 days. Please review it. — [company_name]"}},{"type":"create_notification","config":{"title":"Invoice [invoice_number] — 30 days outstanding","body":"[client_name] has an invoice outstanding for 30 days."}},{"type":"create_task","config":{"title":"Follow up: Invoice [invoice_number] — 30 days outstanding","description":"Client [client_name] has not paid after 30 days."}},{"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":30,"final_reminder":true}}}]'::jsonb,
     true, true, 'invoice_sent_reminder_30d')
  ON CONFLICT DO NOTHING;

  -- Additional presets
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES
    (p_org_id, 'Thank You After Job', 'Send thank-you SMS after job completion', 'job.completed', '{}'::jsonb, 0,
     '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thank you for choosing [company_name]! We hope you''re satisfied with the work. — [company_name]"}},{"type":"log_activity","config":{"event_type":"thank_you_sent"}}]'::jsonb, false, true, 'thank_you_after_job'),
    (p_org_id, 'Welcome New Lead', 'Send welcome SMS when a new lead is created', 'lead.created', '{}'::jsonb, 0,
     '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thanks for reaching out to [company_name]! We''ll get back to you shortly. — [company_name]"}},{"type":"create_notification","config":{"title":"New Lead","body":"New lead: [client_name]"}},{"type":"log_activity","config":{"event_type":"welcome_sent"}}]'::jsonb, false, true, 'welcome_new_lead'),
    (p_org_id, 'Stale Lead Follow-Up (7 days)', 'Alert if lead has no activity after 7 days', 'lead.created', '{}'::jsonb, 604800,
     '[{"type":"create_notification","config":{"title":"Stale Lead Alert","body":"Lead [client_name] has had no activity for 7 days."}},{"type":"create_task","config":{"title":"Follow up with lead: [client_name]","description":"No activity for 7 days. Reach out to maintain engagement."}},{"type":"log_activity","config":{"event_type":"stale_lead_alert"}}]'::jsonb, false, true, 'stale_lead_7d'),
    (p_org_id, 'Payment Confirmation', 'Notify when payment is received', 'invoice.paid', '{}'::jsonb, 0,
     '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we received your payment for invoice [invoice_number]. Thank you! — [company_name]"}},{"type":"create_notification","config":{"title":"Payment Received","body":"Payment received for invoice [invoice_number] from [client_name]."}},{"type":"log_activity","config":{"event_type":"payment_confirmed"}}]'::jsonb, false, true, 'payment_confirmation'),
    (p_org_id, 'No-Show Follow-Up', 'Follow up when appointment is cancelled', 'appointment.cancelled', '{}'::jsonb, 3600,
     '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we noticed your appointment was cancelled. Would you like to reschedule? — [company_name]"}},{"type":"log_activity","config":{"event_type":"no_show_followup"}}]'::jsonb, false, true, 'no_show_followup'),
    (p_org_id, 'Post-Appointment Survey', 'Send survey after job completion', 'job.completed', '{}'::jsonb, 7200,
     '[{"type":"request_review","config":{}},{"type":"log_activity","config":{"event_type":"survey_sent"}}]'::jsonb, false, true, 'post_appointment_survey'),
    (p_org_id, 'Google Review Request', 'Send review request after job completion', 'job.completed', '{}'::jsonb, 7200,
     '[{"type":"request_review","config":{}}]'::jsonb, false, true, 'google_review'),
    (p_org_id, 'Appointment Confirmation', 'Confirm appointment immediately', 'appointment.created', '{}'::jsonb, 0,
     '[{"type":"send_sms","config":{"body":"Your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you there!"}},{"type":"send_email","config":{"subject":"[company_name] - Appointment Confirmed","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your appointment is confirmed:</p><ul><li><strong>Date:</strong> [appointment_date]</li><li><strong>Time:</strong> [appointment_time]</li><li><strong>Location:</strong> [appointment_address]</li></ul><p>See you soon!<br/>[company_name]</p></div>"}}]'::jsonb, false, true, 'appointment_confirmation')
  ON CONFLICT DO NOTHING;

  RETURN v_count;
END;
$$;
