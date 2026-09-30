/**
 * Le refus est lu par la personne refusée : il doit être en bon français.
 *
 * Mesuré en prod le 2026-09-30 : « Ton rôle ne te donne pas accès À LE résumé
 * des revenus » — les libellés de PERMISSION_PAR_OUTIL commencent presque tous
 * par un article, et les coller après « à » donnait la faute à tout le monde.
 */
import { describe, it, expect } from 'vitest';
import { aAvecArticle } from '../server/lib/lumi/raccourcis';
import { PERMISSION_PAR_OUTIL } from '../server/lib/agent/garde';

describe('contraction de « à » devant un article', () => {
  it.each([
    ['le résumé des revenus', 'au résumé des revenus'],
    ['les factures', 'aux factures'],
    ['la paie', 'à la paie'],
    ["l'envoi de devis", "à l'envoi de devis"],
    ['la mémoire de Lumi (réglage d’entreprise)', 'à la mémoire de Lumi (réglage d’entreprise)'],
  ])('« %s » → « %s »', (entree, attendu) => {
    expect(aAvecArticle(entree)).toBe(attendu);
  });

  it('AUCUN libellé réel ne produit « à le », « à les » ou « à la le »', () => {
    const fautes = Object.entries(PERMISSION_PAR_OUTIL)
      .map(([outil, r]) => [outil, `Ton rôle ne te donne pas accès ${aAvecArticle(r.capacite)}.`] as const)
      .filter(([, phrase]) => /\baccès à l(e|es)\s/i.test(phrase));
    expect(fautes.map(([o]) => o), `Outils dont le refus est mal écrit : ${fautes.map(([o]) => o).join(', ')}`).toEqual([]);
  });
});
