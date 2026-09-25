/**
 * L'INTERVALLE D'UN ABONNEMENT LUME (2026-09-25).
 *
 * Trois rythmes : mensuel, trimestriel (aux 3 mois), annuel. Le trimestriel
 * est le MÊME forfait facturé aux 3 mois, au prix mensuel × 3 — pas un
 * rabais. Il n'est offert sur aucune page : il se vend par lien de paiement
 * Stripe (prix `month` / `interval_count: 3`, `metadata.lume_interval`).
 *
 * POURQUOI UN MODULE
 * L'intervalle était un ternaire binaire (`=== 'yearly' ? … : mensuel`) : une
 * troisième valeur tombait en silence dans « mensuel » — prix, période,
 * libellé du reçu. Ici chaque décision est un `switch` exhaustif : oublier
 * un cas est une erreur de compilation (`never`).
 *
 * L'accès ne dépend JAMAIS de l'intervalle : subscription-guard lit le
 * statut, feature-guard le forfait. Ce module ne sert qu'à facturer et à
 * afficher juste.
 */
import type Stripe from 'stripe';

export type IntervalleAbonnement = 'monthly' | 'quarterly' | 'yearly';

function inconnu(v: never): never {
  throw new Error(`Intervalle d'abonnement inconnu : ${String(v)}`);
}

export function estIntervalle(v: unknown): v is IntervalleAbonnement {
  return v === 'monthly' || v === 'quarterly' || v === 'yearly';
}

/**
 * Valeur lue en base ou dans des métadonnées tapées à la main. Tout ce qui
 * n'est pas reconnu retombe sur « mensuel », comme avant ce module.
 */
export function intervalleLu(v: string | null | undefined): IntervalleAbonnement {
  if (estIntervalle(v)) return v;
  if (v === 'annual') return 'yearly';
  return 'monthly';
}

/**
 * Plan annuel en 3 versements (billing.ts create-checkout-session) : prix
 * `month` / 4 portant `metadata.installments = 3`. C'est la SEULE forme créée
 * par le code — un `month` / 3 n'en est jamais un, même avec une métadonnée
 * de versements : ce serait un trimestriel classé annuel à tort.
 */
export function estPrixVersements(
  recurring: { interval?: string | null; interval_count?: number | null } | null | undefined,
  metadata: Record<string, string> | null | undefined,
): boolean {
  if (estIntervalle(metadata?.lume_interval)) return false;
  return recurring?.interval === 'month'
    && Number(recurring?.interval_count || 1) === 4
    && Number(metadata?.installments || 0) === 3;
}

/**
 * Stripe → Lume. `metadata.lume_interval` fait autorité ; à défaut, la
 * récurrence. Une combinaison inconnue (ex. `month` / 2) donne null : on ne
 * devine pas un forfait qu'on facturerait faux.
 */
export function intervalleDepuisPrix(
  recurring: { interval?: string | null; interval_count?: number | null } | null | undefined,
  metadata: Record<string, string> | null | undefined,
): IntervalleAbonnement | null {
  const marque = metadata?.lume_interval;
  if (estIntervalle(marque)) return marque;
  const unite = recurring?.interval;
  const nombre = Number(recurring?.interval_count || 1);
  if (unite === 'year' && nombre === 1) return 'yearly';
  if (unite === 'month' && nombre === 1) return 'monthly';
  if (unite === 'month' && nombre === 3) return 'quarterly';
  return null;
}

/** Fin de la période qui commence à `debut`. */
export function finDePeriode(debut: Date, intervalle: IntervalleAbonnement): Date {
  const fin = new Date(debut);
  switch (intervalle) {
    case 'monthly': fin.setMonth(fin.getMonth() + 1); return fin;
    case 'quarterly': fin.setMonth(fin.getMonth() + 3); return fin;
    case 'yearly': fin.setFullYear(fin.getFullYear() + 1); return fin;
    default: return inconnu(intervalle);
  }
}

