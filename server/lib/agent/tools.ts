/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Tool registry
   ─────────────────────────────────────────────────────────────
   READ tools run server-side against the caller's RLS-scoped
   Supabase client (org isolation enforced by RLS + explicit org_id).
   WRITE tools are NEVER executed here: calling one produces a
   *proposal* that is surfaced to the user for confirmation. The
   actual mutation runs client-side via the existing *Api.ts helpers
   only after the user clicks "Confirm".
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FunctionDeclaration } from './gemini';

export interface ToolContext {
  client: SupabaseClient;
  orgId: string;
  userId: string;
}

export type ToolKind = 'read' | 'write';

export interface AgentTool {
  declaration: FunctionDeclaration;
  kind: ToolKind;
  /** Present only for read tools. Returns a JSON-serialisable result. */
  handler?: (args: Record<string, any>, ctx: ToolContext) => Promise<any>;
}

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

const fullName = (r: any) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

// ─────────────────────────────────────────────────────────────────
// READ TOOLS
// ─────────────────────────────────────────────────────────────────

const searchClients: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'search_clients',
    description:
      'Search the CRM clients by name, company, email, phone, or city. Returns matching clients with their id (needed to create quotes/invoices/jobs or send SMS), contact info and city.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (name, company, email, phone, or city).' },
        limit: { type: 'integer', description: 'Max results (default 10, max 25).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 10, 25);
    let q = ctx.client
      .from('clients')
      .select('id, first_name, last_name, company, email, phone, address, city, status')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .limit(limit);
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      q = q.or(
        `first_name.ilike.%${t}%,last_name.ilike.%${t}%,company.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%,city.ilike.%${t}%`,
      );
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
      count: data?.length || 0,
      clients: (data || []).map((c) => ({
        id: c.id,
        name: fullName(c),
        company: c.company,
        email: c.email,
        phone: c.phone,
        city: c.city,
        address: c.address,
        status: c.status,
      })),
    };
  },
};

const searchLeads: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'search_leads',
    description: 'Search CRM leads (prospects) by name, company, email or phone. Returns matching leads with their id and status.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text.' },
        limit: { type: 'integer', description: 'Max results (default 10, max 25).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 10, 25);
    let q = ctx.client
      .from('leads_active')
      .select('id, first_name, last_name, company, email, phone, status, value, address')
      .eq('org_id', ctx.orgId)
      .limit(limit);
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      q = q.or(
        `first_name.ilike.%${t}%,last_name.ilike.%${t}%,company.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`,
      );
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
      count: data?.length || 0,
      leads: (data || []).map((l) => ({
        id: l.id,
        name: fullName(l),
        company: l.company,
        email: l.email,
        phone: l.phone,
        status: l.status,
        value: l.value,
        address: l.address,
      })),
    };
  },
};

const listJobs: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_jobs',
    description: 'List jobs (work orders) in the CRM, optionally filtered by status or a search term. Returns job number, title, client, address, schedule, status and total.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter, e.g. 'scheduled', 'completed', 'draft', 'in_progress'." },
        query: { type: 'string', description: 'Optional search text (job number, title, address, client).' },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 15, 30);
    let q = ctx.client
      .from('jobs_active')
      .select('id, job_number, title, client_name, property_address, scheduled_at, end_at, status, total_cents, currency')
      .eq('org_id', ctx.orgId)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (args.status) q = q.eq('status', String(args.status));
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      q = q.or(`job_number.ilike.%${t}%,title.ilike.%${t}%,property_address.ilike.%${t}%,client_name.ilike.%${t}%`);
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { count: data?.length || 0, jobs: data || [] };
  },
};

const getJob: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_job',
    description: 'Get the full details of a single job by its id.',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'The job id.' } },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) => {
    const { data, error } = await ctx.client
      .from('jobs_active')
      .select('id, job_number, title, description, client_name, client_id, property_address, scheduled_at, end_at, status, total_cents, currency, job_type, requires_invoicing, notes')
      .eq('org_id', ctx.orgId)
      .eq('id', String(args.job_id))
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: 'Job not found.' };
    return data;
  },
};

