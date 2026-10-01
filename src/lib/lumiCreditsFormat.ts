/**
 * Crédits Lumi — mise en forme, sans appel réseau (utilisable par les pages
 * publiques comme Tarifs). Le libellé vient de l'i18n (`lumiCredits.unit`) :
 * une seule clé, réutilisée partout.
 *
 * Aucun montant en dollars d'IA ne s'affiche au client (décision du
 * 2026-09-30) : ces fonctions ne manipulent que des crédits.
 */
import en from '../i18n/en';
import fr from '../i18n/fr';

type Langue = 'fr' | 'en';

/**
 * Crédits inclus dans Autopilot, pour les pages de vente. L'app, elle, lit
 * le vrai chiffre du serveur (`plans.lumi_credits_mensuels`, /api/lumi/credits).
 */
export const CREDITS_LUMI_AUTOPILOT = 1000;

/** Remplit un gabarit i18n : « Il te reste {n} {unit} » + { n: '12', unit: 'crédits Lumi' }. */
export function remplir(gabarit: string, valeurs: Record<string, string | number>): string {
  return gabarit.replace(/\{(\w+)\}/g, (tout: string, cle: string, position: number) => {
    if (!(cle in valeurs)) return tout;
    const v = String(valeurs[cle]);
    // « jusqu'au {date}. » avec date = « 12 nov. » : pas de double point.
    return v.endsWith('.') && gabarit.charAt(position + tout.length) === '.' ? v.slice(0, -1) : v;
  });
}

/** Première lettre en majuscule (« crédits Lumi » → « Crédits Lumi »). */
export function majuscule(texte: string): string {
  return texte ? texte.charAt(0).toLocaleUpperCase() + texte.slice(1) : texte;
}

/** 1000 → « 1 000 » (fr) / « 1,000 » (en). Entiers à l'écran, sauf l'historique (1 décimale). */
export function fmtCredits(n: number, langue: Langue, decimales = 0): string {
  return n.toLocaleString(langue === 'fr' ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 0, maximumFractionDigits: decimales });
}

/**
 * 'YYYY-MM-DD' → « 12 nov. » (fr) / « Nov 12 » (en). La date est lue comme
 * une date LOCALE : `new Date('2026-11-12')` serait minuit UTC, donc le 11
 * au soir à Montréal — le renouvellement s'afficherait un jour trop tôt.
 */
export function fmtDateCredits(iso: string | null | undefined, langue: Langue, long = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(langue === 'fr' ? 'fr-CA' : 'en-CA', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

/** Le libellé de l'unité dans une langue donnée (« crédits Lumi » / « Lumi credits »). */
export function uniteCredits(langue: Langue): string {
  return (langue === 'fr' ? fr : en).lumiCredits.unit;
}

/** « 1 000 crédits Lumi / mois » / « 1,000 Lumi credits / month ». */
export function creditsParMois(langue: Langue, n: number = CREDITS_LUMI_AUTOPILOT): string {
  const cl = (langue === 'fr' ? fr : en).lumiCredits;
  return remplir(cl.perMonth, { n: fmtCredits(n, langue), unit: cl.unit });
}

/** Les textes « crédits Lumi » d'une langue, pour les composants qui reçoivent `fr` plutôt que `t`. */
export function textesCredits(langue: Langue) {
  return (langue === 'fr' ? fr : en).lumiCredits;
}
