/**
 * Job profitability — ONE definition for the job page, the Statistics card,
 * Lumi and the MCP: the server action `analyze_profitability`
 * (server/lib/rentabilite, route GET /api/profitability).
 *   revenue     = invoices before taxes, minus refunds (job/quote price as an
 *                 estimate when nothing is invoiced)
 *   labour      = hours clocked on the job × the member's hourly rate
 *                 (scheduled visits × assigned tech as an estimate)
 *   commissions = the job's commission entries
 *   expenses    = the "Expenses" custom-field folder (+ priced materials);
 *                 the old per-job total only when no such field is filled
 * With a missing cost the margin is a MAXIMUM (`marge_est_un_maximum`).
 * Access: financial.view_margins (Roles page), checked by the server.
 */
import { supabase } from './supabase';
import { getCurrentOrgId, getCurrentOrgIdOrThrow } from './orgApi';

export type Completude = 'complete' | 'partielle' | 'insuffisante';

export interface JobPnLRow {
  job_id: string;
  job_number: string;
  client_name: string;
  revenue_cents: number;
  hours: number;
  labour_cents: number;
  commissions_cents: number;
  expenses_cents: number;
  profit_cents: number;
  /** null: no revenue, or not enough data to compute a margin. */
  margin_pct: number | null;
  completude: Completude;
  margin_is_maximum: boolean;
  estimated: boolean;
  /** The old per-job expense total can still be edited (no "Expenses" field filled). */
  expenses_editable: boolean;
}

export interface JobPnL {
  rows: JobPnLRow[];
  total_revenue_cents: number;
  total_labour_cents: number;
  total_commissions_cents: number;
  total_expenses_cents: number;
  total_profit_cents: number;
  margin_pct: number | null;
  completude: Completude;
  margin_is_maximum: boolean;
  /** Ready-made sentence: figure, what is included, what is missing, one action. */
  summary_fr: string;
  summary_en: string;
}

const EMPTY: JobPnL = {
  rows: [],
  total_revenue_cents: 0,
  total_labour_cents: 0,
  total_commissions_cents: 0,
  total_expenses_cents: 0,
  total_profit_cents: 0,
  margin_pct: null,
  completude: 'insuffisante',
  margin_is_maximum: false,
  summary_fr: '',
  summary_en: '',
};

/** Accès refusé (permission des marges) : l'écran masque le volet au lieu d'afficher une erreur. */
export class RentabiliteRefusee extends Error {}

async function lireRentabilite(params: Record<string, string | number | undefined>): Promise<any> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expirée.');
  const orgId = await getCurrentOrgId();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const reponse = await fetch(`/api/profitability?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, ...(orgId ? { 'x-org-id': orgId } : {}) },
  });
  let corps: any = null;
  try { corps = await reponse.json(); } catch { /* corps illisible : le statut suffit */ }
  if (reponse.status === 403) throw new RentabiliteRefusee(corps?.error || 'Accès refusé.');
  if (!reponse.ok) throw new Error(corps?.error || 'Rentabilité indisponible.');
  return corps;
}

function versLigne(g: any): JobPnLRow {
  return {
    job_id: String(g.cle),
    job_number: g.numero || String(g.cle).slice(0, 8),
    client_name: g.client || '—',
    revenue_cents: Number(g.revenus_cents) || 0,
    hours: Number(g.heures) || 0,
    labour_cents: Number(g.main_oeuvre_cents) || 0,
    commissions_cents: Number(g.commissions_cents) || 0,
    expenses_cents: Number(g.depenses_cents) || 0,
    profit_cents: Number(g.profit_cents) || 0,
    margin_pct: g.completude === 'insuffisante' || g.marge_pct == null ? null : Math.round(Number(g.marge_pct)),
    completude: g.completude,
    margin_is_maximum: Boolean(g.marge_est_un_maximum),
    estimated: Boolean(g.contient_estimations),
    expenses_editable: g.depenses_saisie_libre !== false,
  };
}

export async function fetchJobPnL(params: { from: string; to: string }): Promise<JobPnL> {
  try {
    const r = await lireRentabilite({ date_from: params.from, date_to: params.to, group_by: 'job', sort: 'revenus_desc', limit: 500 });
    const rows = ((r?.groupes || []) as any[]).map(versLigne);
    if (rows.length === 0) return { ...EMPTY, summary_fr: r?.resume_fr ?? '', summary_en: r?.resume_en ?? '' };
    const t = r.totaux;
    return {
      rows,
      total_revenue_cents: t.revenus_cents,
      total_labour_cents: t.main_oeuvre_cents,
      total_commissions_cents: t.commissions_cents,
      total_expenses_cents: t.depenses_cents,
      total_profit_cents: t.profit_cents,
      margin_pct: r.completude === 'insuffisante' || t.marge_pct == null ? null : Math.round(t.marge_pct),
      completude: r.completude,
      margin_is_maximum: Boolean(r.marge_est_un_maximum),
      summary_fr: r.resume_fr,
      summary_en: r.resume_en,
    };
  } catch (err) {
    if (err instanceof RentabiliteRefusee) return EMPTY;
    console.error('[profitabilityApi] fetchJobPnL :', err);
    return EMPTY;
  }
}

/** Rentabilité d'UN job (fiche de job). null si l'utilisateur n'a pas accès aux marges. */
export async function fetchJobPnLForJob(jobId: string): Promise<(JobPnLRow & { summary_fr: string; summary_en: string }) | null> {
  try {
    const r = await lireRentabilite({ job_id: jobId, group_by: 'job', limit: 1 });
    const g = (r?.groupes || [])[0];
    if (!g) return null;
    return { ...versLigne(g), summary_fr: r.resume_fr, summary_en: r.resume_en };
  } catch (err) {
    if (err instanceof RentabiliteRefusee) return null;
    throw err;
  }
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
