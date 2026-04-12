/* ═══════════════════════════════════════════════════════════════
   Action Executors — Modular actions for the automation engine.
   Each action receives config + context and returns a result.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';

export interface ActionContext {
  supabase: SupabaseClient;
  orgId: string;
  entityType: string;
  entityId: string;
  twilio: { client: any; phoneNumber: string } | null;
  resendApiKey: string;
  baseUrl: string;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export type ActionType =
  | 'send_email'
  | 'send_sms'
  | 'create_notification'
  | 'create_task'
  | 'update_status'
  | 'request_review'
  | 'log_activity';

// ── Template variable resolution ─────────────────────────────

export function resolveTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  // Support both {var} and [var] syntax for backward compatibility, normalize to {var}
  return template
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
    .replace(/\[(\w+)\]/g, (_, key) => vars[key] ?? '');
}

export async function resolveEntityVariables(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  // Fetch company settings
  const { data: company } = await supabase
    .from('company_settings')
    .select('company_name, phone, google_review_url')
    .eq('org_id', orgId)
    .maybeSingle();

  if (company) {
    vars.company_name = company.company_name || '';
    vars.company_phone = company.phone || '';
    vars.google_review_url = company.google_review_url || '';
  }

  if (entityType === 'lead') {
    const { data: lead } = await supabase
      .from('leads')
      .select('first_name, last_name, email, phone, title, client_id:converted_to_client_id')
      .eq('id', entityId)
      .maybeSingle();
    if (lead) {
      vars.client_first_name = lead.first_name || '';
      vars.client_last_name = lead.last_name || '';
      vars.client_name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
      vars.client_email = lead.email || '';
      vars.client_phone = lead.phone || '';
    }
  }

  if (entityType === 'client') {
    const { data: client } = await supabase
      .from('clients')
      .select('first_name, last_name, email, phone')
      .eq('id', entityId)
      .maybeSingle();
    if (client) {
      vars.client_first_name = client.first_name || '';
      vars.client_last_name = client.last_name || '';
      vars.client_name = `${client.first_name || ''} ${client.last_name || ''}`.trim();
      vars.client_email = client.email || '';
      vars.client_phone = client.phone || '';
    }
  }

  if (entityType === 'job') {
    const { data: job } = await supabase
      .from('jobs')
      .select('title, client_id')
      .eq('id', entityId)
      .maybeSingle();
    if (job) {
      vars.job_name = job.title || '';
      if (job.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name, last_name, email, phone').eq('id', job.client_id).maybeSingle();
        if (c) {
          vars.client_first_name = c.first_name || '';
          vars.client_last_name = c.last_name || '';
          vars.client_name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
          vars.client_email = c.email || '';
          vars.client_phone = c.phone || '';
        }
      }
    }
  }

  if (entityType === 'invoice') {
    const { data: inv } = await supabase
      .from('invoices')
      .select('invoice_number, due_date, total_cents, client_id, job_id')
      .eq('id', entityId)
      .maybeSingle();
    if (inv) {
      vars.invoice_number = inv.invoice_number || '';
      vars.invoice_due_date = inv.due_date || '';
      vars.invoice_total = inv.total_cents ? `$${(inv.total_cents / 100).toFixed(2)}` : '$0.00';
      if (inv.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name, last_name, email, phone').eq('id', inv.client_id).maybeSingle();
        if (c) {
          vars.client_first_name = c.first_name || '';
          vars.client_last_name = c.last_name || '';
          vars.client_name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
          vars.client_email = c.email || '';
          vars.client_phone = c.phone || '';
        }
      }
      if (inv.job_id) {
        const { data: j } = await supabase.from('jobs').select('title').eq('id', inv.job_id).maybeSingle();
        if (j) vars.job_name = j.title || '';
      }
    }
  }

  if (entityType === 'appointment' || entityType === 'schedule_event') {
    // schedule_events → job → client (schedule_events has no direct client_id)
    const { data: evt } = await supabase
      .from('schedule_events')
      .select(`
        id, job_id, start_at, start_time, end_at, end_time, notes, status,
        job:jobs!schedule_events_job_id_fkey(
          id, title, property_address, client_id, client_name,
          clients:clients!jobs_client_id_fkey(first_name, last_name, email, phone)
        )
      `)
      .eq('id', entityId)
      .maybeSingle() as any;
    if (evt) {
      const startField = evt.start_at || evt.start_time;
      if (startField) {
        const d = new Date(startField);
        vars.appointment_date = d.toLocaleDateString('fr-CA');
        vars.appointment_time = d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
      }
      vars.appointment_title = evt.job?.title || '';
      vars.appointment_address = evt.job?.property_address || '';
      vars.job_name = evt.job?.title || '';
      const c = evt.job?.clients;
      if (c) {
        vars.client_first_name = c.first_name || '';
        vars.client_last_name = c.last_name || '';
        vars.client_name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        vars.client_email = c.email || '';
        vars.client_phone = c.phone || '';
      } else if (evt.job?.client_name) {
        vars.client_name = evt.job.client_name;
        vars.client_first_name = evt.job.client_name.split(' ')[0] || '';
      }
    }
  }

  return vars;
}

// ── Action: Send Email ──────────────────────────────────────

export async function executeSendEmail(
  config: { to?: string; subject: string; body: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const to = config.to ? resolveTemplate(config.to, vars) : vars.client_email;
  if (!to) return { success: false, error: 'No recipient email' };

  const subject = resolveTemplate(config.subject, vars);
  const body = resolveTemplate(config.body, vars);

  if (!ctx.resendApiKey) return { success: false, error: 'Resend API key not configured' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${vars.company_name || 'Lume CRM'} <onboarding@resend.dev>`,
        to: [to],
        subject,
        html: body,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Resend error: ${err}` };
    }
    return { success: true, data: { to, subject } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Action: Send SMS ────────────────────────────────────────

export async function executeSendSms(
  config: { to?: string; body: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (!ctx.twilio) return { success: false, error: 'Twilio not configured' };

  const to = config.to ? resolveTemplate(config.to, vars) : vars.client_phone;
  if (!to) return { success: false, error: 'No recipient phone' };

  const body = resolveTemplate(config.body, vars);

  try {
    await ctx.twilio.client.messages.create({
      body,
      from: ctx.twilio.phoneNumber,
      to,
    });
    return { success: true, data: { to, body } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Action: Create Notification ─────────────────────────────

export async function executeCreateNotification(
  config: { title: string; body: string; reference_id?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const title = resolveTemplate(config.title, vars);
  const body = resolveTemplate(config.body, vars);

  const { error } = await ctx.supabase.from('notifications').insert({
    org_id: ctx.orgId,
    type: 'automation',
    title,
    body,
    reference_id: config.reference_id || ctx.entityId,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: { title } };
}

// ── Action: Create Task ─────────────────────────────────────

export async function executeCreateTask(
  config: { title: string; description?: string; due_date?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const title = resolveTemplate(config.title, vars);
  const description = config.description ? resolveTemplate(config.description, vars) : '';

  const { error } = await ctx.supabase.from('tasks').insert({
    org_id: ctx.orgId,
    title,
    description,
    status: 'pending',
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
    due_date: config.due_date || null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: { title } };
}

// ── Action: Update Status ───────────────────────────────────

export async function executeUpdateStatus(
  config: { table: string; status: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const { error } = await ctx.supabase
    .from(config.table)
    .update({ status: config.status })
    .eq('id', ctx.entityId);

  if (error) return { success: false, error: error.message };
  return { success: true, data: { table: config.table, status: config.status } };
}

// ── Action: Request Review ──────────────────────────────────

export async function executeRequestReview(
  _config: Record<string, any>,
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  // 1. Validate google_review_url exists
  if (!vars.google_review_url) {
    return { success: false, error: 'No Google Review URL configured for this company. Set it in Company Settings.' };
  }

  // 2. Determine client_id and job_id from entity
  let clientId: string | null = null;
  let jobId: string | null = null;

  if (ctx.entityType === 'job') {
    jobId = ctx.entityId;
    const { data: job } = await ctx.supabase
      .from('jobs')
      .select('client_id')
      .eq('id', ctx.entityId)
      .maybeSingle();
    clientId = job?.client_id || null;
  } else if (ctx.entityType === 'invoice') {
    const { data: inv } = await ctx.supabase
      .from('invoices')
      .select('client_id, job_id')
      .eq('id', ctx.entityId)
      .maybeSingle();
    clientId = inv?.client_id || null;
    jobId = inv?.job_id || null;
  }

  // 3. Validate client has email
  if (!vars.client_email) {
    return { success: false, error: 'Client has no email address.' };
  }

  // 4. Resolve client name: first_name > full name > "Bonjour"
  const clientGreeting = vars.client_first_name
    || vars.client_name
    || 'Bonjour';

  // 5. Anti-duplicate: check if review already sent to this client in last 7 days
  if (clientId) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentReview } = await ctx.supabase
      .from('review_requests')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('client_id', clientId)
      .in('status', ['sent', 'clicked', 'submitted'])
      .gte('sent_at', sevenDaysAgo)
      .limit(1)
      .maybeSingle();

    if (recentReview) {
      return { success: false, error: 'A review request was already sent to this client in the last 7 days.' };
    }
  }

  // 6. Generate unique token & create survey
  const token = crypto.randomUUID().replace(/-/g, '');

  const { data: survey, error: surveyError } = await ctx.supabase
    .from('satisfaction_surveys')
    .insert({
      org_id: ctx.orgId,
      client_id: clientId,
      job_id: jobId,
      token,
    })
    .select('id')
    .single();

  if (surveyError) return { success: false, error: surveyError.message };

  // 7. Build survey URL
  const surveyUrl = `${ctx.baseUrl}/survey/${token}`;
  vars.survey_url = surveyUrl;
  vars.review_link = surveyUrl;

  // 8. Try to load custom email template for review_request
  let subject = `${vars.company_name || 'Our team'} — How was your experience?`;
  let body = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2>Hi ${clientGreeting},</h2>
      <p>We recently completed <strong>${vars.job_name || 'your project'}</strong> and would love to hear your feedback!</p>
      <p>Please take a moment to rate your experience:</p>
      <p style="text-align:center;margin:30px 0;">
        <a href="${surveyUrl}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Rate Your Experience
        </a>
      </p>
      <p>Thank you for choosing ${vars.company_name || 'us'}!</p>
    </div>
  `;

  // Check for custom review email template
  const { data: emailTemplate } = await ctx.supabase
    .from('email_templates')
    .select('subject, body')
    .eq('org_id', ctx.orgId)
    .eq('type', 'review_request')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();

  if (emailTemplate) {
    // Resolve template variables using {var} syntax
    const templateVars: Record<string, string> = {
      client_name: clientGreeting,
      company_name: vars.company_name || '',
      job_name: vars.job_name || 'your project',
      review_link: surveyUrl,
    };
    subject = emailTemplate.subject.replace(/\{(\w+)\}/g, (_, k) => templateVars[k] ?? '');
    body = emailTemplate.body.replace(/\{(\w+)\}/g, (_, k) => templateVars[k] ?? '');
  }

  // 9. Send email
  const emailResult = await executeSendEmail(
    { subject, body },
    vars,
    ctx,
  );

  // 10. Log review request for tracking
  await ctx.supabase.from('review_requests').insert({
    org_id: ctx.orgId,
    client_id: clientId,
    job_id: jobId,
    survey_id: survey?.id || null,
    subject_sent: subject,
    status: emailResult.success ? 'sent' : 'failed',
    sent_at: emailResult.success ? new Date().toISOString() : null,
  });

  // 11. Log activity
  await ctx.supabase.from('activity_log').insert({
    org_id: ctx.orgId,
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
    related_entity_type: 'client',
    related_entity_id: clientId,
    event_type: 'review_requested',
    metadata: {
      client_name: clientGreeting,
      survey_token: token,
      email_sent: emailResult.success,
    },
  });

  return {
    success: true,
    data: { token, surveyUrl, emailSent: emailResult.success },
  };
}

// ── Action: Log Activity ────────────────────────────────────

export async function executeLogActivity(
  config: { event_type: string; metadata?: Record<string, any> },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const { error } = await ctx.supabase.from('activity_log').insert({
    org_id: ctx.orgId,
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
    event_type: config.event_type,
    metadata: config.metadata || {},
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── Master executor ─────────────────────────────────────────

export async function executeAction(
  actionType: ActionType,
  config: Record<string, any>,
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  switch (actionType) {
    case 'send_email':
      return executeSendEmail(config as any, vars, ctx);
    case 'send_sms':
      return executeSendSms(config as any, vars, ctx);
    case 'create_notification':
      return executeCreateNotification(config as any, vars, ctx);
    case 'create_task':
      return executeCreateTask(config as any, vars, ctx);
    case 'update_status':
      return executeUpdateStatus(config as any, vars, ctx);
    case 'request_review':
      return executeRequestReview(config, vars, ctx);
    case 'log_activity':
      return executeLogActivity(config as any, vars, ctx);
    default:
      return { success: false, error: `Unknown action type: ${actionType}` };
  }
}
