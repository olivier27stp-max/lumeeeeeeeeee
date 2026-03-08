import { supabase } from './supabase';

type Money = number;

export interface DashboardUserContext {
  fullName: string;
  avatarUrl: string | null;
  organizationName: string;
}

export interface WorkflowSummary {
  quotes: {
    activeLeads: number;
    approvedAmount: Money;
    draft: number;
    approved: number;
    changesRequested: number;
  };
  jobs: {
    active: number;
    inProgressAmount: Money;
    activeSubCount: number;
    actionRequired: number;
  };
  invoices: {
    total: number;
    comingSoon: boolean;
  };
}

export interface TodayAppointmentItem {
  id: string;
  jobId: string;
  title: string;
  clientName: string | null;
  propertyAddress: string | null;
  teamId: string | null;
  teamColor: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string | null;
  startAt: string;
  endAt: string;
  status: string;
}

export interface TodayAppointmentsSummary {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  remaining: number;
  items: TodayAppointmentItem[];
}

export interface ReceivableTopClient {
  clientName: string;
  balance: Money;
}

export interface BusinessPerformance {
  receivables: {
    totalDue: Money;
    clientsOwing: number;
    topClients: ReceivableTopClient[];
  };
  upcomingJobs: {
    next7Days: number;
  };
  revenue: {
    currentMonth: Money;
  };
  upcomingPayouts: {
    total: number;
    processing: number;
  };
}

export interface DashboardData {
  user: DashboardUserContext;
  workflow: WorkflowSummary;
  appointments: TodayAppointmentsSummary;
  performance: BusinessPerformance;
}

function normalize(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function moneyFromRow(row: any): number {
  if (typeof row.total_amount === 'number') return row.total_amount;
  if (typeof row.total_cents === 'number') return row.total_cents / 100;
  return 0;
}

function getDayRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getNext7DaysRange(now = new Date()) {
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  return { startIso: now.toISOString(), endIso: end.toISOString() };
}

function getMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function getCurrentOrgId(): Promise<string> {
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) throw new Error('Failed to resolve organization context.');
  const orgId = (data as string | null) || null;
  if (!orgId) throw new Error('No organization context found. Please refresh.');
  return orgId;
}

