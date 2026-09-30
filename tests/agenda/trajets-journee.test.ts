/**
 * Trajets planifiés de l'Agenda (audit 2026-09-30) : ordre chronologique,
 * alertes « chevauchement » et « trajet impossible », visites annulées hors
 * trajet, adresses à corriger listées, matrice de route en cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { trajetsParJour, jourDans, type VisiteTrajet } from '../../server/lib/trajets/journee';
import { matriceTrajets, definirFournisseurMatrice, viderCacheMatrice, compteurs, pointValide, volOiseauMetres, type Point } from '../../server/lib/trajets/matrice';
import { instantLocal, LIEUX } from '../../scripts/qa/agenda/fixture';

const TZ = 'America/Toronto';
/** Route déterministe : vol d'oiseau × 1,3 à 60 km/h. */
const route = (a: Point, b: Point) => { const metres = Math.round(volOiseauMetres(a, b) * 1.3); return { metres, secondes: Math.round(metres / (60000 / 3600)), estime: false }; };
const pt = (l: { lat: number | null; lng: number | null }) => (l.lat == null || l.lng == null ? null : { lat: l.lat, lng: l.lng });

let n = 0;
function visite(jour: string, hhmm: string, min: number, lieu: { adresse: string; lat: number | null; lng: number | null }, extra: Partial<VisiteTrajet> = {}): VisiteTrajet {
  const debut = instantLocal(jour, hhmm, TZ);
  return {
    visitId: `v${++n}`, jobId: `j${n}`, teamId: 'eq1', debut: debut.toISOString(),
    fin: new Date(debut.getTime() + min * 60_000).toISOString(), statut: 'scheduled',
    titre: `Visite ${n}`, client: null, adresse: lieu.adresse, point: pt(lieu), ...extra,
  };
}

