/**
 * METTRE SES AUTOMATISATIONS EN PAUSE — par entreprise.
 *
 * L'interrupteur global (#470) coupe TOUTE la plateforme et n'est
 * pilotable que par variable d'environnement : seul l'éditeur peut
 * l'actionner, et couper punirait tous les clients à la fois.
 *
 * Celui-ci appartient au client. Ce qui est vérifié ici, c'est le
 * CONTRAT — le comportement, lui, a été prouvé contre le vrai moteur :
 * en marche la tâche est créée, en pause rien ne part, à la reprise ça
 * repart.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { orgEnPause, oublierPause, viderCachePause } from '../server/lib/automations-pause-org';

const ORG = '11111111-1111-1111-1111-111111111111';

/** Un faux client qui répond ce qu'on lui dit, en comptant les lectures. */
function faux(reponse: { data?: unknown; error?: { message: string } }) {
  const compte = { lectures: 0 };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { compte.lectures++; return reponse; },
        }),
      }),
    }),
  };
  return { client: client as never, compte };
}

beforeEach(() => viderCachePause());

describe('l’interrupteur du client', () => {
  it('une entreprise en pause est reconnue', async () => {
    const { client } = faux({ data: { automations_paused: true } });
    expect(await orgEnPause(client, ORG)).toBe(true);
  });

  it('sans réglage, l’entreprise n’est PAS en pause', async () => {
    /*
     * Le cas d'une org qui n'a pas encore de ligne `company_settings`.
     * Si l'absence valait « en pause », un nouveau client verrait ses
     * automatisations muettes sans rien avoir demandé — exactement le
     * genre de panne silencieuse que ce dépôt a déjà payée.
     */
    const { client } = faux({ data: null });
    expect(await orgEnPause(client, ORG)).toBe(false);
  });

  it('une lecture EN ÉCHEC laisse passer', async () => {
    /*
     * Le contraire transformerait une panne de base en arrêt silencieux
     * des automatisations de TOUS les clients : bien pire que le risque
     * que ça éviterait.
     */
    const { client } = faux({ error: { message: 'réseau coupé' } });
    expect(await orgEnPause(client, ORG)).toBe(false);
  });
});

describe('le cache', () => {
  it('ne relit pas la base à chaque événement', async () => {
    // Le moteur appelle ceci à CHAQUE événement et à chaque tâche
    // dépilée : sans cache, une entreprise active paierait une requête
    // par événement.
    const { client, compte } = faux({ data: { automations_paused: false } });
    for (let i = 0; i < 20; i++) await orgEnPause(client, ORG);
    expect(compte.lectures).toBe(1);
  });

  it('une bascule est vue TOUT DE SUITE, pas dans 15 s', async () => {
    /*
     * C'est le cœur de la fonctionnalité : on clique parce que des
     * messages partent maintenant. Un arrêt d'urgence qui met un quart
     * de minute à mordre laisse partir ce qu'on voulait arrêter — la
     * route appelle donc `oublierPause()` après avoir écrit.
     */
    const enMarche = faux({ data: { automations_paused: false } });
    expect(await orgEnPause(enMarche.client, ORG)).toBe(false);

    oublierPause(ORG);

    const enPause = faux({ data: { automations_paused: true } });
    expect(await orgEnPause(enPause.client, ORG)).toBe(true);
  });
});

describe('le moteur respecte la pause', () => {
  it('les DEUX entrées du moteur la consultent', async () => {
    /*
     * `handleEvent` (événement qui arrive) et la boucle des tâches
     * planifiées. Protéger une seule des deux laisserait partir tout ce
     * qui était déjà en file — c'est-à-dire précisément les relances
     * qu'on voulait arrêter.
     */
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../server/lib/automationEngine.ts'), 'utf8');

    expect(src, 'handleEvent doit consulter la pause')
      .toMatch(/orgEnPause\(engineConfig\.supabase, event\.orgId\)/);
    expect(src, 'la file des tâches doit la consulter par tâche')
      .toMatch(/orgEnPause\(supabase, task\.org_id\)/);
  });

  it('une tâche sautée reste intacte, elle n’est pas mise en échec', () => {
    /*
     * La file est CONSERVÉE : un interrupteur qui ferait perdre les
     * envois prévus est un interrupteur qu'on n'ose pas utiliser — donc
     * inutile le jour où il faut s'en servir. On `continue`, sans
     * toucher au statut.
     */
    const { readFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const src = readFileSync(resolve(__dirname, '../server/lib/automationEngine.ts'), 'utf8');
    const i = src.indexOf('orgEnPause(supabase, task.org_id)');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 120)).toMatch(/continue;/);
  });
});
