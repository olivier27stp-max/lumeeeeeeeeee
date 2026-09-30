/**
 * Job profitability — real P&L per job, computed IN THE DATABASE by
 * `rentabilite_jobs` (migration 20261002700000) so the Statistics card, the
 * job page and Lumi share ONE definition:
 *   revenue  = jobs.subtotal_cents (before taxes — TPS/TVQ are not revenue)
 *   labour   = hours clocked ON the job (time_entries.job_id, breaks deducted)
 *              × the member's hourly rate (team_members, like payroll)
 *   expenses = jobs.expenses_cents
 * Access: financial.view_margins (Roles page) — enforced by the function.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface JobPnLRow {
  job_id: string;
  job_number: string;
  client_name: string;
  revenue_cents: number;
  hours: number;
  labour_cents: number;
  expenses_cents: number;
  profit_cents: number;
  margin_pct: number;
}

export interface JobPnL {
  rows: JobPnLRow[];
  total_revenue_cents: number;
  total_labour_cents: number;
  total_expenses_cents: number;
  total_profit_cents: number;
  margin_pct: number;
}

const EMPTY: JobPnL = {
  rows: [],
  total_revenue_cents: 0,
  total_labour_cents: 0,
  total_expenses_cents: 0,
  total_profit_cents: 0,
  margin_pct: 0,
};

function versLigne(r: any): JobPnLRow {
  return {
    job_id: String(r.job_id),
    job_number: r.job_number || String(r.job_id).slice(0, 8),
    client_name: r.client_nom || '—',
    revenue_cents: Number(r.revenu_cents) || 0,
    hours: Number(r.heures) || 0,
    labour_cents: Number(r.main_oeuvre_cents) || 0,
    expenses_cents: Number(r.depenses_cents) || 0,
    profit_cents: Number(r.profit_cents) || 0,
    margin_pct: Math.round(Number(r.marge_pct) || 0),
  };
}

export async function fetchJobPnL(params: { from: string; to: string }): Promise<JobPnL> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase.rpc('rentabilite_jobs', { p_org: orgId, p_from: params.from, p_to: params.to });
    if (error) throw error;
    const rows = ((data || []) as any[]).map(versLigne).sort((a, b) => b.revenue_cents - a.revenue_cents);
    if (rows.length === 0) return EMPTY;
    const tRev = rows.reduce((s, r) => s + r.revenue_cents, 0);
    const tLab = rows.reduce((s, r) => s + r.labour_cents, 0);
    const tExp = rows.reduce((s, r) => s + r.expenses_cents, 0);
    const tPro = tRev - tLab - tExp;
    return {
      rows,
      total_revenue_cents: tRev,
      total_labour_cents: tLab,
      total_expenses_cents: tExp,
      total_profit_cents: tPro,
      margin_pct: tRev > 0 ? Math.round((tPro / tRev) * 100) : 0,
    };
  } catch (err) {
    console.error('[profitabilityApi] fetchJobPnL :', err);
    return EMPTY;
  }
}

/** Rentabilité d'UN job (fiche de job). null si l'utilisateur n'a pas accès aux marges. */
export async function fetchJobPnLForJob(jobId: string): Promise<JobPnLRow | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('rentabilite_jobs', { p_org: orgId, p_job: jobId });
  if (error) {
    if (error.code === '42501') return null;
    throw error;
  }
  const r = ((data || []) as any[])[0];
  return r ? versLigne(r) : null;
}

/** Set the materials/subcontracting expense on a job (in cents). Org-scoped. */
export async function updateJobExpenses(jobId: string, expensesCents: number): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('jobs')
    .update({ expenses_cents: Math.max(0, Math.round(expensesCents)) })
    .eq('id', jobId)
    .eq('org_id', orgId);
  if (error) throw error;
}
