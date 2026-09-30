import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { TAILLE_PAGE, toutesLesLignesEnParallele, toutesLesLignesParId } from './lignesPaginees';

export type InsightsTab = 'finance' | 'revenue' | 'reports' | 'lead_conversion' | 'jobs' | 'invoices' | 'teams' | 'pipeline' | 'clients' | 'profitability' | 'churn' | 'cohort' | 'budget' | 'relations';

// ── Existing types ──────────────────────────────────────────

export interface InsightsOverview {
  new_leads_count: number;
  converted_quotes_count: number;
  new_oneoff_jobs_count: number;
  invoiced_value_cents: number;
  revenue_cents: number;
  requests_count: number | null;
}

export interface InsightsRevenuePoint {
  bucket_start: string;
  revenue_cents: number;
  invoiced_cents: number;
}

export interface InsightsLeadSourceBreakdown {
  source: string;
  leads_created: number;
  leads_closed: number;
  revenue_cents: number;
}

export interface InsightsLeadConversion {
  leads_created: number;
  leads_closed: number;
  conversion_rate: number;
  breakdown: InsightsLeadSourceBreakdown[] | null;
}

export interface InsightsInvoicesSummary {
  count_draft: number;
  count_sent: number;
  count_paid: number;
  count_past_due: number;
  total_outstanding_cents: number;
  avg_payment_time_days: number | null;
}

export interface InsightsJobsSummary {
  totalJobs: number;
  scheduledJobs: number;
  unscheduledJobs: number;
  byTeam: Array<{ teamId: string | null; teamName: string; count: number }>;
}

// ── New types (Bloc 1) ──────────────────────────────────────

export interface PeriodComparison {
  metric: string;
  current_value: number;
  previous_value: number;
  change_pct: number | null;
}

export interface RevenueForecast {
  month_start: string;
  projected_cents: number;
  source: string;
}

export interface TeamPerformance {
  team_id: string;
  team_name: string;
  jobs_count: number;
  jobs_completed: number;
  completion_rate: number;
  revenue_cents: number;
  avg_job_value_cents: number;
}

export interface PipelineVelocity {
  total_deals: number;
  won_deals: number;
  lost_deals: number;
  win_rate: number;
  avg_deal_value_cents: number;
  avg_days_to_close: number;
}

// ── Bloc 2 types ────────────────────────────────────────────

export interface ClientLifetimeValue {
  client_id: string;
  client_name: string;
  first_job_at: string | null;
  tenure_days: number;
  total_jobs: number;
  total_revenue_cents: number;
  avg_job_value_cents: number;
  last_activity_at: string | null;
  days_since_last_activity: number;
  clv_score: number;
}

export interface JobProfitability {
  total_jobs: number;
  total_revenue_cents: number;
  total_cost_cents: number;
  gross_margin_cents: number;
  margin_pct: number;
  avg_revenue_per_job_cents: number;
  avg_cost_per_job_cents: number;
  profitable_jobs: number;
  unprofitable_jobs: number;
}

export interface ChurnRiskClient {
  client_id: string;
  client_name: string;
  email: string | null;
  total_jobs: number;
  total_revenue_cents: number;
  last_activity_at: string | null;
  days_inactive: number;
  overdue_invoices: number;
  overdue_amount_cents: number;
  churn_risk_score: number;
  risk_level: 'high' | 'medium' | 'low';
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * La fonction d'agrégat n'existe pas encore en base (migration pas appliquée) :
 * PostgREST répond PGRST202. On retombe alors sur la lecture paginée, plus lente mais juste.
 */
export function fonctionAbsente(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'PGRST202';
}

/** Bornes d'une période de dates LOCALES : minuit du premier jour, minuit du lendemain du dernier (exclusif). */
export function toIsoRange(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const endExclusive = new Date(toDate);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { fromIso: fromDate.toISOString(), toIsoExclusive: endExclusive.toISOString() };
}

// ── Existing fetchers ───────────────────────────────────────

export async function fetchInsightsOverview(params: { from: string; to: string }): Promise<InsightsOverview> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_overview', {
    p_org: orgId, p_from: params.from, p_to: params.to,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    new_leads_count: Number(row?.new_leads_count || 0),
    converted_quotes_count: Number(row?.converted_quotes_count || 0),
    new_oneoff_jobs_count: Number(row?.new_oneoff_jobs_count || 0),
    invoiced_value_cents: Number(row?.invoiced_value_cents || 0),
    revenue_cents: Number(row?.revenue_cents || 0),
    requests_count: row?.requests_count == null ? null : Number(row.requests_count),
  };
}

