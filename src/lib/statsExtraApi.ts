/**
 * Extra Statistiques aggregates that had no RPC yet — computed client-side over
 * ALL rows (lignesPaginees) with local-day bounds. Errors propagate: the card shows
 * an error state instead of a misleading zero. Covers: payment-method mix,
 * average-job-value series and loyalty metrics.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { fetchCohortRetention, fonctionAbsente, toIsoRange } from './insightsApi';
import { TAILLE_PAGE, toutesLesLignesParId } from './lignesPaginees';

export interface Series { labels: string[]; vals: number[] }

/** Clé « YYYY-MM » du mois LOCAL d'un instant (le navigateur est à l'heure de l'entreprise). */
function moisLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Ordered YYYY-MM keys spanning [from, to]. */
function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
/** Nom court du mois, formaté comme le graphique Revenu (« sept. », « Sep »). */
function monthLabel(key: string, fr: boolean): string {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 15);
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { month: 'short' }).format(d);
}

/**
 * Encaissé par mode de paiement sur la période (4 premiers, le reste dans « other »).
 * Même définition que la carte Revenu : paiements réussis NETS des remboursements
 * (un remboursement partiel laisse le statut 'succeeded'), bornes au minuit local.
 * Lu dans la table (refunded_cents) et non via rpc_list_payments, qui ne le renvoie pas
 * et plafonnait à 5 000 paiements.
 */
export async function fetchPaymentMix(params: { from: string; to: string }): Promise<Array<{ name: string; value: number }>> {
  const orgId = await getCurrentOrgIdOrThrow();
  const agregat = await supabase.rpc('rpc_insights_payment_mix', { p_org: orgId, p_from: params.from, p_to: params.to });
  if (!agregat.error) return top4((agregat.data || []).map((r: any) => ({ name: String(r.method), value: Number(r.cents) || 0 })));
  if (!fonctionAbsente(agregat.error)) throw agregat.error;
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  const lignes = await toutesLesLignesParId<{ id: string; method: string | null; amount_cents: number; refunded_cents: number | null }>((apres) => {
    let q = supabase
      .from('payments')
      .select('id, method, amount_cents, refunded_cents')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('status', ['succeeded', 'refunded'])
      .gte('payment_date', fromIso)
      .lt('payment_date', toIsoExclusive);
    if (apres) q = q.gt('id', apres);
    return q.order('id').limit(TAILLE_PAGE);
  });
  const map = new Map<string, number>();
  for (const r of lignes) {
    const cle = r.method || 'other';
    map.set(cle, (map.get(cle) || 0) + (r.amount_cents || 0) - (r.refunded_cents || 0));
  }
  return top4(Array.from(map.entries()).map(([name, value]) => ({ name, value })));
}

/** 4 modes au plus : les 3 premiers et « other » pour le reste (ex æquo : ordre alphabétique). */
function top4(lignes: Array<{ name: string; value: number }>): Array<{ name: string; value: number }> {
  const sorted = lignes.filter((s) => s.value > 0).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (sorted.length <= 4) return sorted;
  const top = sorted.slice(0, 3);
  const other = sorted.slice(3).reduce((s, x) => s + x.value, 0);
  if (other > 0) top.push({ name: 'other', value: other });
  return top;
}

interface MoisCompletes { nombre: number; total: number; recurrent: number }

/**
 * Jobs COMPLÉTÉS dans la période, regroupés par mois LOCAL de complétion : agrégat en base
 * (rpc_insights_completed_jobs_monthly) ou, sans lui, lecture de toutes les lignes.
 */
async function moisCompletes(params: { from: string; to: string }): Promise<Map<string, MoisCompletes>> {
  const orgId = await getCurrentOrgIdOrThrow();
  const parMois = new Map<string, MoisCompletes>();
  const agregat = await supabase.rpc('rpc_insights_completed_jobs_monthly', { p_org: orgId, p_from: params.from, p_to: params.to });
  if (!agregat.error) {
    for (const r of (agregat.data || []) as any[]) parMois.set(String(r.mois), { nombre: Number(r.nombre) || 0, total: Number(r.total_cents) || 0, recurrent: Number(r.recurrent_cents) || 0 });
    return parMois;
  }
  if (!fonctionAbsente(agregat.error)) throw agregat.error;
  for (const j of await jobsCompletes(params)) {
    const m = parMois.get(moisLocal(j.completed_at)) || { nombre: 0, total: 0, recurrent: 0 };
    m.nombre += 1; m.total += j.total_cents || 0;
    if (String(j.job_type) === 'recurring') m.recurrent += j.total_cents || 0;
    parMois.set(moisLocal(j.completed_at), m);
  }
  return parMois;
}

/** Jobs COMPLÉTÉS dans la période (date de complétion, bornes locales), toutes pages. */
async function jobsCompletes(params: { from: string; to: string }) {
  const orgId = await getCurrentOrgIdOrThrow();
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);
  return toutesLesLignesParId<{ id: string; completed_at: string; total_cents: number; job_type: string | null }>((apres) => {
    let q = supabase
      .from('jobs')
      .select('id, completed_at, total_cents, job_type')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .eq('status', 'completed')
      .gte('completed_at', fromIso)
      .lt('completed_at', toIsoExclusive);
    if (apres) q = q.gt('id', apres);
    return q.order('id').limit(TAILLE_PAGE);
  });
}

/**
 * Valeur moyenne (TTC) d'un job complété, par mois LOCAL de complétion, et la moyenne
 * réelle de la période (somme / nombre — pas la moyenne des moyennes mensuelles).
 * Avant : mois UTC de CRÉATION, statut 'invoiced' inexistant, 5 000 lignes plafonnées à 1 000.
 */
export async function fetchAvgJobValueSeries(params: { from: string; to: string; fr: boolean }): Promise<Series & { moyenne: number; nombre: number }> {
  const parMois = await moisCompletes(params);
  let somme = 0; let nombre = 0;
  for (const m of parMois.values()) { somme += m.total; nombre += m.nombre; }
  const keys = monthKeys(params.from, params.to);
  return {
    labels: keys.map((k) => monthLabel(k, params.fr)),
    vals: keys.map((k) => { const m = parMois.get(k); return m && m.nombre ? Math.round(m.total / m.nombre) : 0; }),
    moyenne: nombre ? Math.round(somme / nombre) : 0,
    nombre,
  };
}

/**
 * Fidélité : part récurrente de la valeur des jobs complétés dans la période (même base
 * que la valeur moyenne) et rétention moyenne des cohortes. La valeur vie moyenne se
 * lit à part (fetchValeurVieMoyenne), sur tous les clients.
 */
export async function fetchLoyalty(params: { from: string; to: string }): Promise<{ recurringPct: number; retentionPct: number }> {
  let rec = 0, tot = 0;
  for (const m of (await moisCompletes(params)).values()) { tot += m.total; rec += m.recurrent; }
  const recurringPct = tot > 0 ? Math.round((rec / tot) * 100) : 0;

  const cohorts = await fetchCohortRetention();
  // months_after = 0 vaut 100 % par définition — l'inclure gonflait la moyenne.
  const rets = cohorts.filter((c) => Number(c.months_after) >= 1)
    .map((c) => { const r = c.retention_pct || 0; return r > 0 && r <= 1 ? r * 100 : r; });
  const retentionPct = rets.length ? Math.round(rets.reduce((s, r) => s + r, 0) / rets.length) : 0;

  return { recurringPct, retentionPct };
}
