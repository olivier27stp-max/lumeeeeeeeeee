/**
 * FILTRER SUR UNE DATE OU UN MONTANT.
 *
 * Le moteur ne connaissait que l'égalité (`eq`, `neq`, `in`, `not_in`).
 * Impossible de dire « les prospects créés après le 1er juin » ou « les
 * soumissions de plus de 5 000 $ » — pourtant les deux filtres qu'un
 * entrepreneur demande en premier.
 *
 * Ce qui se joue ici, c'est QUI reçoit le message. Un filtre qui laisse
 * passer ce qu'il ne comprend pas envoie à tout le monde.
 */

import { describe, it, expect } from 'vitest';
import { evaluateConditions } from '../server/lib/automationEngine';
import type { CRMEvent } from '../server/lib/eventBus';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Un événement minimal qui porte les métadonnées à filtrer. */
function evt(metadata: Record<string, unknown>): CRMEvent {
  return {
    type: 'lead.created',
    orgId: '11111111-1111-1111-1111-111111111111',
    entityType: 'client',
    entityId: '22222222-2222-2222-2222-222222222222',
    metadata,
  } as CRMEvent;
}

describe('filtrer sur une DATE', () => {
  it('« créé après le 1er juin » ne retient que ce qui suit', () => {
    const apresJuin = { created_at: { gt: '2026-06-01T00:00:00Z' } };
    expect(evaluateConditions(apresJuin, evt({ created_at: '2026-09-25T10:00:00Z' }))).toBe(true);
    expect(evaluateConditions(apresJuin, evt({ created_at: '2026-01-15T10:00:00Z' }))).toBe(false);
  });

  it('« créé avant » et les bornes inclusives', () => {
    const avant = { created_at: { lt: '2026-06-01T00:00:00Z' } };
    expect(evaluateConditions(avant, evt({ created_at: '2026-01-15T10:00:00Z' }))).toBe(true);
    expect(evaluateConditions(avant, evt({ created_at: '2026-09-25T10:00:00Z' }))).toBe(false);

    // `gte`/`lte` : la date pile poil compte.
    const pile = '2026-06-01T00:00:00Z';
    expect(evaluateConditions({ created_at: { gte: pile } }, evt({ created_at: pile }))).toBe(true);
    expect(evaluateConditions({ created_at: { gt: pile } }, evt({ created_at: pile }))).toBe(false);
  });

  it('un intervalle se dit avec les deux bornes', () => {
    // « créé en juin » — c'est la forme qu'un écran de filtre produira.
    const enJuin = { created_at: { gte: '2026-06-01T00:00:00Z', lt: '2026-07-01T00:00:00Z' } };
    expect(evaluateConditions(enJuin, evt({ created_at: '2026-06-15T12:00:00Z' }))).toBe(true);
    expect(evaluateConditions(enJuin, evt({ created_at: '2026-07-02T12:00:00Z' }))).toBe(false);
    expect(evaluateConditions(enJuin, evt({ created_at: '2026-05-31T23:59:00Z' }))).toBe(false);
  });
});

describe('filtrer sur un MONTANT', () => {
  it('« plus de 5 000 $ » — l’exemple que le code citait sans savoir le faire', () => {
    const gros = { total_cents: { gt: 500000 } };
    expect(evaluateConditions(gros, evt({ total_cents: 750000 }))).toBe(true);
    expect(evaluateConditions(gros, evt({ total_cents: 250000 }))).toBe(false);
  });

  it('un nombre écrit en texte reste un NOMBRE, pas une année', () => {
    /*
     * `Date.parse('5')` répond une date (an 2001) : sans garde, « montant
     * supérieur à 5 » aurait comparé des millisecondes à un montant. On
     * essaie donc le nombre d'abord.
     */
    expect(evaluateConditions({ n: { gt: 3 } }, evt({ n: '5' }))).toBe(true);
    expect(evaluateConditions({ n: { gt: 10 } }, evt({ n: '5' }))).toBe(false);
  });
});

