/**
 * Filtres de la page Statistiques : période (prédéfinie ou personnalisée), comparaison à la
 * période précédente, et filtres équipe / technicien / vendeur / client / service.
 * Un seul état pour toute la page, reflété dans l'URL (partageable, retour arrière).
 * Les fonctions SQL reçoivent les filtres dans p_filtres (jsonb) ; chacune ignore ceux qui ne la
 * concernent pas — la page le signale sur la carte (FILTRES_APPLICABLES).
 */
import { periodRange, type InsightsPeriod, type InsightsRange } from './insightsPeriod';

export type CleFiltre = 'equipe' | 'technicien' | 'vendeur' | 'client' | 'service';
export const CLES_FILTRES: CleFiltre[] = ['equipe', 'technicien', 'vendeur', 'client', 'service'];
export type Filtres = Partial<Record<CleFiltre, string>>;

export interface EtatStats {
  periode: InsightsPeriod | 'custom';
  du?: string;
  au?: string;
  comparer: boolean;
  filtres: Filtres;
}

export const ETAT_DEFAUT: EtatStats = { periode: '12m', comparer: false, filtres: {} };

/** Cartes de la page → filtres qu'elles savent appliquer (les autres sont signalés « non appliqué »). */
export const FILTRES_APPLICABLES: Record<string, CleFiltre[]> = {
  revenu: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  services: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  modes: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  valeurMoyenne: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  equipes: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  topClients: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  fidelite: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  entonnoir: ['vendeur', 'client'],
  pipeline: ['vendeur', 'client'],
  soumissions: ['vendeur', 'client', 'service'],
  tresorerie: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  zones: ['equipe', 'technicien', 'vendeur', 'client', 'service'],
  rentabilite: ['technicien', 'vendeur', 'client', 'service'],
};

/** Filtres actifs que la carte ne sait pas appliquer. */
export function filtresNonAppliques(carte: string, filtres: Filtres): CleFiltre[] {
  const ok = new Set(FILTRES_APPLICABLES[carte] ?? []);
  return CLES_FILTRES.filter((k) => filtres[k] && !ok.has(k));
}

/** Filtres pour p_filtres (seulement les valeurs posées). */
export function pourRpc(filtres: Filtres): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CLES_FILTRES) if (filtres[k]) out[k] = filtres[k] as string;
  return out;
}

const JOUR = 86_400_000;
const versDate = (s: string) => new Date(`${s}T12:00:00`);
const versIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Granularité d'une période personnalisée : jours jusqu'à 45 jours, semaines jusqu'à 6 mois, sinon mois. */
export function granulariteAuto(du: string, au: string): InsightsRange['granularity'] {
  const jours = Math.round((versDate(au).getTime() - versDate(du).getTime()) / JOUR) + 1;
  return jours <= 45 ? 'day' : jours <= 183 ? 'week' : 'month';
}

/** Plage de la période choisie (dates LOCALES). Une période personnalisée incomplète retombe sur 12 mois. */
export function plage(etat: EtatStats, maintenant: Date = new Date()): InsightsRange {
  if (etat.periode === 'custom' && etat.du && etat.au) {
    const [du, au] = etat.du <= etat.au ? [etat.du, etat.au] : [etat.au, etat.du];
    return { from: du, to: au, granularity: granulariteAuto(du, au) };
  }
  return periodRange(etat.periode === 'custom' ? '12m' : etat.periode, maintenant);
}

/** Période précédente de même durée, juste avant (le 1er au 30 sept. → le 2 août au 31 août). */
export function plagePrecedente(r: InsightsRange): InsightsRange {
  const jours = Math.round((versDate(r.to).getTime() - versDate(r.from).getTime()) / JOUR) + 1;
  const fin = new Date(versDate(r.from).getTime() - JOUR);
  const debut = new Date(fin.getTime() - (jours - 1) * JOUR);
  return { from: versIso(debut), to: versIso(fin), granularity: r.granularity };
}

/**
 * Variation entre deux valeurs, prête à afficher. Jamais « ∞ % » ni « NaN » :
 * précédent à 0 → « nouveau » (ou rien si les deux sont à 0).
 * mode 'points' : écart de points de pourcentage (taux) ; 'jours' : écart en jours.
 */
export function variation(actuel: number | null | undefined, precedent: number | null | undefined, mode: 'pct' | 'points' | 'jours' = 'pct', fr = true):
  { texte: string; sens: 'hausse' | 'baisse' | 'stable' } | null {
  if (actuel == null || precedent == null || !Number.isFinite(actuel) || !Number.isFinite(precedent)) return null;
  if (mode !== 'pct') {
    const d = Math.round((actuel - precedent) * 10) / 10;
    const unite = mode === 'points' ? 'pt' : fr ? 'j' : 'd';
    if (d === 0) return { texte: `= 0 ${unite}`, sens: 'stable' };
    return { texte: `${d > 0 ? '↑' : '↓'} ${Math.abs(d).toLocaleString(fr ? 'fr-CA' : 'en-CA')} ${unite}`, sens: d > 0 ? 'hausse' : 'baisse' };
  }
  if (precedent === 0) return actuel === 0 ? { texte: '= 0 %', sens: 'stable' } : { texte: fr ? 'nouveau' : 'new', sens: 'hausse' };
  const p = Math.round(((actuel - precedent) / Math.abs(precedent)) * 100);
  if (p === 0) return { texte: '= 0 %', sens: 'stable' };
  return { texte: `${p > 0 ? '↑' : '↓'} ${Math.abs(p)} %`, sens: p > 0 ? 'hausse' : 'baisse' };
}

/** État ↔ paramètres d'URL (?periode=custom&du=…&au=…&comparer=1&equipe=…). */
export function lireUrl(params: URLSearchParams): EtatStats {
  const periode = params.get('periode');
  const valides = ['12m', '2y', '3y', '12w', 'ytd', 'custom'];
  const filtres: Filtres = {};
  for (const k of CLES_FILTRES) { const v = params.get(k); if (v && /^[0-9a-f-]{36}$/i.test(v)) filtres[k] = v; }
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    periode: (valides.includes(periode ?? '') ? periode : '12m') as EtatStats['periode'],
    du: date(params.get('du')),
    au: date(params.get('au')),
    comparer: params.get('comparer') === '1',
    filtres,
  };
}

export function ecrireUrl(etat: EtatStats): URLSearchParams {
  const p = new URLSearchParams();
  if (etat.periode !== '12m') p.set('periode', etat.periode);
  if (etat.periode === 'custom') { if (etat.du) p.set('du', etat.du); if (etat.au) p.set('au', etat.au); }
  if (etat.comparer) p.set('comparer', '1');
  for (const k of CLES_FILTRES) if (etat.filtres[k]) p.set(k, etat.filtres[k] as string);
  return p;
}