export async function fetchInsightsRevenueSeries(params: {
  from: string; to: string; granularity?: 'day' | 'week' | 'month';
}): Promise<InsightsRevenuePoint[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_revenue_series', {
    p_org: orgId, p_from: params.from, p_to: params.to, p_granularity: params.granularity || 'month',
  });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    bucket_start: String(row.bucket_start),
    revenue_cents: Number(row.revenue_cents || 0),
    invoiced_cents: Number(row.invoiced_cents || 0),
  }));
}

export async function fetchInsightsLeadConversion(params: { from: string; to: string }): Promise<InsightsLeadConversion> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_lead_conversion', {
    p_org: orgId, p_from: params.from, p_to: params.to,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const rawBreakdown = row?.breakdown;
  const parsedBreakdown = Array.isArray(rawBreakdown)
    ? rawBreakdown.map((entry: any) => ({
        source: String(entry?.source || 'Unknown'),
        leads_created: Number(entry?.leads_created || 0),
        leads_closed: Number(entry?.leads_closed || 0),
        revenue_cents: Number(entry?.revenue_cents || 0),
      }))
    : null;
  return {
    leads_created: Number(row?.leads_created || 0),
    leads_closed: Number(row?.leads_closed || 0),
    conversion_rate: Number(row?.conversion_rate || 0),
    breakdown: parsedBreakdown,
  };
}

export async function fetchInsightsInvoicesSummary(params: { from: string; to: string }): Promise<InsightsInvoicesSummary> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_invoices_summary', {
    p_org: orgId, p_from: params.from, p_to: params.to,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    count_draft: Number(row?.count_draft || 0),
    count_sent: Number(row?.count_sent || 0),
    count_paid: Number(row?.count_paid || 0),
    count_past_due: Number(row?.count_past_due || 0),
    total_outstanding_cents: Number(row?.total_outstanding_cents || 0),
    avg_payment_time_days: row?.avg_payment_time_days == null ? null : Number(row.avg_payment_time_days),
  };
}

export async function fetchInsightsJobsSummary(params: { from: string; to: string }): Promise<InsightsJobsSummary> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  const [{ data: jobsRows, error: jobsError }, { data: teamsRows, error: teamsError }] = await Promise.all([
    supabase.from('jobs').select('id,team_id,scheduled_at,status').eq('org_id', orgId).is('deleted_at', null).gte('created_at', fromIso).lt('created_at', toIsoExclusive),
    supabase.from('teams').select('id,name').eq('org_id', orgId).is('deleted_at', null),
  ]);
  if (jobsError) throw jobsError;
  if (teamsError) throw teamsError;
  const jobs = jobsRows || [];
  const teams = teamsRows || [];
  const teamLabelMap = new Map<string, string>(teams.map((tm: any) => [tm.id, tm.name || 'Unnamed team']));
  const byTeamMap = new Map<string, { teamId: string | null; teamName: string; count: number }>();
  for (const job of jobs) {
    const teamId = (job as any).team_id || null;
    const key = teamId || 'unassigned';
    const teamName = teamId ? teamLabelMap.get(teamId) || 'Unknown team' : 'Unassigned';
    const current = byTeamMap.get(key) || { teamId, teamName, count: 0 };
    current.count += 1;
    byTeamMap.set(key, current);
  }
  const scheduledJobs = jobs.filter((j: any) => !!j.scheduled_at && String(j.status || '').toLowerCase() !== 'unscheduled').length;
  return {
    totalJobs: jobs.length,
    scheduledJobs,
    unscheduledJobs: jobs.length - scheduledJobs,
    byTeam: Array.from(byTeamMap.values()).sort((a, b) => b.count - a.count),
  };
}