// Shared helper: schedule events joined to their jobs, optional location filter.
async function fetchScheduleEvents(
  ctx: ToolContext,
  opts: { startDate?: string; endDate?: string; location?: string },
) {
  const start = opts.startDate ? new Date(opts.startDate) : new Date();
  const end = opts.endDate ? new Date(opts.endDate) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const startIso = isNaN(start.getTime()) ? new Date().toISOString() : start.toISOString();
  const endIso = isNaN(end.getTime()) ? new Date(Date.now() + 90 * 86400000).toISOString() : end.toISOString();

  const { data: events, error: evErr } = await ctx.client
    .from('schedule_events')
    .select('id, job_id, start_at, end_at, status')
    .eq('org_id', ctx.orgId)
    .is('deleted_at', null)
    .gte('start_at', startIso)
    .lte('start_at', endIso)
    .order('start_at', { ascending: true })
    .limit(200);
  if (evErr) return { error: evErr.message };

  const jobIds = Array.from(new Set((events || []).map((e) => e.job_id).filter(Boolean)));
  if (jobIds.length === 0) return { count: 0, events: [] };

  let jobsQ = ctx.client
    .from('jobs')
    .select('id, title, client_name, property_address, status, total_cents')
    .eq('org_id', ctx.orgId)
    .is('deleted_at', null)
    .in('id', jobIds);
  const loc = String(opts.location || '').trim();
  if (loc) jobsQ = jobsQ.ilike('property_address', `%${loc.replace(/[%,()]/g, ' ')}%`);
  const { data: jobs, error: jobErr } = await jobsQ;
  if (jobErr) return { error: jobErr.message };

  const jobMap = new Map((jobs || []).map((j) => [j.id, j]));
  const result = (events || [])
    .filter((e) => jobMap.has(e.job_id))
    .map((e) => {
      const j = jobMap.get(e.job_id)!;
      return {
        start_at: e.start_at,
        end_at: e.end_at,
        event_status: e.status,
        job_title: j.title,
        client_name: j.client_name,
        address: j.property_address,
        total_cents: j.total_cents,
      };
    });
  return { count: result.length, events: result };
}

const findDatesInLocation: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'find_dates_in_location',
    description:
      "Find the scheduled dates where the team works in a given city or location (e.g. 'Bromont'). Searches the calendar by the job's property address. Use this to answer questions like 'what are our dates in Bromont?'.",
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or location name to search the schedule for (e.g. Bromont).' },
        start_date: { type: 'string', description: 'Optional ISO date to start from (default: today).' },
        end_date: { type: 'string', description: 'Optional ISO date to end at (default: 90 days from now).' },
      },
      required: ['location'],
    },
  },
  handler: async (args, ctx) =>
    fetchScheduleEvents(ctx, { location: String(args.location), startDate: args.start_date, endDate: args.end_date }),
};

const querySchedule: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'query_schedule',
    description: 'List scheduled calendar events between two dates (jobs with date, client, address and status). Use for "what is scheduled this week?" type questions.',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'ISO date (inclusive). Default: today.' },
        end_date: { type: 'string', description: 'ISO date (inclusive). Default: 30 days from now.' },
      },
    },
  },
  handler: async (args, ctx) =>
    fetchScheduleEvents(ctx, {
      startDate: args.start_date,
      endDate: args.end_date || new Date(Date.now() + 30 * 86400000).toISOString(),
    }),
};

const listQuotes: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_quotes',
    description: 'List quotes, optionally filtered by status or a search term. Returns quote number, title, status and total.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter, e.g. 'draft', 'sent', 'accepted', 'rejected'." },
        query: { type: 'string', description: 'Optional search (quote number or title).' },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 15, 30);
    let q = ctx.client
      .from('quotes')
      .select('id, quote_number, title, status, total_cents, currency, valid_until, created_at')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (args.status) q = q.eq('status', String(args.status));
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      q = q.or(`quote_number.ilike.%${t}%,title.ilike.%${t}%`);
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { count: data?.length || 0, quotes: data || [] };
  },
};

const listInvoices: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_invoices',
    description: 'List invoices, optionally filtered by status (all, draft, past_due, paid). Returns invoice number, client, status, total and balance.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "One of: all, draft, sent_not_due, past_due, paid. Default all." },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 15, 30);
    const { data, error } = await ctx.client.rpc('rpc_list_invoices', {
      p_status: String(args.status || 'all'),
      p_range: 'all',
      p_q: null,
      p_sort: 'recent',
      p_limit: limit,
      p_offset: 0,
      p_from: null,
      p_to: null,
      p_org: null,
    });
    if (error) return { error: error.message };
    const rows = Array.isArray(data) ? data : (data as any)?.items || [];
    return {
      count: rows.length,
      invoices: rows.slice(0, limit).map((r: any) => ({
        id: r.id,
        invoice_number: r.invoice_number,
        client_name: r.client_name,
        status: r.status,
        total_cents: r.total_cents,
        balance_cents: r.balance_cents,
        due_date: r.due_date,
      })),
    };
  },
};

