-- ORDER_HINT: 1/2 — timestamp collision with 20260401200000_backend_audit_fixes.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

/* ═══════════════════════════════════════════════════════════════
   Migration — Advanced Automation Presets (28 workflows)

   Complete automation system:
   - 5 quote follow-ups (J+1, J+3, J+7, J+14, J+21)
   - 5 invoice reminders (J+1, J+3, J+7, J+14, J+30)
   - 5 lead nurturing (immediate, J+1, J+3, J+7, J+14)
   - 5 job/appointment (confirm, -7d, -1d, -2h, thank you)
   - 2 review requests (2h, 7d)
   - 3 payment (confirmation, deposit reminder, deposit followup)
   - 3 re-engagement (30d, 90d cross-sell, 365d anniversary)
   ═══════════════════════════════════════════════════════════════ */

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

  -- Quote Follow-Up J+1
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 1 Day', 'Friendly follow-up 1 day after quote sent', 'quote.sent', '{}'::jsonb, 86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just following up on the quote we sent yesterday. Have you had a chance to review it? Let us know if you have any questions! — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Following up on your quote","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote yesterday and wanted to make sure you received it.</p><p>If you have any questions or would like to discuss the details, we''re happy to help.</p><p>Best regards,<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"follow_up_sent","metadata":{"type":"quote_followup_1d"}}}]'::jsonb,
    true, true, 'quote_followup_1d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

  -- Quote Follow-Up J+3
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 3 Days', 'Gentle reminder 3 days after quote sent', 'quote.sent', '{}'::jsonb, 259200,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we wanted to check in about the quote we sent a few days ago. We''re available if you''d like to discuss anything. — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Still interested in our quote?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote a few days ago and haven''t heard back yet.</p><p>We understand you may be busy — just wanted to let you know we''re here if you have any questions or concerns about the estimate.</p><p>Looking forward to hearing from you!<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"follow_up_sent","metadata":{"type":"quote_followup_3d"}}}]'::jsonb,
    false, true, 'quote_followup_3d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Quote Follow-Up J+7
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 7 Days', 'Direct follow-up 1 week after quote sent — alerts team', 'quote.sent', '{}'::jsonb, 604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], it''s been a week since we sent your quote. We don''t want you to miss out — the quote may expire soon. Let us know! — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Your quote is expiring soon","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been a week since we sent your quote, and we wanted to give you a heads up that it will expire soon.</p><p>If you''re still interested, now is a great time to move forward. We''re happy to answer any remaining questions.</p><p>Best,<br/>[company_name]</p></div>"}},
      {"type":"create_notification","config":{"title":"Quote not responded — 7 days","body":"[client_name] has not responded to their quote after 7 days."}},
      {"type":"log_activity","config":{"event_type":"follow_up_sent","metadata":{"type":"quote_followup_7d"}}}]'::jsonb,
    false, true, 'quote_followup_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Quote Follow-Up J+14
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 14 Days', 'Urgent follow-up — assigns task to manager', 'quote.sent', '{}'::jsonb, 1209600,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just one more check-in about your quote. If the price or scope needs adjusting, we''re flexible. Let''s make it work! — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Last chance to review your quote","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''ve reached out a couple of times about your quote and haven''t heard back.</p><p>If the pricing or scope doesn''t fit, we''re happy to adjust. We''d love the opportunity to work with you.</p><p>Please let us know either way so we can update our records.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"create_task","config":{"title":"Urgent: Quote follow-up — [client_name]","description":"Client [client_name] has not responded to their quote in 14 days. Call them directly or adjust the offer."}},
      {"type":"create_notification","config":{"title":"Quote stale — 14 days","body":"[client_name] quote is 14 days old with no response. Task created."}},
      {"type":"log_activity","config":{"event_type":"follow_up_sent","metadata":{"type":"quote_followup_14d"}}}]'::jsonb,
    false, true, 'quote_followup_14d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Quote Follow-Up J+21 (Final)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 21 Days (Final)', 'Final follow-up before closing the file', 'quote.sent', '{}'::jsonb, 1814400,
    '[{"type":"send_email","config":{"subject":"[company_name] — Closing your quote file","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''ve followed up several times about your quote and understand you may have gone in a different direction.</p><p>We''ll be closing this file shortly. If you''d like to revisit the project in the future, don''t hesitate to reach out — we''d be happy to help.</p><p>All the best,<br/>[company_name]</p></div>"}},
      {"type":"create_notification","config":{"title":"Quote closed — no response after 21 days","body":"[client_name] never responded. File being closed."}},
      {"type":"log_activity","config":{"event_type":"follow_up_final","metadata":{"type":"quote_followup_21d"}}}]'::jsonb,
    false, true, 'quote_followup_21d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  INVOICE REMINDERS (5)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -- Invoice J+1
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Invoice Reminder — 1 Day', 'Friendly payment reminder 1 day after invoice sent', 'invoice.sent', '{}'::jsonb, 86400,
    '[{"type":"send_email","config":{"subject":"[company_name] — Payment Reminder: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a friendly reminder that invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is awaiting payment.</p><p>If you''ve already sent payment, please disregard this message.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":1}}}]'::jsonb,
    true, true, 'invoice_sent_reminder_1d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Invoice J+3
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Invoice Reminder — 3 Days', 'Follow-up reminder 3 days after invoice sent', 'invoice.sent', '{}'::jsonb, 259200,
    '[{"type":"send_email","config":{"subject":"[company_name] — Payment Reminder: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>This is a reminder that invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> remains unpaid.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], reminder that invoice [invoice_number] for [invoice_total] is awaiting payment. — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":3}}}]'::jsonb,
    true, true, 'invoice_sent_reminder_3d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Invoice J+7
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Invoice Reminder — 7 Days', 'Firmer reminder 7 days after invoice sent — alerts team', 'invoice.sent', '{}'::jsonb, 604800,
    '[{"type":"send_email","config":{"subject":"[company_name] — Invoice [invoice_number] Still Unpaid","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> was sent 7 days ago and remains unpaid.</p><p>Please arrange payment as soon as possible. If you have questions, contact us.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], invoice [invoice_number] for [invoice_total] is now 7 days unpaid. Please arrange payment. — [company_name]"}},
      {"type":"create_notification","config":{"title":"Invoice [invoice_number] — 7 days unpaid","body":"[client_name] has not paid invoice [invoice_number] after 7 days."}},
      {"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":7}}}]'::jsonb,
    true, true, 'invoice_sent_reminder_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Invoice J+14
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Invoice Reminder — 14 Days', 'Urgent reminder — creates follow-up task', 'invoice.sent', '{}'::jsonb, 1209600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Urgent: Invoice [invoice_number] Past Due","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is now 14 days past due.</p><p>We kindly ask that you arrange payment as soon as possible. If there is an issue, please contact us so we can find a solution.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], invoice [invoice_number] is 14 days overdue. Please arrange payment or contact us. — [company_name]"}},
      {"type":"create_task","config":{"title":"Follow up: Invoice [invoice_number] — 14 days overdue","description":"Client [client_name] has not paid invoice [invoice_number] after 14 days. Call them directly."}},
      {"type":"create_notification","config":{"title":"Invoice [invoice_number] — 14 days overdue","body":"[client_name] invoice overdue 14 days. Task created for follow-up."}},
      {"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":14}}}]'::jsonb,
    false, true, 'invoice_sent_reminder_14d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Invoice J+30 (Final)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Invoice Final Reminder — 30 Days', 'Final notice — full escalation', 'invoice.sent', '{}'::jsonb, 2592000,
    '[{"type":"send_email","config":{"subject":"[company_name] — Final Notice: Invoice [invoice_number]","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> has been outstanding for 30 days.</p><p>Please arrange payment immediately. If there is a problem, contact us right away so we can resolve this.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"IMPORTANT: Invoice [invoice_number] for [invoice_total] is 30 days overdue. Please arrange payment immediately or contact us. — [company_name]"}},
      {"type":"create_notification","config":{"title":"URGENT: Invoice [invoice_number] — 30 days","body":"[client_name] has an invoice outstanding for 30 days. Immediate action required."}},
      {"type":"create_task","config":{"title":"URGENT: Invoice [invoice_number] — 30 days overdue","description":"Client [client_name] has not paid for 30 days. Escalate to management."}},
      {"type":"log_activity","config":{"event_type":"invoice_reminded","metadata":{"days_after_sent":30,"final_reminder":true}}}]'::jsonb,
    true, true, 'invoice_sent_reminder_30d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  LEAD NURTURING (5)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -- Welcome (immediate)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead — Welcome', 'Instant welcome SMS + team notification', 'lead.created', '{}'::jsonb, 0,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thanks for reaching out to [company_name]! We received your request and will get back to you shortly. — [company_name]"}},
      {"type":"create_notification","config":{"title":"New Lead","body":"New lead: [client_name] — [client_phone]"}},
      {"type":"log_activity","config":{"event_type":"welcome_sent"}}]'::jsonb,
    false, true, 'welcome_new_lead')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Lead J+1
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Follow-Up — 1 Day', 'Check-in 1 day after lead created', 'lead.created', '{}'::jsonb, 86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], this is [company_name]. We got your request and wanted to confirm — we''ll be in touch soon with next steps!"}},
      {"type":"log_activity","config":{"event_type":"lead_followup","metadata":{"type":"lead_followup_1d"}}}]'::jsonb,
    false, true, 'lead_followup_1d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Lead J+3
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Follow-Up — 3 Days', 'Service presentation email 3 days after lead created', 'lead.created', '{}'::jsonb, 259200,
    '[{"type":"send_email","config":{"subject":"[company_name] — Here''s what we can do for you","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Thanks again for your interest in [company_name].</p><p>We specialize in delivering top-quality service, and we''d love to help you with your project.</p><p>Ready to move forward? Just reply to this email or give us a call at [company_phone].</p><p>Best,<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"lead_followup","metadata":{"type":"lead_followup_3d"}}}]'::jsonb,
    false, true, 'lead_followup_3d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Stale Lead J+7
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Alert — 7 Days Stale', 'Alert team if lead has no activity after 7 days', 'lead.created', '{}'::jsonb, 604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we haven''t heard from you in a while. Still interested in getting a quote? We''re here to help! — [company_name]"}},
      {"type":"create_notification","config":{"title":"Stale Lead — 7 days","body":"Lead [client_name] has had no activity for 7 days. Follow up needed."}},
      {"type":"log_activity","config":{"event_type":"stale_lead_alert","metadata":{"days":7}}}]'::jsonb,
    false, true, 'stale_lead_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Lead J+14 (final)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lead Final Follow-Up — 14 Days', 'Last attempt + task to rep', 'lead.created', '{}'::jsonb, 1209600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Still interested?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We reached out a couple of times and haven''t heard back.</p><p>If you''re still interested, we''d love to help. If not, no worries at all — feel free to reach out anytime in the future.</p><p>Best,<br/>[company_name]</p></div>"}},
      {"type":"create_task","config":{"title":"Lead going cold: [client_name]","description":"Lead [client_name] has not responded in 14 days. Make a final call or close the lead."}},
      {"type":"create_notification","config":{"title":"Lead cold — 14 days","body":"[client_name] is going cold. Task assigned."}},
      {"type":"log_activity","config":{"event_type":"lead_followup_final","metadata":{"type":"lead_followup_14d"}}}]'::jsonb,
    false, true, 'lead_followup_14d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  JOB / APPOINTMENT (5)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -- Appointment Confirmation (immediate)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Appointment Confirmation', 'Instant confirmation SMS + email when job is scheduled', 'appointment.created', '{}'::jsonb, 0,
    '[{"type":"send_sms","config":{"body":"Your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you there!"}},
      {"type":"send_email","config":{"subject":"[company_name] — Appointment Confirmed","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your appointment is confirmed:</p><ul><li><strong>Date:</strong> [appointment_date]</li><li><strong>Time:</strong> [appointment_time]</li><li><strong>Location:</strong> [appointment_address]</li></ul><p>See you soon!<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"appointment_confirmed"}}]'::jsonb,
    false, true, 'appointment_confirmation')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Job Reminder -7 days
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 1 Week Before', 'SMS + email reminder 1 week before appointment', 'appointment.created', '{}'::jsonb, -604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], reminder: your appointment with [company_name] is in 1 week, on [appointment_date]. See you then!"}},
      {"type":"send_email","config":{"subject":"[company_name] — Appointment in 1 Week","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Just a reminder that your appointment is coming up on <strong>[appointment_date]</strong> at <strong>[appointment_time]</strong>.</p><p>If you need to reschedule, please let us know.</p><p>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"reminder_sent","metadata":{"type":"job_reminder_7d"}}}]'::jsonb,
    true, true, 'job_reminder_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Job Reminder -1 day
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 1 Day Before', 'SMS + email reminder the day before appointment', 'appointment.created', '{}'::jsonb, -86400,
    '[{"type":"send_sms","config":{"body":"Reminder: your appointment with [company_name] is tomorrow, [appointment_date] at [appointment_time]. See you then!"}},
      {"type":"send_email","config":{"subject":"[company_name] — Your Appointment is Tomorrow","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>This is a reminder that your appointment is <strong>tomorrow</strong>:</p><ul><li><strong>Date:</strong> [appointment_date]</li><li><strong>Time:</strong> [appointment_time]</li><li><strong>Location:</strong> [appointment_address]</li></ul><p>See you then!<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"reminder_sent","metadata":{"type":"job_reminder_1d"}}}]'::jsonb,
    true, true, 'job_reminder_1d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Job Reminder -2 hours
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 2 Hours Before', 'SMS reminder 2 hours before appointment', 'appointment.created', '{}'::jsonb, -7200,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just a heads up — we''ll be there in about 2 hours for your [appointment_time] appointment. See you soon! — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"reminder_sent","metadata":{"type":"job_reminder_2h"}}}]'::jsonb,
    false, true, 'job_reminder_2h')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Thank You After Job
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Thank You After Job', 'Send thank-you SMS 1 hour after job completion', 'job.completed', '{}'::jsonb, 3600,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thank you for choosing [company_name]! We hope you''re happy with the work. If you have any questions, don''t hesitate to reach out. Have a great day!"}},
      {"type":"log_activity","config":{"event_type":"thank_you_sent"}}]'::jsonb,
    false, true, 'thank_you_after_job')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  REVIEW REQUESTS (2)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -- Review Request +2h
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Review Request — After Job', 'Send review request email 2 hours after job completion', 'job.completed', '{}'::jsonb, 7200,
    '[{"type":"request_review","config":{}},
      {"type":"log_activity","config":{"event_type":"review_requested"}}]'::jsonb,
    false, true, 'google_review')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Review Reminder +7d
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Review Reminder — 7 Days', 'Reminder SMS if client has not left a review after 7 days', 'job.completed', '{}'::jsonb, 604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we hope you''re enjoying the results! If you have a moment, we''d really appreciate a quick review: [google_review_url] — Thank you! [company_name]"}},
      {"type":"log_activity","config":{"event_type":"review_reminder_sent"}}]'::jsonb,
    false, true, 'review_reminder_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  PAYMENT (3)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -- Payment Confirmation
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Payment Confirmation', 'Thank-you SMS + notification when payment received', 'invoice.paid', '{}'::jsonb, 0,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we''ve received your payment for invoice [invoice_number]. Thank you! — [company_name]"}},
      {"type":"create_notification","config":{"title":"Payment Received","body":"Payment received for invoice [invoice_number] from [client_name]."}},
      {"type":"log_activity","config":{"event_type":"payment_confirmed"}}]'::jsonb,
    false, true, 'payment_confirmation')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Deposit Required (when quote approved)
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Deposit Reminder — Quote Approved', 'Remind client about required deposit after quote approval', 'quote.approved', '{}'::jsonb, 3600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Deposit Required to Get Started","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Great news — your quote has been approved!</p><p>To get started, a deposit is required. Please complete your payment at your earliest convenience so we can schedule your appointment.</p><p>If you have any questions, we''re here to help.</p><p>Thank you,<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], your quote is approved! A deposit is required to proceed. Please check your email for details. — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"deposit_reminder_sent"}}]'::jsonb,
    false, true, 'deposit_reminder')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Deposit Follow-Up J+2
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Deposit Follow-Up — 2 Days', 'Follow up if deposit not paid 2 days after quote approved', 'quote.approved', '{}'::jsonb, 172800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just a reminder that a deposit is needed to schedule your appointment. Let us know if you need help! — [company_name]"}},
      {"type":"create_notification","config":{"title":"Deposit pending — [client_name]","body":"Client [client_name] approved quote but deposit not yet received (2 days)."}},
      {"type":"log_activity","config":{"event_type":"deposit_followup_sent"}}]'::jsonb,
    false, true, 'deposit_followup_2d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  RE-ENGAGEMENT (3)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -- Cross-Sell 30 days
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Cross-Sell — 30 Days After Job', 'Reach out 30 days after job to offer additional services', 'job.completed', '{}'::jsonb, 2592000,
    '[{"type":"send_email","config":{"subject":"[company_name] — Need anything else?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been about a month since we completed your project, and we wanted to check in.</p><p>Do you have any other projects in mind? We offer a range of services and would love to help again.</p><p>Feel free to reach out anytime!</p><p>Best,<br/>[company_name]</p></div>"}},
      {"type":"log_activity","config":{"event_type":"cross_sell_sent","metadata":{"days":30}}}]'::jsonb,
    false, true, 'cross_sell_30d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Re-Engagement 90 days
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Re-Engagement — 90 Days', 'Check in with client 90 days after last job', 'job.completed', '{}'::jsonb, 7776000,
    '[{"type":"send_email","config":{"subject":"[company_name] — It''s been a while!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been a few months since we last worked together, and we wanted to say hi!</p><p>If you need anything — maintenance, a new project, or just advice — we''re always here for you.</p><p>Hope to hear from you soon!<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], it''s been a while! Just checking in to see if you need anything. We''re here if you do! — [company_name]"}},
      {"type":"log_activity","config":{"event_type":"reengagement_sent","metadata":{"days":90}}}]'::jsonb,
    false, true, 'reengagement_90d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- No-Show Follow-Up
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'No-Show / Cancellation Follow-Up', 'Follow up 1 hour after appointment cancelled', 'appointment.cancelled', '{}'::jsonb, 3600,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we noticed your appointment was cancelled. Would you like to reschedule? We''re happy to find a time that works. — [company_name]"}},
      {"type":"create_notification","config":{"title":"Appointment Cancelled","body":"[client_name] cancelled their appointment. Follow up to reschedule."}},
      {"type":"log_activity","config":{"event_type":"no_show_followup"}}]'::jsonb,
    false, true, 'no_show_followup')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Lost Lead Re-engagement
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lost Lead — Re-engagement', 'Reach out when a lead is marked as lost', 'lead.status_changed', '{"new_status":"lost"}'::jsonb, 0,
    '[{"type":"send_email","config":{"subject":"[company_name] — We''re sorry to see you go","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We understand things don''t always work out, and that''s okay.</p><p>If anything changes in the future, or if you need help down the road, please don''t hesitate to reach out. We''d love to work with you.</p><p>Wishing you all the best,<br/>[company_name]</p></div>"}},
      {"type":"create_notification","config":{"title":"Lead Lost","body":"[client_name] marked as lost."}},
      {"type":"log_activity","config":{"event_type":"lost_lead_reengagement"}}]'::jsonb,
    false, true, 'lost_lead_reengagement')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  -- Post-Appointment Survey
  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Post-Job Survey', 'Send satisfaction survey 1 hour after job completion', 'job.completed', '{}'::jsonb, 3600,
    '[{"type":"request_review","config":{}},
      {"type":"log_activity","config":{"event_type":"survey_sent"}}]'::jsonb,
    false, true, 'post_appointment_survey')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET
    trigger_event = EXCLUDED.trigger_event,
    delay_seconds = EXCLUDED.delay_seconds,
    actions = EXCLUDED.actions,
    name = EXCLUDED.name;

  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Add unique constraint if missing (needed for ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_rules_org_preset_key'
  ) THEN
    -- Create unique index for (org_id, preset_key) where preset_key is not null
    CREATE UNIQUE INDEX automation_rules_org_preset_key
    ON public.automation_rules (org_id, preset_key)
    WHERE preset_key IS NOT NULL;
  END IF;
END $$;

-- Re-seed all orgs with new/updated presets
DO $$
DECLARE
  v_org record;
BEGIN
  FOR v_org IN SELECT id FROM public.orgs LOOP
    PERFORM public.seed_automation_presets(v_org.id);
  END LOOP;
END $$;
