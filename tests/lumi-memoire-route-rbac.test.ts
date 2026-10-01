/**
 * La mémoire de Lumi (`org_knowledge`) n'est accessible par l'API qu'aux rôles
 * qui peuvent modifier les réglages. Prouvé en prod le 2026-10-01 (bureau de
 * test) : un TECHNICIEN obtenait 200 en lecture, en écriture et en retrait sur
 * /api/org-knowledge — la route utilise la clé de service et n'avait aucune
 * entrée RBAC, alors que la base (policy) et les outils de Lumi exigent déjà
 * `settings.update`. Une note écrite par un technicien entrait dans le prompt
 * de Lumi du propriétaire.
 *
 * Le test croise les routes VRAIMENT déclarées par le routeur avec la table :
 * une nouvelle route sans entrée le fait échouer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const PERMS = lire('server/lib/route-permissions.ts');

const routes = [...lire('server/routes/org-knowledge.ts').matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)]
  .map((m) => `${m[1].toUpperCase()} /api/org-knowledge${m[2] === '/' ? '' : m[2]}`);

describe('mémoire de Lumi — route /api/org-knowledge', () => {
  it('le routeur déclare bien ses routes (sinon le test ne prouverait rien)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(routes)('%s exige settings.update, comme les outils de Lumi et la policy', (route) => {
    expect(PERMS).toContain(`'${route}': 'settings.update'`);
  });

  it('même clé que les outils de mémoire de Lumi', () => {
    const garde = lire('server/lib/agent/garde.ts');
    for (const outil of ['remember_this', 'forget_note', 'recall_notes']) {
      expect(garde).toMatch(new RegExp(`${outil}:\\s*\\{ cle: 'settings\\.update'`));
    }
  });
});
