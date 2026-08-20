import { supabase } from '../supabase';
import { Job } from '@/types/db';
import { createNotification } from './notifications';
import { notifierRendezVousCree } from './server';
import { getOrgCurrency } from './org';
import { endOfToday, startOfToday } from '../format';
import { tr } from '@/lib/i18n';
import {
  PermissionsMap,
  Scope,
  stripFinancialFields,
  TeamRole,
} from '../permissions';

/**
 * Role/scope context passed from the membership layer so the data layer can:
 *  - restrict jobs to the user's team when their scope is not company-wide
 *    (technicians = 'assigned' → only their team's jobs), and
 *  - mask financial fields (total_cents, …) for users without pricing access.
 * This is the real pricing boundary on mobile (RLS does not mask columns).
 */
export type JobAccess = {
  teamId: string | null;
  scope: Scope;
  permissions: PermissionsMap | null;
  role: TeamRole | null;
};

function maskJob(job: Job, access?: JobAccess): Job {
  if (!access) return job;
  return stripFinancialFields(job, 'jobs', access.permissions, access.role ?? undefined) as Job;
}

/** Filter a jobs query to the user's team unless they have company-wide scope. */
function applyScope<T>(query: T, access?: JobAccess): T {
  if (!access || access.scope === 'company') return query;
  // Non-company scope (technician 'assigned', 'team', 'self'): restrict to team.
  if (access.teamId) {
    return (query as any).eq('team_id', access.teamId);
  }
  // No team assigned + restricted scope → return nothing (avoid leaking org jobs).
  return (query as any).eq('team_id', '00000000-0000-0000-0000-000000000000');
}

export async function listTodaysJobs(access?: JobAccess): Promise<Job[]> {
  const start = startOfToday().toISOString();
  const end = endOfToday().toISOString();

  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .or(`scheduled_at.gte.${start},start_at.gte.${start}`)
    .or(`scheduled_at.lte.${end},start_at.lte.${end}`)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function listUpcomingJobs(access?: JobAccess, limit = 50): Promise<Job[]> {
  const now = new Date().toISOString();
  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .gte('scheduled_at', now)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

/**
 * Most recently created jobs regardless of schedule date — used as a Home
 * fallback so the box still shows real work when nothing is scheduled today or
 * upcoming. Respects team scope and financial masking like the other lists.
 */
export async function listRecentJobs(access?: JobAccess, limit = 10): Promise<Job[]> {
  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

/**
 * Test helper (runs as the signed-in user): take the most recent real jobs and
 * spread them across today & tomorrow at staggered hours, so the Home carousels
 * have real data to demo. Returns how many landed on each day.
 */
export async function spreadJobsAcrossTodayTomorrow(
  orgId: string,
): Promise<{ today: number; tomorrow: number }> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) throw new Error(tr().mobileErrors.noJobsToReschedule);

  let today = 0;
  let tomorrow = 0;
  for (let i = 0; i < ids.length; i++) {
    const offsetDays = i % 2; // alternate today / tomorrow
    const hour = 8 + Math.floor(i / 2) * 2; // 8h, 10h, 12h, …
    const start = new Date();
    start.setDate(start.getDate() + offsetDays);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 2, 0, 0, 0);
    const { error: upErr } = await supabase
      .from('jobs')
      .update({ scheduled_at: start.toISOString(), end_at: end.toISOString() })
      .eq('id', ids[i]);
    if (upErr) throw new Error(upErr.message);
    if (offsetDays === 0) today++;
    else tomorrow++;
  }
  return { today, tomorrow };
}

