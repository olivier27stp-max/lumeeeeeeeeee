/**
 * Crédits Lumi (2026-09-30) — ce que le CLIENT voit de sa consommation IA.
 *
 * Le coût réel reste mesuré en ¢ US (usage renvoyé par le fournisseur ×
 * `tarifs.ts`) et journalisé dans `ai_usage.cost_cents` — pour nous seulement.
 * Le client, lui, ne voit JAMAIS un montant : des crédits.
 *
 *   1 crédit = CENTS_US_PAR_CREDIT ¢ US de coût réel (même taux que la table
 *   `lumi_credit_taux` en base — un test compare les deux).
 *   Stockage en MICRO-crédits entiers (`ai_usage.credits_micro`, calculé par
 *   un trigger à l'insertion) ; affichage arrondi vers le bas.
 *
 * La période est MENSUELLE, au jour anniversaire du début d'abonnement, dans
 * le fuseau du bureau (`lumi_periode_debut` en base) ; pas de report.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Palier } from './budget';

/** 1 crédit = 3 ¢ US de coût API réel (décision du 2026-09-30). */
export const CENTS_US_PAR_CREDIT = 3;
export const MICRO_PAR_CREDIT = 1_000_000;

/** Coût réel (¢ US, décimales) → micro-crédits entiers, comme le trigger en base. */
export function centsEnMicroCredits(cents: number): number {
  return Math.round((Math.max(0, cents) * MICRO_PAR_CREDIT) / CENTS_US_PAR_CREDIT);
}

/** Micro-crédits → crédits affichés : toujours arrondis vers le BAS. */
export function creditsAffiches(micro: number): number {
  return Math.floor(Math.max(0, micro) / MICRO_PAR_CREDIT);
}

/** Crédits inclus par période → plafond interne en ¢ US (réservation atomique en base). */
export function creditsEnCents(credits: number): number {
  return Math.max(0, credits) * CENTS_US_PAR_CREDIT;
}

export interface EtatCredits {
  /** Le forfait inclut Lumi. */
  inclus: boolean;
  /** Crédits de la période. */
  total: number;
  /** Crédits consommés (entier, vers le bas). */
  utilises: number;
  /** Crédits restants (entier ≥ 0, vers le bas). */
  restants: number;
  /** 0..100. */
  pourcentage: number;
  /** Date locale du bureau, 'YYYY-MM-DD'. */
  renouvellement_le: string;
  palier: Palier;
  /** '80' dès 80 % consommés ; '100' épuisé. */
  avertissement: null | '80' | '100';
}

/** Calcule l'état affichable à partir des micro-crédits consommés. Pur, testable. */
export function etatDepuis(p: {
  inclus: boolean; totalCredits: number; utilisesMicro: number; renouvellement_le: string; palier: Palier;
}): EtatCredits {
  const totalMicro = Math.max(0, p.totalCredits) * MICRO_PAR_CREDIT;
  const utilisesMicro = Math.max(0, p.utilisesMicro);
  const restantsMicro = Math.max(0, totalMicro - utilisesMicro);
  const pourcentage = totalMicro > 0 ? Math.min(100, Math.floor((utilisesMicro * 100) / totalMicro)) : 0;
  const epuise = p.inclus && (p.palier === 'epuise' || (totalMicro > 0 && restantsMicro === 0));
  return {
    inclus: p.inclus,
    total: p.totalCredits,
    utilises: creditsAffiches(utilisesMicro),
    restants: creditsAffiches(restantsMicro),
    pourcentage,
    renouvellement_le: p.renouvellement_le,
    palier: epuise ? 'epuise' : p.palier,
    avertissement: !p.inclus ? null : epuise ? '100' : pourcentage >= 80 ? '80' : null,
  };
}

/** Date locale (fuseau du bureau) d'un instant, 'YYYY-MM-DD'. */
export function dateLocale(iso: string | Date, fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau || 'America/Montreal', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(typeof iso === 'string' ? new Date(iso) : iso);
}

export async function fuseauDuBureau(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  return String((data as { timezone?: string } | null)?.timezone || '').trim() || 'America/Montreal';
}

/** Prochain renouvellement du bureau, 'YYYY-MM-DD' local. */
export async function renouvellementLe(admin: SupabaseClient, orgId: string, fuseau?: string): Promise<string> {
  const { data, error } = await admin.rpc('lumi_prochain_renouvellement', { p_org: orgId });
  if (error) throw new Error(`lumi_prochain_renouvellement: ${error.message}`);
  return dateLocale(String(data), fuseau ?? await fuseauDuBureau(admin, orgId));
}

/** Micro-crédits consommés par le groupe du bureau sur la période (support exclu). */
export async function microCreditsUtilises(admin: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await admin.rpc('lumi_credits_utilises', { p_org: orgId });
  if (error) throw new Error(`lumi_credits_utilises: ${error.message}`);
  return Number(data ?? 0);
}