export async function fetchTopServices(params: { from: string; to: string }): Promise<Array<{ name: string; value: number }>> {
  const orgId = await getCurrentOrgIdOrThrow();
  const agregat = await supabase.rpc('rpc_insights_service_mix', { p_org: orgId, p_from: params.from, p_to: params.to });
  if (!agregat.error) return top3EtAutre((agregat.data || []).map((r: any) => ({ name: String(r.title), value: Number(r.cents) || 0 })));
  if (!fonctionAbsente(agregat.error)) throw agregat.error;
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  const rows = await toutesLesLignesParId<{ id: string; title: string | null; total_cents: number | null }>((apres) => {
    let q = supabase
      .from('jobs')
      .select('id,title,total_cents')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .not('status', 'in', '(draft,cancelled)')
      .gte('created_at', fromIso)
      .lt('created_at', toIsoExclusive);
    if (apres) q = q.gt('id', apres);
    return q.order('id').limit(TAILLE_PAGE);
  });
  const byTitle = new Map<string, number>();
  for (const row of rows) {
    const title = (row as any).title || 'Untitled';
    byTitle.set(title, (byTitle.get(title) || 0) + ((row as any).total_cents || 0));
  }
  return top3EtAutre(Array.from(byTitle.entries()).map(([name, value]) => ({ name, value })));
}

/** 3 premiers par valeur (ex æquo : ordre alphabétique), le reste regroupé dans « Other ». */
function top3EtAutre(lignes: Array<{ name: string; value: number }>): Array<{ name: string; value: number }> {
  const sorted = lignes.slice().sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (sorted.length <= 3) return sorted;
  const top3 = sorted.slice(0, 3);
  const otherValue = sorted.slice(3).reduce((sum, s) => sum + s.value, 0);
  if (otherValue > 0) top3.push({ name: 'Other', value: otherValue });
  return top3;
}

// ── New fetchers (Bloc 1) ───────────────────────────────────

export async function fetchPeriodComparison(params: { from: string; to: string }): Promise<PeriodComparison[]> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rpc_insights_period_comparison', {
      p_org: orgId, p_from: params.from, p_to: params.to,
    });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      metric: String(row.metric),
      current_value: Number(row.current_value || 0),
      previous_value: Number(row.previous_value || 0),
      change_pct: row.change_pct == null ? null : Number(row.change_pct),
    }));
  } catch {
    return [];
  }
}

export async function fetchRevenueForecast(): Promise<RevenueForecast[]> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rpc_insights_revenue_forecast', { p_org: orgId });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      month_start: String(row.month_start),
      projected_cents: Number(row.projected_cents || 0),
      source: String(row.source || 'blended'),
    }));
  } catch {
    return [];
  }
}

// Les lectures de /insights ne transforment plus une erreur en « zéro » : la page
// affichait « Aucune donnée » (ou 0 %) sur une panne, indiscernable d'une période vide.
export async function fetchTeamPerformance(params: { from: string; to: string }): Promise<TeamPerformance[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_team_performance', {
    p_org: orgId, p_from: params.from, p_to: params.to,
  });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    team_id: String(row.team_id),
    team_name: String(row.team_name || 'Unknown'),
    jobs_count: Number(row.jobs_count || 0),
    jobs_completed: Number(row.jobs_completed || 0),
    completion_rate: Number(row.completion_rate || 0),
    revenue_cents: Number(row.revenue_cents || 0),
    avg_job_value_cents: Number(row.avg_job_value_cents || 0),
  }));
}

export async function fetchPipelineVelocity(params: { from: string; to: string }): Promise<PipelineVelocity> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_pipeline_velocity', {
    p_org: orgId, p_from: params.from, p_to: params.to,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_deals: Number(row?.total_deals || 0),
    won_deals: Number(row?.won_deals || 0),
    lost_deals: Number(row?.lost_deals || 0),
    win_rate: Number(row?.win_rate || 0),
    avg_deal_value_cents: Number(row?.avg_deal_value_cents || 0),
    avg_days_to_close: Number(row?.avg_days_to_close || 0),
  };
}

// ── Bloc 2 fetchers ─────────────────────────────────────────

// ── Drill-down fetchers ─────────────────────────────────────

export async function drilldownRevenueByMonth(params: { month: string }): Promise<any[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const start = new Date(`${params.month}T00:00:00`);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const { data } = await supabase.from('invoices')
    .select('id, invoice_number, client_id, status, total_cents, balance_cents, issued_at, paid_at')
    .eq('org_id', orgId).is('deleted_at', null)
    .gte('issued_at', start.toISOString()).lt('issued_at', end.toISOString())
    .order('issued_at', { ascending: false }).limit(50);
  return data || [];
}

