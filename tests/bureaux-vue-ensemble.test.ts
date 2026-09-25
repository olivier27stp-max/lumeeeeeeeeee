/**
 * Bureaux — phase 1 : vue d'ensemble du propriétaire (2026-09-25). Preuve de
 * bout en bout contre staging : scripts/qa/bureaux-vue-ensemble.mts (10/10).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHIFFRES, periode, totaliser, type ChiffresBureau } from '../server/lib/offices-overview';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const bureau = (n: number): ChiffresBureau => Object.fromEntries(CHIFFRES.map((c) => [c, n])) as unknown as ChiffresBureau;

describe('totaliser', () => {
  it('additionne chaque chiffre de chaque bureau', () => {
    const t = totaliser([bureau(1), bureau(2), bureau(40)]);
    for (const c of CHIFFRES) expect(t[c]).toBe(43);
  });
  it('aucun bureau : tout à zéro', () => {
    for (const c of CHIFFRES) expect(totaliser([])[c]).toBe(0);
  });
});

describe('periode', () => {
  const maintenant = new Date('2026-09-25T15:00:00Z');
  it('défaut : le mois en cours', () => {
    expect(periode(undefined, undefined, maintenant)).toEqual({ from: '2026-09-01', to: '2026-09-25' });
  });
  it('valeur invalide ignorée', () => {
    expect(periode("2026-01-01'; drop", 'x', maintenant)).toEqual({ from: '2026-09-01', to: '2026-09-25' });
  });
  it('bornes inversées remises dans l’ordre', () => {
    expect(periode('2026-12-31', '2026-01-01', maintenant)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('route', () => {
  it('réservée aux propriétaires et à la permission des rapports', () => {
    expect(lire('server/lib/route-permissions.ts')).toContain("'GET /api/orgs/offices/overview': 'financial.view_analytics'");
    const r = lire('server/routes/orgs.ts');
    expect(r).toContain("router.get('/orgs/offices/overview'");
    expect(r).toContain('Réservé aux propriétaires.');
  });
});
