import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { emitDealStageChanged } from './automationEventsApi';

/** Convert a display-label stage to its DB slug */
export function stageToDbSlug(stage: string): string {
  const raw = String(stage || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const map: Record<string, string> = {
    new: 'new',
    'follow_up_1': 'follow_up_1',
    'follow_up_2': 'follow_up_2',
    'follow_up_3': 'follow_up_3',
    closed: 'closed',
    lost: 'lost',
  };
  return map[raw] || 'new';
}

export const PIPELINE_STAGES = ['New', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Closed', 'Lost'] as const;
export type PipelineStageName = (typeof PIPELINE_STAGES)[number];
export const TRIGGER_STAGE = 'closed' as const;

/** DB slug → display label */
export const STAGE_LABEL_MAP: Record<string, PipelineStageName> = {
  new: 'New',
  follow_up_1: 'Follow-up 1',
  follow_up_2: 'Follow-up 2',
  follow_up_3: 'Follow-up 3',
  closed: 'Closed',
  lost: 'Lost',
};

/** Display label → DB slug */
export const STAGE_DB_MAP: Record<string, string> = {
  'New': 'new',
  'Follow-up 1': 'follow_up_1',
  'Follow-up 2': 'follow_up_2',
  'Follow-up 3': 'follow_up_3',
  'Closed': 'closed',
  'Lost': 'lost',
};
export const ALLOW_CREATE_ANOTHER_JOB = false;

export interface PipelineDeal {
  id: string;
  lead_id: string | null;
  client_id: string | null;
  job_id: string | null;
  stage: PipelineStageName | string;
  value: number;
  title: string;
  notes: string | null;
  lost_at?: string | null;
  won_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  lead: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    address?: string | null;
    company?: string | null;
    title?: string | null;
    notes?: string | null;
    tags?: string[] | null;
    contact?: {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  } | null;
  client: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    contact?: {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  } | null;
  job: {
    id: string;
    title: string;
    status: string | null;
    team_id: string | null;
  } | null;
}

export interface PipelineScheduleEvent {
  id: string;
  job_id: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  status: string | null;
}

export interface AvailabilitySlot {
  slot_start: string;
  slot_end: string;
  team_id: string | null;
}

export interface JobIntent {
  id: string;
  org_id: string;
  lead_id: string;
  deal_id: string | null;
  triggered_stage: string;
  status: 'pending' | 'consumed' | 'canceled';
  created_by: string | null;
  created_at: string;
  consumed_at: string | null;
}

export interface IntentLeadPrefill {
  lead_id: string;
  lead_name: string;
  lead_email: string | null;
  lead_phone: string | null;
  lead_address: string | null;
  deal_title: string | null;
  notes: string | null;
  estimated_minutes: number;
  preferred_start_at: string | null;
}

function normalizeStage(value: string): PipelineStageName {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const map: Record<string, PipelineStageName> = {
    new: 'New',
    follow_up_1: 'Follow-up 1',
    follow_up_2: 'Follow-up 2',
    follow_up_3: 'Follow-up 3',
    closed: 'Closed',
    lost: 'Lost',
    // Legacy → new mapping
    contacted: 'Follow-up 1',
    contact: 'Follow-up 1',
    estimate_sent: 'Follow-up 2',
    quote_sent: 'Follow-up 2',
    follow_up: 'Follow-up 1',
    won: 'Closed',
    qualified: 'New',
    archived: 'Lost',
  };
  return map[raw] || 'New';
}

function mapDeal(row: any): PipelineDeal {
  return {
    id: row.id,
    lead_id: row.lead_id || null,
    client_id: row.client_id || null,
    job_id: row.job_id || null,
    stage: normalizeStage(row.stage),
    value: Number(row.value || 0),
    title: row.title || 'Untitled deal',
    notes: row.notes || null,
    lost_at: row.lost_at || null,
    won_at: row.won_at || null,
    deleted_at: row.deleted_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lead: row.lead
      ? {
          id: row.lead.id,
          first_name: row.lead.first_name || '',
          last_name: row.lead.last_name || '',
          email: row.lead.contact?.email || row.lead.email || null,
          phone: row.lead.contact?.phone || row.lead.phone || null,
          address: row.lead.address || null,
          company: row.lead.company || null,
          title: row.lead.title || null,
          notes: row.lead.notes || null,
          tags: row.lead.tags || null,
          contact: row.lead.contact
            ? {
                id: row.lead.contact.id,
                full_name: row.lead.contact.full_name || null,
                email: row.lead.contact.email || null,
                phone: row.lead.contact.phone || null,
              }
            : null,
        }
      : null,
    client: row.client
      ? {
          id: row.client.id,
          first_name: row.client.first_name || '',
          last_name: row.client.last_name || '',
          email: row.client.contact?.email || row.client.email || null,
          phone: row.client.contact?.phone || row.client.phone || null,
          contact: row.client.contact
            ? {
                id: row.client.contact.id,
                full_name: row.client.contact.full_name || null,
                email: row.client.contact.email || null,
                phone: row.client.contact.phone || null,
              }
            : null,
        }
      : null,
    job: row.job
      ? {
          id: row.job.id,
          title: row.job.title || '',
          status: row.job.status || null,
          team_id: row.job.team_id || null,
        }
      : null,
  };
}

export async function listPipelineDeals(): Promise<PipelineDeal[]> {
  // Use pipeline_deals_visible view as single source of truth.
  // This view filters out: soft-deleted deals, orphaned leads/clients,
  // WON deals older than 2 days, LOST deals older than 15 days.
  const { data, error } = await supabase
    .from('pipeline_deals_visible')
    .select(
      `
        id,lead_id,client_id,job_id,stage,value,title,notes,lost_at,won_at,deleted_at,created_at,updated_at,
        lead:leads!pipeline_deals_lead_id_fkey(
          id,first_name,last_name,email,phone,address,company,title,notes,tags,
          contact:contacts!leads_contact_id_fkey(id,full_name,email,phone)
        ),
        client:clients!pipeline_deals_client_id_fkey(
          id,first_name,last_name,email,phone,
          contact:contacts!clients_contact_id_fkey(id,full_name,email,phone)
        ),
        job:jobs!pipeline_deals_job_id_fkey(id,title,status,team_id)
      `
    )
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapDeal);
}

export async function getPipelineDealById(id: string): Promise<PipelineDeal | null> {
  const { data, error } = await supabase
    .from('pipeline_deals_visible')
    .select(
      `
        id,lead_id,client_id,job_id,stage,value,title,notes,lost_at,won_at,deleted_at,created_at,updated_at,
        lead:leads!pipeline_deals_lead_id_fkey(
          id,first_name,last_name,email,phone,address,company,title,notes,tags,
          contact:contacts!leads_contact_id_fkey(id,full_name,email,phone)
        ),
        client:clients!pipeline_deals_client_id_fkey(
          id,first_name,last_name,email,phone,
          contact:contacts!clients_contact_id_fkey(id,full_name,email,phone)
        ),
        job:jobs!pipeline_deals_job_id_fkey(id,title,status,team_id)
      `
    )
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return mapDeal(data);
}

export async function createDealWithJob(payload: {
  lead_id: string;
  title: string;
  value: number;
  stage: PipelineStageName;
  notes?: string | null;
  pipeline_id?: string | null;
}): Promise<PipelineDeal> {
  const { data, error } = await supabase.rpc('create_pipeline_deal', {
    p_lead_id: payload.lead_id,
    p_title: payload.title,
    p_value: payload.value,
    p_stage: stageToDbSlug(payload.stage),
    p_notes: payload.notes ?? null,
    p_pipeline_id: payload.pipeline_id ?? null,
  });

  if (error) throw error;
  const dealId = String(data);
  const created = await getPipelineDealById(dealId);
  if (!created) throw new Error('Deal created but could not be loaded.');
  return created;
}

export async function updatePipelineDeal(
  id: string,
  payload: Partial<{ stage: PipelineStageName; value: number; title: string; notes: string | null }>
): Promise<PipelineDeal> {
  const { stage, ...rest } = payload;

  if (Object.keys(rest).length > 0) {
    const { error: updateError } = await supabase
      .from('pipeline_deals')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw updateError;
  }

  let oldStage: string | null = null;
  if (stage !== undefined) {
    // Capture old stage for event emission
    const { data: currentDeal } = await supabase.from('pipeline_deals').select('stage,lead_id,job_id').eq('id', id).maybeSingle();
    oldStage = currentDeal?.stage || null;

    const { error: stageError } = await supabase.rpc('set_deal_stage', {
      p_deal_id: id,
      p_stage: stageToDbSlug(stage),
    });
    if (stageError) throw stageError;

    // Emit pipeline stage change event (non-blocking)
    const newSlug = stageToDbSlug(stage);
    if (oldStage !== newSlug) {
      emitDealStageChanged({
        dealId: id,
        leadId: currentDeal?.lead_id || undefined,
        jobId: currentDeal?.job_id || undefined,
        oldStage: oldStage || '',
        newStage: newSlug,
      });
    }
  }

  const data = await getPipelineDealById(id);
  if (!data) throw new Error('Deal updated but could not be loaded.');
  return data;
}

export async function softDeletePipelineDeal(dealId: string): Promise<void> {
  const { error } = await supabase
    .from('pipeline_deals')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', dealId)
    .is('deleted_at', null);
  if (error) throw error;
}

/** Server-side deal deletion using service_role (bypasses RLS). */
export async function serverDeleteDeal(dealId: string, alsoDeleteLead = false): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');
  const response = await fetch('/api/deals/soft-delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dealId, alsoDeleteLead }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Failed to delete deal (${response.status}).`);
}

export async function setPipelineDealStage(id: string, stage: PipelineStageName): Promise<PipelineDeal> {
  // Capture old stage
  const { data: currentDeal } = await supabase.from('pipeline_deals').select('stage,lead_id,job_id').eq('id', id).maybeSingle();
  const oldStage = currentDeal?.stage || null;

  const { error } = await supabase.rpc('set_deal_stage', {
    p_deal_id: id,
    p_stage: stageToDbSlug(stage),
  });
  if (error) throw error;

  const newSlug = stageToDbSlug(stage);
  if (oldStage !== newSlug) {
    emitDealStageChanged({
      dealId: id,
      leadId: currentDeal?.lead_id || undefined,
      jobId: currentDeal?.job_id || undefined,
      oldStage: oldStage || '',
      newStage: newSlug,
    });
  }

  const deal = await getPipelineDealById(id);
  if (!deal) throw new Error('Deal updated but could not be loaded.');
  return deal;
}

export async function listScheduleEventsForJob(jobId: string): Promise<PipelineScheduleEvent[]> {
  const { data, error } = await supabase
    .from('schedule_events')
    .select(
      `
        id,job_id,start_at,end_at,start_time,end_time,notes,status,
        job:jobs!schedule_events_job_id_fkey(id,title,status)
      `
    )
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('start_at', { ascending: true })
    .limit(8);

  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    job_id: row.job_id,
    start_time: row.start_at || row.start_time,
    end_time: row.end_at || row.end_time,
    notes: row.notes || null,
    status: row.status || null,
  }));
}

