import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Boucle de rendu infinie sur la page Tâches.
 *
 * Trouvée le 2026-09-01 par la campagne de passages répétés : elle
 * n'apparaissait qu'environ une fois sur quatre, donc jamais lors d'un test
 * unique — le pire genre de défaut, celui qu'on voit sans pouvoir le
 * reproduire.
 *
 * Cause : `useEffect(..., [rows])` où `rows = data?.rows || []`. Tant que les
 * données ne sont pas chargées, ce `[]` est un NOUVEAU tableau à chaque rendu.
 * React le compare par référence, relance l'effet, qui appelle setSelected,
 * qui provoque un rendu — et ainsi de suite. React finit par abandonner avec
 * « Maximum update depth exceeded ».
 *
 * Symptômes côté utilisateur : page qui rame, processeur qui s'emballe.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

describe('la page Tâches ne boucle plus', () => {
  const source = lire('src/pages/Tasks.tsx');

  it('l\'effet ne dépend plus de la référence du tableau', () => {
    // `[rows]` seul suffisait à créer la boucle.
    expect(source).not.toMatch(/useEffect\(\(\) => \{ setSelected\(new Set\(\)\); \}, \[rows\]\)/);
  });

  it('il dépend de l\'identité des lignes affichées', () => {
    expect(source).toContain('const idsAffiches = rows.map');
    expect(source).toContain('}, [idsAffiches]);');
  });

  it('la cause est documentée sur place', () => {
    // Sans explication, quelqu'un « simplifiera » en remettant [rows].
    expect(source).toContain('Maximum update depth exceeded');
  });
});

describe('le même piège n\'est pas ailleurs', () => {
  it('Payments protège son tableau par useMemo', () => {
    const src = lire('src/pages/Payments.tsx');
    expect(src).toMatch(/const rows = useMemo\(\(\) => paymentsQuery\.data\?\.rows \|\| \[\]/);
  });

  it('Quotes n\'utilise rows que dans un useMemo, jamais dans un useEffect', () => {
    // Un useMemo ne met aucun état à jour : il recalcule sans pouvoir boucler.
    const src = lire('src/pages/Quotes.tsx');
    const effets = src.match(/useEffect\([\s\S]{0,400}?\}, \[[^\]]*rows[^\]]*\]\)/g) || [];
    expect(effets).toEqual([]);
  });
});
