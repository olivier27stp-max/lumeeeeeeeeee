/**
 * Lumi n'appelle plus les routes d'événements VIDES.
 *
 * Quatre événements naissent d'un trigger en base ; leur route ne fait plus que répondre
 * `{ ok: true, via: 'base' }`, mais elle exige « Modifier les automatisations ». Un technicien qui
 * demandait à Lumi d'ajouter ou d'annuler une visite recevait donc « automatisations non
 * déclenchées » — alors que la base avait émis l'événement et que les rappels étaient partis.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENEMENTS_NES_EN_BASE } from '../../server/lib/agent/evenements-nes-en-base';

const lire = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** Les routes de `automation-events.ts` dont le corps se réduit à « via: 'base' ». */
function routesVides(): string[] {
  const source = lire('server/routes/automation-events.ts');
  const vides: string[] = [];
  const debut = /router\.post\('(\/automations\/events\/[a-z-]+)'/g;
  const departs = [...source.matchAll(debut)];
  departs.forEach((m, i) => {
    const corps = source.slice(m.index ?? 0, departs[i + 1]?.index ?? source.length);
    if (/return res\.json\(\{ ok: true, via: 'base' \}\);/.test(corps) && !/eventBus\.emit|requireAuthedClient/.test(corps)) vides.push(m[1]);
  });
  return vides.sort();
}

describe('événements nés en base', () => {
  it('la liste est exactement celle des routes vides', () => {
    expect([...EVENEMENTS_NES_EN_BASE].sort()).toEqual(routesVides());
  });

  it.each([
    ['server/lib/agent/tools-etendus.ts', 'signalerEvenement'],
    ['server/lib/agent/tools-terrain.ts', 'signalerTerrain'],
  ])('%s : %s rend null sans appeler la route', (fichier, fonction) => {
    const source = lire(fichier);
    const corps = source.slice(source.indexOf(`async function ${fonction}(`));
    const avantLAppel = corps.slice(0, corps.indexOf('appelInterne('));
    expect(avantLAppel).toMatch(/if \(EVENEMENTS_NES_EN_BASE\.has\(chemin\)\) return null;/);
  });

  it('les routes qui travaillent encore ne sont pas dans la liste', () => {
    for (const chemin of ['/automations/events/job-completed', '/automations/events/appointment-rescheduled', '/automations/events/task-completed']) {
      expect(EVENEMENTS_NES_EN_BASE.has(chemin)).toBe(false);
    }
  });
});