export async function createQuickScheduleEvent(jobId: string): Promise<PipelineScheduleEvent> {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';

  // Use RPC to properly update both schedule_events AND jobs.scheduled_at/status
  const { data, error } = await supabase.rpc('rpc_schedule_job', {
    p_job_id: jobId,
    p_start_at: start.toISOString(),
    p_end_at: end.toISOString(),
    p_team_id: null,
    p_timezone: tz,
  });

  if (error) throw error;
  const event = (data as any)?.event || data;
  return {
    id: String(event.id),
    job_id: String(event.job_id),
    start_time: String(event.start_at || event.start_time),
    end_time: String(event.end_at || event.end_time),
    notes: event.notes || null,
    status: event.status || null,
  };
}

export async function getAvailableSlots(params: {
  teamId?: string | null;
  days?: number;
  slotMinutes?: number;
  timezone?: string;
}): Promise<AvailabilitySlot[]> {
  const { data: orgId, error: orgError } = await supabase.rpc('current_org_id');
  if (orgError) throw orgError;
  if (!orgId) throw new Error('No organization context found.');

  const startDate = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_org_id: orgId,
    p_team_id: params.teamId ?? null,
    p_start_date: startDate,
    p_days: params.days ?? 14,
    p_slot_minutes: params.slotMinutes ?? 30,
    p_timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto',
  });
  if (error) throw error;
  return ((data as any[]) || []).map((row) => ({
    slot_start: String(row.slot_start),
    slot_end: String(row.slot_end),
    team_id: row.team_id ? String(row.team_id) : null,
  }));
}

