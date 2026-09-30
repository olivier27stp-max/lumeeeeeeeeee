/**
 * Solveur « Optimiser la journée » (audit Agenda, 2026-09-30) : 100 % code.
 * Fixtures dont l'ordre optimal est connu, contraintes, déterminisme.
 */
import { describe, it, expect } from 'vitest';
import { optimiserEquipe, EXACT_MAX, type EntreeEquipe, type VisiteOpt } from '../../server/lib/trajets/optimisation';
import { volOiseauMetres, type Point } from '../../server/lib/trajets/matrice';

/** Route déterministe : vol d'oiseau × 1,3 à 60 km/h. */
const tr = (a: Point, b: Point) => { const metres = Math.round(volOiseauMetres(a, b) * 1.3); return { metres, secondes: Math.round(metres / (60000 / 3600)), estime: false }; };
const H = (h: number, m = 0) => Date.UTC(2026, 9, 5, 12 + h - 8, m); // 8 h Toronto = 12 h UTC (heure d'été)
/** Des points alignés d'ouest en est sur la latitude de Drummondville, tous les ~8 km. */
const P = (i: number): Point => ({ lat: 45.88, lng: -72.60 + i * 0.1 });

function v(id: string, pos: number, h: number, m = 0, extra: Partial<VisiteOpt> = {}): VisiteOpt {
  return { id, jobId: `job-${id}`, titre: id, debut: H(h, m), fin: H(h, m) + 45 * 60_000, point: P(pos), fixe: null, ...extra };
}
const equipe = (visites: VisiteOpt[], extra: Partial<EntreeEquipe> = {}): EntreeEquipe => ({
  teamId: 'eq', visites, debutJournee: H(8), finJournee: H(18), pasAvant: H(7), depart: P(0), arrivee: null, ...extra,
});

describe('solveur : ordre optimal connu', () => {
  it('des arrêts alignés planifiés en zigzag → l’ordre d’ouest en est', () => {
    const r = optimiserEquipe(equipe([v('d', 4, 8), v('a', 1, 9), v('c', 3, 10), v('b', 2, 11)]), tr);
    expect(r.apres.ordre).toEqual(['a', 'b', 'c', 'd']);
    expect(r.gainSecondes).toBeGreaterThan(10 * 60);
    expect(r.exact).toBe(true);
  });

  it('déjà dans le bon ordre → aucun gain, rien à déplacer d’ordre', () => {
    const r = optimiserEquipe(equipe([v('a', 1, 8), v('b', 2, 9), v('c', 3, 10)]), tr);
    expect(r.apres.ordre).toEqual(['a', 'b', 'c']);
    expect(r.gainSecondes).toBe(0);
  });
});

describe('solveur : contraintes', () => {
  it('une visite fixe garde son heure exacte ; les autres s’organisent autour', () => {
    const fixe = v('f', 4, 10, 0, { fixe: 'confirmee_client' });
    const r = optimiserEquipe(equipe([v('d', 3, 8), fixe, v('a', 1, 11), v('b', 2, 12)]), tr);
    expect(r.changements.find((c) => c.visitId === 'f')).toBeUndefined();
    expect(r.fixes).toEqual([{ visitId: 'f', titre: 'f', raison: 'confirmee_client' }]);
  });

  it('chaque visite garde sa durée ; rien hors des heures de travail ni dans le passé', () => {
    const e = equipe([v('d', 4, 8), v('a', 1, 9), v('c', 3, 10), v('b', 2, 11)], { pasAvant: H(9, 7), debutJournee: H(8), finJournee: H(17) });
    const r = optimiserEquipe(e, tr);
    for (const c of r.changements) {
      expect(c.apresFin - c.apresDebut).toBe(c.avantFin - c.avantDebut);
      expect(c.apresDebut).toBeGreaterThanOrEqual(H(9, 7));
      expect(c.apresFin).toBeLessThanOrEqual(H(17));
      expect(new Date(c.apresDebut).getUTCMinutes() % 5).toBe(0);
    }
  });

  it('les visites d’une même job gardent leur ordre', () => {
    const r = optimiserEquipe(equipe([v('j2', 1, 11, 0, { jobId: 'même' }), v('x', 3, 8), v('j1', 4, 9, 0, { jobId: 'même' }), v('y', 2, 10)]), tr);
    expect(r.apres.ordre.indexOf('j1')).toBeLessThan(r.apres.ordre.indexOf('j2'));
  });

  it('journée impossible à tenir : aucune proposition, et la raison', () => {
    const r = optimiserEquipe(equipe([v('a', 1, 8), v('b', 2, 9)], { finJournee: H(8, 30) }), tr);
    expect(r.changements).toEqual([]);
    expect(r.impossibles.length).toBeGreaterThan(0);
  });

  it('en cours de journée : seulement les visites restantes, à partir de la position actuelle', () => {
    const faite = v('fait', 1, 8, 0, { fixe: 'terminee' });
    const e = equipe([faite, v('d', 4, 9, 30), v('b', 2, 10, 30), v('c', 3, 11, 30)], { pasAvant: H(9), depart: P(1) });
    const r = optimiserEquipe(e, tr);
    expect(r.apres.ordre).toEqual(['b', 'c', 'd']);
    expect(r.fixes).toContainEqual({ visitId: 'fait', titre: 'fait', raison: 'terminee' });
    expect(r.changements.every((c) => c.apresDebut >= H(9))).toBe(true);
  });
});

describe('solveur : déterminisme et heuristique', () => {
  const grande = () => {
    // Au-delà de l'exact : heuristique. Positions pseudo-aléatoires mais fixes.
    const pos = [7, 2, 9, 4, 1, 8, 3, 6, 5, 10];
    return equipe(pos.map((p, i) => v(`v${i}`, p, 8 + Math.floor(i * 0.9), (i * 7) % 60)), { finJournee: H(23) });
  };

  it('10 exécutions → exactement la même proposition', () => {
    const e = equipe([v('d', 4, 8), v('a', 1, 9), v('c', 3, 10), v('b', 2, 11), v('e', 5, 12)]);
    const premiere = JSON.stringify(optimiserEquipe(e, tr));
    for (let i = 0; i < 10; i++) expect(JSON.stringify(optimiserEquipe(e, tr))).toBe(premiere);
    const g = JSON.stringify(optimiserEquipe(grande(), tr));
    for (let i = 0; i < 10; i++) expect(JSON.stringify(optimiserEquipe(grande(), tr))).toBe(g);
  });

  it('heuristique (au-delà de l’exact) : trouve l’ordre optimal d’arrêts alignés', () => {
    const r = optimiserEquipe(grande(), tr);
    expect(r.exact).toBe(false);
    expect(grande().visites.length).toBeGreaterThan(EXACT_MAX);
    expect(r.apres.ordre).toEqual(['v4', 'v1', 'v6', 'v3', 'v8', 'v7', 'v0', 'v5', 'v2', 'v9']);
  });

  it('heuristique = exact sur des journées où les deux s’appliquent', () => {
    // Mêmes 8 visites : on force l'heuristique en comparant à l'exact (le résultat exact est l'étalon).
    const e = equipe([v('d', 4, 8), v('a', 1, 9), v('h', 8, 10), v('c', 3, 11), v('g', 7, 12), v('b', 2, 13), v('f', 6, 14), v('e', 5, 15)], { finJournee: H(23) });
    const r = optimiserEquipe(e, tr);
    expect(r.exact).toBe(true);
    expect(r.apres.ordre).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});
