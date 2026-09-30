/**
 * Matrice des temps et distances de route, EN CACHE (audit Agenda, 2026-09-30).
 *
 * L'Agenda appelait Mapbox depuis le navigateur à chaque rendu : 100 appels
 * pour charger une semaine de 5 équipes, refaits à chaque rechargement. Ici,
 * chaque paire de points n'est demandée qu'UNE fois à OSRM (routes réelles,
 * OpenStreetMap), puis gardée en mémoire : recharger l'Agenda, changer de
 * vue ou d'équipe ne coûte plus aucun appel tant que les adresses ne changent
 * pas. Le solveur « Optimiser la journée » lit la même matrice.
 *
 * Repli : OSRM indisponible → estimation (vol d'oiseau × 1,3 à 50 km/h),
 * marquée `estime: true` pour que l'écran le dise, et gardée seulement une
 * heure (on retentera les vraies valeurs).
 */
import { osrmTable } from '../osrm';

export interface Point { lat: number; lng: number }
export interface Trajet { secondes: number; metres: number; estime: boolean }

const FACTEUR_ROUTE = 1.3;
const VITESSE_ESTIMEE_MS = 50_000 / 3600;
const DUREE_VIE_REELLE_MS = 30 * 24 * 3600 * 1000;
const DUREE_VIE_ESTIMEE_MS = 3600 * 1000;
const TAILLE_MAX = 200_000;

/** Compteurs d'appels, pour la mesure des coûts (et les tests). */
export const compteurs = { appelsMatrice: 0, pairesCalculees: 0, pairesEnCache: 0 };

type Entree = Trajet & { expire: number };
const cache = new Map<string, Entree>();

/** Un fournisseur de matrice remplaçable (tests : matrice déterministe). */
export type FournisseurMatrice = (points: Point[]) => Promise<{ durations: number[][]; distances: number[][] } | null>;
let fournisseur: FournisseurMatrice = osrmTable;
export function definirFournisseurMatrice(f: FournisseurMatrice | null): void { fournisseur = f ?? osrmTable; }
export function viderCacheMatrice(): void {
  cache.clear();
  compteurs.appelsMatrice = 0; compteurs.pairesCalculees = 0; compteurs.pairesEnCache = 0;
}

const cle = (a: Point, b: Point) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

export function volOiseauMetres(a: Point, b: Point): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimation(a: Point, b: Point): Trajet {
  const metres = Math.round(volOiseauMetres(a, b) * FACTEUR_ROUTE);
  return { metres, secondes: Math.round(metres / VITESSE_ESTIMEE_MS), estime: true };
}

function lire(a: Point, b: Point, maintenant: number): Trajet | null {
  const e = cache.get(cle(a, b));
  if (!e || e.expire < maintenant) return null;
  return { secondes: e.secondes, metres: e.metres, estime: e.estime };
}

function ecrire(a: Point, b: Point, t: Trajet, maintenant: number): void {
  if (cache.size >= TAILLE_MAX) {
    // Éviction simple : on retire le plus ancien (ordre d'insertion d'une Map).
    const premiere = cache.keys().next().value;
    if (premiere !== undefined) cache.delete(premiere);
  }
  cache.set(cle(a, b), { ...t, expire: maintenant + (t.estime ? DUREE_VIE_ESTIMEE_MS : DUREE_VIE_REELLE_MS) });
}

/**
 * Trajets entre toutes les paires de `points` : m[i][j] = de i vers j.
 * Un seul appel au fournisseur, et seulement s'il manque au moins une paire.
 */
export async function matriceTrajets(points: Point[]): Promise<Trajet[][]> {
  const n = points.length;
  const maintenant = Date.now();
  const m: (Trajet | null)[][] = points.map((a, i) => points.map((b, j) => (i === j ? { secondes: 0, metres: 0, estime: false } : lire(a, b, maintenant))));
  const manquantes = m.some((ligne) => ligne.some((t) => t === null));
  if (!manquantes) {
    compteurs.pairesEnCache += n * (n - 1);
    return m as Trajet[][];
  }
  compteurs.appelsMatrice++;
  const reponse = n >= 2 ? await fournisseur(points).catch(() => null) : null;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || m[i][j]) continue;
      const s = reponse?.durations?.[i]?.[j];
      const d = reponse?.distances?.[i]?.[j];
      const t: Trajet = typeof s === 'number' && Number.isFinite(s)
        ? { secondes: Math.round(s), metres: typeof d === 'number' && Number.isFinite(d) ? Math.round(d) : Math.round(volOiseauMetres(points[i], points[j]) * FACTEUR_ROUTE), estime: false }
        : estimation(points[i], points[j]);
      ecrire(points[i], points[j], t, maintenant);
      m[i][j] = t;
      compteurs.pairesCalculees++;
    }
  }
  return m as Trajet[][];
}

/** Une coordonnée utilisable : définie, dans les bornes, et jamais 0,0. */
export function pointValide(lat: unknown, lng: unknown): Point | null {
  const la = typeof lat === 'string' ? Number(lat) : lat;
  const lo = typeof lng === 'string' ? Number(lng) : lng;
  if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  if (Math.abs(la) < 1e-6 && Math.abs(lo) < 1e-6) return null;
  return { lat: la, lng: lo };
}
