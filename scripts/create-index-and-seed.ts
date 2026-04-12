import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  // Read and execute the migration SQL directly
  const migrationPath = join(process.cwd(), 'supabase/migrations/20260401200000_advanced_automation_presets.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  console.log('📦 Applying advanced automation presets migration...\n');

  // We can't run raw SQL via Supabase JS client directly.
  // Instead, let's insert the new presets manually using the Supabase client.

  const { data: orgs } = await sb.from('orgs').select('id, name');
  if (!orgs) { console.log('No orgs'); return; }

  // Define all 28 presets
  const presets = [
    // QUOTE FOLLOW-UPS (5)
    { key: 'quote_followup_1d', name: 'Quote Follow-Up — 1 Day', trigger: 'quote.sent', delay: 86400, active: true,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], just following up on the quote we sent yesterday. Have you had a chance to review it? Let us know if you have any questions! — [company_name]"}},
        {type:'send_email',config:{subject:"[company_name] — Following up on your quote",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>We sent you a quote yesterday and wanted to make sure you received it.</p><p>If you have any questions, we're happy to help.</p><p>Best regards,<br/>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'follow_up_sent',metadata:{type:'quote_followup_1d'}}}
      ]},
    { key: 'quote_followup_3d', name: 'Quote Follow-Up — 3 Days', trigger: 'quote.sent', delay: 259200, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], checking in about the quote we sent a few days ago. We're available if you'd like to discuss anything. — [company_name]"}},
        {type:'send_email',config:{subject:"[company_name] — Still interested in our quote?",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>We sent you a quote a few days ago and haven't heard back yet.</p><p>We're here if you have any questions or concerns.</p><p>Looking forward to hearing from you!<br/>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'follow_up_sent',metadata:{type:'quote_followup_3d'}}}
      ]},
    { key: 'quote_followup_7d', name: 'Quote Follow-Up — 7 Days', trigger: 'quote.sent', delay: 604800, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], it's been a week since we sent your quote. The quote may expire soon — let us know! — [company_name]"}},
        {type:'send_email',config:{subject:"[company_name] — Your quote is expiring soon",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>It's been a week since we sent your quote, and it will expire soon.</p><p>If you're still interested, now is a great time to move forward.</p><p>Best,<br/>[company_name]</p></div>"}},
        {type:'create_notification',config:{title:'Quote not responded — 7 days',body:'[client_name] has not responded to their quote after 7 days.'}},
        {type:'log_activity',config:{event_type:'follow_up_sent',metadata:{type:'quote_followup_7d'}}}
      ]},
    { key: 'quote_followup_14d', name: 'Quote Follow-Up — 14 Days', trigger: 'quote.sent', delay: 1209600, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], one more check-in about your quote. If the price needs adjusting, we're flexible. Let's make it work! — [company_name]"}},
        {type:'send_email',config:{subject:"[company_name] — Last chance to review your quote",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>We've reached out a couple of times about your quote.</p><p>If the pricing doesn't fit, we're happy to adjust. Please let us know either way.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'create_task',config:{title:'Urgent: Quote follow-up — [client_name]',description:'Client [client_name] has not responded in 14 days. Call directly.'}},
        {type:'create_notification',config:{title:'Quote stale — 14 days',body:'[client_name] quote is 14 days old. Task created.'}},
        {type:'log_activity',config:{event_type:'follow_up_sent',metadata:{type:'quote_followup_14d'}}}
      ]},
    { key: 'quote_followup_21d', name: 'Quote Follow-Up — 21 Days (Final)', trigger: 'quote.sent', delay: 1814400, active: false,
      actions: [
        {type:'send_email',config:{subject:"[company_name] — Closing your quote file",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>We've followed up several times and understand you may have gone in a different direction.</p><p>We'll be closing this file shortly. If you'd like to revisit in the future, don't hesitate to reach out.</p><p>All the best,<br/>[company_name]</p></div>"}},
        {type:'create_notification',config:{title:'Quote closed — no response 21 days',body:'[client_name] never responded. File closed.'}},
        {type:'log_activity',config:{event_type:'follow_up_final',metadata:{type:'quote_followup_21d'}}}
      ]},

    // INVOICE REMINDERS (5)
    { key: 'invoice_sent_reminder_1d', name: 'Invoice Reminder — 1 Day', trigger: 'invoice.sent', delay: 86400, active: true,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Payment Reminder: Invoice [invoice_number]',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Friendly reminder that invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is awaiting payment.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'invoice_reminded',metadata:{days_after_sent:1}}}
      ]},
    { key: 'invoice_sent_reminder_3d', name: 'Invoice Reminder — 3 Days', trigger: 'invoice.sent', delay: 259200, active: true,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Payment Reminder: Invoice [invoice_number]',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Reminder that invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> remains unpaid.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'send_sms',config:{body:'Hi [client_first_name], reminder that invoice [invoice_number] for [invoice_total] is awaiting payment. — [company_name]'}},
        {type:'log_activity',config:{event_type:'invoice_reminded',metadata:{days_after_sent:3}}}
      ]},
    { key: 'invoice_sent_reminder_7d', name: 'Invoice Reminder — 7 Days', trigger: 'invoice.sent', delay: 604800, active: true,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Invoice [invoice_number] Still Unpaid',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> was sent 7 days ago and remains unpaid.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'send_sms',config:{body:'Hi [client_first_name], invoice [invoice_number] for [invoice_total] is now 7 days unpaid. — [company_name]'}},
        {type:'create_notification',config:{title:'Invoice [invoice_number] — 7 days unpaid',body:'[client_name] has not paid after 7 days.'}},
        {type:'log_activity',config:{event_type:'invoice_reminded',metadata:{days_after_sent:7}}}
      ]},
    { key: 'invoice_sent_reminder_14d', name: 'Invoice Reminder — 14 Days', trigger: 'invoice.sent', delay: 1209600, active: false,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Urgent: Invoice [invoice_number] Past Due',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is now 14 days past due.</p><p>Please arrange payment or contact us.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'send_sms',config:{body:'Hi [client_first_name], invoice [invoice_number] is 14 days overdue. Please arrange payment. — [company_name]'}},
        {type:'create_task',config:{title:'Follow up: Invoice [invoice_number] — 14 days overdue',description:'Client [client_name] has not paid after 14 days.'}},
        {type:'create_notification',config:{title:'Invoice [invoice_number] — 14 days overdue',body:'Task created for follow-up.'}},
        {type:'log_activity',config:{event_type:'invoice_reminded',metadata:{days_after_sent:14}}}
      ]},
    { key: 'invoice_sent_reminder_30d', name: 'Invoice Final Reminder — 30 Days', trigger: 'invoice.sent', delay: 2592000, active: true,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Final Notice: Invoice [invoice_number]',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Invoice <strong>[invoice_number]</strong> for <strong>[invoice_total]</strong> is 30 days outstanding.</p><p>Please arrange payment immediately.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'send_sms',config:{body:'IMPORTANT: Invoice [invoice_number] for [invoice_total] is 30 days overdue. Please arrange payment. — [company_name]'}},
        {type:'create_notification',config:{title:'URGENT: Invoice [invoice_number] — 30 days',body:'Immediate action required.'}},
        {type:'create_task',config:{title:'URGENT: Invoice [invoice_number] — 30 days overdue',description:'Escalate to management.'}},
        {type:'log_activity',config:{event_type:'invoice_reminded',metadata:{days_after_sent:30,final_reminder:true}}}
      ]},

    // LEAD NURTURING (5)
    { key: 'welcome_new_lead', name: 'Lead — Welcome', trigger: 'lead.created', delay: 0, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], thanks for reaching out to [company_name]! We'll get back to you shortly."}},
        {type:'create_notification',config:{title:'New Lead',body:'New lead: [client_name] — [client_phone]'}},
        {type:'log_activity',config:{event_type:'welcome_sent'}}
      ]},
    { key: 'lead_followup_1d', name: 'Lead Follow-Up — 1 Day', trigger: 'lead.created', delay: 86400, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], this is [company_name]. We got your request — we'll be in touch soon with next steps!"}},
        {type:'log_activity',config:{event_type:'lead_followup',metadata:{type:'lead_followup_1d'}}}
      ]},
    { key: 'lead_followup_3d', name: 'Lead Follow-Up — 3 Days', trigger: 'lead.created', delay: 259200, active: false,
      actions: [
        {type:'send_email',config:{subject:"[company_name] — Here's what we can do for you",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Thanks for your interest in [company_name].</p><p>We'd love to help with your project. Reply or call us at [company_phone].</p><p>Best,<br/>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'lead_followup',metadata:{type:'lead_followup_3d'}}}
      ]},
    { key: 'stale_lead_7d', name: 'Lead Alert — 7 Days Stale', trigger: 'lead.created', delay: 604800, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], still interested in getting a quote? We're here to help! — [company_name]"}},
        {type:'create_notification',config:{title:'Stale Lead — 7 days',body:'Lead [client_name] has had no activity for 7 days.'}},
        {type:'log_activity',config:{event_type:'stale_lead_alert',metadata:{days:7}}}
      ]},
    { key: 'lead_followup_14d', name: 'Lead Final Follow-Up — 14 Days', trigger: 'lead.created', delay: 1209600, active: false,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Still interested?',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>We reached out a couple of times and haven't heard back.</p><p>If you're still interested, we'd love to help. Feel free to reach out anytime.</p><p>Best,<br/>[company_name]</p></div>"}},
        {type:'create_task',config:{title:'Lead going cold: [client_name]',description:'Lead has not responded in 14 days. Make a final call or close.'}},
        {type:'create_notification',config:{title:'Lead cold — 14 days',body:'[client_name] is going cold. Task assigned.'}},
        {type:'log_activity',config:{event_type:'lead_followup_final',metadata:{type:'lead_followup_14d'}}}
      ]},

    // JOB/APPOINTMENT (5)
    { key: 'appointment_confirmation', name: 'Appointment Confirmation', trigger: 'appointment.created', delay: 0, active: false,
      actions: [
        {type:'send_sms',config:{body:'Your appointment with [company_name] is confirmed for [appointment_date] at [appointment_time]. See you there!'}},
        {type:'send_email',config:{subject:'[company_name] — Appointment Confirmed',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Your appointment is confirmed:</p><ul><li><strong>Date:</strong> [appointment_date]</li><li><strong>Time:</strong> [appointment_time]</li><li><strong>Location:</strong> [appointment_address]</li></ul><p>See you soon!<br/>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'appointment_confirmed'}}
      ]},
    { key: 'job_reminder_7d', name: 'Job Reminder — 1 Week Before', trigger: 'appointment.created', delay: -604800, active: true,
      actions: [
        {type:'send_sms',config:{body:'Hi [client_first_name], reminder: your appointment with [company_name] is in 1 week, on [appointment_date]. See you then!'}},
        {type:'send_email',config:{subject:'[company_name] — Appointment in 1 Week',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Reminder: your appointment is on <strong>[appointment_date]</strong> at <strong>[appointment_time]</strong>.</p><p>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'reminder_sent',metadata:{type:'job_reminder_7d'}}}
      ]},
    { key: 'job_reminder_1d', name: 'Job Reminder — 1 Day Before', trigger: 'appointment.created', delay: -86400, active: true,
      actions: [
        {type:'send_sms',config:{body:'Reminder: your appointment with [company_name] is tomorrow, [appointment_date] at [appointment_time]. See you then!'}},
        {type:'send_email',config:{subject:'[company_name] — Your Appointment is Tomorrow',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Your appointment is <strong>tomorrow</strong>:</p><ul><li>[appointment_date] at [appointment_time]</li><li>[appointment_address]</li></ul><p>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'reminder_sent',metadata:{type:'job_reminder_1d'}}}
      ]},
    { key: 'job_reminder_2h', name: 'Job Reminder — 2 Hours Before', trigger: 'appointment.created', delay: -7200, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], heads up — we'll be there in about 2 hours for your [appointment_time] appointment. See you soon! — [company_name]"}},
        {type:'log_activity',config:{event_type:'reminder_sent',metadata:{type:'job_reminder_2h'}}}
      ]},
    { key: 'thank_you_after_job', name: 'Thank You After Job', trigger: 'job.completed', delay: 3600, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], thank you for choosing [company_name]! We hope you're happy with the work. Have a great day!"}},
        {type:'log_activity',config:{event_type:'thank_you_sent'}}
      ]},

    // REVIEW (2)
    { key: 'google_review', name: 'Review Request — After Job', trigger: 'job.completed', delay: 7200, active: false,
      actions: [{type:'request_review',config:{}},{type:'log_activity',config:{event_type:'review_requested'}}]},
    { key: 'review_reminder_7d', name: 'Review Reminder — 7 Days', trigger: 'job.completed', delay: 604800, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], if you have a moment, we'd really appreciate a quick review: [google_review_url] — Thank you! [company_name]"}},
        {type:'log_activity',config:{event_type:'review_reminder_sent'}}
      ]},

    // PAYMENT (3)
    { key: 'payment_confirmation', name: 'Payment Confirmation', trigger: 'invoice.paid', delay: 0, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], we've received your payment for invoice [invoice_number]. Thank you! — [company_name]"}},
        {type:'create_notification',config:{title:'Payment Received',body:'Payment received for invoice [invoice_number] from [client_name].'}},
        {type:'log_activity',config:{event_type:'payment_confirmed'}}
      ]},
    { key: 'deposit_reminder', name: 'Deposit Reminder — Quote Approved', trigger: 'quote.approved', delay: 3600, active: false,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Deposit Required to Get Started',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>Your quote has been approved!</p><p>A deposit is required to schedule your appointment. Please complete payment at your earliest convenience.</p><p>Thank you,<br/>[company_name]</p></div>"}},
        {type:'send_sms',config:{body:"Hi [client_first_name], your quote is approved! A deposit is required to proceed. Check your email for details. — [company_name]"}},
        {type:'log_activity',config:{event_type:'deposit_reminder_sent'}}
      ]},
    { key: 'deposit_followup_2d', name: 'Deposit Follow-Up — 2 Days', trigger: 'quote.approved', delay: 172800, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], reminder that a deposit is needed to schedule your appointment. Let us know if you need help! — [company_name]"}},
        {type:'create_notification',config:{title:'Deposit pending — [client_name]',body:'Quote approved but deposit not yet received (2 days).'}},
        {type:'log_activity',config:{event_type:'deposit_followup_sent'}}
      ]},

    // RE-ENGAGEMENT (3)
    { key: 'cross_sell_30d', name: 'Cross-Sell — 30 Days After Job', trigger: 'job.completed', delay: 2592000, active: false,
      actions: [
        {type:'send_email',config:{subject:'[company_name] — Need anything else?',body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>It's been about a month since we completed your project.</p><p>Do you have any other projects in mind? We'd love to help again.</p><p>Best,<br/>[company_name]</p></div>"}},
        {type:'log_activity',config:{event_type:'cross_sell_sent',metadata:{days:30}}}
      ]},
    { key: 'reengagement_90d', name: 'Re-Engagement — 90 Days', trigger: 'job.completed', delay: 7776000, active: false,
      actions: [
        {type:'send_email',config:{subject:"[company_name] — It's been a while!",body:"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>Hi [client_first_name],</h2><p>It's been a few months since we last worked together.</p><p>If you need anything — maintenance, a new project, or just advice — we're here for you.</p><p>[company_name]</p></div>"}},
        {type:'send_sms',config:{body:"Hi [client_first_name], it's been a while! Just checking in. We're here if you need anything! — [company_name]"}},
        {type:'log_activity',config:{event_type:'reengagement_sent',metadata:{days:90}}}
      ]},
    { key: 'no_show_followup', name: 'No-Show / Cancellation Follow-Up', trigger: 'appointment.cancelled', delay: 3600, active: false,
      actions: [
        {type:'send_sms',config:{body:"Hi [client_first_name], we noticed your appointment was cancelled. Would you like to reschedule? — [company_name]"}},
        {type:'create_notification',config:{title:'Appointment Cancelled',body:'[client_name] cancelled their appointment.'}},
        {type:'log_activity',config:{event_type:'no_show_followup'}}
      ]},
  ];

  for (const org of orgs) {
    console.log(`\n🔧 ORG: ${org.name} (${org.id.slice(0, 8)}...)`);
    let inserted = 0;
    let updated = 0;

    for (const p of presets) {
      // Check if exists
      const { data: existing } = await sb.from('automation_rules')
        .select('id')
        .eq('org_id', org.id)
        .eq('preset_key', p.key)
        .maybeSingle();

      if (existing) {
        // Update
        await sb.from('automation_rules')
          .update({
            name: p.name,
            trigger_event: p.trigger,
            delay_seconds: p.delay,
            actions: p.actions,
          })
          .eq('id', existing.id);
        updated++;
      } else {
        // Insert
        await sb.from('automation_rules').insert({
          org_id: org.id,
          name: p.name,
          description: '',
          trigger_event: p.trigger,
          conditions: {},
          delay_seconds: p.delay,
          actions: p.actions,
          is_active: p.active,
          is_preset: true,
          preset_key: p.key,
        });
        inserted++;
      }
    }

    console.log(`   ✅ ${inserted} inserted, ${updated} updated`);

    // Final count
    const { count } = await sb.from('automation_rules')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .eq('is_preset', true);

    console.log(`   📊 Total presets: ${count}`);
  }
}

run().catch(e => console.error(e));