describe('ce que le filtre REFUSE de juger', () => {
  it('une valeur non comparable refuse la règle, elle ne la laisse pas passer', () => {
    /*
     * C'est le cœur : laisser passer ce qu'on ne sait pas juger enverrait
     * le message à tout le monde. Le fichier a déjà payé cette faute avec
     * les opérateurs inconnus.
     */
    expect(evaluateConditions({ x: { gt: 5 } }, evt({ x: 'abc' }))).toBe(false);
    expect(evaluateConditions({ x: { gt: '2026-06-01' } }, evt({ x: 'pas une date' }))).toBe(false);
  });

  it('un champ ABSENT refuse la règle', () => {
    // Sans ça, une règle « montant > 5000 » partirait sur un événement qui
    // ne porte aucun montant.
    expect(evaluateConditions({ total_cents: { gt: 100 } }, evt({}))).toBe(false);
    expect(evaluateConditions({ total_cents: { gt: 100 } }, evt({ total_cents: null }))).toBe(false);
  });

  it('un opérateur inconnu refuse toujours la règle', () => {
    // Le garde d'origine ne doit pas avoir été affaibli par l'ajout.
    expect(evaluateConditions({ x: { between: [1, 5] } }, evt({ x: 3 }))).toBe(false);
  });
});

describe('les anciens filtres marchent toujours', () => {
  it('égalité, liste et négation sont intacts', () => {
    expect(evaluateConditions({ source: 'web' }, evt({ source: 'web' }))).toBe(true);
    expect(evaluateConditions({ source: { eq: 'web' } }, evt({ source: 'web' }))).toBe(true);
    expect(evaluateConditions({ source: { in: ['web', 'tel'] } }, evt({ source: 'tel' }))).toBe(true);
    expect(evaluateConditions({ source: { not_in: ['web'] } }, evt({ source: 'web' }))).toBe(false);
  });

  it('une date ET une égalité se combinent', () => {
    const regle = { source: 'web', created_at: { gt: '2026-06-01T00:00:00Z' } };
    expect(evaluateConditions(regle, evt({ source: 'web', created_at: '2026-09-01T00:00:00Z' }))).toBe(true);
    // La date est bonne mais pas la source : la règle ne part pas.
    expect(evaluateConditions(regle, evt({ source: 'tel', created_at: '2026-09-01T00:00:00Z' }))).toBe(false);
  });
});

/*
 * LA SAISIE À L'ÉCRAN.
 *
 * Le moteur sait comparer, encore faut-il pouvoir l'ÉCRIRE. Le champ
 * n'acceptait que `champ = valeur` : un filtre de date était
 * inexprimable, donc inexistant pour l'utilisateur.
 *
 * On relit la logique du panneau depuis le fichier : elle n'est pas
 * exportée (c'est un détail interne du composant), mais ce qu'elle
 * produit part en base et décide qui reçoit le message.
 */
describe('écrire un filtre dans le panneau', () => {
  const src = readFileSync(resolve(__dirname, '../src/components/automations/PanneauEtape.tsx'), 'utf8');

  it('les 6 signes sont reconnus', () => {
    expect(src).toMatch(/\['gte', '>='\], \['lte', '<='\], \['gt', '>'\], \['lt', '<'\]/);
  });

  it('`>=` est cherché AVANT `>` — sinon il serait coupé en deux', () => {
    /*
     * `'montant >= 5'.indexOf('>')` trouve la même position que `>=`.
     * Sans le tri par longueur, on lirait l'opérateur `>` et une valeur
     * « = 5 » — un filtre silencieusement faux.
     */
    expect(src).toMatch(/b\.signe\.length - a\.signe\.length/);
  });

  it('deux lignes sur le même champ font un intervalle', () => {
    // C'est la façon d'écrire « créé en juin » sans inventer une syntaxe.
    expect(src).toMatch(/\.\.\.\(existant as Record<string, unknown>\), \[trouve\.op\]: valeur/);
  });

  it('l’égalité reste écrite à plat', () => {
    // Toutes les règles existantes portent cette forme : la changer
    // casserait leurs conditions au premier enregistrement.
    expect(src).toMatch(/if \(trouve\.op === 'eq'\) \{[\s\S]{0,300}?out\[cle\] = val;/);
  });

  it('l’aide explique la comparaison, sinon personne ne la découvre', () => {
    expect(src).toMatch(/montant > 5000/);
    expect(src).toMatch(/created_at >= 2026-06-01/);
  });
});