/** Search jobs by title, client name or job number (for the global search). */
export async function searchJobs(term: string, access?: JobAccess, limit = 20): Promise<Job[]> {
  const t = term.trim().replace(/[,()*]/g, ' ');
  if (!t) return [];
  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .or(`title.ilike.*${t}*,client_name.ilike.*${t}*,job_number.ilike.*${t}*`)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  query = applyScope(query, access);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function listJobsInRange(
  startISO: string,
  endISO: string,
  access?: JobAccess,
): Promise<Job[]> {
  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .gte('scheduled_at', startISO)
    .lte('scheduled_at', endISO)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function listJobsForClient(clientId: string, access?: JobAccess): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function getJob(id: string, access?: JobAccess): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return maskJob(data as Job, access);
}

export interface JobLineItem {
  name: string;
  /** Description de la ligne — celle du catalogue, ou saisie à la main. */
  description?: string | null;
  /**
   * Date (locale, AAAA-MM-JJ) de la visite du plan à laquelle la ligne
   * s'applique. null = la ligne couvre le job entier. Quand des lignes sont
   * rattachées, create_invoice_from_visit facture chaque visite au prorata
   * de SES services au lieu de diviser le total en parts égales.
   */
  visit_date?: string | null;
  qty: number;
  unit_price_cents: number;
}

export interface JobLineItemRow {
  id: string;
  name: string;
  description: string | null;
  qty: number;
  unit_price_cents: number;
  total_cents: number;
}

/** The services/line items attached to a job (what the tech will actually do). */
export async function listJobLineItems(jobId: string): Promise<JobLineItemRow[]> {
  const { data, error } = await supabase
    .from('job_line_items')
    .select('id, name, description, qty, unit_price_cents, total_cents')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JobLineItemRow[];
}

/** UI frequency keys (jobs/new) mapped to the DB-allowed recurrence config. */
export type RecurrenceFrequencyKey =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'annual'
  | 'custom';

export interface JobInput {
  title: string;
  description?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  property_address?: string | null;
  scheduled_at?: string | null;
  end_at?: string | null;
  team_id?: string | null;
  job_type?: string;
  requires_invoicing?: boolean;
  items?: JobLineItem[];
  taxRatePct?: number;
  latitude?: number | null;
  longitude?: number | null;
  /** When set (job_type 'recurring'), a job_recurrence_rules row is created so
   * the server cron generates future occurrences. */
  recurrence?: { frequency: RecurrenceFrequencyKey; startISO: string; endDate?: string | null } | null;
  /** Plan de service : les rendez-vous planifiés, écrits tels quels dans
   *  schedule_events — même principe que le web (NewJobModal), qui matérialise
   *  chaque visite au lieu de laisser un cron les générer. Exclusif avec
   *  `recurrence` : les deux ensemble créeraient des doublons. */
  planVisits?: { startISO: string; endISO: string; notes?: string | null }[] | null;
  /** Mode de facturation d'un plan de service (jobs.billing_mode) :
   *  'per_visit' facture chaque visite complétée, 'single' une seule fois,
   *  'installments' suit l'échéancier de job_billing_milestones. */
  billingMode?: 'per_visit' | 'single' | 'installments' | null;
  /** Envoie la facture d'emblée quand elle est créée (jobs.auto_charge). */
  autoCharge?: boolean;
  /** « Plusieurs paiements » : N versements d'un montant fixe, plus le solde. */
  installments?: { count: number; amountCents: number } | null;
  /** Champs que le formulaire web envoie et qui manquaient au mobile. */
  jobNumber?: string | null;
  salespersonId?: string | null;
  saleDate?: string | null;
  showOnLeaderboard?: boolean;
  depositRequired?: boolean;
  depositType?: 'percentage' | 'fixed' | null;
  depositValue?: number;
  requirePaymentMethod?: boolean;
  billingSplit?: boolean;
  /** Demander un avis au client une fois la job terminée. */
  askForReview?: boolean;
  /** Propriété du client où le travail se fait (jobs.property_id). */
  propertyId?: string | null;
  /** Lead d'origine quand le job vient d'une conversion (jobs.lead_id). */
  leadId?: string | null;
}

/** Build the job_recurrence_rules payload from a UI frequency key + start date.
 * The DB CHECK only allows daily|weekly|biweekly|monthly|custom, so 'annual'
 * is expressed as a 365-day custom interval. */
function buildRecurrenceRow(
  jobId: string,
  orgId: string,
  cfg: { frequency: RecurrenceFrequencyKey; startISO: string; endDate?: string | null },
): Record<string, unknown> {
  const start = new Date(cfg.startISO);
  const startDate = start.toISOString().slice(0, 10);
  const weekday = start.getDay(); // 0=Sun … 6=Sat
  const dom = start.getDate();

  let frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom' = 'weekly';
  let interval_days: number | null = null;
  let day_of_week: number[] | null = null;
  let day_of_month: number | null = null;

  switch (cfg.frequency) {
    case 'daily':
      frequency = 'daily';
      interval_days = 1;
      break;
    case 'weekly':
      frequency = 'weekly';
      interval_days = 7;
      day_of_week = [weekday];
      break;
    case 'biweekly':
      frequency = 'biweekly';
      interval_days = 14;
      day_of_week = [weekday];
      break;
    case 'monthly':
      frequency = 'monthly';
      day_of_month = dom;
      break;
    case 'annual':
      frequency = 'custom';
      interval_days = 365;
      break;
    case 'custom':
    default:
      frequency = 'custom';
      interval_days = 7;
      break;
  }

  // First future occurrence: start + interval (the initial job already exists).
  const next = new Date(start);
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + (interval_days ?? 7));

  return {
    job_id: jobId,
    org_id: orgId,
    frequency,
    interval_days,
    day_of_week,
    day_of_month,
    start_date: startDate,
    end_date: cfg.endDate ?? null,
    next_run_at: next.toISOString(),
    is_active: true,
  };
}