describe('trajets planifiés', () => {
  it('suit l’ordre CHRONOLOGIQUE, même quand un autre ordre serait plus court', () => {
    const D = LIEUX.drummondville;
    // 8 h loin, 9 h près, 10 h loin : un optimiseur réordonnerait, le trajet planifié non.
    const vs = [visite('2026-10-05', '10:00', 45, D[7]), visite('2026-10-05', '08:00', 45, D[0]), visite('2026-10-05', '09:00', 45, D[5])];
    const [jour] = trajetsParJour(vs, TZ, route);
    expect(jour.equipes[0].arrets.map((a) => a.visitId)).toEqual([vs[1].visitId, vs[2].visitId, vs[0].visitId]);
    expect(jour.equipes[0].arrets.map((a) => a.ordre)).toEqual([1, 2, 3]);
  });

  it('visite annulée : hors du trajet ; adresse introuvable : listée à corriger, jamais placée', () => {
    const D = LIEUX.drummondville;
    const vs = [
      visite('2026-10-06', '08:00', 45, D[0]),
      visite('2026-10-06', '09:00', 45, D[1], { statut: 'cancelled' }),
      visite('2026-10-06', '10:00', 45, { adresse: '123 rue Inexistante', lat: null, lng: null }),
      visite('2026-10-06', '11:00', 45, D[2]),
    ];
    const [jour] = trajetsParJour(vs, TZ, route);
    expect(jour.equipes[0].arrets.map((a) => a.visitId)).toEqual([vs[0].visitId, vs[3].visitId]);
    expect(jour.aCorriger.map((a) => a.visitId)).toEqual([vs[2].visitId]);
    expect(jour.equipes[0].arrets.every((a) => a.lat !== 0 && a.lng !== 0)).toBe(true);
  });

  it('trajet impossible : Sherbrooke → Trois-Rivières en 15 minutes', () => {
    const vs = [visite('2026-10-05', '09:00', 45, LIEUX.sherbrooke[0]), visite('2026-10-05', '10:00', 45, LIEUX.trois_rivieres[0])];
    const [jour] = trajetsParJour(vs, TZ, route);
    expect(jour.equipes[0].arrets[1].alertes).toEqual(['trajet_impossible']);
    expect(jour.equipes[0].alertes).toBe(1);
  });

  it('chevauchement : deux visites de la même équipe qui se recouvrent', () => {
    const D = LIEUX.drummondville;
    const vs = [visite('2026-10-06', '10:00', 45, D[0]), visite('2026-10-06', '10:30', 45, D[1])];
    const [jour] = trajetsParJour(vs, TZ, route);
    expect(jour.equipes[0].arrets[1].alertes).toEqual(['chevauchement']);
  });

  it('deux jobs à la même adresse : deux arrêts, route nulle entre eux', () => {
    const D = LIEUX.drummondville;
    const vs = [visite('2026-10-08', '13:00', 45, D[4]), visite('2026-10-08', '14:00', 45, D[4])];
    const [jour] = trajetsParJour(vs, TZ, route);
    expect(jour.equipes[0].arrets).toHaveLength(2);
    expect(jour.equipes[0].arrets[1].depuisPrecedent?.metres).toBe(0);
  });

  it('le jour est celui de l’ENTREPRISE, passage à l’heure normale compris', () => {
    // 8 h le 2 novembre 2026 à Toronto (après le recul d'heure du 1er) = 13 h UTC.
    const iso = instantLocal('2026-11-02', '08:00', TZ).toISOString();
    expect(iso).toBe('2026-11-02T13:00:00.000Z');
    expect(jourDans(iso, TZ)).toBe('2026-11-02');
    // 22 h le 5 octobre à Toronto = le 6 en UTC, mais le 5 pour l'entreprise.
    expect(jourDans(instantLocal('2026-10-05', '22:00', TZ).toISOString(), TZ)).toBe('2026-10-05');
  });

  it('chaque équipe a son propre trajet', () => {
    const D = LIEUX.drummondville;
    const vs = [visite('2026-10-05', '08:00', 45, D[0]), visite('2026-10-05', '08:00', 45, D[1], { teamId: 'eq2' })];
    const [jour] = trajetsParJour(vs, TZ, route);
    expect(jour.equipes.map((e) => e.teamId).sort()).toEqual(['eq1', 'eq2']);
  });
});

describe('coordonnées', () => {
  it('rejette 0,0, les valeurs hors bornes et les vides', () => {
    expect(pointValide(0, 0)).toBeNull();
    expect(pointValide(null, -72)).toBeNull();
    expect(pointValide(95, -72)).toBeNull();
    expect(pointValide('45.88', '-72.48')).toEqual({ lat: 45.88, lng: -72.48 });
  });
});

describe('matrice de route en cache', () => {
  beforeEach(() => { viderCacheMatrice(); definirFournisseurMatrice(null); });

  it('un seul appel pour un jeu de points, puis zéro', async () => {
    let appels = 0;
    definirFournisseurMatrice(async (points) => {
      appels++;
      const m = points.map((a) => points.map((b) => route(a, b)));
      return { durations: m.map((l) => l.map((t) => t.secondes)), distances: m.map((l) => l.map((t) => t.metres)) };
    });
    const pts = LIEUX.drummondville.slice(0, 4).map((l) => pt(l)!);
    await matriceTrajets(pts);
    await matriceTrajets(pts);
    await matriceTrajets([pts[2], pts[0]]);
    expect(appels).toBe(1);
    expect(compteurs.appelsMatrice).toBe(1);
  });

  it('fournisseur en panne : estimation marquée, jamais 0', async () => {
    definirFournisseurMatrice(async () => null);
    const [a, b] = [pt(LIEUX.sherbrooke[0])!, pt(LIEUX.trois_rivieres[0])!];
    const m = await matriceTrajets([a, b]);
    expect(m[0][1].estime).toBe(true);
    expect(m[0][1].secondes).toBeGreaterThan(3600);
  });
});
