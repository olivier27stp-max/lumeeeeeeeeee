/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Server-Side CRM Tools (Read + Write)
   All write tools require user approval via the approval flow.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

interface ToolResult {
  success: boolean;
  summary: string;
  data?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(val: unknown, name: string): string | null {
  if (typeof val !== 'string' || !UUID_RE.test(val)) return `Invalid ${name}: must be a valid UUID`;
  return null;
}

// ═══════════════════════════════════════════════════════════════
// READ TOOLS
// ═══════════════════════════════════════════════════════════════

export async function getClientById(supabase: SupabaseClient, orgId: string, clientId: string): Promise<ToolResult> {
  const { data, error } = await supabase.from('clients')
    .select('*').eq('org_id', orgId).eq('id', clientId).is('deleted_at', null).maybeSingle();
  if (error || !data) return { success: false, summary: `Client not found: ${clientId}` };
  return { success: true, summary: `Client: ${data.first_name} ${data.last_name}`, data };
}

export async function getJobById(supabase: SupabaseClient, orgId: string, jobId: string): Promise<ToolResult> {
  const { data, error } = await supabase.from('jobs')
    .select('*').eq('org_id', orgId).eq('id', jobId).is('deleted_at', null).maybeSingle();
  if (error || !data) return { success: false, summary: `Job not found: ${jobId}` };
  return { success: true, summary: `Job: ${data.title} (${data.status})`, data };
}

export async function getQuoteById(supabase: SupabaseClient, orgId: string, quoteId: string): Promise<ToolResult> {
  const { data, error } = await supabase.from('quotes')
    .select('*').eq('org_id', orgId).eq('id', quoteId).is('deleted_at', null).maybeSingle();
  if (error || !data) return { success: false, summary: `Quote not found: ${quoteId}` };
  return { success: true, summary: `Quote #${data.quote_number} (${data.status})`, data };
}

export async function getInvoiceById(supabase: SupabaseClient, orgId: string, invoiceId: string): Promise<ToolResult> {
  const { data, error } = await supabase.from('invoices')
    .select('*').eq('org_id', orgId).eq('id', invoiceId).is('deleted_at', null).maybeSingle();
  if (error || !data) return { success: false, summary: `Invoice not found: ${invoiceId}` };
  return { success: true, summary: `Invoice #${data.invoice_number} (${data.status})`, data };
}

export async function getAvailableTeams(supabase: SupabaseClient, orgId: string): Promise<ToolResult> {
  const { data, error } = await supabase.from('teams')
    .select('id, name, color_hex, description, is_active')
    .eq('org_id', orgId).is('deleted_at', null).eq('is_active', true).order('name');
  if (error) return { success: false, summary: 'Failed to fetch teams' };
  return { success: true, summary: `${data?.length || 0} teams available`, data };
}

// ═══════════════════════════════════════════════════════════════
// WRITE TOOLS — All require approval
// ═══════════════════════════════════════════════════════════════

/** Assign a team to a job */
async function assignTeamToJob(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const jobErr = validateUUID(params.jobId, 'jobId');
  const teamErr = validateUUID(params.teamId, 'teamId');
  if (jobErr) return { success: false, summary: jobErr };
  if (teamErr) return { success: false, summary: teamErr };

  // Validate team is active
  const { data: team } = await supabase.from('teams')
    .select('name, is_active').eq('id', params.teamId).eq('org_id', orgId).maybeSingle();
  if (!team) return { success: false, summary: 'Team not found' };
  if (!team.is_active) return { success: false, summary: `Team "${team.name}" is inactive — cannot assign` };

  // Validate job is assignable
  const { data: job } = await supabase.from('jobs')
    .select('title, status').eq('id', params.jobId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!job) return { success: false, summary: 'Job not found' };
  if (job.status === 'completed' || job.status === 'cancelled') {
    return { success: false, summary: `Job "${job.title}" is ${job.status} — cannot reassign` };
  }

  const { error } = await supabase.from('jobs')
    .update({ team_id: params.teamId, updated_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('id', params.jobId);

  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Team "${team.name}" assigned to job "${job.title}"` };
}

/** Update a quote's pricing */
async function updateQuote(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const quoteErr = validateUUID(params.quoteId, 'quoteId');
  if (quoteErr) return { success: false, summary: quoteErr };

  // Validate quote is editable
  const { data: quote } = await supabase.from('quotes')
    .select('quote_number, status').eq('id', params.quoteId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!quote) return { success: false, summary: 'Quote not found' };
  if (quote.status === 'accepted' || quote.status === 'rejected') {
    return { success: false, summary: `Quote #${quote.quote_number} is ${quote.status} — cannot modify` };
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof params.totalCents === 'number' && params.totalCents >= 0) updates.total_cents = params.totalCents;
  if (Array.isArray(params.items)) updates.items = params.items;
  if (typeof params.notes === 'string') updates.notes = params.notes;

  const { error } = await supabase.from('quotes').update(updates).eq('org_id', orgId).eq('id', params.quoteId);
  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Quote #${quote.quote_number} updated` };
}

/** Create a follow-up draft note */
async function createFollowupDraft(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const clientErr = validateUUID(params.clientId, 'clientId');
  if (clientErr) return { success: false, summary: clientErr };

  const { data: client } = await supabase.from('clients')
    .select('first_name, last_name, deleted_at').eq('id', params.clientId).eq('org_id', orgId).maybeSingle();
  if (!client) return { success: false, summary: 'Client not found' };
  if (client.deleted_at) return { success: false, summary: `Client ${client.first_name} is archived — reactivate first` };

  const { data, error } = await supabase.from('notes').insert({
    org_id: orgId,
    entity_type: 'client',
    entity_id: params.clientId,
    title: typeof params.subject === 'string' ? params.subject : 'Follow-up draft',
    content: typeof params.body === 'string' ? params.body : '',
    is_pinned: false,
  }).select('id').single();

  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Follow-up draft created for ${client.first_name} ${client.last_name}` };
}

/** Convert a lead to a client */
async function convertLeadToClient(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const leadErr = validateUUID(params.leadId, 'leadId');
  if (leadErr) return { success: false, summary: leadErr };

  const { data: lead } = await supabase.from('leads')
    .select('*').eq('id', params.leadId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!lead) return { success: false, summary: 'Lead not found' };
  if (lead.status === 'lost') return { success: false, summary: 'Cannot convert a lost lead — business rule' };
  if (!lead.email) return { success: false, summary: 'Lead has no email — required to create client' };
  if (lead.converted_to_client_id) return { success: false, summary: 'Lead already converted' };

  // Create client
  const { data: client, error: clientErr2 } = await supabase.from('clients').insert({
    org_id: orgId,
    created_by: lead.created_by,
    first_name: lead.first_name,
    last_name: lead.last_name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    address: lead.address || '',
    status: 'active',
  }).select('id').single();

  if (clientErr2 || !client) return { success: false, summary: `Failed to create client: ${clientErr2?.message}` };

  // Update lead
  await supabase.from('leads').update({
    status: 'won',
    converted_to_client_id: client.id,
    converted_at: new Date().toISOString(),
  }).eq('id', params.leadId);

  return { success: true, summary: `Lead "${lead.first_name} ${lead.last_name}" converted to client`, data: { clientId: client.id } };
}

/** Update a job's status */
async function updateJobStatus(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const jobErr = validateUUID(params.jobId, 'jobId');
  if (jobErr) return { success: false, summary: jobErr };

  const validStatuses = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];
  if (!validStatuses.includes(params.status)) {
    return { success: false, summary: `Invalid status. Must be one of: ${validStatuses.join(', ')}` };
  }

  const { data: job } = await supabase.from('jobs')
    .select('title, status').eq('id', params.jobId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!job) return { success: false, summary: 'Job not found' };

  // Prevent invalid transitions
  if (job.status === 'completed' && params.status !== 'completed') {
    return { success: false, summary: `Job "${job.title}" is completed — cannot revert status` };
  }

  const updates: Record<string, unknown> = { status: params.status, updated_at: new Date().toISOString() };
  if (params.status === 'completed') updates.completed_at = new Date().toISOString();

  const { error } = await supabase.from('jobs').update(updates).eq('id', params.jobId).eq('org_id', orgId);
  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Job "${job.title}" status changed to ${params.status}` };
}

/** Schedule a job (set date + optionally team) */
async function scheduleJob(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const jobErr = validateUUID(params.jobId, 'jobId');
  if (jobErr) return { success: false, summary: jobErr };

  const { data: job } = await supabase.from('jobs')
    .select('title, status').eq('id', params.jobId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!job) return { success: false, summary: 'Job not found' };
  if (job.status === 'completed' || job.status === 'cancelled') {
    return { success: false, summary: `Job "${job.title}" is ${job.status} — cannot schedule` };
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.scheduledAt) {
    const date = new Date(params.scheduledAt);
    if (isNaN(date.getTime())) return { success: false, summary: 'Invalid date format' };
    if (date.getTime() < Date.now() - 86400000) return { success: false, summary: 'Cannot schedule in the past' };
    updates.scheduled_at = date.toISOString();
    updates.status = 'scheduled';
  }
  if (params.teamId) {
    const teamErr = validateUUID(params.teamId, 'teamId');
    if (teamErr) return { success: false, summary: teamErr };
    updates.team_id = params.teamId;
  }

  const { error } = await supabase.from('jobs').update(updates).eq('id', params.jobId).eq('org_id', orgId);
  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Job "${job.title}" scheduled${params.scheduledAt ? ` for ${new Date(params.scheduledAt).toLocaleDateString()}` : ''}` };
}

/** Update lead status */
async function updateLeadStatus(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const leadErr = validateUUID(params.leadId, 'leadId');
  if (leadErr) return { success: false, summary: leadErr };

  const validStatuses = ['new', 'contacted', 'qualified', 'won', 'lost'];
  if (!validStatuses.includes(params.status)) {
    return { success: false, summary: `Invalid status. Must be one of: ${validStatuses.join(', ')}` };
  }

  const { data: lead } = await supabase.from('leads')
    .select('first_name, last_name, status').eq('id', params.leadId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!lead) return { success: false, summary: 'Lead not found' };
  if (lead.status === 'won') return { success: false, summary: 'Lead already converted — cannot change status' };

  const { error } = await supabase.from('leads')
    .update({ status: params.status, updated_at: new Date().toISOString() })
    .eq('id', params.leadId).eq('org_id', orgId);

  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Lead "${lead.first_name} ${lead.last_name}" status changed to ${params.status}` };
}

