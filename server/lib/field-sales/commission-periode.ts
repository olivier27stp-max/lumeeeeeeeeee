/**
 * Lecture et totaux des commissions — UNE seule source pour la page
 * Commissions, la Paie et le rapport (audit du 2026-09-30).
 *
 * Avant, chaque écran filtrait et additionnait à sa façon : `created_at` ici,
 * `triggered_at` là, bornes en UTC, reversées comptées ou non, estimations
 * payées en paie, sommes en dollars flottants. Les mêmes commissions
 * donnaient des totaux différents selon l'écran.
 *
 * Règles communes :
 *  - une commission appartient à la période où elle est GAGNÉE (`triggered_at`
 *    = date de paiement de la facture), dans le fuseau de l'entreprise ;
 *  - une ESTIMATION (entrée projetée à la création du job, sans facture) n'est
 *    jamais « gagnée » : elle est montrée à part, jamais dans un total dû ;
 *  - une commission REVERSÉE n'est jamais dans un total dû ;
 *  - tous les totaux sont des entiers en cents (la colonne est en dollars).
 */
import { startOfDayIso, endOfDayExclusiveIso, toLocalDate } from '../reports/dates';

export interface EntreeCommission {
  id?: string;
  user_id?: string;
  invoice_id?: string | null;
  status: string;
  amount: number | string | null;
  base_amount?: number | string | null;
}

/** Dollars (numeric) → cents entiers. */
export const enCents = (dollars: number | string | null | undefined): number => Math.round(Number(dollars || 0) * 100);

/** Estimation projetée à la création du job : aucune facture, pas encore gagnée. */
export const estEstimation = (e: Pick<EntreeCommission, 'invoice_id' | 'status'>): boolean => !e.invoice_id && e.status === 'pending';

/** [début, fin exclusive) d'une période « du … au … » (dates seules) dans le fuseau `tz`. */
export function bornesPeriode(from: string, to: string, tz: string): { debut: string; finExclusive: string } {
  return { debut: startOfDayIso(from, tz), finExclusive: endOfDayExclusiveIso(to, tz) };
}

/** Instant du 1er du mois (local à `tz`) qui contient `iso`. */
export function debutDuMoisLocal(iso: string, tz: string): string {
  return startOfDayIso(`${toLocalDate(iso, tz).slice(0, 7)}-01`, tz);
}

export interface TotauxCommissions {
  /** Gagné et dû : en attente d'approbation + approuvé + versé. */
  du_cents: number;
  en_attente_cents: number;
  approuve_cents: number;
  verse_cents: number;
  repris_cents: number;
  /** Estimations (jobs pas encore payés) — jamais dans du_cents. */
  estime_cents: number;
  /** Nombre de factures distinctes ayant une commission gagnée non reprise. */
  ventes: number;
}

export function totauxCommissions(entrees: EntreeCommission[]): TotauxCommissions {
  const t: TotauxCommissions = { du_cents: 0, en_attente_cents: 0, approuve_cents: 0, verse_cents: 0, repris_cents: 0, estime_cents: 0, ventes: 0 };
  const factures = new Set<string>();
  for (const e of entrees) {
    const c = enCents(e.amount);
    if (estEstimation(e)) { t.estime_cents += c; continue; }
    if (e.status === 'reversed') { t.repris_cents += c; continue; }
    if (e.status === 'pending') t.en_attente_cents += c;
    else if (e.status === 'approved') t.approuve_cents += c;
    else if (e.status === 'paid') t.verse_cents += c;
    else continue;
    if (e.invoice_id) factures.add(e.invoice_id);
  }
  t.du_cents = t.en_attente_cents + t.approuve_cents + t.verse_cents;
  t.ventes = factures.size;
  return t;
}

/**
 * Répartit `totalCents` entre les bénéficiaires d'un split, au prorata de
 * leur %, par la méthode du plus grand reste : la somme des parts est
 * EXACTEMENT le total (arrondir chaque part séparément pouvait verser 1 ¢ de
 * plus que la commission — 50/50 sur 5 ¢ donnait 3 + 3).
 * Les % sont normalisés par leur somme (comportement historique, décision D7).
 */
export function repartirParts<T extends { pct: number }>(totalCents: number, beneficiaires: T[]): Array<T & { part_cents: number }> {
  const somme = beneficiaires.reduce((s, b) => s + (b.pct > 0 ? b.pct : 0), 0);
  if (somme <= 0 || totalCents <= 0) return beneficiaires.map((b) => ({ ...b, part_cents: 0 }));
  const bruts = beneficiaires.map((b, i) => {
    const exact = (totalCents * Math.max(b.pct, 0)) / somme;
    return { b, i, bas: Math.floor(exact), reste: exact - Math.floor(exact) };
  });
  let restants = totalCents - bruts.reduce((s, x) => s + x.bas, 0);
  const ordre = [...bruts].sort((x, y) => y.reste - x.reste || x.i - y.i);
  const bonus = new Set<number>();
  for (const x of ordre) { if (restants <= 0) break; bonus.add(x.i); restants -= 1; }
  return bruts.map((x) => ({ ...x.b, part_cents: x.bas + (bonus.has(x.i) ? 1 : 0) }));
}

/** Base de commission d'une facture : sous-total − rabais, AVANT taxes. */
export function baseAvantTaxesCents(facture: { subtotal_cents?: number | null; discount_cents?: number | null; total_cents?: number | null; tax_cents?: number | null }): number {
  if (facture.subtotal_cents != null) {
    const sous = Math.max(Number(facture.subtotal_cents) || 0, 0);
    const rabais = Math.min(Math.max(Number(facture.discount_cents) || 0, 0), sous);
    return sous - rabais;
  }
  // Ligne héritée sans sous-total : on retire au moins les taxes connues.
  return Math.max((Number(facture.total_cents) || 0) - (Number(facture.tax_cents) || 0), 0);
}
