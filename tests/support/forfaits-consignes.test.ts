/**
 * Les forfaits dans les consignes de l’assistant de support.
 *
 * Batterie du support, prod, 2026-10-01 : sans aucun fait écrit sur le contenu
 * des forfaits, l’assistant de l’app devinait — « le porte-à-porte est inclus
 * dans Scale et Autopilot » (il est réservé à Autopilot), et « à partir de quel
 * forfait les textos ? » ne recevait pas « Scale ».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Les cellules [Minimum, Scale, Autopilot] d'une ligne du tableau comparatif de la page Tarifs, par le début de son libellé anglais. */
function cellulesDe(page: string, debut: string): string {
  const depart = page.indexOf(`{ label: { en: '${debut}`);
  if (depart < 0) throw new Error(`ligne « ${debut} » introuvable dans Pricing.tsx`);
  const d = page.indexOf('cells: [', depart) + 'cells: ['.length;
  return page.slice(d, page.indexOf('] }', d));
}

describe('les forfaits dans les consignes de l’assistant de support', () => {
  const page = readFileSync(resolve(__dirname, '..', '..', 'src', 'pages', 'marketing', 'Pricing.tsx'), 'utf8');

  it('l’assistant de l’app a ces faits dans ses consignes, pas seulement derrière la recherche', async () => {
    const { promptsPourMesure, FORFAITS_POUR_LE_SUPPORT } = await import('../../server/lib/support/ia');
    for (const langue of ['fr', 'en'] as const) {
      const stable = promptsPourMesure(langue, 'app', null).stable;
      expect(stable).toContain(FORFAITS_POUR_LE_SUPPORT);
      expect(stable).toContain('name the FIRST plan that has the feature');
    }
    // L'assistant du site (visiteur) garde sa propre fiche, alignée ailleurs.
    expect(promptsPourMesure('fr', 'public', null).stable).not.toContain(FORFAITS_POUR_LE_SUPPORT);
  });

  it('chaque nombre de ces consignes est celui de la page Tarifs', async () => {
    const { FORFAITS_POUR_LE_SUPPORT } = await import('../../server/lib/support/ia');
    const lignes = FORFAITS_POUR_LE_SUPPORT.split('\n');
    const noms = ['Minimum', 'Scale', 'Autopilot'];
    const prix = [...page.matchAll(/CAD: \{ monthly: (\d+), extraUser: (\d+) \}/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const sieges = [...page.matchAll(/seats: \{ users: (\d+) \}/g)].map((m) => Number(m[1]));
    const bureaux = [...cellulesDe(page, 'Offices included').matchAll(/en: '(\d+)'/g)].map((m) => Number(m[1]));
    const rabais = [...page.matchAll(/annualDiscount: ([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100));
    expect(prix).toHaveLength(3);
    noms.forEach((nom, i) => {
      const l = lignes[i];
      expect(l.startsWith(`${nom}: $${prix[i][0]}`), l).toBe(true);
      expect(l).toContain(`+$${prix[i][1]} per extra user`);
      expect(l).toContain(`${bureaux[i]} office${bureaux[i] > 1 ? 's' : ''} —`);
      // Minimum : la page dit 3 utilisateurs, la table `plans` 2 — pas écrit tant que ce n'est pas tranché.
      if (i === 0) expect(l).not.toMatch(/\d+ users/);
      else expect(l).toContain(`${sieges[i]} users,`);
    });
    expect(lignes[3]).toBe(`Paid yearly: ${rabais[0]}% / ${rabais[1]}% / ${rabais[2]}% off.`);
    // Premier forfait de chaque fonction : 1 = Scale, 2 = Autopilot.
    const premier = (debut: string) => cellulesDe(page, debut).split(',').map((c) => c.trim()).findIndex((c) => c !== 'false');
    for (const [debut, mot] of [['Two-way SMS with a dedicated number', 'texting'], ['Automations & quote/invoice follow-ups', 'automations'], ['QuickBooks export', 'QuickBooks']] as const) {
      expect(premier(debut), debut).toBe(1);
      expect(lignes[1], mot).toContain(mot);
      expect(lignes[0], mot).not.toContain(mot);
    }
    for (const [debut, mot] of [['Lumi, the AI assistant', 'Lumi'], ['Door-to-door:', 'door-to-door'], ['Full API access', 'API access']] as const) {
      expect(premier(debut), debut).toBe(2);
      expect(lignes[2], mot).toContain(mot);
      expect(lignes[1], mot).not.toContain(mot);
    }
  });
});
