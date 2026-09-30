/**
 * API de cartes SIMULÉE pour les tests de l'Agenda : aucun appel réel.
 *
 * Matrice déterministe : distance routière = vol d'oiseau × 1,3 ; vitesse
 * moyenne 60 km/h. Même entrée → même réponse, à chaque exécution.
 * Couvre les réponses Mapbox (Directions, Optimization) que le navigateur
 * appelle, et compte les appels : un test de coût peut vérifier qu'aucun
 * appel ne part à chaque rendu.
 */
import type { Page, Route } from '@playwright/test';

export const FACTEUR_ROUTE = 1.3;
export const VITESSE_MS = 60_000 / 3600;

export function volOiseauM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a; const [lng2, lat2] = b;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance (m) et durée (s) simulées entre deux points [lng, lat]. */
export function trajetSimule(a: [number, number], b: [number, number]): { distance: number; duration: number } {
  const distance = Math.round(volOiseauM(a, b) * FACTEUR_ROUTE);
  return { distance, duration: Math.round(distance / VITESSE_MS) };
}

function coords(url: string, marqueur: string): [number, number][] {
  const brut = decodeURIComponent(url.split(marqueur)[1].split('?')[0]);
  return brut.split(';').map((p) => p.split(',').map(Number) as [number, number]);
}

function route(points: [number, number][]) {
  const legs = points.slice(1).map((p, i) => trajetSimule(points[i], p));
  return {
    distance: legs.reduce((s, l) => s + l.distance, 0),
    duration: legs.reduce((s, l) => s + l.duration, 0),
    geometry: { type: 'LineString', coordinates: points },
    legs,
  };
}

export interface CompteurCartes { directions: number; optimisation: number; geocodage: number; tuiles: number }

/** Branche la carte simulée sur la page. `erreur: true` simule une panne de l'API. */
export async function simulerCartes(page: Page, opts: { erreur?: boolean } = {}): Promise<CompteurCartes> {
  const n: CompteurCartes = { directions: 0, optimisation: 0, geocodage: 0, tuiles: 0 };
  await page.route('https://api.mapbox.com/**', async (r: Route) => {
    const url = r.request().url();
    if (opts.erreur) return r.fulfill({ status: 503, body: 'indisponible' });
    if (url.includes('/directions/v5/')) {
      n.directions++;
      return r.fulfill({ json: { code: 'Ok', routes: [route(coords(url, '/driving/'))] } });
    }
    if (url.includes('/optimized-trips/v1/')) {
      n.optimisation++;
      const pts = coords(url, '/driving/');
      return r.fulfill({ json: { code: 'Ok', trips: [route(pts)], waypoints: pts.map((_, i) => ({ waypoint_index: i, trips_index: 0 })) } });
    }
    if (url.includes('/geocoding/')) { n.geocodage++; return r.fulfill({ json: { features: [] } }); }
    // Style, tuiles, polices, sprites : réponses vides (la carte se dessine sans fond).
    n.tuiles++;
    if (url.includes('/styles/v1/')) {
      return r.fulfill({ json: { version: 8, name: 'test', sources: {}, layers: [{ id: 'fond', type: 'background', paint: { 'background-color': '#eef2f7' } }] } });
    }
    return r.fulfill({ status: 204, body: '' });
  });
  // Tuiles d'autres fournisseurs et avatars : jamais de réseau réel.
  await page.route(/api\.dicebear\.com|tile\.openstreetmap|events\.mapbox\.com/, (r) => r.fulfill({ status: 204, body: '' }));
  return n;
}