export async function getDashboardData(): Promise<DashboardData> {
  const now = new Date();
  const { startIso: dayStart, endIso: dayEnd } = getDayRange(now);
  const { startIso: weekStart, endIso: weekEnd } = getNext7DaysRange(now);
  const { startIso: monthStart, endIso: monthEnd } = getMonthRange(now);

  const [{ data: authData }, orgId] = await Promise.all([supabase.auth.getUser(), getCurrentOrgId()]);
  const user = authData.user;
  if (!user) throw new Error('User not authenticated.');

  const profileQuery = supabase.from('profiles').select('full_name,avatar_url,company_name').eq('id', user.id).maybeSingle();

  let dealsQuery = supabase
    .from('pipeline_deals')
    .select('id,lead_id,stage,value,deleted_at')
    .is('deleted_at', null);

  let jobsQuery = supabase
    .from('jobs_active')
    .select('id,client_id,client_name,status,total_amount,total_cents,updated_at');

  let todayEventsQuery = supabase
    .from('schedule_events')
    .select(
      `
          id,job_id,start_at,end_at,status,team_id,
          team:teams!schedule_events_team_id_fkey(id,color_hex),
          job:jobs!schedule_events_job_id_fkey(id,title,status,client_name,property_address,team_id,latitude,longitude,geocode_status)
        `
    )
    .is('deleted_at', null)
    .gte('start_at', dayStart)
    .lte('start_at', dayEnd)
    .order('start_at', { ascending: true });

  let upcomingEventsQuery = supabase
    .from('schedule_events')
    .select('id,start_at')
    .is('deleted_at', null)
    .gte('start_at', weekStart)
    .lte('start_at', weekEnd);

  let revenueJobsQuery = supabase
    .from('jobs_active')
    .select('id,status,total_amount,total_cents,updated_at')
    .gte('updated_at', monthStart)
    .lte('updated_at', monthEnd);

  dealsQuery = dealsQuery.eq('org_id', orgId);
  jobsQuery = jobsQuery.eq('org_id', orgId);
  todayEventsQuery = todayEventsQuery.eq('org_id', orgId);
  upcomingEventsQuery = upcomingEventsQuery.eq('org_id', orgId);
  revenueJobsQuery = revenueJobsQuery.eq('org_id', orgId);

  const [
    { data: profileRow, error: profileError },
    { data: dealsRows, error: dealsError },
    { data: jobsRows, error: jobsError },
    { data: todayRows, error: todayError },
    { data: upcomingRows, error: upcomingError },
    { data: revenueRows, error: revenueError },
  ] = await Promise.all([profileQuery, dealsQuery, jobsQuery, todayEventsQuery, upcomingEventsQuery, revenueJobsQuery]);

  if (profileError) throw profileError;
  if (dealsError) throw dealsError;
  if (jobsError) throw jobsError;
  if (todayError) throw todayError;
  if (upcomingError) throw upcomingError;
  if (revenueError) throw revenueError;

  const deals = dealsRows || [];
  const jobs = jobsRows || [];
  const todayEvents = (todayRows || []) as any[];
  const upcomingEvents = upcomingRows || [];
  const revenueJobs = revenueRows || [];

  const draftCount = deals.filter((deal) => ['qualified', 'contact'].includes(normalize(deal.stage))).length;
  const approvedCount = deals.filter((deal) => normalize(deal.stage) === 'closed').length;
  const changesRequestedCount = deals.filter((deal) => normalize(deal.stage) === 'quote_sent').length;
  const activeLeadsCount = deals.filter((deal) => !['closed', 'lost'].includes(normalize(deal.stage))).length;
  const approvedAmount = deals
    .filter((deal) => normalize(deal.stage) === 'closed')
    .reduce((sum, deal) => sum + Number(deal.value || 0), 0);

  const activeJobs = jobs.filter((job) => !['completed', 'done', 'canceled', 'cancelled'].includes(normalize(job.status)));
  const activeJobsCount = activeJobs.length;
  const inProgressAmount = activeJobs.reduce((sum, job) => sum + moneyFromRow(job), 0);
  const actionRequiredCount = jobs.filter((job) => ['action_required', 'late'].includes(normalize(job.status))).length;

  const appointmentItems: TodayAppointmentItem[] = todayEvents.map((event) => ({
    id: event.id,
    jobId: event.job_id,
    title: event.job?.title || 'Untitled job',
    clientName: event.job?.client_name || null,
    propertyAddress: event.job?.property_address || null,
    teamId: event.team_id || event.job?.team_id || null,
    teamColor: event.team?.color_hex || null,
    latitude: event.job?.latitude == null ? null : Number(event.job.latitude),
    longitude: event.job?.longitude == null ? null : Number(event.job.longitude),
    geocodeStatus: event.job?.geocode_status || null,
    startAt: event.start_at,
    endAt: event.end_at,
    status: String(event.status || event.job?.status || 'scheduled'),
  }));

  const activeAppointments = appointmentItems.filter((event) =>
    ['scheduled', 'active', 'in_progress'].includes(normalize(event.status))
  ).length;
  const completedAppointments = appointmentItems.filter((event) =>
    ['completed', 'done'].includes(normalize(event.status))
  ).length;
  const overdueAppointments = appointmentItems.filter((event) => {
    const isCompleted = ['completed', 'done'].includes(normalize(event.status));
    return !isCompleted && new Date(event.startAt).getTime() < now.getTime();
  }).length;
  const remainingAppointments = appointmentItems.filter((event) => {
    const isCompleted = ['completed', 'done'].includes(normalize(event.status));
    return !isCompleted && new Date(event.startAt).getTime() > now.getTime();
  }).length;

  const dueJobs = jobs.filter((job) => ['requires_invoicing', 'action_required', 'late'].includes(normalize(job.status)));
  const dueByClient = new Map<string, { name: string; balance: number }>();
  for (const job of dueJobs) {
    const key = String(job.client_id || job.client_name || 'unknown');
    const current = dueByClient.get(key) || { name: job.client_name || 'Unknown client', balance: 0 };
    current.balance += moneyFromRow(job);
    dueByClient.set(key, current);
  }
  const dueClients = Array.from(dueByClient.values()).sort((a, b) => b.balance - a.balance);
  const receivablesTotal = dueClients.reduce((sum, client) => sum + client.balance, 0);

  const revenueMonth = revenueJobs
    .filter((job) => ['completed', 'done'].includes(normalize(job.status)))
    .reduce((sum, job) => sum + moneyFromRow(job), 0);

  return {
    user: {
      fullName:
        profileRow?.full_name ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'User',
      avatarUrl: profileRow?.avatar_url || null,
      organizationName: profileRow?.company_name || 'LUME',
    },
    workflow: {
      quotes: {
        activeLeads: activeLeadsCount,
        approvedAmount,
        draft: draftCount,
        approved: approvedCount,
        changesRequested: changesRequestedCount,
      },
      jobs: {
        active: activeJobsCount,
        inProgressAmount,
        activeSubCount: activeJobsCount,
        actionRequired: actionRequiredCount,
      },
      invoices: {
        total: 0,
        comingSoon: true,
      },
    },
    appointments: {
      total: appointmentItems.length,
      active: activeAppointments,
      completed: completedAppointments,
      overdue: overdueAppointments,
      remaining: remainingAppointments,
      items: appointmentItems,
    },
    performance: {
      receivables: {
        totalDue: receivablesTotal,
        clientsOwing: dueClients.length,
        topClients: dueClients.slice(0, 3).map((client) => ({
          clientName: client.name,
          balance: client.balance,
        })),
      },
      upcomingJobs: {
        next7Days: upcomingEvents.length,
      },
      revenue: {
        currentMonth: revenueMonth,
      },
      upcomingPayouts: {
        total: 0,
        processing: 0,
      },
    },
  };
}
