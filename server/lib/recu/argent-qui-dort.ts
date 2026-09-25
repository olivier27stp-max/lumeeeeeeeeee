/**
 * Le Reçu — l'argent qui dort.
 * ────────────────────────────
 * L'autre moitié du reçu : pas ce que les suivis ont rapporté, mais ce qu'ils
 * rapporteraient si on s'en occupait. Deux gisements :
 *
 *   · les soumissions envoyées, jamais signées, sans relance récente ;
 *   · les factures échues dont le solde n'est pas rentré.
 *
 * Contrairement à l'attribution, ce calcul ne demande AUCUN historique : il se
 * lit sur l'état d'aujourd'hui. C'est donc le premier chiffre en dollars que
 * Lume peut montrer, avant même d'avoir des relances au compteur.
 *
 * Comme `attribution.ts`, ce fichier ne parle pas à la base : il trie et
 * classe ce qu'on lui donne. Les montants sont en cents, les dates civiles en
 * `YYYY-MM-DD` (c'est le type de `due_date` et de `valid_until` en base).
 */

const JOUR_MS = 86_400_000;

/** Nombre de jours sans relance au-delà duquel une soumission « dort ». */
export const SEUIL_DORMANCE_JOURS = 7;

export interface DevisDormant {
  devisId: string;
  montantCents: number;
  client: string | null;
  /** Dernier contact connu : relance si elle existe, sinon l'envoi initial. */
  dernierContactA: Date;
  joursSansContact: number;
}

export interface FactureEnRetard {
  factureId: string;
  soldeCents: number;
  client: string | null;
  /** Date d'échéance civile, `YYYY-MM-DD`. */
  echeanceLe: string;
  joursDeRetard: number;
}

export interface ArgentQuiDort {
  totalCents: number;
  devisTotalCents: number;
  facturesTotalCents: number;
  devis: DevisDormant[];
  factures: FactureEnRetard[];
}

export interface EntreeDevis {
  devisId: string;
  montantCents: number;
  client: string | null;
  statut: string;
  envoyeA: Date | null;
  /** Dernière relance connue, tous canaux confondus. */
  derniereRelanceA: Date | null;
  signeA: Date | null;
}

export interface EntreeFacture {
  factureId: string;
  soldeCents: number;
  client: string | null;
  statut: string;
  echeanceLe: string | null;
}

/**
 * Les statuts de devis encore « en jeu ».
 *
 * `draft` en est exclu : un brouillon jamais parti n'est pas de l'argent qui
 * dort, c'est du travail pas fait. Les statuts terminaux (`approved`,
 * `declined`, `converted`, `expired`, `archived`) le sont aussi.
 */
const STATUTS_EN_JEU = new Set(['awaiting_response', 'changes_requested']);

/**
 * Les statuts de facture qui peuvent être en retard.
 *
 * `overdue` n'existe PAS en base (le CHECK ne l'autorise pas) : le retard est
 * dérivé de `due_date`. On l'accepte quand même en entrée, parce que du code
 * existant le filtre encore.
 */
const STATUTS_IMPAYES = new Set(['sent', 'partial', 'overdue']);

function joursEntre(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / JOUR_MS);
}

/** Minuit UTC d'une date civile `YYYY-MM-DD`. */
function dateCivile(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function trouverArgentQuiDort(
  entrees: { devis: EntreeDevis[]; factures: EntreeFacture[] },
  opts: { maintenant?: Date; seuilDormanceJours?: number; top?: number } = {},
): ArgentQuiDort {
  const maintenant = opts.maintenant ?? new Date();
  const seuil = opts.seuilDormanceJours ?? SEUIL_DORMANCE_JOURS;
  const aujourdhui = maintenant.toISOString().slice(0, 10);

  const devis: DevisDormant[] = [];
  for (const d of entrees.devis) {
    if (!STATUTS_EN_JEU.has(d.statut)) continue;
    if (d.signeA) continue;
    if (!d.envoyeA) continue;
    if (d.montantCents <= 0) continue;

    // Le dernier contact fait foi : un devis relancé hier ne dort pas, même
    // s'il a été envoyé il y a trois mois.
    const dernierContactA = d.derniereRelanceA && d.derniereRelanceA > d.envoyeA
      ? d.derniereRelanceA
      : d.envoyeA;
    const joursSansContact = joursEntre(dernierContactA, maintenant);
    if (joursSansContact < seuil) continue;

    devis.push({
      devisId: d.devisId,
      montantCents: d.montantCents,
      client: d.client,
      dernierContactA,
      joursSansContact,
    });
  }

  const factures: FactureEnRetard[] = [];
  for (const f of entrees.factures) {
    if (!STATUTS_IMPAYES.has(f.statut)) continue;
    if (f.soldeCents <= 0) continue;
    if (!f.echeanceLe) continue;
    // Comparaison de dates civiles : une facture due aujourd'hui n'est pas
    // encore en retard.
    if (f.echeanceLe >= aujourdhui) continue;

    const ech = dateCivile(f.echeanceLe);
    if (!ech) continue;

    factures.push({
      factureId: f.factureId,
      soldeCents: f.soldeCents,
      client: f.client,
      echeanceLe: f.echeanceLe,
      joursDeRetard: Math.max(0, joursEntre(ech, maintenant)),
    });
  }

  // Le plus gros d'abord : c'est l'ordre dans lequel un entrepreneur agit.
  devis.sort((a, b) => b.montantCents - a.montantCents);
  factures.sort((a, b) => b.soldeCents - a.soldeCents);

  const devisTotalCents = devis.reduce((s, x) => s + x.montantCents, 0);
  const facturesTotalCents = factures.reduce((s, x) => s + x.soldeCents, 0);

  return {
    // Le total porte sur TOUT ce qui dort, pas seulement sur le top affiché :
    // tronquer la liste ne doit pas rétrécir le chiffre annoncé.
    totalCents: devisTotalCents + facturesTotalCents,
    devisTotalCents,
    facturesTotalCents,
    devis: opts.top ? devis.slice(0, opts.top) : devis,
    factures: opts.top ? factures.slice(0, opts.top) : factures,
  };
}