export async function drilldownJobsByTeam(params: { teamId: string; from: string; to: string }): Promise<any[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  const q = supabase.from('jobs')
    .select('id, title, status, client_name, total_cents, scheduled_at, created_at')
    .eq('org_id', orgId).is('deleted_at', null)
    .gte('created_at', fromIso).lt('created_at', toIsoExclusive)
    .order('created_at', { ascending: false }).limit(50);
  if (params.teamId === 'unassigned') {
    q.is('team_id', null);
  } else {
    q.eq('team_id', params.teamId);
  }
  const { data } = await q;
  return data || [];
}

export async function drilldownLeadsBySource(params: { source: string; from: string; to: string }): Promise<any[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  const { data } = await supabase.from('clients')
    .select('id, first_name, last_name, email, source, status:lead_status, value, created_at')
    .eq('org_id', orgId).eq('status', 'lead').is('deleted_at', null)
    .eq('source', params.source)
    .gte('created_at', fromIso).lt('created_at', toIsoExclusive)
    .order('created_at', { ascending: false }).limit(50);
  return data || [];
}

// ── Bloc 2 fetchers ─────────────────────────────────────────

export async function drilldownClientJobs(params: { clientId: string }): Promise<any[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data } = await supabase.from('jobs')
    .select('id, title, status, total_cents, scheduled_at, created_at')
    .eq('org_id', orgId).eq('client_id', params.clientId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(30);
  return data || [];
}

export async function drilldownClientInvoices(params: { clientId: string }): Promise<any[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data } = await supabase.from('invoices')
    .select('id, invoice_number, status, total_cents, balance_cents, issued_at, paid_at')
    .eq('org_id', orgId).eq('client_id', params.clientId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(30);
  return data || [];
}

export async function fetchClientLifetimeValue(limit = 20): Promise<ClientLifetimeValue[]> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rpc_insights_client_lifetime_value', { p_org: orgId, p_limit: limit });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      client_id: String(row.client_id),
      client_name: String(row.client_name || 'Unknown'),
      first_job_at: row.first_job_at || null,
      tenure_days: Number(row.tenure_days || 0),
      total_jobs: Number(row.total_jobs || 0),
      total_revenue_cents: Number(row.total_revenue_cents || 0),
      avg_job_value_cents: Number(row.avg_job_value_cents || 0),
      last_activity_at: row.last_activity_at || null,
      days_since_last_activity: Number(row.days_since_last_activity || 0),
      clv_score: Number(row.clv_score || 0),
    }));
  } catch { return []; }
}

function versValeurClient(row: any): ClientLifetimeValue {
  return {
    client_id: String(row.client_id),
    client_name: String(row.client_name || 'Unknown'),
    first_job_at: row.first_job_at || null,
    tenure_days: Number(row.tenure_days || 0),
    total_jobs: Number(row.total_jobs || 0),
    total_revenue_cents: Number(row.total_revenue_cents || 0),
    avg_job_value_cents: Number(row.avg_job_value_cents || 0),
    last_activity_at: row.last_activity_at || null,
    days_since_last_activity: Number(row.days_since_last_activity || 0),
    clv_score: Number(row.clv_score || 0),
  };
}

export interface ZoneAdresse { adresse: string | null; jobs: number; revenu_cents: number; lat_somme: number; lng_somme: number }

/**
 * Revenu par ville : jobs COMPLÉTÉS ayant une visite dans la période, comptés une fois,
 * regroupés par adresse (agrégat en base ; sinon toutes les visites, dédoublonnées par job).
 */
export async function fetchZonesParAdresse(params: { from: string; to: string }): Promise<ZoneAdresse[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const agregat = await supabase.rpc('rpc_insights_zones', { p_org: orgId, p_from: params.from, p_to: params.to });
  if (!agregat.error) {
    return ((agregat.data || []) as any[]).map((r) => ({
      adresse: r.adresse ?? null, jobs: Number(r.jobs) || 0, revenu_cents: Number(r.revenu_cents) || 0,
      lat_somme: Number(r.lat_somme) || 0, lng_somme: Number(r.lng_somme) || 0,
    }));
  }
  if (!fonctionAbsente(agregat.error)) throw agregat.error;
  const { fetchMapJobsInRange } = await import('./mapApi');
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  const { pins } = await fetchMapJobsInRange(fromIso, toIsoExclusive);
  const vus = new Set<string>();
  const parAdresse = new Map<string, ZoneAdresse>();
  for (const p of pins) {
    if (p.status !== 'completed' || vus.has(p.jobId)) continue;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || (p.latitude === 0 && p.longitude === 0)) continue;
    vus.add(p.jobId);
    const cle = p.address ?? '';
    const z = parAdresse.get(cle) || { adresse: p.address, jobs: 0, revenu_cents: 0, lat_somme: 0, lng_somme: 0 };
    z.jobs += 1; z.revenu_cents += p.totalCents || 0; z.lat_somme += p.latitude; z.lng_somme += p.longitude;
    parAdresse.set(cle, z);
  }
  return [...parAdresse.values()];
}

