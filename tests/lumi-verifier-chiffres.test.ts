/**
 * Détecteur d'hallucination sur les montants (2026-09-22).
 *
 * Le cas qui a motivé ce module : Lumi a répondu « Garde-gouttières,
 * 1 910,00 $ » et j'ai dû ouvrir la base pour vérifier que c'était exact.
 * C'était juste — mais ce contrôle doit être fait par une machine, à chaque
 * tour, pas par un humain sur un échantillon.
 *
 * Le prompt exige déjà « chaque chiffre vient d'un résultat d'outil ».
 * Ces tests vérifient qu'on le CONSTATE.
 */
import { describe, it, expect } from 'vitest';
import { verifierChiffres, montantsCites, enCents } from '../server/lib/lumi/verifier-chiffres';

describe('lecture des montants', () => {
  it('comprend les deux conventions', () => {
    expect(enCents('1 910,00')).toBe(191000);   // français
    expect(enCents('1,910.00')).toBe(191000);   // anglais
    expect(enCents('1910')).toBe(191000);
    expect(enCents('12,50')).toBe(1250);
    expect(enCents('0,99')).toBe(99);
  });

  it('extrait les montants d\'une phrase, dans les deux langues', () => {
    expect(montantsCites('Le total est de 1 910,00 $.').map((m) => m.cents)).toEqual([191000]);
    expect(montantsCites('Total: $1,910.00 today').map((m) => m.cents)).toEqual([191000]);
    expect(montantsCites('275,00 $ et 1 910,00 $').map((m) => m.cents)).toEqual([27500, 191000]);
  });

  it('ignore les nombres qui ne sont pas des montants', () => {
    // « 3 factures », « job 33 » : un compte n'est pas un prix.
    expect(montantsCites('Tu as 3 factures en retard sur le job 33.')).toEqual([]);
  });
});

describe('vérification contre les résultats d\'outils', () => {
  const outil = ['{"count":1,"jobs":[{"title":"Garde-gouttières","total_cents":191000}]}'];

  it('un montant sourcé passe', () => {
    const v = verifierChiffres('Le job Garde-gouttières est à 1 910,00 $.', outil);
    expect(v.cites).toBe(1);
    expect(v.suspects).toEqual([]);
  });

  it('un montant INVENTÉ est signalé', () => {
    const v = verifierChiffres('Le job Garde-gouttières est à 2 450,00 $.', outil);
    expect(v.suspects).toHaveLength(1);
    expect(v.suspects[0].cents).toBe(245000);
  });

  it('tolère un cent d\'écart (arrondi d\'affichage)', () => {
    expect(verifierChiffres('Environ 1 910,01 $.', outil).suspects).toEqual([]);
  });

  it('un total additionné à la main est signalé', () => {
    // Le piège réel : le modèle additionne deux montants de tête au lieu
    // d'utiliser la somme fournie par l'outil.
    const deux = ['{"invoices":[{"balance_cents":62087},{"balance_cents":40000}]}'];
    const v = verifierChiffres('Tes factures en retard totalisent 1 020,87 $.', deux);
    expect(v.suspects).toHaveLength(1);
  });

  it('ne conclut rien sans résultat d\'outil', () => {
    // Une réponse produit (« le forfait Scale est à 250 $ ») cite des
    // montants légitimes qui ne viennent pas des données du client.
    expect(verifierChiffres('Le forfait est à 250,00 $.', []).suspects).toEqual([]);
  });

  it('accepte un montant rendu en dollars par un outil', () => {
    expect(verifierChiffres('Total 250,00 $.', ['{"prix":250}']).suspects).toEqual([]);
  });
});