export async function createScheduleEventAtSlot(payload: {
  jobId: string;
  startAt: string;
  endAt: string;
  teamId?: string | null;
  timezone?: string;
}): Promise<PipelineScheduleEvent> {
  const { data, error } = await supabase.rpc('rpc_schedule_job', {
    p_job_id: payload.jobId,
    p_start_at: payload.startAt,
    p_end_at: payload.endAt,
    p_team_id: payload.teamId ?? null,
    p_timezone: payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto',
  });
  if (error) throw error;
  const event = (data as any)?.event;
  if (!event) throw new Error('Event could not be created.');
  return {
    id: String(event.id),
    job_id: String(event.job_id),
    start_time: String(event.start_at || event.start_time),
    end_time: String(event.end_at || event.end_time),
    notes: event.notes || null,
    status: event.status || null,
  };
}

export async function deleteLeadAndOptionalClient(params: {
  leadId: string;
  alsoDeleteClient: boolean;
}): Promise<{
  lead: number;
  deals: number;
  jobs_unlinked: number;
  tasks: number;
  lead_lists: number;
  job_intents: number;
  client_deleted: number;
}> {
  const { data: orgId, error: orgError } = await supabase.rpc('current_org_id');
  if (orgError) throw orgError;
  if (!orgId) throw new Error('No organization context found.');

  const { data, error } = await supabase.rpc('delete_lead_and_optional_client', {
    p_org_id: orgId,
    p_lead_id: params.leadId,
    p_also_delete_client: params.alsoDeleteClient,
    p_deleted_by: null,
  });
  if (error) throw error;
  return {
    lead: Number((data as any)?.lead || 0),
    deals: Number((data as any)?.deals || 0),
    jobs_unlinked: Number((data as any)?.jobs_unlinked || 0),
    tasks: Number((data as any)?.tasks || 0),
    lead_lists: Number((data as any)?.lead_lists || 0),
    job_intents: Number((data as any)?.job_intents || 0),
    client_deleted: Number((data as any)?.client_deleted || 0),
  };
}

