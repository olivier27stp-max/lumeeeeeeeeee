/**
 * OSRM — vraies distances et temps de conduite via OpenStreetMap.
 *
 * On interroge l'endpoint /table du serveur public OSRM
 * (router.project-osrm.org) : il renvoie, pour un ensemble de points, la
 * matrice complète des durées et distances par la route (routes réelles, pas
 * à vol d'oiseau). L'optimiseur travaille ensuite sur cette matrice.
 *
 * Repli : si OSRM est indisponible/trop lent/limité, l'appelant retombe sur
 * le calcul haversine — le service ne tombe jamais en panne pour autant.
 *
 * Note : le serveur public OSRM est destiné à un usage raisonnable et sans
 * garantie. Pour un gros volume, héberger sa propre instance OSRM ou passer à
 * une API payante (Google/Mapbox).
 */

import type { LatLng } from './geo';

const OSRM_BASE = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const TABLE_TIMEOUT_MS = 8000;

export interface OsrmMatrix {
  /** durations[i][j] = secondes de conduite du point i au point j */
  durations: number[][];
  /** distances[i][j] = mètres par la route du point i au point j */
  distances: number[][];
}

/**
 * Matrice des durées + distances par la route entre tous les points fournis.
 * L'ordre des lignes/colonnes suit l'ordre du tableau `points`.
 * Renvoie null si OSRM échoue (l'appelant doit alors retomber sur haversine).
 */
export async function osrmTable(points: LatLng[]): Promise<OsrmMatrix | null> {
  if (points.length < 2) return null;

  // OSRM attend lng,lat séparés par ';'.
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM_BASE}/table/v1/driving/${coords}?annotations=duration,distance`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TABLE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json?.code !== 'Ok' || !Array.isArray(json.durations)) return null;

    // `distances` peut manquer selon la config du serveur : on tolère.
    const durations: number[][] = json.durations;
    const distances: number[][] = Array.isArray(json.distances) ? json.distances : [];
    return { durations, distances };
  } catch {
    return null; // timeout, réseau, ou OSRM indisponible → repli haversine
  } finally {
    clearTimeout(timer);
  }
}
