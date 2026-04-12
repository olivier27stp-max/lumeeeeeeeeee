/* ═══════════════════════════════════════════════════════════════
   Migration — Activate all automation presets

   Turns on every preset automation rule for all orgs.
   Also updates the seed function so new orgs get all presets
   active by default.
   ═══════════════════════════════════════════════════════════════ */

-- 1) Activate all existing preset rules
UPDATE public.automation_rules
SET is_active = true
WHERE is_preset = true
  AND is_active = false;

-- 2) Update the seed function so future orgs also get all presets active
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
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 3 Days', 'Gentle reminder 3 days after quote sent', 'quote.sent', '{}'::jsonb, 259200,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], we wanted to check in about the quote we sent a few days ago. — [company_name]"}},
      {"type":"send_email","config":{"subject":"[company_name] — Still interested in our quote?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you a quote a few days ago and haven''t heard back yet.</p><p>We''re here if you have any questions.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_3d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 7 Days', 'Follow-up 7 days after quote sent', 'quote.sent', '{}'::jsonb, 604800,
    '[{"type":"send_email","config":{"subject":"[company_name] — Your quote is still available","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your quote is still available. Let us know if you''d like to move forward!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Quote Follow-Up — 14 Days', 'Last chance follow-up 14 days after quote sent', 'quote.sent', '{}'::jsonb, 1209600,
    '[{"type":"send_email","config":{"subject":"[company_name] — Last follow-up on your quote","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We wanted to reach out one last time about the quote we sent two weeks ago.</p><p>If now isn''t the right time, no worries — we''re here whenever you''re ready.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'quote_followup_14d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Estimate Follow-Up (3 days)', 'Follow-up 3 days after estimate sent', 'estimate.sent', '{}'::jsonb, 259200,
    '[{"type":"send_email","config":{"subject":"[company_name] — Following up on your estimate","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We sent you an estimate a few days ago and wanted to follow up.</p><p>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Hi [client_first_name], just following up on the estimate we sent. Let us know if you have any questions! — [company_name]"}}]'::jsonb,
    true, true, 'estimate_followup')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

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
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  LEADS (3)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Welcome New Lead', 'Send welcome message when a new lead is created', 'lead.created', '{}'::jsonb, 0,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thank you for reaching out to [company_name]! We''ll get back to you shortly."}},
      {"type":"create_notification","config":{"title":"New lead: [client_name]","body":"A new lead has been created."}}]'::jsonb,
    true, true, 'welcome_new_lead')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Stale Lead — 7 Days', 'Alert when a lead has no activity for 7 days', 'lead.status_changed', '{}'::jsonb, 604800,
    '[{"type":"create_notification","config":{"title":"Stale lead: [client_name]","body":"This lead has had no activity for 7 days."}},
      {"type":"create_task","config":{"title":"Follow up with stale lead: [client_name]"}}]'::jsonb,
    true, true, 'stale_lead_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Lost Lead Re-engagement', 'Re-engage leads marked as lost after 30 days', 'lead.status_changed', '{"new_status":"lost"}'::jsonb, 2592000,
    '[{"type":"send_email","config":{"subject":"[company_name] — We''d love to help","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been a while since we last connected. If your needs have changed, we''d love to help.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'lost_lead_reengagement')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  JOBS & SCHEDULING (4)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 7 Days Before', 'Reminder 7 days before appointment', 'appointment.created', '{}'::jsonb, -604800,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], just a reminder that your appointment with [company_name] is in 7 days on [appointment_date]. See you soon!"}}]'::jsonb,
    true, true, 'job_reminder_7d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Job Reminder — 1 Day Before', 'Reminder 1 day before appointment', 'appointment.created', '{}'::jsonb, -86400,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], your appointment with [company_name] is tomorrow! See you at [appointment_time]. — [company_name]"}}]'::jsonb,
    true, true, 'job_reminder_1d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Appointment Confirmation', 'Confirm appointment immediately', 'appointment.created', '{}'::jsonb, 0,
    '[{"type":"send_email","config":{"subject":"[company_name] — Appointment Confirmed","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>Your appointment is confirmed for [appointment_date] at [appointment_time].</p><p>See you soon!<br/>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you there!"}}]'::jsonb,
    true, true, 'appointment_confirmation')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'No-Show Follow-Up', 'Follow up when appointment is cancelled or no-show', 'appointment.cancelled', '{}'::jsonb, 3600,
    '[{"type":"send_email","config":{"subject":"[company_name] — We missed you!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We noticed your appointment was cancelled. We''d love to reschedule at your convenience.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'no_show_followup')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  PAYMENTS (2)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Payment Confirmation', 'Confirm payment received', 'invoice.paid', '{}'::jsonb, 0,
    '[{"type":"send_email","config":{"subject":"[company_name] — Payment Received","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''ve received your payment. Thank you!</p><p>[company_name]</p></div>"}},
      {"type":"send_sms","config":{"body":"Payment received! Thank you, [client_first_name]. — [company_name]"}}]'::jsonb,
    true, true, 'payment_confirmation')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Deposit Received', 'Notify when deposit is received', 'invoice.paid', '{}'::jsonb, 0,
    '[{"type":"create_notification","config":{"title":"Deposit received from [client_name]","body":"Deposit payment has been received."}}]'::jsonb,
    true, true, 'deposit_received')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  FOLLOW-UP (3)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Thank You After Job', 'Send thank you message after job completion', 'job.completed', '{}'::jsonb, 7200,
    '[{"type":"send_sms","config":{"body":"Thank you for choosing [company_name], [client_first_name]! We hope you''re happy with the work. Don''t hesitate to reach out if you need anything!"}},
      {"type":"send_email","config":{"subject":"[company_name] — Thank you!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Thank you, [client_first_name]!</h2><p>We hope you''re satisfied with the work. Don''t hesitate to reach out anytime.</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'thank_you_after_job')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Cross-Sell — 30 Days', 'Cross-sell offer 30 days after job', 'job.completed', '{}'::jsonb, 2592000,
    '[{"type":"send_email","config":{"subject":"[company_name] — A special offer for you","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been about a month since we worked together. Did you know we also offer other services?</p><p>Feel free to reach out!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'cross_sell_30d')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Post-Appointment Survey', 'Send satisfaction survey after service', 'job.completed', '{}'::jsonb, 86400,
    '[{"type":"send_email","config":{"subject":"[company_name] — How was your experience?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>We''d love to hear your feedback about our recent service. Your opinion helps us improve!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'post_appointment_survey')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  REVIEWS (1)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Google Review Request', 'Request Google review after job', 'job.completed', '{}'::jsonb, 7200,
    '[{"type":"send_sms","config":{"body":"Hi [client_first_name], thank you for choosing [company_name]! If you were satisfied, we''d really appreciate a Google review. It helps us a lot!"}},
      {"type":"request_review","config":{}}]'::jsonb,
    true, true, 'google_review')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --  CLIENT ENGAGEMENT (2)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Client Anniversary', 'Send anniversary message on client creation date', 'lead.created', '{}'::jsonb, 31536000,
    '[{"type":"send_email","config":{"subject":"[company_name] — Happy Anniversary!","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Happy Anniversary, [client_first_name]!</h2><p>It''s been a year since we started working together. Thank you for your trust!</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'client_anniversary')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  INSERT INTO public.automation_rules (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
  VALUES (p_org_id, 'Seasonal Reminder — 6 Months', 'Seasonal check-in 6 months after last service', 'job.completed', '{}'::jsonb, 15552000,
    '[{"type":"send_email","config":{"subject":"[company_name] — Time for a check-up?","body":"<div style=\"font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;\"><h2>Hi [client_first_name],</h2><p>It''s been about 6 months since your last service with us. Time for a seasonal check-up?</p><p>[company_name]</p></div>"}}]'::jsonb,
    true, true, 'seasonal_reminder_6m')
  ON CONFLICT (org_id, preset_key) DO UPDATE SET is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Re-seed all existing orgs with updated active states
DO $$
DECLARE
  v_org record;
BEGIN
  FOR v_org IN SELECT id FROM public.orgs LOOP
    PERFORM public.seed_automation_presets(v_org.id);
  END LOOP;
END;
$$;
