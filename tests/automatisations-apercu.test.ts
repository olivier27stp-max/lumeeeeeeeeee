/**
 * « TESTER » — ce qui partirait, sans rien envoyer.
 *
 * Le bouton affichait « Le test arrive bientôt ». Or c'est LA question
 * qu'on se pose avant de publier : « qu'est-ce qui va partir, et à qui ? »
 *
 * Deux dangers, tous deux silencieux :
 *   · un aperçu qui ENVOIE pour de vrai (ou planifie une tâche) ;
 *   · un aperçu sur des données inventées, qui cacherait le « Bonjour , »
 *     d'un client sans nom.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const route = readFileSync(resolve(RACINE, 'server/routes/automation-test.ts'), 'utf8');
const apercu = route.slice(route.indexOf("'/automations/rules/:id/apercu'"));

describe('l’aperçu ne peut rien envoyer', () => {
  it('il n’exécute AUCUNE action', () => {
    // `executeAction` enverrait pour de vrai. Un aperçu qui envoie est pire
    // que pas d'aperçu du tout.
    expect(apercu, 'un aperçu n’exécute jamais une action').not.toMatch(/executeAction/);
  });

  it('il ne planifie AUCUNE tâche', () => {
    expect(apercu, 'aucune écriture dans la file du moteur')
      .not.toMatch(/automation_scheduled_tasks/);
  });

  it('il n’émet AUCUN événement', () => {
    expect(apercu).not.toMatch(/eventBus\.emit/);
  });
});

describe('l’aperçu montre la vérité', () => {
  it('il utilise un VRAI client de l’organisation', () => {
    /*
     * Sur des données inventées, « Bonjour [client_name] » aurait toujours
     * l'air correct. Sur un vrai client sans prénom, il donne « Bonjour , » —
     * et c'est précisément ce qu'il faut voir avant de publier.
     */
    /*
     * La lecture des clients DOIT porter les deux filtres. Vérifié en
     * sabotant : retirer `deleted_at` laissait le test au vert, parce qu'il
     * cherchait le motif n'importe où dans la route. On borne donc la
     * fenêtre à la requête elle-même.
     */
    const debut = apercu.indexOf("from('clients')");
    const lecture = apercu.slice(debut, apercu.indexOf('maybeSingle()', debut));
    expect(lecture, 'jamais un client supprimé').toMatch(/is\('deleted_at', null\)/);
    expect(lecture, 'il faut de quoi le joindre, sinon l’aperçu ne montre rien')
      .toMatch(/not\('email', 'is', null\)/);
    expect(apercu, 'l’org de l’appelant, jamais une autre').toMatch(/eq\('org_id', auth\.orgId\)/);
  });

  it('il résout les variables comme le moteur', () => {
    // Deux moteurs de rendu finiraient par diverger : l'aperçu mentirait.
    expect(apercu).toMatch(/resolveEntityVariables/);
    expect(apercu).toMatch(/resolveTemplate/);
  });

  it('il couvre les DEUX formes de règle', () => {
    // Un parcours (`steps`) et une règle simple (`actions`) : les 35
    // préréglages sont des règles simples.
    expect(apercu).toMatch(/regle\.steps/);
    expect(apercu).toMatch(/regle\.actions/);
  });

  it('il le dit quand il n’y a personne à montrer', () => {
    // Un aperçu vide sans explication ressemble à une panne.
    expect(apercu).toMatch(/Ajoutez un client/);
  });

  it('la règle doit appartenir à l’organisation', () => {
    expect(apercu).toMatch(/status\(404\)/);
  });
});
