import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { Job } from '../types';
import type { JobDraftInitialValues } from '../components/NewJobModal';
import { calculateJobFinancials, type CalcLineItem, type TaxLine } from './jobCalc';
import { resolveClientIdForLead } from './leadsApi';
import { emitJobCompleted } from './automationEventsApi';
import { invalidateScheduleCache } from './scheduleApi';

export type JobSort = 'client' | 'job_number' | 'schedule' | 'status' | 'total';
export type JobSortDirection = 'asc' | 'desc';

export interface JobsQuery {
  status?: string;
  jobType?: string;
  clientId?: string;
  q?: string;
  sort?: JobSort;
  sortDirection?: JobSortDirection;
  page?: number;
  pageSize?: number;
}

export interface JobsResult {
  jobs: Job[];
  total: number;
}

export interface JobsKpis {
  ending_within_30: number;
  late: number;
  requires_invoicing: number;
  action_required: number;
  unscheduled: number;
  recent_visits: number;
  recent_visits_prev: number;
  visits_scheduled: number;
  visits_scheduled_prev: number;
}

export interface JobLineItemInput {
  name: string;
  qty: number;
  unit_price_cents: number;
  included?: boolean;
}

export interface SalespersonOption {
  id: string;
  label: string;
}

export interface JobModalDraft extends JobDraftInitialValues {
  id: string;
}

export interface SoftDeleteJobResult {
  job: number;
}

const SORT_MAP: Record<JobSort, string> = {
  client: 'client_name',
  job_number: 'job_number',
  schedule: 'scheduled_at',
  status: 'status',
  total: 'total_cents',
};

const isDev = import.meta.env.DEV;

function devLogJobWrite(label: string, payload: Record<string, any>) {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console.debug(`[jobs:${label}]`, payload);
}

function isMissingJobLineItemsTableError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return (
    message.includes("could not find the table 'public.job_line_items'") ||
    message.includes('relation "public.job_line_items" does not exist') ||
    code === 'PGRST205' ||
    code === '42P01'
  );
}

/**
 * Derive the display status for a job, taking into account business rules:
 * - "Late": job is scheduled but the date has passed
 * - "Action Required": job is scheduled but date passed > 30 days ago
 * - "Requires Invoicing": job is completed + requires_invoicing flag
 * - "Unscheduled": job has no scheduled_at or is draft
 */
