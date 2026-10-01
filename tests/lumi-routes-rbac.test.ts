/**
 * Toute route de Lumi déclare son droit (LUMI_INVENTORY, risque S4).
 *
 * `/lumi/action`, `/lumi/mode` et `/lumi/autorisations` n'avaient aucune entrée :
 * un membre à qui le propriétaire a retiré Lumi (page Rôles) pouvait encore
 * lancer les actions rapides et changer son mode de confirmation.
 *
 * Exceptions voulues : `/lumi/credits` et `/lumi/credits/historique` servent
 * l'affichage des crédits (aucun montant en dollars) ; l'historique par
 * personne vérifie `external_agent.admin` dans son gestionnaire.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const PERMS = lire('server/lib/route-permissions.ts');
const OUVERTES = new Set(['GET /api/lumi/credits', 'GET /api/lumi/credits/historique']);

const routes = [...lire('server/routes/lumi.ts').matchAll(/router\.(get|post|put|patch|delete)\(\s*'(\/lumi\/[^']+)'/g)]
  .map((m) => `${m[1].toUpperCase()} /api${m[2]}`);

describe('routes de Lumi — droit déclaré', () => {
  it('le routeur déclare bien ses routes (sinon le test ne prouverait rien)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(routes.filter((r) => !OUVERTES.has(r)))('%s exige external_agent.use', (route) => {
    expect(PERMS).toContain(`'${route}': 'external_agent.use'`);
  });

  it('les seules routes ouvertes sont celles des crédits', () => {
    expect(routes.filter((r) => !PERMS.includes(`'${r}':`)).sort()).toEqual([...OUVERTES].sort());
  });
});