/** Send an invoice (mark as sent) */
async function sendInvoice(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const invErr = validateUUID(params.invoiceId, 'invoiceId');
  if (invErr) return { success: false, summary: invErr };

  const { data: inv } = await supabase.from('invoices')
    .select('invoice_number, status, total_cents, client_id')
    .eq('id', params.invoiceId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!inv) return { success: false, summary: 'Invoice not found' };
  if (inv.status !== 'draft') return { success: false, summary: `Invoice #${inv.invoice_number} is ${inv.status} — can only send drafts` };
  if (!inv.total_cents || inv.total_cents <= 0) return { success: false, summary: 'Invoice has no total — add items first' };

  // Check client has email
  if (inv.client_id) {
    const { data: client } = await supabase.from('clients')
      .select('email').eq('id', inv.client_id).maybeSingle();
    if (!client?.email) return { success: false, summary: 'Client has no email — cannot send invoice' };
  }

  const { error } = await supabase.from('invoices')
    .update({ issued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', params.invoiceId).eq('org_id', orgId);

  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Invoice #${inv.invoice_number} sent ($${(inv.total_cents / 100).toFixed(2)})` };
}

/** Record a manual payment */
async function recordPayment(supabase: SupabaseClient, orgId: string, params: Record<string, any>): Promise<ToolResult> {
  const invErr = validateUUID(params.invoiceId, 'invoiceId');
  if (invErr) return { success: false, summary: invErr };

  if (typeof params.amountCents !== 'number' || params.amountCents <= 0) {
    return { success: false, summary: 'amountCents must be a positive number' };
  }

  const { data: inv } = await supabase.from('invoices')
    .select('invoice_number, status, balance_cents, client_id')
    .eq('id', params.invoiceId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (!inv) return { success: false, summary: 'Invoice not found' };
  if (inv.status === 'paid') return { success: false, summary: 'Invoice already paid' };
  if (inv.status === 'void') return { success: false, summary: 'Invoice is void — cannot accept payment' };
  if (params.amountCents > (inv.balance_cents || 0)) {
    return { success: false, summary: `Amount ($${(params.amountCents / 100).toFixed(2)}) exceeds balance ($${((inv.balance_cents || 0) / 100).toFixed(2)})` };
  }

  const method = ['card', 'e-transfer', 'cash', 'check'].includes(params.method) ? params.method : 'cash';

  const { error } = await supabase.from('payments').insert({
    org_id: orgId,
    invoice_id: params.invoiceId,
    client_id: inv.client_id,
    provider: 'manual',
    status: 'succeeded',
    method,
    amount_cents: params.amountCents,
    currency: 'CAD',
    payment_date: new Date().toISOString(),
  });

  if (error) return { success: false, summary: `Failed: ${error.message}` };
  return { success: true, summary: `Payment of $${(params.amountCents / 100).toFixed(2)} recorded for invoice #${inv.invoice_number}` };
}

// ═══════════════════════════════════════════════════════════════
// TOOL ROUTER
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ACTIONS = [
  'team_assignment', 'pricing', 'followup',
  'convert_lead', 'update_job_status', 'schedule_job',
  'update_lead_status', 'send_invoice', 'record_payment',
];

export async function executeCrmTool(
  supabase: SupabaseClient,
  orgId: string,
  actionType: string,
  params: Record<string, any>
): Promise<ToolResult> {
  if (!ALLOWED_ACTIONS.includes(actionType)) {
    return { success: false, summary: `Unknown action type: ${actionType}` };
  }

  console.log(`[crm-tools] Executing ${actionType} for org ${orgId}`, JSON.stringify(params).slice(0, 200));

  switch (actionType) {
    case 'team_assignment':
      return assignTeamToJob(supabase, orgId, params);
    case 'pricing':
      return updateQuote(supabase, orgId, params);
    case 'followup':
      return createFollowupDraft(supabase, orgId, params);
    case 'convert_lead':
      return convertLeadToClient(supabase, orgId, params);
    case 'update_job_status':
      return updateJobStatus(supabase, orgId, params);
    case 'schedule_job':
      return scheduleJob(supabase, orgId, params);
    case 'update_lead_status':
      return updateLeadStatus(supabase, orgId, params);
    case 'send_invoice':
      return sendInvoice(supabase, orgId, params);
    case 'record_payment':
      return recordPayment(supabase, orgId, params);
    default:
      return { success: false, summary: `Unknown action type: ${actionType}` };
  }
}