/**
 * Les N clients qui ont le plus rapporté (tri par revenu fait par la base, un seul appel).
 * La RPC trie par « score CLV » (récence, fréquence) : prendre ses 6 premiers puis trier
 * par revenu perdait un gros client inactif — la carte « Top clients par revenu » mentait.
 */
export async function fetchTopClientsParRevenu(n = 5): Promise<ClientLifetimeValue[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .rpc('rpc_insights_client_lifetime_value', { p_org: orgId, p_limit: 1_000_000 })
    .order('total_revenue_cents', { ascending: false })
    .order('client_name', { ascending: true })
    .limit(n);
  if (error) throw error;
  return (data || []).map(versValeurClient);
}

/** Valeur vie moyenne sur TOUS les clients qui ont eu un job (agrégat en base, sinon lecture complète). */
export async function fetchValeurVieMoyenne(): Promise<number> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_valeur_vie_moyenne', { p_org: orgId });
  if (!error) return Number((Array.isArray(data) ? data[0] : data)?.moyenne_cents) || 0;
  if (!fonctionAbsente(error)) throw error;
  const tous = await fetchValeurTousClients();
  return tous.length ? Math.round(tous.reduce((s, c) => s + c.total_revenue_cents, 0) / tous.length) : 0;
}

/**
 * Valeur de TOUS les clients qui ont eu un job, triée par revenu décroissant.
 * La RPC trie par « score CLV » (récence, fréquence) : prendre ses 6 premiers puis trier
 * par revenu perdait un gros client inactif — la carte « Top clients par revenu » mentait.
 */
export async function fetchValeurTousClients(): Promise<ClientLifetimeValue[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  // La RPC recalcule tout à chaque appel : pages en parallèle, ordre stable par client.
  const lignes = await toutesLesLignesEnParallele((a, b, compter) => supabase
    .rpc('rpc_insights_client_lifetime_value', { p_org: orgId, p_limit: 1_000_000 }, compter ? { count: 'exact' } : undefined)
    .order('client_id')
    .range(a, b));
  return lignes.map(versValeurClient)
    .sort((x, y) => y.total_revenue_cents - x.total_revenue_cents || x.client_name.localeCompare(y.client_name));
}

export async function fetchJobProfitability(params: { from: string; to: string }): Promise<JobProfitability> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rpc_insights_job_profitability', { p_org: orgId, p_from: params.from, p_to: params.to });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      total_jobs: Number(row?.total_jobs || 0),
      total_revenue_cents: Number(row?.total_revenue_cents || 0),
      total_cost_cents: Number(row?.total_cost_cents || 0),
      gross_margin_cents: Number(row?.gross_margin_cents || 0),
      margin_pct: Number(row?.margin_pct || 0),
      avg_revenue_per_job_cents: Number(row?.avg_revenue_per_job_cents || 0),
      avg_cost_per_job_cents: Number(row?.avg_cost_per_job_cents || 0),
      profitable_jobs: Number(row?.profitable_jobs || 0),
      unprofitable_jobs: Number(row?.unprofitable_jobs || 0),
    };
  } catch {
    return { total_jobs: 0, total_revenue_cents: 0, total_cost_cents: 0, gross_margin_cents: 0, margin_pct: 0, avg_revenue_per_job_cents: 0, avg_cost_per_job_cents: 0, profitable_jobs: 0, unprofitable_jobs: 0 };
  }
}

export async function fetchChurnRisk(limit = 20): Promise<ChurnRiskClient[]> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rpc_insights_churn_risk', { p_org: orgId, p_limit: limit });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      client_id: String(row.client_id),
      client_name: String(row.client_name || 'Unknown'),
      email: row.email || null,
      total_jobs: Number(row.total_jobs || 0),
      total_revenue_cents: Number(row.total_revenue_cents || 0),
      last_activity_at: row.last_activity_at || null,
      days_inactive: Number(row.days_inactive || 0),
      overdue_invoices: Number(row.overdue_invoices || 0),
      overdue_amount_cents: Number(row.overdue_amount_cents || 0),
      churn_risk_score: Number(row.churn_risk_score || 0),
      risk_level: String(row.risk_level || 'low') as 'high' | 'medium' | 'low',
    }));
  } catch { return []; }
}