export async function createJob(orgId: string, input: JobInput): Promise<Job> {
  const { items = [], taxRatePct = 0, ...rest } = input;
  const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
  const taxTotal = Math.round((subtotal * taxRatePct) / 100);
  const total = subtotal + taxTotal;

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      org_id: orgId,
      status: 'scheduled',
      title: rest.title,
      description: rest.description ?? null,
      client_id: rest.client_id ?? null,
      client_name: rest.client_name ?? null,
      team_id: rest.team_id ?? null,
      job_type: rest.job_type ?? 'one_off',
      // Écrits à l'INSERT, pas en UPDATE : `jobs` n'accorde la modification
      // que colonne par colonne, et ces deux-là ne l'étaient pas (le web y a
      // perdu tous ses modes de facturation en silence).
      billing_mode: rest.billingMode ?? null,
      auto_charge: rest.autoCharge ?? false,
      requires_invoicing: rest.requires_invoicing ?? false,
      job_number: rest.jobNumber?.trim() || null,
      salesperson_id: rest.salespersonId ?? null,
      sale_date: rest.saleDate ?? null,
      show_on_leaderboard: rest.showOnLeaderboard ?? true,
      deposit_required: rest.depositRequired ?? false,
      deposit_type: rest.depositRequired ? rest.depositType ?? null : null,
      deposit_value: rest.depositRequired ? rest.depositValue ?? 0 : 0,
      // Sans ça la colonne retombe sur son défaut 'not_required' : la job
      // exigeait un dépôt que rien ne comptait comme dû (le web, lui, le
      // met à 'pending' — jobsApi.ts).
      deposit_status: rest.depositRequired ? 'pending' : 'not_required',
      require_payment_method: rest.requirePaymentMethod ?? false,
      ask_for_review: rest.askForReview ?? false,
      property_id: rest.propertyId ?? null,
      lead_id: rest.leadId ?? null,
      // Un plan « plusieurs paiements » implique la facturation par étapes,
      // exactement comme le web.
      billing_split:
        rest.billingMode === 'installments' ? true : rest.billingSplit ?? false,
      property_address: rest.property_address ?? '',
      scheduled_at: rest.scheduled_at ?? null,
      end_at: rest.end_at ?? null,
      latitude: rest.latitude ?? null,
      longitude: rest.longitude ?? null,
      currency: await getOrgCurrency(orgId),
      total_cents: total,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const job = data as Job;

  createNotification({
    orgId,
    title: `Nouveau job : ${job.title}`,
    body: job.client_name ?? undefined,
    category: 'new_job',
    type: 'info',
    entityType: 'job',
    entityId: job.id,
  });

  if (items.length) {
    // RLS requires created_by = auth.uid(), otherwise the insert is silently rejected.
    const { data: auth } = await supabase.auth.getUser();
    const createdBy = auth?.user?.id ?? null;
    const rows = items.map((it) => ({
      org_id: orgId,
      job_id: job.id,
      created_by: createdBy,
      name: it.name || 'Item',
      description: it.description?.trim() || null,
      visit_date: it.visit_date ?? null,
      qty: it.qty,
      unit_price_cents: it.unit_price_cents,
      total_cents: Math.round(it.qty * it.unit_price_cents),
    }));
    const { error: liErr } = await supabase.from('job_line_items').insert(rows);
    if (liErr) throw new Error(`Services non enregistrés : ${liErr.message}`);
  }

  // Recurring job → create the recurrence rule so the server cron generates
  // future occurrences.
  //
  // L'erreur était auparavant avalée dans un console.warn : le job était créé,
  // la récurrence non, et rien ne le signalait. Sans récurrence le job n'est
  // pas ce que l'utilisateur a demandé, donc on remonte l'échec.
  if (rest.job_type === 'recurring' && input.recurrence) {
    const row = buildRecurrenceRow(job.id, orgId, {
      ...input.recurrence,
      startISO: input.recurrence.startISO || rest.scheduled_at || new Date().toISOString(),
    });
    const { error: recErr } = await supabase.from('job_recurrence_rules').insert(row);
    if (recErr) throw new Error(`${tr().mobileErrors.recurrenceFailed} : ${recErr.message}`);
  }

  // « Plusieurs paiements » : N versements du montant choisi, puis un « Solde »
  // qui couvre le reste — sans lui le total du job ne serait jamais payé en
  // entier. Même construction que le web (NewJobModal).
  if (rest.billingMode === 'installments' && input.installments && input.installments.count > 0) {
    const { count, amountCents } = input.installments;
    const { data: auth } = await supabase.auth.getUser();
    const createdBy = auth?.user?.id ?? null;
    const jalons = Array.from({ length: count }, (_, i) => ({
      org_id: orgId,
      job_id: job.id,
      created_by: createdBy,
      position: i + 1,
      label: `Paiement ${i + 1}`,
      percent: null,
      amount_cents: amountCents,
      due_date: null,
    }));
    const solde = total - count * amountCents;
    if (solde > 0) {
      jalons.push({
        org_id: orgId, job_id: job.id, created_by: createdBy,
        position: jalons.length + 1, label: 'Solde', percent: null,
        amount_cents: solde, due_date: null,
      });
    }
    const { error: jalErr } = await supabase.from('job_billing_milestones').insert(jalons);
    if (jalErr) throw new Error(`${tr().mobileErrors.installmentsFailed} : ${jalErr.message}`);
  }

  // Plan de service : un événement d'agenda par rendez-vous planifié. C'est LE
  // livrable demandé, donc l'échec remonte — perdre les rendez-vous en silence
  // laisserait un job seul là où l'utilisateur en attendait douze.
  if (input.planVisits && input.planVisits.length > 0) {
    const rows = input.planVisits.map((v) => ({
      org_id: orgId,
      job_id: job.id,
      team_id: rest.team_id ?? null,
      start_at: v.startISO,
      end_at: v.endISO,
      start_time: v.startISO,
      end_time: v.endISO,
      status: 'scheduled',
      // Services propres à cette visite, en clair sur son rendez-vous — même
      // convention que le web quand les produits sont personnalisés.
      notes: v.notes ?? null,
    }));
    const { data: crees, error: evErr } = await supabase
      .from('schedule_events')
      .insert(rows)
      .select('id, start_at');
    if (evErr) throw new Error(`${tr().mobileErrors.appointmentsFailed} : ${evErr.message}`);
    // Le moteur d'automatisation ne voit pas les écritures directes : sans cet
    // appel, la confirmation de rendez-vous n'est jamais envoyée.
    for (const ev of crees ?? []) {
      await notifierRendezVousCree({
        eventId: ev.id,
        jobId: job.id,
        clientId: rest.client_id ?? null,
        startTime: ev.start_at,
        title: rest.title ?? null,
        address: rest.property_address ?? null,
      });
    }
    return job;
  }

  // Auto-add to the schedule (schedule_events) so it shows in the calendar,
  // like the web. Best effort — never fail job creation over this.
  if (rest.scheduled_at) {
    const { data: cree } = await supabase
      .from('schedule_events')
      .insert({
        org_id: orgId,
        job_id: job.id,
        team_id: rest.team_id ?? null,
        start_at: rest.scheduled_at,
        end_at: rest.end_at ?? rest.scheduled_at,
        start_time: rest.scheduled_at,
        end_time: rest.end_at ?? rest.scheduled_at,
        status: 'scheduled',
      })
      .select('id')
      .maybeSingle()
      .then((r) => r, () => ({ data: null }));
    if (cree?.id) {
      await notifierRendezVousCree({
        eventId: cree.id,
        jobId: job.id,
        clientId: rest.client_id ?? null,
        startTime: rest.scheduled_at,
        title: rest.title ?? null,
        address: rest.property_address ?? null,
      });
    }
  }
  return job;
}

export async function updateJob(id: string, input: Partial<JobInput>): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Job;
}

/** Re-open a completed job (undo the completion): back to scheduled, clear
 * completed_at. RLS still enforces the org/team boundary. */
export async function reopenJob(id: string): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({ status: 'scheduled', completed_at: null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Permanently delete a job (RLS still enforces the org/team boundary). */
export async function deleteJob(id: string): Promise<void> {
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markJobInProgress(id: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'in_progress',
      start_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Job;
}

export async function markJobCompleted(id: string, notes?: string): Promise<Job> {
  const completedAt = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: 'completed',
    completed_at: completedAt,
    end_at: completedAt,
  };
  if (notes && notes.trim().length > 0) update.notes = notes.trim();

  const { data, error } = await supabase
    .from('jobs')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Job;
}