const getCompanyInfo: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_company_info',
    description: "Get the user's own company details (name, email, phone, address). Use when asked about the business itself.",
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('company_settings')
      .select('company_name, email, phone, website, street1, city, province, postal_code')
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) return { error: error.message };
    return data || { company_name: null };
  },
};

// ─────────────────────────────────────────────────────────────────
// WRITE TOOLS (proposal-only — never executed server-side)
// ─────────────────────────────────────────────────────────────────

const lineItemSchema = {
  type: 'array',
  description: 'Line items.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Item/service name.' },
      description: { type: 'string', description: 'Optional details.' },
      quantity: { type: 'number', description: 'Quantity (default 1).' },
      unit_price_cents: { type: 'integer', description: 'Unit price in CENTS (e.g. $500.00 = 50000).' },
    },
    required: ['name', 'unit_price_cents'],
  },
};

const createQuote: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'create_quote',
    description:
      'Propose creating a quote. Requires a client_id OR lead_id (look it up first with search_clients/search_leads). Does NOT create anything — it asks the user to confirm. Only call once all line items and the recipient are known.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Existing client id (preferred).' },
        lead_id: { type: 'string', description: 'Existing lead id (if quoting a lead).' },
        title: { type: 'string', description: 'Quote title.' },
        line_items: lineItemSchema,
        valid_days: { type: 'integer', description: 'Validity in days (default 30).' },
        notes: { type: 'string', description: 'Optional notes.' },
      },
      required: ['title', 'line_items'],
    },
  },
};

const createInvoice: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'create_invoice',
    description:
      'Propose creating an invoice for a client. Requires client_id (look it up with search_clients). Does NOT create anything until the user confirms.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Existing client id.' },
        subject: { type: 'string', description: 'Invoice subject/title.' },
        due_date: { type: 'string', description: 'Optional ISO due date (YYYY-MM-DD).' },
        items: {
          type: 'array',
          description: 'Invoice items.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Item description.' },
              qty: { type: 'number', description: 'Quantity (default 1).' },
              unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
            },
            required: ['description', 'unit_price_cents'],
          },
        },
        tax_cents: { type: 'integer', description: 'Optional total tax in cents.' },
      },
      required: ['client_id', 'items'],
    },
  },
};

const createJob: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'create_job',
    description: 'Propose creating a job (work order). Does NOT create anything until the user confirms.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Job title.' },
        client_id: { type: 'string', description: 'Existing client id (optional).' },
        property_address: { type: 'string', description: 'Job site address (optional).' },
        scheduled_at: { type: 'string', description: 'Optional ISO datetime for the visit.' },
        description: { type: 'string', description: 'Optional description.' },
        line_items: {
          type: 'array',
          description: 'Optional line items.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              qty: { type: 'number' },
              unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
            },
            required: ['name', 'unit_price_cents'],
          },
        },
      },
      required: ['title'],
    },
  },
};

const sendSms: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'send_sms',
    description:
      'Propose sending an SMS to a client. Requires the phone number (look up the client with search_clients first). Does NOT send anything until the user confirms.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Existing client id (optional but recommended).' },
        client_name: { type: 'string', description: 'Client name for display (optional).' },
        phone_number: { type: 'string', description: 'Recipient phone number.' },
        message_text: { type: 'string', description: 'The SMS body to send.' },
      },
      required: ['phone_number', 'message_text'],
    },
  },
};

// ─────────────────────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  searchClients,
  searchLeads,
  listJobs,
  getJob,
  findDatesInLocation,
  querySchedule,
  listQuotes,
  listInvoices,
  getCompanyInfo,
  createQuote,
  createInvoice,
  createJob,
  sendSms,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.declaration.name, t]),
);

export const TOOL_DECLARATIONS: FunctionDeclaration[] = AGENT_TOOLS.map((t) => t.declaration);