function deriveJobDisplayStatus(raw: {
  status?: string | null;
  scheduled_at?: string | null;
  requires_invoicing?: boolean;
}): string {
  const dbStatus = (raw.status || '').toLowerCase();
  const scheduledAt = raw.scheduled_at ? new Date(raw.scheduled_at) : null;
  const now = new Date();

  // Draft or no schedule → Unscheduled
  if (!dbStatus || dbStatus === 'draft') {
    return scheduledAt ? 'Draft' : 'Unscheduled';
  }

  // Scheduled but date is in the past
  if (dbStatus === 'scheduled' && scheduledAt) {
    const daysSince = (now.getTime() - scheduledAt.getTime()) / 86400000;
    if (daysSince > 30) return 'Action Required';
    if (daysSince > 0) return 'Late';
    return 'Scheduled';
  }
  if (dbStatus === 'scheduled') return 'Scheduled';

  // Completed + requires invoicing
  if (dbStatus === 'completed' && raw.requires_invoicing) return 'Requires Invoicing';
  if (dbStatus === 'completed') return 'Completed';

  if (dbStatus === 'in_progress') return 'In Progress';
  if (dbStatus === 'cancelled' || dbStatus === 'canceled') return 'Cancelled';

  // Fallback
  return dbStatus
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/** Simple label formatter (no business logic — used when raw context is unavailable) */
function formatStatusLabel(value: string | null | undefined): string {
  if (!value) return 'Unscheduled';
  const normalized = value.toLowerCase();
  if (normalized === 'draft') return 'Draft';
  if (normalized === 'scheduled') return 'Scheduled';
  if (normalized === 'in_progress') return 'In Progress';
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'Cancelled';
  if (normalized === 'requires_invoicing') return 'Requires Invoicing';
  if (normalized === 'action_required') return 'Action Required';
  return normalized
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function normalizeStatusValue(status: string): string {
  const normalized = status.trim().toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return 'draft';

  if (normalized === 'scheduled') return 'scheduled';
  if (normalized === 'in_progress') return 'in_progress';
  if (normalized === 'completed' || normalized === 'done' || normalized === 'closed') return 'completed';
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'lost') return 'cancelled';
  if (normalized === 'draft') return 'draft';

  // Legacy/non-job states map back to valid job lifecycle.
  if (normalized === 'unscheduled' || normalized === 'late' || normalized === 'action_required' || normalized === 'qualified' || normalized === 'quote_sent') {
    return 'draft';
  }
  if (normalized === 'requires_invoicing') return 'completed';

  return 'draft';
}

function normalizeAddressValue(address: string | null | undefined): string {
  return String(address || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function syncJobSchedule(payload: {
  jobId: string;
  teamId?: string | null;
  scheduledAt?: string | null;
  endAt?: string | null;
}) {
  if (payload.scheduledAt && payload.endAt) {
    const { error, status } = await supabase.rpc('rpc_schedule_job', {
      p_job_id: payload.jobId,
      p_start_at: payload.scheduledAt,
      p_end_at: payload.endAt,
      p_team_id: payload.teamId ?? null,
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Montreal',
    });
    devLogJobWrite('rpc_schedule_job_response', {
      job_id: payload.jobId,
      status,
      error: error ? { code: error.code, message: error.message } : null,
      start_at: payload.scheduledAt,
      end_at: payload.endAt,
    });
    if (error) throw error;
    return;
  }

  const { error, status } = await supabase.rpc('rpc_unschedule_job', {
    p_job_id: payload.jobId,
    p_event_id: null,
  });
  devLogJobWrite('rpc_unschedule_job_response', {
    job_id: payload.jobId,
    status,
    error: error ? { code: error.code, message: error.message } : null,
  });
  if (error) throw error;
}

function mapJob(raw: any, clientNameFallback?: string | null): Job {
  return {
    id: raw.id,
    org_id: raw.org_id,
    lead_id: raw.lead_id ?? null,
    job_number: raw.job_number || String(raw.id).slice(0, 8),
    title: raw.title || '',
    client_id: raw.client_id ?? null,
    team_id: raw.team_id ?? null,
    client_name: raw.client_name ?? clientNameFallback ?? null,
    property_address: raw.property_address || '',
    scheduled_at: raw.scheduled_at || null,
    end_at: raw.end_at || null,
    status: deriveJobDisplayStatus(raw),
    total_cents: raw.total_cents ?? Math.round(Number(raw.total_amount || 0) * 100),
    currency: raw.currency || 'CAD',
    subtotal: raw.subtotal == null ? undefined : Number(raw.subtotal),
    tax_total: raw.tax_total == null ? undefined : Number(raw.tax_total),
    total: raw.total == null ? undefined : Number(raw.total),
    tax_lines: Array.isArray(raw.tax_lines) ? raw.tax_lines : [],
    job_type: raw.job_type || null,
    salesperson_id: raw.salesperson_id || null,
    requires_invoicing: !!raw.requires_invoicing,
    billing_split: !!raw.billing_split,
    notes: raw.notes || null,
    latitude: raw.latitude == null ? null : Number(raw.latitude),
    longitude: raw.longitude == null ? null : Number(raw.longitude),
    geocode_status: raw.geocode_status || null,
    geocoded_at: raw.geocoded_at || null,
    invoice_url: raw.invoice_url || null,
    attachments: raw.attachments || null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

function buildSearchFilter(search: string): string {
  const term = `%${search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
  return [
    `job_number.ilike.${term}`,
    `title.ilike.${term}`,
    `description.ilike.${term}`,
    `property_address.ilike.${term}`,
    `client_name.ilike.${term}`,
  ].join(',');
}

async function loadClientNames(clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company')
    .is('deleted_at', null)
    .in('id', clientIds);

  if (error) return new Map();

  const map = new Map<string, string>();
  for (const row of data || []) {
    const label = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.company || '-';
    map.set(row.id, label);
  }
  return map;
}

function applyTableFilters(request: any, query: JobsQuery) {
  let builder = request;
  const { status, jobType, clientId, q } = query;
  if (status && status !== 'All') {
    const normalized = status.trim().toLowerCase().replace(/\s+/g, '_');
    if (normalized === 'unscheduled') {
      // Jobs without a scheduled date or in draft status
      builder = builder.or('scheduled_at.is.null,status.eq.draft');
    } else if (normalized === 'late') {
      // Scheduled jobs whose scheduled_at is in the past
      builder = builder.eq('status', 'scheduled').lt('scheduled_at', new Date().toISOString());
    } else if (normalized === 'requires_invoicing' || normalized === 'requires invoicing') {
      // Completed jobs that need invoicing
      builder = builder.eq('status', 'completed').eq('requires_invoicing', true);
    } else if (normalized === 'action_required' || normalized === 'action required') {
      // Scheduled jobs whose scheduled_at is more than 30 days in the past
      const minus30 = new Date(Date.now() - 30 * 86400000).toISOString();
      builder = builder.eq('status', 'scheduled').lt('scheduled_at', minus30);
    } else if (normalized === 'ending_within_30' || normalized === 'ending within 30 days' || normalized === 'ending_within_30_days') {
      // Jobs scheduled within the next 30 days
      const now = new Date().toISOString();
      const plus30 = new Date(Date.now() + 30 * 86400000).toISOString();
      builder = builder.gte('scheduled_at', now).lte('scheduled_at', plus30);
    } else {
      // Direct DB status match
      builder = builder.eq('status', normalizeStatusValue(status));
    }
  }
  if (jobType && jobType !== 'All') builder = builder.eq('job_type', jobType);
  if (clientId && clientId !== 'All') builder = builder.eq('client_id', clientId);
  if (q && q.trim()) builder = builder.or(buildSearchFilter(q));
  return builder;
}

export async function getJobs(query: JobsQuery): Promise<JobsResult> {
  const { sort = 'schedule', sortDirection = 'asc', page = 1, pageSize = 20 } = query;
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let request = supabase.from('jobs_active').select('*', { count: 'exact' }).range(rangeFrom, rangeTo);
  request = applyTableFilters(request, query);
  request = request.order(SORT_MAP[sort], { ascending: sortDirection === 'asc', nullsFirst: true });
  request = request.order('created_at', { ascending: false });

  const { data, error, count } = await request;
  if (error) throw error;
  const rows = data || [];
  const clientMap = await loadClientNames(rows.map((job: any) => job.client_id).filter(Boolean) as string[]);

  return {
    jobs: rows.map((row: any) => mapJob(row, row.client_id ? clientMap.get(row.client_id) : null)),
    total: count || 0,
  };
}

export async function getJobsKpis(params: { status?: string; jobType?: string; q?: string }): Promise<JobsKpis> {
  const now = new Date();
  const plus30 = new Date(now.getTime() + 30 * 86400000);
  const minus30 = new Date(now.getTime() - 30 * 86400000);
  const minus60 = new Date(now.getTime() - 60 * 86400000);

  let request = supabase.from('jobs_active').select('id,status,scheduled_at,requires_invoicing').limit(5000);
  request = applyTableFilters(request, params);

  const { data, error } = await request;
  if (error) throw error;
  const rawRows = data || [];
  const jobs = rawRows.map((row: any) => mapJob(row));

  const endingWithin30 = jobs.filter((j) => j.scheduled_at && new Date(j.scheduled_at) >= now && new Date(j.scheduled_at) <= plus30).length;
  // Derive virtual KPI statuses from real DB fields
  const late = rawRows.filter((r: any) => r.status === 'scheduled' && r.scheduled_at && new Date(r.scheduled_at) < now).length;
  const requiresInvoicing = rawRows.filter((r: any) => r.status === 'completed' && r.requires_invoicing).length;
  const actionRequired = rawRows.filter((r: any) => r.status === 'scheduled' && r.scheduled_at && new Date(r.scheduled_at) < minus30).length;
  const unscheduled = rawRows.filter((r: any) => !r.scheduled_at || r.status === 'draft').length;
  const recentVisits = jobs.filter((j) => j.scheduled_at && new Date(j.scheduled_at) >= minus30 && new Date(j.scheduled_at) <= now).length;
  const prevRecentVisits = jobs.filter((j) => j.scheduled_at && new Date(j.scheduled_at) >= minus60 && new Date(j.scheduled_at) < minus30).length;
  const visitsScheduled = jobs.filter((j) => j.scheduled_at && new Date(j.scheduled_at) >= now && new Date(j.scheduled_at) <= plus30).length;
  const prevVisitsScheduled = jobs.filter((j) => j.scheduled_at && new Date(j.scheduled_at) >= minus30 && new Date(j.scheduled_at) < now).length;

  return {
    ending_within_30: endingWithin30,
    late,
    requires_invoicing: requiresInvoicing,
    action_required: actionRequired,
    unscheduled,
    recent_visits: recentVisits,
    recent_visits_prev: prevRecentVisits,
    visits_scheduled: visitsScheduled,
    visits_scheduled_prev: prevVisitsScheduled,
  };
}

export async function getJobTypes(): Promise<string[]> {
  const { data, error } = await supabase.from('jobs_active').select('job_type').not('job_type', 'is', null).limit(500);
  if (error) throw error;
  const types = new Set<string>();
  (data || []).forEach((row: { job_type: string | null }) => {
    if (row.job_type) types.add(row.job_type);
  });
  return Array.from(types).sort();
}

export async function getJobById(id: string): Promise<Job | null> {
  const { data, error } = await supabase.from('jobs_active').select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  if (!data) return null;
  let clientName: string | null = null;
  if (data.client_id) {
    const clientMap = await loadClientNames([data.client_id]);
    clientName = clientMap.get(data.client_id) ?? null;
  }
  return mapJob(data, clientName);
}

export async function getJobModalDraftById(id: string): Promise<JobModalDraft | null> {
  const { data: jobRow, error: jobError } = await supabase.from('jobs_active').select('*').eq('id', id).maybeSingle();
  if (jobError) throw jobError;
  if (!jobRow) return null;

  let lineItems: Array<{ name: string; qty: number; unit_price_cents: number; included?: boolean }> = [];
  const { data: lineItemsData, error: lineItemsError } = await supabase
    .from('job_line_items')
    .select('name,qty,unit_price_cents,included')
    .eq('job_id', id)
    .order('created_at', { ascending: true });
  if (lineItemsError) {
    if (!isMissingJobLineItemsTableError(lineItemsError)) throw lineItemsError;
  } else {
    lineItems = (lineItemsData || []) as Array<{ name: string; qty: number; unit_price_cents: number; included?: boolean }>;
  }

  return {
    id: jobRow.id,
    lead_id: jobRow.lead_id ?? null,
    title: jobRow.title || '',
    client_id: jobRow.client_id ?? null,
    team_id: jobRow.team_id ?? null,
    job_number: jobRow.job_number ?? null,
    salesperson_id: jobRow.salesperson_id ?? null,
    job_type: (jobRow.job_type as 'one_off' | 'recurring' | null) ?? 'one_off',
    property_address: jobRow.property_address ?? null,
    address_line1: jobRow.address_line1 ?? null,
    address_line2: jobRow.address_line2 ?? null,
    city: jobRow.city ?? null,
    province: jobRow.province ?? null,
    postal_code: jobRow.postal_code ?? null,
    country: jobRow.country ?? 'Canada',
    description: jobRow.notes || jobRow.description || null,
    status: formatStatusLabel(jobRow.status),
    requires_invoicing: !!jobRow.requires_invoicing,
    billing_split: !!jobRow.billing_split,
    subtotal: jobRow.subtotal == null ? null : Number(jobRow.subtotal),
    tax_total: jobRow.tax_total == null ? null : Number(jobRow.tax_total),
    total: jobRow.total == null ? null : Number(jobRow.total),
    tax_lines: Array.isArray(jobRow.tax_lines) ? jobRow.tax_lines : [],
    scheduled_at: jobRow.scheduled_at || null,
    end_at: jobRow.end_at || null,
    line_items: (lineItems || []).map((row) => ({
      name: row.name,
      qty: Number(row.qty || 1),
      unit_price_cents: Number(row.unit_price_cents || 0),
      included: row.included !== false,
    })),
  };
}

/** Check if a time slot has scheduling conflicts */
export async function checkScheduleConflict(scheduledAt: string, durationHours = 2, excludeJobId?: string): Promise<{ hasConflict: boolean; conflicts: Array<{ id: string; title: string; client_name: string; scheduled_at: string }> }> {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + durationHours * 3600000);

  let query = supabase
    .from('schedule_events')
    .select('id, job_id, start_time, end_time, jobs!inner(id, title, client_name)')
    .lt('start_time', end.toISOString())
    .gt('end_time', start.toISOString())
    .is('deleted_at', null);

  const { data } = await query;
  const conflicts = (data ?? [])
    .filter((e: any) => !excludeJobId || e.job_id !== excludeJobId)
    .map((e: any) => ({
      id: e.job_id,
      title: e.jobs?.title ?? '',
      client_name: e.jobs?.client_name ?? '',
      scheduled_at: e.start_time,
    }));

  return { hasConflict: conflicts.length > 0, conflicts };
}

export async function createJob(payload: {
  id?: string;
  lead_id?: string | null;
  title: string;
  job_number?: string | null;
  client_id?: string | null;
  team_id?: string | null;
  salesperson_id?: string | null;
  description?: string | null;
  job_type?: string | null;
  property_address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  place_id?: string | null;
  scheduled_at?: string | null;
  end_at?: string | null;
  status: string;
  total_cents?: number;
  total_amount?: number;
  currency?: string;
  requires_invoicing?: boolean;
  billing_split?: boolean;
  line_items?: JobLineItemInput[];
  deposit_required?: boolean;
  deposit_type?: 'percentage' | 'fixed' | null;
  deposit_value?: number;
  require_payment_method?: boolean;
  subtotal?: number;
  tax_total?: number;
  total?: number;
  tax_lines?: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
}): Promise<Job> {
  const orgId = await getCurrentOrgIdOrThrow();

  // Auto-resolve client_id from lead_id if not provided
  if (payload.lead_id && !payload.client_id) {
    const resolvedClientId = await resolveClientIdForLead(payload.lead_id);
    if (resolvedClientId) {
      payload.client_id = resolvedClientId;
    }
  }

  devLogJobWrite('submit_payload', {
    org_id: orgId,
    jobId: payload.id || null,
    lead_id: payload.lead_id || null,
    client_id: payload.client_id || null,
    title: payload.title,
    start_at: payload.scheduled_at || null,
    end_at: payload.end_at || null,
    subtotal: payload.subtotal ?? null,
    tax_total: payload.tax_total ?? null,
    total: payload.total ?? null,
    total_cents: payload.total_cents ?? null,
    line_items_count: Array.isArray(payload.line_items) ? payload.line_items.length : 0,
  });

  let clientName: string | null = null;
  let clientAddress: string | null = null;
  let shouldQueueGeocode = false;
  if (payload.client_id) {
    const { data: clientRow, error: clientError } = await supabase
      .from('clients')
      .select('id,first_name,last_name,company,address')
      .is('deleted_at', null)
      .eq('id', payload.client_id)
      .single();
    if (clientError) throw clientError;
    clientName = [clientRow.first_name, clientRow.last_name].filter(Boolean).join(' ').trim() || clientRow.company || null;
    clientAddress = clientRow.address || null;
  }

  let data: any;
  if (payload.id) {
    const { data: existingJob, error: existingJobError } = await supabase
      .from('jobs')
      .select('property_address')
      .eq('id', payload.id)
      .maybeSingle();
    if (existingJobError) throw existingJobError;

    const nextAddress = payload.property_address || clientAddress || '-';
    shouldQueueGeocode = normalizeAddressValue(existingJob?.property_address) !== normalizeAddressValue(nextAddress);

    const updatePayload: Record<string, any> = {
      title: payload.title,
      lead_id: payload.lead_id || null,
      job_number: payload.job_number || null,
      notes: payload.description || null,
      job_type: payload.job_type || null,
      property_address: nextAddress,
      address: nextAddress,
      scheduled_at: payload.scheduled_at || null,
      end_at: payload.end_at || null,
      status: normalizeStatusValue(payload.status || 'scheduled'),
      total_amount: payload.total_amount ?? Number((payload.total_cents || 0) / 100),
      total_cents: payload.total_cents ?? Math.round(Number(payload.total_amount || 0) * 100),
      currency: payload.currency || 'CAD',
      client_id: payload.client_id || null,
      team_id: payload.team_id || null,
      client_name: clientName,
      salesperson_id: payload.salesperson_id || null,
      requires_invoicing: payload.requires_invoicing ?? false,
      billing_split: payload.billing_split ?? false,
      subtotal: payload.subtotal ?? Number((payload.total_cents || 0) / 100),
      tax_total: payload.tax_total ?? 0,
      total: payload.total ?? Number((payload.total_cents || 0) / 100),
      tax_lines: payload.tax_lines ?? [],
      updated_at: new Date().toISOString(),
    };

    // Include structured address fields if provided
    if (payload.address_line1 !== undefined) updatePayload.address_line1 = payload.address_line1 || null;
    if (payload.address_line2 !== undefined) updatePayload.address_line2 = payload.address_line2 || null;
    if (payload.city !== undefined) updatePayload.city = payload.city || null;
    if (payload.province !== undefined) updatePayload.province = payload.province || null;
    if (payload.postal_code !== undefined) updatePayload.postal_code = payload.postal_code || null;
    if (payload.country !== undefined) updatePayload.country = payload.country || 'Canada';
    if (payload.place_id !== undefined) updatePayload.place_id = payload.place_id || null;

    if (shouldQueueGeocode) {
      updatePayload.geocode_status = 'pending';
      updatePayload.geocoded_at = null;
      updatePayload.latitude = null;
      updatePayload.longitude = null;
    }

    const { data: updated, error, status } = await supabase
      .from('jobs')
      .update(updatePayload)
      .eq('id', payload.id)
      .select('*')
      .single();
    devLogJobWrite('update_jobs_response', {
      org_id: orgId,
      status,
      error: error ? { code: error.code, message: error.message } : null,
      data_id: updated?.id || null,
    });
    if (error) throw error;
    if (!updated?.id) throw new Error('Job save failed: no id returned from database.');
    data = updated;
  } else {
    const { data: rpcData, error: rpcError, status: rpcStatus } = await supabase.rpc('rpc_create_job_with_optional_schedule', {
      p_lead_id: payload.lead_id || null,
      p_client_id: payload.client_id || null,
      p_team_id: payload.team_id || null,
      p_title: payload.title,
      p_job_number: payload.job_number || null,
      p_job_type: payload.job_type || null,
      p_status: payload.status || null,
      p_address: payload.property_address || clientAddress || '-',
      p_notes: payload.description || null,
      p_scheduled_at: payload.scheduled_at || null,
      p_end_at: payload.end_at || null,
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Montreal',
    });
    devLogJobWrite('rpc_create_job_with_optional_schedule_response', {
      org_id: orgId,
      status: rpcStatus,
      error: rpcError ? { code: rpcError.code, message: rpcError.message } : null,
      job_id: (rpcData as any)?.job_id || null,
    });
    if (rpcError) throw rpcError;
    const jobId = String((rpcData as any)?.job_id || '');
    if (!jobId) throw new Error('Job created but job_id is missing');
    const { data: created, error: fetchError, status: fetchStatus } = await supabase
      .from('jobs_active')
      .select('*')
      .eq('id', jobId)
      .single();
    devLogJobWrite('fetch_created_job_response', {
      org_id: orgId,
      status: fetchStatus,
      error: fetchError ? { code: fetchError.code, message: fetchError.message } : null,
      data_id: created?.id || null,
    });
    if (fetchError) throw fetchError;
    if (!created?.id) throw new Error('Job save failed: created row is missing id.');
    data = created;
    shouldQueueGeocode = normalizeAddressValue(data?.property_address) !== '';

    // Update structured address fields (RPC only stores property_address)
    if (payload.address_line1 || payload.city || payload.province) {
      await supabase.from('jobs').update({
        address_line1: payload.address_line1 || null,
        address_line2: payload.address_line2 || null,
        city: payload.city || null,
        province: payload.province || null,
        postal_code: payload.postal_code || null,
        country: payload.country || 'Canada',
        place_id: payload.place_id || null,
      }).eq('id', data.id);
    }

    if (shouldQueueGeocode) {
      const { error: pendingError, status: pendingStatus } = await supabase
        .from('jobs')
        .update({
          geocode_status: 'pending',
          geocoded_at: null,
          latitude: null,
          longitude: null,
        })
        .eq('id', data.id);
      devLogJobWrite('queue_geocode_response', {
        org_id: orgId,
        status: pendingStatus,
        error: pendingError ? { code: pendingError.code, message: pendingError.message } : null,
        data_id: data.id,
      });
      if (pendingError) throw pendingError;

      const { data: refreshed, error: refreshedError, status: refreshedStatus } = await supabase
        .from('jobs_active')
        .select('*')
        .eq('id', data.id)
        .single();
      devLogJobWrite('refresh_created_job_response', {
        org_id: orgId,
        status: refreshedStatus,
        error: refreshedError ? { code: refreshedError.code, message: refreshedError.message } : null,
        data_id: refreshed?.id || null,
      });
      if (refreshedError) throw refreshedError;
      if (!refreshed?.id) throw new Error('Job save failed: refreshed row is missing id.');
      data = refreshed;
    }
  }

  if (payload.id) {
    const { error: deleteItemsError, status: deleteItemsStatus } = await supabase
      .from('job_line_items')
      .delete()
      .eq('job_id', payload.id);
    devLogJobWrite('delete_line_items_response', {
      org_id: orgId,
      status: deleteItemsStatus,
      error: deleteItemsError ? { code: deleteItemsError.code, message: deleteItemsError.message } : null,
      job_id: payload.id,
    });
    if (deleteItemsError && !isMissingJobLineItemsTableError(deleteItemsError)) throw deleteItemsError;
  }

  if (payload.line_items && payload.line_items.length > 0) {
    const rows = payload.line_items
      .filter((item) => item.name.trim())
      .map((item) => ({
        job_id: data.id,
        name: item.name.trim(),
        qty: item.qty,
        unit_price_cents: item.unit_price_cents,
        total_cents: Math.max(0, Math.round(item.qty * item.unit_price_cents)),
        included: item.included !== false,
      }));
    if (rows.length > 0) {
      const { error: itemError, status: itemStatus } = await supabase.from('job_line_items').insert(rows);
      devLogJobWrite('insert_line_items_response', {
        org_id: orgId,
        status: itemStatus,
        error: itemError ? { code: itemError.code, message: itemError.message } : null,
        job_id: data.id,
        rows: rows.length,
      });
      if (itemError && !isMissingJobLineItemsTableError(itemError)) throw itemError;
    }
  }

  // ── Persist financial fields on the job row ──
  // For new jobs, the RPC doesn't accept financial params, so we update after line items are inserted.
  // For edited jobs, the upsert already sets them, but we recalculate from inserted items for consistency.
  {
    const calcItems: CalcLineItem[] = (payload.line_items || [])
      .filter((item) => item.name.trim() && item.included !== false)
      .map((item) => ({ qty: item.qty, unit_price_cents: item.unit_price_cents }));
    const calcTaxes: TaxLine[] = payload.tax_lines || [];
    const financials = calculateJobFinancials(calcItems, calcTaxes);

    const { error: finErr, status: finStatus } = await supabase
      .from('jobs')
      .update({
        subtotal: financials.subtotal,
        tax_total: financials.tax_amount,
        total: financials.total,
        total_cents: financials.total_cents,
        total_amount: financials.total,
        tax_lines: payload.tax_lines || [],
      })
      .eq('id', data.id);
    devLogJobWrite('persist_financials', {
      org_id: orgId,
      job_id: data.id,
      status: finStatus,
      error: finErr ? { code: finErr.code, message: finErr.message } : null,
      subtotal: financials.subtotal,
      tax_amount: financials.tax_amount,
      total: financials.total,
    });
    if (finErr) throw finErr;

    // Persist deposit settings if provided
    if (payload.deposit_required !== undefined) {
      const depositCents = payload.deposit_type === 'percentage'
        ? Math.round(financials.total_cents * (payload.deposit_value || 0) / 100)
        : Math.round((payload.deposit_value || 0) * 100);
      await supabase.from('jobs').update({
        deposit_required: payload.deposit_required || false,
        deposit_type: payload.deposit_required ? (payload.deposit_type || null) : null,
        deposit_value: payload.deposit_required ? (payload.deposit_value || 0) : 0,
        deposit_cents: payload.deposit_required ? depositCents : 0,
        require_payment_method: payload.require_payment_method || false,
        deposit_status: payload.deposit_required ? 'pending' : 'not_required',
      }).eq('id', data.id);
    }

    // Refresh data so returned job has correct values
    const { data: refreshedFin, error: refreshedFinErr } = await supabase
      .from('jobs_active')
      .select('*')
      .eq('id', data.id)
      .single();
    if (!refreshedFinErr && refreshedFin) data = refreshedFin;
  }

  if (payload.lead_id) {
    const convertedAt = new Date().toISOString();
    const { error: leadUpdateError } = await supabase
      .from('leads')
      .update({
        converted_job_id: data.id,
        converted_at: convertedAt,
      })
      .eq('id', payload.lead_id)
      .is('deleted_at', null);
    if (leadUpdateError) {
      // eslint-disable-next-line no-console
      console.error('[jobs] failed to link lead -> job conversion', {
        leadId: payload.lead_id,
        jobId: data.id,
        code: leadUpdateError.code,
      });
    }
  }

  // Always sync schedule — use the freshest data from DB
  const finalScheduledAt = data.scheduled_at || payload.scheduled_at || null;
  const finalEndAt = data.end_at || payload.end_at || null;
  const finalTeamId = data.team_id || payload.team_id || null;

  await syncJobSchedule({
    jobId: data.id,
    teamId: finalTeamId,
    scheduledAt: finalScheduledAt,
    endAt: finalEndAt,
  });
  invalidateScheduleCache();

  return mapJob(data, clientName);
}

export async function getActiveJobByLeadId(leadId: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs_active')
    .select('*')
    .eq('lead_id', leadId)
    .not('status', 'in', '(canceled,cancelled,completed,done)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapJob(data);
}

export async function updateJob(
  id: string,
  payload: Partial<
    Pick<Job, 'status' | 'scheduled_at' | 'end_at' | 'total_cents' | 'title' | 'property_address' | 'job_type' | 'client_name' | 'notes' | 'team_id'>
  > & {
    subtotal?: number;
    tax_total?: number;
    total?: number;
    tax_lines?: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
  }
): Promise<Job> {
  const updatePayload: Record<string, any> = {};
  if (payload.status !== undefined) updatePayload.status = normalizeStatusValue(String(payload.status || ''));
  if (payload.scheduled_at !== undefined) updatePayload.scheduled_at = payload.scheduled_at;
  if (payload.end_at !== undefined) updatePayload.end_at = payload.end_at;
  if (payload.team_id !== undefined) updatePayload.team_id = payload.team_id || null;
  if (payload.total_cents !== undefined) {
    updatePayload.total_cents = payload.total_cents;
    updatePayload.total_amount = Number(payload.total_cents || 0) / 100;
  }
  if (payload.title !== undefined) updatePayload.title = payload.title;
  if (payload.property_address !== undefined) {
    const { data: existingJob, error: existingError } = await supabase
      .from('jobs')
      .select('property_address')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;

    const nextAddress = payload.property_address || '';
    updatePayload.property_address = nextAddress;
    if (normalizeAddressValue(existingJob?.property_address) !== normalizeAddressValue(nextAddress)) {
      updatePayload.geocode_status = 'pending';
      updatePayload.geocoded_at = null;
      updatePayload.latitude = null;
      updatePayload.longitude = null;
    }
  }
  if (payload.job_type !== undefined) updatePayload.job_type = payload.job_type;
  if (payload.client_name !== undefined) updatePayload.client_name = payload.client_name;
  if (payload.notes !== undefined) updatePayload.notes = payload.notes;
  if (payload.subtotal !== undefined) updatePayload.subtotal = payload.subtotal;
  if (payload.tax_total !== undefined) updatePayload.tax_total = payload.tax_total;
  if (payload.total !== undefined) updatePayload.total = payload.total;
  if (payload.tax_lines !== undefined) updatePayload.tax_lines = payload.tax_lines;

  // Support optimistic locking if version provided in payload
  const expectedVersion = (payload as any).version;
  let query = supabase.from('jobs').update(updatePayload).eq('id', id);
  if (expectedVersion != null) query = query.eq('version', expectedVersion);
  const { data, error } = await query.select('*').single();
  if (error?.code === 'PGRST116' && expectedVersion != null) {
    throw new Error('This job was modified by another user. Please refresh and try again.');
  }
  if (error) throw error;

  // Fire automation hook when job marked completed (non-blocking)
  if (updatePayload.status === 'completed') {
    emitJobCompleted({ jobId: id });
  }

  // Sync schedule if schedule-relevant fields were changed
  const scheduleFieldsChanged =
    payload.scheduled_at !== undefined ||
    payload.end_at !== undefined ||
    payload.team_id !== undefined;

  if (scheduleFieldsChanged) {
    await syncJobSchedule({
      jobId: id,
      teamId: data.team_id ?? null,
      scheduledAt: data.scheduled_at ?? null,
      endAt: data.end_at ?? null,
    });
    invalidateScheduleCache();
  }

  return mapJob(data);
}

export async function getSuggestedJobNumber(): Promise<string> {
  const { data, error } = await supabase
    .from('jobs_active')
    .select('job_number')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  let maxNumber = 0;
  for (const row of data || []) {
    const numeric = Number.parseInt(String(row.job_number || '').replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(numeric) && numeric > maxNumber) maxNumber = numeric;
  }
  return String(maxNumber + 1);
}

export async function listSalespeople(): Promise<SalespersonOption[]> {
  const { data: memberships, error: membershipsError } = await supabase.from('memberships').select('user_id').limit(200);
  if (membershipsError || !memberships || memberships.length === 0) return [];

  const ids = Array.from(new Set(memberships.map((row: any) => row.user_id).filter(Boolean)));
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
  const labels = new Map<string, string>();
  for (const profile of profiles || []) labels.set(profile.id, profile.full_name || `User ${profile.id.slice(0, 6)}`);

  return ids.map((id) => ({ id, label: labels.get(id) || `User ${id.slice(0, 6)}` }));
}

export async function exportJobsCsv(query: Omit<JobsQuery, 'page' | 'pageSize'>): Promise<string> {
  let request = supabase.from('jobs_active').select('*').order('created_at', { ascending: false }).limit(2000);
  request = applyTableFilters(request, query);
  const { data, error } = await request;
  if (error) throw error;

  const rows = (data || []).map((row: any) => mapJob(row));
  const headers = ['Client', 'Job number', 'Title', 'Property', 'Schedule', 'Status', 'Total'];
  const lines = rows.map((job) => {
    const total = (job.total_cents / 100).toFixed(2);
    const values = [
      job.client_name || '-',
      job.job_number,
      job.title,
      job.property_address || '',
      job.scheduled_at || '',
      job.status,
      `${total} ${job.currency || 'CAD'}`,
    ];
    return values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
  });
  return [headers.join(','), ...lines].join('\n');
}

export interface JobLineItem {
  id: string;
  name: string;
  qty: number;
  unit_price_cents: number;
  total_cents: number;
  included: boolean;
}

export async function getJobLineItems(jobId: string): Promise<JobLineItem[]> {
  const { data, error } = await supabase
    .from('job_line_items')
    .select('id,name,qty,unit_price_cents,total_cents,included')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingJobLineItemsTableError(error)) return [];
    throw error;
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name || '',
    qty: Number(row.qty || 1),
    unit_price_cents: Number(row.unit_price_cents || 0),
    total_cents: Number(row.total_cents || 0),
    included: row.included !== false,
  }));
}

export async function getJobWithLineItems(jobId: string): Promise<{ job: Job; lineItems: JobLineItem[] } | null> {
  const job = await getJobById(jobId);
  if (!job) return null;
  const lineItems = await getJobLineItems(jobId);
  return { job, lineItems };
}

export async function softDeleteJob(jobId: string): Promise<SoftDeleteJobResult> {
  const orgId = await getCurrentOrgIdOrThrow();

  // Soft-delete associated schedule_events first
  const nowIso = new Date().toISOString();
  await supabase
    .from('schedule_events')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('job_id', jobId)
    .is('deleted_at', null);

  const { data, error } = await supabase.rpc('soft_delete_job', {
    p_org_id: orgId,
    p_job_id: jobId,
  });
  if (error) throw error;

  invalidateScheduleCache();

  return {
    job: Number((data as any)?.job || 0),
  };
}