/** Nombre de mois couverts par un prélèvement (revenu mensuel normalisé). */
export function moisParPeriode(intervalle: IntervalleAbonnement): number {
  switch (intervalle) {
    case 'monthly': return 1;
    case 'quarterly': return 3;
    case 'yearly': return 12;
    default: return inconnu(intervalle);
  }
}

/** « Période de facturation » du reçu. */
export function libelleFacturation(intervalle: IntervalleAbonnement): string {
  switch (intervalle) {
    case 'monthly': return 'Mensuel';
    case 'quarterly': return 'Trimestriel';
    case 'yearly': return 'Annuel';
    default: return inconnu(intervalle);
  }
}

/** « 347,00 $ / mois » — ce qui suit la barre. */
export function libellePeriode(intervalle: IntervalleAbonnement): string {
  switch (intervalle) {
    case 'monthly': return 'mois';
    case 'quarterly': return '3 mois';
    case 'yearly': return 'an';
    default: return inconnu(intervalle);
  }
}

/**
 * Prix catalogue d'un forfait pour un intervalle, en cents. Le trimestriel
 * n'a pas de colonne dans `plans` : il vaut, par définition, 3 × le mensuel.
 */
export function prixCatalogue(
  plan: Record<string, unknown> | null | undefined,
  intervalle: IntervalleAbonnement,
  currency: string | null | undefined,
): number {
  if (!plan) return 0;
  const dev = String(currency || 'CAD').toUpperCase() === 'USD' ? 'usd' : 'cad';
  const lire = (cle: string) => {
    const v = Number(plan[cle]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  };
  switch (intervalle) {
    case 'monthly': return lire(`monthly_price_${dev}`);
    case 'quarterly': return lire(`monthly_price_${dev}`) * 3;
    case 'yearly': return lire(`yearly_price_${dev}`);
    default: return inconnu(intervalle);
  }
}

/**
 * Où chercher, dans `plans`, le forfait d'un montant facturé par Stripe
 * (webhook customer.subscription.updated). null = aucun forfait ne peut
 * correspondre (trimestriel non divisible par 3).
 */
export function appariementPlan(
  intervalle: IntervalleAbonnement,
  currency: string,
  montantCents: number,
): { colonne: string; montant: number } | null {
  const dev = currency.toUpperCase() === 'USD' ? 'usd' : 'cad';
  switch (intervalle) {
    case 'monthly': return { colonne: `monthly_price_${dev}`, montant: montantCents };
    case 'quarterly': return montantCents % 3 === 0 ? { colonne: `monthly_price_${dev}`, montant: montantCents / 3 } : null;
    case 'yearly': return { colonne: `yearly_price_${dev}`, montant: montantCents };
    default: return inconnu(intervalle);
  }
}

/**
 * Ce qu'un client a acheté, lu sur le prix Stripe payé — pour un lien de
 * paiement créé dans le tableau de bord Stripe, dont la session ne porte
 * pas nos métadonnées. Chaque produit Lume porte `metadata.plan_id` et
 * `metadata.plan_slug`. Les produits « siège supplémentaire » portent aussi
 * un plan_id, mais avec `type` : ce n'est pas un forfait, on les écarte.
 */
export function forfaitDepuisPrix(prix: Stripe.Price | null | undefined): {
  plan_id: string | null;
  plan_slug: string | null;
  interval: IntervalleAbonnement;
  currency: string;
} | null {
  if (!prix || !prix.recurring) return null;
  const produit = prix.product;
  if (!produit || typeof produit === 'string' || (produit as Stripe.DeletedProduct).deleted) return null;
  const meta = (produit as Stripe.Product).metadata || {};
  if (meta.type) return null;
  const plan_id = meta.plan_id || null;
  const plan_slug = meta.plan_slug || null;
  if (!plan_id && !plan_slug) return null;
  const interval = intervalleDepuisPrix(prix.recurring, prix.metadata);
  if (!interval) return null;
  return { plan_id, plan_slug, interval, currency: (prix.currency || 'cad').toUpperCase() };
}
