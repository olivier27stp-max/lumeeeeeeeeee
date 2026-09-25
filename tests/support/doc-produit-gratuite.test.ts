/**
 * La FAQ des pages Fonctionnalités sert enfin à répondre (2026-09-22).
 *
 * `chercherAide` l'indexait déjà, mais `articles-dabord` la rejetait pour
 * deux raisons : elle n'exigeait que des tournures « comment faire », et
 * l'écart avec le 2e résultat renvoyait au modèle des questions dont la
 * réponse exacte était pourtant en tête (recouvrement de titre mesuré à
 * 100 %).
 *
 * Mesuré avant : 3/15 des questions de la doc étaient gratuites. Après : 10.
 * Ce sont des questions que les clients posent vraiment — signature
 * électronique, frais de paiement, GPS hors des heures, SMS inclus.
 */
import { describe, it, expect } from 'vitest';
import { reponseFaqPour } from '../../server/lib/support/faq';
import { reponseAideDirecte } from '../../server/lib/support/articles-dabord';

const sert = (q: string) => !!(reponseFaqPour(q, 'fr') ?? reponseAideDirecte(q, 'fr', { premierMessage: true }));

describe('les questions de la doc produit sont servies sans modèle', () => {
  const couvertes = [
    'combien de clients je peux avoir',
    'la signature electronique est elle valide',
    'je peux mettre des options',
    'le gps suit mes employes en dehors des heures',
    'ca marche sans reseau',
    'je garde mon numero actuel',
    'quels sont les frais de paiement en ligne',
    'ca remplace mon comptable',
    'lumi peut il faire des erreurs',
    'dans quels forfaits',
  ];
  for (const q of couvertes) {
    it(`« ${q.slice(0, 46)} » → 0 token`, () => expect(sert(q)).toBe(true));
  }
});

/**
 * Le risque de brancher la doc produit : confondre une question sur le
 * PRODUIT avec une question sur les DONNÉES. « Combien de clients je peux
 * avoir ? » (limite du forfait) et « combien j'ai de clients ? » (le compte)
 * se ressemblent — la seconde doit TOUJOURS aller au modèle.
 */
describe('jamais une question sur les données', () => {
  const surLesDonnees = [
    'combien j ai de clients',
    'j ai combien de clients',
    'mes factures sont elles payees',
    'combien de jobs j ai cette semaine',
    'mon equipe a fait combien d heures',
    'quelles factures sont en retard',
    'quel est mon chiffre du mois',
    'supprime la facture INV-0004',
    'qui sont mes meilleurs clients',
    'prepare ma journee de demain',
  ];
  for (const q of surLesDonnees) {
    it(`« ${q.slice(0, 46)} » → le modèle`, () => expect(sert(q)).toBe(false));
  }

  it('une question PRODUIT proche reste gratuite', () => {
    // La nuance qui compte : sans possessif, c'est la limite du forfait.
    expect(sert('combien de clients je peux avoir')).toBe(true);
    // Et « mes clients » dans une question « comment faire » reste produit.
    expect(sert('comment importer mes clients depuis excel')).toBe(true);
  });
});
