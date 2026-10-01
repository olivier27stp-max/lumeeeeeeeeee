/**
 * Compression des résultats d'outils (audit Lumi B5) : sans perte, déterministe,
 * et mesurablement plus courte sur une liste typique.
 */
import { describe, it, expect } from 'vitest';
import { sansVides, enTable, compacter, serialiserResultat, LIGNES_MIN_TABLE } from '../server/lib/lumi/compress';

const job = (i: number) => ({
  id: `job${i}`, job_number: 100 + i, title: `Nettoyage ${i}`, client_name: 'Marie Tremblay', property_address: null,
  scheduled_at: '2026-09-16T14:00:00-04:00', end_at: null, status: 'scheduled', derived_status: 'scheduled', total_cents: 12500, currency: 'CAD',
});

describe('sansVides', () => {
  it('retire null et undefined, garde 0, false, "" et les tableaux vides', () => {
    expect(sansVides({ a: null, b: undefined, c: 0, d: false, e: '', f: [], g: { h: null } })).toEqual({ c: 0, d: false, e: '', f: [], g: {} });
    expect(sansVides([1, null, { x: null }])).toEqual([1, {}]);
  });
});

describe('enTable', () => {
  it(`met en table à partir de ${LIGNES_MIN_TABLE} objets plats, colonnes dans l ordre d apparition`, () => {
    const t = enTable([{ a: 1, b: 2 }, { a: 3, c: 4 }, { a: 5 }, { a: 6 }, { a: 7, b: 8 }]) as any;
    expect(t.columns).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([[1, 2, null], [3, null, 4], [5, null, null], [6, null, null], [7, 8, null]]);
    expect(t.count).toBe(5);
  });
  it('laisse intacte une liste courte, une liste de scalaires ou de tableaux', () => {
    expect(enTable([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(enTable([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(enTable([[1], [2], [3], [4], [5]])).toEqual([[1], [2], [3], [4], [5]]);
  });
});

describe('compacter / serialiserResultat', () => {
  it('une liste de 20 jobs perd au moins 35 % de caractères, sans perdre une valeur', () => {
    const resultat = { total_matching: 22, sum_total_cents: 250_000, jobs: Array.from({ length: 20 }, (_, i) => job(i)) };
    const brut = JSON.stringify(resultat);
    const compact = serialiserResultat(resultat);
    expect(compact.length).toBeLessThan(brut.length * 0.65);
    const c = JSON.parse(compact);
    expect(c.total_matching).toBe(22);
    expect(c.sum_total_cents).toBe(250_000);
    expect(c.jobs.count).toBe(20);
    expect(c.jobs.columns).toContain('client_name');
    expect(c.jobs.columns).not.toContain('property_address'); // toujours null → absent
    const iTitre = c.jobs.columns.indexOf('title');
    expect(c.jobs.rows[7][iTitre]).toBe('Nettoyage 7');
  });
  it('est déterministe (même entrée → même texte) et gère null', () => {
    const r = { jobs: Array.from({ length: 6 }, (_, i) => job(i)) };
    expect(serialiserResultat(r)).toBe(serialiserResultat(JSON.parse(JSON.stringify(r))));
    expect(serialiserResultat(null)).toBe('null');
    expect(serialiserResultat(undefined)).toBe('null');
  });
  it('les objets imbriqués dans les cellules restent des objets', () => {
    const r = Array.from({ length: 5 }, (_, i) => ({ n: i, client: { name: `C${i}`, phone: null } }));
    const c = compacter(r) as any;
    expect(c.rows[2][1]).toEqual({ name: 'C2' });
  });
});

/**
 * Un JSON coupé au caractère est illisible : le modèle repart en exploration et
 * paie un deuxième tour. La borne retire des LIGNES et laisse un objet valide.
 */
describe('serialiserResultat — borne de taille', () => {
  const liste = (n: number) => ({ total_matching: n, sum_total_cents: 999_000, jobs: Array.from({ length: n }, (_, i) => job(i)) });

  it('rend toujours du JSON valide, sous la borne', () => {
    for (const max of [2_000, 900, 300, 40]) {
      const t = serialiserResultat(liste(400), max);
      expect(t.length).toBeLessThanOrEqual(max);
      expect(() => JSON.parse(t)).not.toThrow();
    }
  });

  it('retire des lignes et dit combien, en gardant les champs de tête', () => {
    const c = JSON.parse(serialiserResultat(liste(400), 3_000));
    expect(c.total_matching).toBe(400);          // le vrai total reste annonçable
    expect(c.sum_total_cents).toBe(999_000);
    expect(c.jobs.rows.length).toBeLessThan(400);
    expect(c.jobs.rows_omitted).toBe(400 - c.jobs.rows.length);
    expect(c.jobs.rows[0][c.jobs.columns.indexOf('title')]).toBe('Nettoyage 0');
  });

  it('raccourcit un champ texte démesuré quand il n y a pas de liste', () => {
    const c = JSON.parse(serialiserResultat({ note: 'x'.repeat(50_000) }, 3_000));
    expect(c.note).toContain('…[coupé]');
    expect(c.note.length).toBeLessThan(50_000);
  });

  it('le dit plutôt que de rendre un JSON cassé quand rien ne suffit', () => {
    const c = JSON.parse(serialiserResultat({ note: 'x'.repeat(50_000) }, 40));
    expect(c.error).toBe('result_too_large');
  });

  it('reste déterministe sous la borne', () => {
    expect(serialiserResultat(liste(300), 2_500)).toBe(serialiserResultat(liste(300), 2_500));
  });

  it('ne touche à rien quand ça rentre', () => {
    const petit = { total_matching: 2, jobs: [job(0), job(1)] };
    expect(serialiserResultat(petit, 100_000)).toBe(JSON.stringify(compacter(petit)));
  });
});