function mapIntent(row: any): JobIntent {
  return {
    id: row.id,
    org_id: row.org_id,
    lead_id: row.lead_id,
    deal_id: row.deal_id || null,
    triggered_stage: row.triggered_stage,
    status: row.status,
    created_by: row.created_by || null,
    created_at: row.created_at,
    consumed_at: row.consumed_at || null,
  };
}

export async function listPendingJobIntents(): Promise<JobIntent[]> {
  const { data, error } = await supabase
    .from('job_intents')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapIntent);
}

export async function getPendingIntentByLeadId(leadId: string): Promise<JobIntent | null> {
  const { data, error } = await supabase
    .from('job_intents')
    .select('*')
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapIntent(data) : null;
}

export async function getLeadPrefillForIntent(intent: JobIntent): Promise<IntentLeadPrefill> {
  const { data, error } = await supabase
    .from('leads_active')
    .select('id,first_name,last_name,email,phone,address,notes,schedule,company,title')
    .eq('id', intent.lead_id)
    .single();
  if (error) throw error;

  const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Lead';
  const preferredStartAt = data.schedule?.start_date && data.schedule?.start_time
    ? `${data.schedule.start_date}T${data.schedule.start_time}:00`
    : null;

  return {
    lead_id: data.id,
    lead_name: fullName,
    lead_email: data.email || null,
    lead_phone: data.phone || null,
    lead_address: data.address || null,
    deal_title: data.title || data.company || null,
    notes: data.notes || null,
    estimated_minutes: 60,
    preferred_start_at: preferredStartAt,
  };
}

export async function getActiveJobForLead(leadId: string): Promise<{ id: string; title: string } | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,title,status')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .not('status', 'in', '(done,canceled)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, title: data.title || 'Job' } : null;
}

export async function cancelJobIntent(intentId: string): Promise<void> {
  const { error } = await supabase
    .from('job_intents')
    .update({ status: 'canceled', consumed_at: new Date().toISOString() })
    .eq('id', intentId)
    .eq('status', 'pending');
  if (error) throw error;
}

export async function createJobFromIntent(payload: {
  intent_id: string;
  lead_id: string;
  title: string;
  address?: string | null;
  notes?: string | null;
  estimated_minutes?: number | null;
  start_at?: string | null;
  timezone?: string | null;
  force_create_another?: boolean;
}): Promise<{ job_id: string; schedule_event_id: string | null; intent_status: string }> {
  const { data, error } = await supabase.rpc('create_job_from_intent', {
    p_intent_id: payload.intent_id,
    p_lead_id: payload.lead_id,
    p_title: payload.title,
    p_address: payload.address ?? null,
    p_notes: payload.notes ?? null,
    p_estimated_minutes: payload.estimated_minutes ?? 60,
    p_start_at: payload.start_at ?? null,
    p_timezone: payload.timezone ?? null,
    p_force_create_another: payload.force_create_another ?? false,
  });
  if (error) throw error;
  return {
    job_id: String((data as any)?.job_id || ''),
    schedule_event_id: (data as any)?.schedule_event_id ? String((data as any).schedule_event_id) : null,
    intent_status: String((data as any)?.intent_status || 'consumed'),
  };
}

