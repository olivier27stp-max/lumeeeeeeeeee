/**
 * REFUSER AVANT DE PUBLIER, PAS APRÈS.
 *
 * L'audit d'un vrai compte GoHighLevel (23 septembre 2026) a trouvé CINQ
 * erreurs bloquantes dans un workflow parfaitement publiable : une action
 * sans pipeline, un segment non résolu, un jeton d'exemple, une condition
 * indéfinie, un nœud mal placé.
 *
 * Leur builder laisse publier un parcours cassé. L'entreprise ne s'en
 * aperçoit qu'en constatant que personne n'a rien reçu — et il n'y a rien
 * dans les journaux, parce que rien n'a échoué : rien n'est parti.
 *
 * Ce fichier tient la garde sur ce qui doit être refusé, et sur ce qui ne
 * doit PAS l'être — une validation trop zélée qui bloque un parcours
 * valide se fait contourner, et ne protège alors plus rien.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { problemesAvantPublication } from '../src/lib/automationCatalogue';
import * as catalogue from '../src/lib/automationCatalogue';

/** Un parcours minimal mais valide : déclencheur émis, une action complète. */
const parcoursValide = {
  trigger_event: 'quote.sent',
  steps: [
    { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: null },
  ],
};

const bloquants = (r: Parameters<typeof problemesAvantPublication>[0]) =>
  problemesAvantPublication(r).filter((p) => p.gravite === 'bloquant');

describe('un parcours valide se publie sans friction', () => {
  it('ne bloque rien sur un parcours correct', () => {
    expect(bloquants(parcoursValide)).toEqual([]);
  });

  it('accepte aussi une règle simple (sans séquence)', () => {
    // Les 35 préréglages sont des règles plates : les bloquer casserait
    // tout ce qui existe déjà.
    expect(bloquants({
      trigger_event: 'invoice.overdue',
      actions: [{ type: 'send_email', config: { subject: 'Rappel', body: 'Bonjour' } }],
    })).toEqual([]);
  });
});