// ── Cohort + Budget fetchers ────────────────────────────────

export interface CohortRow {
  cohort_month: string;
  months_after: number;
  cohort_size: number;
  active_count: number;
  retention_pct: number;
}

export interface BudgetRow {
  month_label: string;
  metric: string;
  target_value: number;
  actual_value: number;
  variance_pct: number | null;
}

export async function fetchCohortRetention(): Promise<CohortRow[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rpc_insights_cohort_retention', { p_org: orgId });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    cohort_month: String(row.cohort_month),
    months_after: Number(row.months_after),
    cohort_size: Number(row.cohort_size),
    active_count: Number(row.active_count),
    retention_pct: Number(row.retention_pct),
  }));
}

export async function fetchBudgetVsActual(params: { from: string; to: string }): Promise<BudgetRow[]> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rpc_insights_budget_vs_actual', { p_org: orgId, p_from: params.from, p_to: params.to });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      month_label: String(row.month_label),
      metric: String(row.metric),
      target_value: Number(row.target_value || 0),
      actual_value: Number(row.actual_value || 0),
      variance_pct: row.variance_pct == null ? null : Number(row.variance_pct),
    }));
  } catch { return []; }
}

// ── Relationship Graph data ─────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  type: 'client' | 'job' | 'team' | 'invoice' | 'lead' | 'quote';
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

export async function fetchRelationshipGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const orgId = await getCurrentOrgIdOrThrow();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  function addNode(id: string, label: string, type: GraphNode['type']) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label: label.slice(0, 25), type });
  }

  try {
    // Clients (limit 40)
    const { data: clients } = await supabase.from('clients')
      .select('id, first_name, last_name').eq('org_id', orgId).is('deleted_at', null).limit(40);
    for (const c of clients || []) addNode(c.id, `${c.first_name || ''} ${c.last_name || ''}`.trim() || '?', 'client');

    // Teams
    const { data: teams } = await supabase.from('teams')
      .select('id, name').eq('org_id', orgId).is('deleted_at', null).limit(20);
    for (const tm of teams || []) addNode(tm.id, tm.name || '?', 'team');

    // Jobs (limit 60) + relationships
    const { data: jobs } = await supabase.from('jobs')
      .select('id, title, client_id, team_id').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(60);
    for (const j of jobs || []) {
      addNode(j.id, j.title || 'Job', 'job');
      if (j.client_id && seen.has(j.client_id)) edges.push({ source: j.client_id, target: j.id });
      if (j.team_id && seen.has(j.team_id)) edges.push({ source: j.id, target: j.team_id });
    }

    // Invoices (limit 40) + relationships
    const { data: invoices } = await supabase.from('invoices')
      .select('id, invoice_number, client_id').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(40);
    for (const inv of invoices || []) {
      addNode(inv.id, `#${inv.invoice_number || '?'}`, 'invoice');
      if (inv.client_id && seen.has(inv.client_id)) edges.push({ source: inv.client_id, target: inv.id });
    }

    // Leads (limit 30) — clients with status='lead'
    const { data: leads } = await supabase.from('clients')
      .select('id, first_name, last_name').eq('org_id', orgId).eq('status', 'lead').is('deleted_at', null).order('created_at', { ascending: false }).limit(30);
    for (const l of leads || []) {
      addNode(l.id, `${l.first_name || ''} ${l.last_name || ''}`.trim() || '?', 'lead');
    }

    // Quotes (limit 30)
    const { data: quotes } = await supabase.from('quotes')
      .select('id, quote_number, lead_id, client_id').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(30);
    for (const q of quotes || []) {
      addNode(q.id, `Q#${q.quote_number || '?'}`, 'quote');
      if (q.lead_id && seen.has(q.lead_id)) edges.push({ source: q.lead_id, target: q.id });
      if (q.client_id && seen.has(q.client_id)) edges.push({ source: q.client_id, target: q.id });
    }
  } catch (err: any) {
    console.error('Failed to fetch relationship graph:', err?.message);
  }

  return { nodes, edges };
}
