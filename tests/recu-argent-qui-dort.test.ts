/**
 * Le Reçu — l'argent qui dort.
 *
 * Deux exigences que ce test protège :
 *   · le total annoncé couvre TOUT ce qui dort, même quand la liste affichée
 *     est tronquée au top 3 (sinon le chiffre ment par omission) ;
 *   · un devis relancé récemment ne dort pas, même s'il est vieux.
 */
import { describe, it, expect } from 'vitest';
import {
  trouverArgentQuiDort,
  SEUIL_DORMANCE_JOURS,
  type EntreeDevis,
  type EntreeFacture,
} from '../server/lib/recu/argent-qui-dort';

const MAINTENANT = new Date('2026-09-23T12:00:00Z');
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * 86_400_000);

const devis = (o: Partial<EntreeDevis> = {}): EntreeDevis => ({
  devisId: 'q1',
  montantCents: 500_000,
  client: 'Dupont',
  statut: 'awaiting_response',
  envoyeA: ilYA(20),
  derniereRelanceA: null,
  signeA: null,
  ...o,
});

const facture = (o: Partial<EntreeFacture> = {}): EntreeFacture => ({
  factureId: 'f1',
  soldeCents: 162_690,
  client: 'Tremblay',
  statut: 'sent',
  echeanceLe: '2026-08-19',
  ...o,
});

const opts = { maintenant: MAINTENANT };

describe('devis dormants', () => {
  it('retient un devis envoyé, jamais relancé, au-delà du seuil', () => {
    const r = trouverArgentQuiDort({ devis: [devis()], factures: [] }, opts);
    expect(r.devis).toHaveLength(1);
    expect(r.devis[0].joursSansContact).toBe(20);
    expect(r.devisTotalCents).toBe(500_000);
  });

  it('ne réveille pas un devis relancé récemment, même s’il est vieux', () => {
    const r = trouverArgentQuiDort({
      devis: [devis({ envoyeA: ilYA(90), derniereRelanceA: ilYA(2) })],
      factures: [],
    }, opts);
    expect(r.devis).toHaveLength(0);
  });

  it('compte les jours depuis la relance, pas depuis l’envoi', () => {
    const r = trouverArgentQuiDort({
      devis: [devis({ envoyeA: ilYA(60), derniereRelanceA: ilYA(15) })],
      factures: [],
    }, opts);
    expect(r.devis[0].joursSansContact).toBe(15);
  });

  it('ignore un brouillon : ce n’est pas de l’argent qui dort', () => {
    const r = trouverArgentQuiDort({ devis: [devis({ statut: 'draft' })], factures: [] }, opts);
    expect(r.devis).toHaveLength(0);
  });

  it('ignore les statuts terminaux', () => {
    for (const statut of ['approved', 'declined', 'converted', 'expired', 'archived']) {
      const r = trouverArgentQuiDort({ devis: [devis({ statut })], factures: [] }, opts);
      expect(r.devis, statut).toHaveLength(0);
    }
  });

  it('ignore un devis signé, quel que soit son statut affiché', () => {
    const r = trouverArgentQuiDort({ devis: [devis({ signeA: ilYA(1) })], factures: [] }, opts);
    expect(r.devis).toHaveLength(0);
  });

  it('ignore un devis jamais envoyé', () => {
    const r = trouverArgentQuiDort({ devis: [devis({ envoyeA: null })], factures: [] }, opts);
    expect(r.devis).toHaveLength(0);
  });

  it('respecte exactement le seuil de dormance', () => {
    const juste = trouverArgentQuiDort({ devis: [devis({ envoyeA: ilYA(SEUIL_DORMANCE_JOURS - 1) })], factures: [] }, opts);
    expect(juste.devis).toHaveLength(0);
    const atteint = trouverArgentQuiDort({ devis: [devis({ envoyeA: ilYA(SEUIL_DORMANCE_JOURS) })], factures: [] }, opts);
    expect(atteint.devis).toHaveLength(1);
  });
});

describe('factures en retard', () => {
  it('retient une facture échue avec un solde', () => {
    const r = trouverArgentQuiDort({ devis: [], factures: [facture()] }, opts);
    expect(r.factures).toHaveLength(1);
    expect(r.factures[0].joursDeRetard).toBe(35);
    expect(r.facturesTotalCents).toBe(162_690);
  });

  it('ne compte pas une facture due aujourd’hui', () => {
    const r = trouverArgentQuiDort({ devis: [], factures: [facture({ echeanceLe: '2026-09-23' })] }, opts);
    expect(r.factures).toHaveLength(0);
  });

  it('ignore une facture soldée, payée, annulée ou brouillon', () => {
    const r = trouverArgentQuiDort({
      devis: [],
      factures: [
        facture({ factureId: 'a', soldeCents: 0 }),
        facture({ factureId: 'b', statut: 'paid' }),
        facture({ factureId: 'c', statut: 'void' }),
        facture({ factureId: 'd', statut: 'draft' }),
      ],
    }, opts);
    expect(r.factures).toHaveLength(0);
  });

  it('accepte le statut « overdue » bien qu’il n’existe pas en base', () => {
    const r = trouverArgentQuiDort({ devis: [], factures: [facture({ statut: 'overdue' })] }, opts);
    expect(r.factures).toHaveLength(1);
  });
});

describe('total et classement', () => {
  it('additionne devis et factures', () => {
    const r = trouverArgentQuiDort({ devis: [devis()], factures: [facture()] }, opts);
    expect(r.totalCents).toBe(500_000 + 162_690);
  });

  it('classe le plus gros montant en premier', () => {
    const r = trouverArgentQuiDort({
      devis: [
        devis({ devisId: 'petit', montantCents: 100_000 }),
        devis({ devisId: 'gros', montantCents: 1_500_000 }),
      ],
      factures: [],
    }, opts);
    expect(r.devis.map((d) => d.devisId)).toEqual(['gros', 'petit']);
  });

  it('garde le total COMPLET même quand la liste est tronquée', () => {
    // Le piège : afficher « le top 3 » et annoncer la somme du top 3.
    // Le chiffre doit porter sur tout ce qui dort.
    const r = trouverArgentQuiDort({
      devis: [
        devis({ devisId: 'a', montantCents: 400_000 }),
        devis({ devisId: 'b', montantCents: 300_000 }),
        devis({ devisId: 'c', montantCents: 200_000 }),
        devis({ devisId: 'd', montantCents: 100_000 }),
      ],
      factures: [],
    }, { ...opts, top: 3 });
    expect(r.devis).toHaveLength(3);
    expect(r.totalCents).toBe(1_000_000);
  });

  it('rend zéro, pas une erreur, quand rien ne dort', () => {
    const r = trouverArgentQuiDort({ devis: [], factures: [] }, opts);
    expect(r.totalCents).toBe(0);
    expect(r.devis).toEqual([]);
    expect(r.factures).toEqual([]);
  });
});