describe('ce qui doit être refusé', () => {
  it('un parcours vide', () => {
    const p = bloquants({ trigger_event: 'quote.sent', steps: [] });
    expect(p.length).toBe(1);
    expect(p[0].message).toMatch(/ne fait rien/);
  });

  it('aucun déclencheur choisi', () => {
    expect(bloquants({ ...parcoursValide, trigger_event: null }).length).toBeGreaterThan(0);
  });

  it('un déclencheur que RIEN n’émet encore est REFUSÉ', () => {
    /*
     * Le piège le plus coûteux : publier sur un événement que rien n'émet
     * donne une automatisation qui ne part JAMAIS, sans le moindre message.
     *
     * Ce test visait `deal.stage_entered`, qui s'est révélé BRANCHÉ (34
     * événements émis et traités en prod, vérifié le 2026-09-25) : le
     * marqueur était une erreur d'analyse, pas un fait. On teste donc la
     * RÈGLE elle-même sur un déclencheur fictif, au lieu de figer une clé
     * qui peut être branchée demain — sinon le test se met à mentir.
     */
    const p = bloquants({ ...parcoursValide, trigger_event: '__jamais_emis__' });
    expect(p.length, 'un déclencheur inconnu doit bloquer').toBeGreaterThan(0);

    // Et la garde `bientot` tient toujours, si un déclencheur en porte un.
    const { DECLENCHEURS } = catalogue;
    const aVenir = DECLENCHEURS.find((d) => d.bientot);
    if (aVenir) {
      const q = bloquants({ ...parcoursValide, trigger_event: aVenir.cle });
      expect(q.length, `${aVenir.cle} est marqué « bientôt » : publier doit être refusé`).toBeGreaterThan(0);
      expect(q[0].message).toMatch(/jamais/);
    }
  });

  it('aucun déclencheur offert n’est marqué « bientôt » sans raison', () => {
    /*
     * Le garde-fou inverse, et celui qui m'a manqué : j'ai grisé deux
     * déclencheurs PARFAITEMENT fonctionnels en déduisant du code au lieu
     * de regarder la base. Un déclencheur grisé à tort est une
     * fonctionnalité perdue, silencieusement.
     *
     * On n'interdit pas `bientot` — on exige qu'il soit JUSTIFIÉ par un
     * commentaire au-dessus, pour que le prochain qui passe sache quoi
     * vérifier.
     */
    const source = readFileSync(resolve(__dirname, '..', 'src/lib/automationCatalogue.ts'), 'utf8');
    for (const d of catalogue.DECLENCHEURS.filter((x) => x.bientot)) {
      const i = source.indexOf(`cle: '${d.cle}'`);
      const bloc = source.slice(i, source.indexOf('\n  },', i));
      expect(bloc, `${d.cle} : dire POURQUOI il est grisé`).toMatch(/n'émet pas|n’émet pas|pas encore/i);
    }
  });

  it('un champ obligatoire vide', () => {
    const p = bloquants({
      trigger_event: 'quote.sent',
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { body: 'x' } }, suivant: null }],
    });
    // L'objet manque.
    expect(p.some((x) => /Objet/.test(x.message))).toBe(true);
    expect(p[0].etapeId, 'l’étape fautive doit être nommée, pour l’ouvrir d’un clic').toBe('e1');
  });

  it('une action qui ne va pas avec le déclencheur', () => {
    // « Envoyer la facture » après « soumission envoyée » : l'entité qui
    // arrive est un devis, le moteur refuserait à l'exécution.
    const p = bloquants({
      trigger_event: 'quote.sent',
      steps: [{ id: 'e1', type: 'action', action: { type: 'envoyer_facture', config: {} }, suivant: null }],
    });
    expect(p.some((x) => /ne peut pas suivre/.test(x.message))).toBe(true);
  });

  it('un renvoi vers une étape supprimée', () => {
    const p = bloquants({
      trigger_event: 'quote.sent',
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: 'e9' }],
    });
    expect(p.some((x) => /supprimée/.test(x.message))).toBe(true);
  });

  it('un parcours qui se termine par une attente', () => {
    // Le client attend, et rien ne vient.
    const p = bloquants({
      trigger_event: 'quote.sent',
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: 'e2' },
        { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: null },
      ],
    });
    expect(p.some((x) => /rien ne se passera/.test(x.message))).toBe(true);
    expect(p.find((x) => /rien ne se passera/.test(x.message))?.etapeId).toBe('e2');
  });

  it('une action inconnue', () => {
    const p = bloquants({
      trigger_event: 'quote.sent',
      steps: [{ id: 'e1', type: 'action', action: { type: 'faire_un_cafe', config: {} }, suivant: null }],
    });
    expect(p.some((x) => /inconnue/.test(x.message))).toBe(true);
  });
});

describe('ce qui mérite un coup d’œil sans bloquer', () => {
  it('une condition vide est un avertissement, pas un refus', () => {
    // Le parcours marche : il suit juste toujours le même chemin.
    const tous = problemesAvantPublication({
      trigger_event: 'quote.sent',
      steps: [
        { id: 'e1', type: 'si', conditions: {}, alors: 'e2', sinon: null },
        { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: null },
      ],
    });
    const cond = tous.find((x) => /condition est vide/.test(x.message));
    expect(cond?.gravite).toBe('avertissement');
    expect(tous.filter((x) => x.gravite === 'bloquant')).toEqual([]);
  });

  it('un parcours uniquement interne avertit, sans bloquer', () => {
    // Créer une tâche sans jamais écrire au client est LÉGITIME (préparer
    // une visite, par exemple) — mais c'est souvent un oubli.
    const tous = problemesAvantPublication({
      trigger_event: 'job.completed',
      steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Vérifier' } }, suivant: null }],
    });
    expect(tous.filter((x) => x.gravite === 'bloquant')).toEqual([]);
    expect(tous.some((x) => x.gravite === 'avertissement' && /interne/.test(x.message))).toBe(true);
  });
});

describe('les messages sont utilisables', () => {
  it('chaque problème est une phrase en français, pas un code', () => {
    const p = problemesAvantPublication({ trigger_event: null, steps: [] });
    for (const x of p) {
      expect(x.message.length, 'un message vide n’aide personne').toBeGreaterThan(15);
      expect(x.message, 'pas de jargon technique dans un message utilisateur')
        .not.toMatch(/undefined|null|Error|\bZod\b/);
    }
  });

  it('les messages existent aussi en anglais', () => {
    const en = problemesAvantPublication({ trigger_event: null, steps: [], fr: false });
    expect(en.length).toBeGreaterThan(0);
    expect(en[0].message).toMatch(/[Pp]ick|[Aa]dd/);
  });
});
