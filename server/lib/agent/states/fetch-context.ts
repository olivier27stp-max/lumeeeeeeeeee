/* State: fetch_context — Fetch relevant CRM data based on intent */

import type { AgentContext, AgentState } from '../types';

export async function fetchContext(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const data: Record<string, unknown> = {};
  const admin = ctx.supabase;
  const orgId = ctx.orgId;

  try {
    const domain = ctx.intent?.domain || 'general';
    const entities = ctx.intent?.entities || {};

    // Fetch based on domain and entities
    if (entities.client_name || entities.client_id || domain === 'followup') {
      const query = admin.from('clients').select('id, first_name, last_name, email, phone, company, address')
        .eq('org_id', orgId).is('deleted_at', null).limit(5);

      if (entities.client_id) {
        query.eq('id', entities.client_id);
      } else if (entities.client_name) {
        query.or(`first_name.ilike.%${entities.client_name}%,last_name.ilike.%${entities.client_name}%,company.ilike.%${entities.client_name}%`);
      }

      const { data: clients } = await query;
      if (clients?.length) data.clients = clients;
    }

    if (entities.job_id || domain === 'team_assignment' || domain === 'scheduling') {
      const query = admin.from('jobs').select('id, title, status, client_name, team_id, scheduled_at, total_cents, description, job_type')
        .eq('org_id', orgId).is('deleted_at', null).limit(10);

      if (entities.job_id) {
        query.eq('id', entities.job_id);
      } else {
        query.order('created_at', { ascending: false });
      }

      const { data: jobs } = await query;
      if (jobs?.length) data.jobs = jobs;
    }

    if (entities.quote_id || domain === 'pricing') {
      const query = admin.from('quotes').select('id, quote_number, client_id, status, total_cents, valid_until, items')
        .eq('org_id', orgId).is('deleted_at', null).limit(5);

      if (entities.quote_id) {
        query.eq('id', entities.quote_id);
      } else {
        query.order('created_at', { ascending: false });
      }

      const { data: quotes } = await query;
      if (quotes?.length) data.quotes = quotes;
    }

    if (domain === 'team_assignment' || domain === 'scheduling') {
      const { data: teams } = await admin.from('teams')
        .select('id, name, color_hex, description, is_active')
        .eq('org_id', orgId).is('deleted_at', null).eq('is_active', true)
        .limit(20);

      if (teams?.length) data.teams = teams;
    }

    if (domain === 'invoicing' || entities.invoice_id) {
      const query = admin.from('invoices').select('id, invoice_number, client_id, status, total_cents, due_date')
        .eq('org_id', orgId).is('deleted_at', null).limit(5);

      if (entities.invoice_id) {
        query.eq('id', entities.invoice_id);
      } else {
        query.order('created_at', { ascending: false });
      }

      const { data: invoices } = await query;
      if (invoices?.length) data.invoices = invoices;
    }

    // Always fetch basic dashboard stats for context
    const { count: jobCount } = await admin.from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId).is('deleted_at', null).eq('status', 'in_progress');

    const { count: leadCount } = await admin.from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId).is('deleted_at', null).in('status', ['new', 'follow_up_1', 'follow_up_2']);

    data.stats = { activeJobs: jobCount || 0, activeLeads: leadCount || 0 };

  } catch (err: any) {
    ctx.errors.push(`Context fetch failed: ${err?.message}`);
    console.warn('[agent/fetch-context] Error:', err?.message);
  }

  ctx.crmData = data;
  return { next: 'check_memory', ctx };
}
