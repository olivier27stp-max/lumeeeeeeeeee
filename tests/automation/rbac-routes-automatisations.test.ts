/**
 * Vague 3 (audit V2, S10, Faible) — chaque route d'automatisation a une
 * entrée RBAC.
 *
 * pause, folders, webhooks, restaurer, appointment-rescheduled,
 * client-tagged et task-completed n'en avaient aucune : la RLS rattrapait
 * (200 avec liste vide, 404), mais un membre sans droit n'obtenait jamais
 * un 403 explicite, et TOUT membre (technicien compris) pouvait signaler un
 * événement. Le test croise les routes VRAIMENT déclarées par les routeurs
 * avec la table : une nouvelle route sans entrée le fait échouer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..', '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');
const PERMS = lire('server/lib/route-permissions.ts');

function routes(fichier: string): string[] {
  const out: string[] = [];
  for (const m of lire(`server/routes/${fichier}`).matchAll(/router\.(get|post|put|patch|delete)\(\s*'(\/automations\/[^']+)'/g)) {
    out.push(`${m[1].toUpperCase()} /api${m[2]}`);
  }
  return out;
}

describe('S10 — toute route d’automatisation déclare son droit', () => {
  const fichiers = ['automation-rules.ts', 'automation-messages.ts', 'automation-events.ts', 'automation-publication.ts', 'automation-stats.ts', 'automation-test.ts', 'reservation.ts'];
  const toutes = fichiers.flatMap(routes);

  it('les routeurs déclarent bien des routes (sinon le test ne prouverait rien)', () => {
    expect(toutes.length).toBeGreaterThan(30);
  });

  it.each(fichiers)('%s : aucune route sans entrée dans route-permissions.ts', (f) => {
    const sans = routes(f).filter((r) => !PERMS.includes(`'${r}':`));
    expect(sans, `routes sans droit déclaré dans ${f}`).toEqual([]);
  });

  it('les droits choisis pour les routes de l’audit', () => {
    for (const ligne of [
      "'GET /api/automations/folders': 'automations.read'",
      "'DELETE /api/automations/folders/:id': 'automations.update'",
      "'GET /api/automations/webhooks': 'automations.read'",
      "'POST /api/automations/webhooks/:id/regenerer': 'automations.update'",
      "'POST /api/automations/pause': 'automations.update'",
      "'POST /api/automations/rules/:id/restaurer': 'automations.update'",
      "'DELETE /api/automations/rules/:id/definitivement': 'automations.update'",
      "'POST /api/automations/events/appointment-rescheduled': ['jobs.update', 'calendar.update']",
      "'POST /api/automations/events/client-tagged': ['clients.update', 'leads.update']",
    ]) expect(PERMS).toContain(ligne);
  });
});
