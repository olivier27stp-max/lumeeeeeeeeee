/**
 * Périodes de paie VERSÉES = verrouillées (règle du brief d'audit, 2026-09-30).
 *
 * Avant, « Marquer la période payée » (page Paie) ne faisait qu'une photo dans
 * `payroll_payments` : les commissions restaient « approuvées », on pouvait
 * encore les reverser ou les verser une deuxième fois, et une commission
 * arrivée après coup changeait en silence une paie déjà versée.
 *
 * Maintenant :
 *  - verser une période passe ses commissions gagnées à « versé » (même
 *    instant que la photo) ; l'annuler ne remet à « approuvé » QUE celles-là ;
 *  - une commission d'une période versée ne s'approuve, ne se verse, ne se
 *    reverse et ne se « dé-verse » plus : 409 ;
 *  - une commission GAGNÉE dans une période déjà versée (paiement enregistré
 *    en retard) est rattachée à la période en cours ; sa vraie date est gardée
 *    dans calc_breakdown.gagnee_le.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fuseauOrg } from '../automations-fuseau-org';
import { toLocalDate } from '../reports/dates';
import { bornesPeriode } from './commission-periode';

export class PeriodeVerrouillee extends Error {
  statut = 409;
  constructor(public periode: { debut: string; fin: string }) {
    super(`Pay period ${periode.debut} → ${periode.fin} has already been paid and is locked.`);
  }
}

/** Période versée (payroll_payments) qui contient l'instant `iso` pour ce membre, sinon null. */
export async function periodeVerseeDe(
  sc: SupabaseClient, orgId: string, userId: string, iso: string,
): Promise<{ debut: string; fin: string; paid_at: string } | null> {
  const jour = toLocalDate(iso, await fuseauOrg(sc, orgId));
  const { data, error } = await sc.from('payroll_payments')
    .select('period_start, period_end, paid_at')
    .eq('org_id', orgId).eq('user_id', userId)
    .lte('period_start', jour).gte('period_end', jour)
    .limit(1);
  if (error) throw new Error(`payroll period lookup failed: ${error.message}`);
  const p = data?.[0];
  return p ? { debut: p.period_start, fin: p.period_end, paid_at: p.paid_at } : null;
}

/** Lève PeriodeVerrouillee si la commission appartient à une période versée. */
export async function exigerPeriodeOuverte(sc: SupabaseClient, orgId: string, entryId: string): Promise<void> {
  const { data, error } = await sc.from('fs_commission_entries')
    .select('user_id, triggered_at').eq('id', entryId).eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return; // l'action elle-même répondra « introuvable »
  const p = await periodeVerseeDe(sc, orgId, data.user_id, data.triggered_at);
  if (p) throw new PeriodeVerrouillee(p);
}

/**
 * Date de rattachement d'une commission gagnée à `gagneeLe` : elle-même si sa
 * période de paie n'est pas encore versée, sinon « maintenant » (période en
 * cours). Renvoie aussi la vraie date pour la garder dans calc_breakdown.
 */
export async function dateDeRattachement(
  sc: SupabaseClient, orgId: string, userId: string, gagneeLe: string,
): Promise<{ triggered_at: string; decalee: boolean }> {
  const p = await periodeVerseeDe(sc, orgId, userId, gagneeLe);
  return p ? { triggered_at: new Date().toISOString(), decalee: true } : { triggered_at: gagneeLe, decalee: false };
}

/** Verse les commissions gagnées d'un membre sur la période (même instant que la photo de paie). */
export async function verserCommissionsPeriode(
  sc: SupabaseClient, orgId: string, userId: string, periode: { start: string; end: string }, verseLe: string, tz?: string,
): Promise<number> {
  const { debut, finExclusive } = bornesPeriode(periode.start, periode.end, tz ?? await fuseauOrg(sc, orgId));
  const { data, error } = await sc.from('fs_commission_entries')
    .update({ status: 'paid', paid_at: verseLe, updated_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('user_id', userId).is('deleted_at', null)
    .in('status', ['pending', 'approved'])
    // Pas les estimations (jobs non payés) : elles ne sont pas dues.
    .or('invoice_id.not.is.null,status.eq.approved')
    .gte('triggered_at', debut).lt('triggered_at', finExclusive)
    .select('id');
  if (error) throw new Error(`commission payout failed: ${error.message}`);
  return (data ?? []).length;
}

/** Annule le versement d'une période : seules les commissions versées À CET INSTANT redeviennent « approuvées ». */
export async function annulerVersementPeriode(
  sc: SupabaseClient, orgId: string, userId: string, periode: { start: string; end: string }, verseLe: string, tz?: string,
): Promise<number> {
  const { debut, finExclusive } = bornesPeriode(periode.start, periode.end, tz ?? await fuseauOrg(sc, orgId));
  const { data, error } = await sc.from('fs_commission_entries')
    .update({ status: 'approved', paid_at: null, updated_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('user_id', userId).is('deleted_at', null)
    .eq('status', 'paid').eq('paid_at', verseLe)
    .gte('triggered_at', debut).lt('triggered_at', finExclusive)
    .select('id');
  if (error) throw new Error(`commission payout undo failed: ${error.message}`);
  return (data ?? []).length;
}
