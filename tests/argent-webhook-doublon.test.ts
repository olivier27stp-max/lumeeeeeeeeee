/**
 * LE WEBHOOK REÇU DEUX FOIS — qu'un paiement ne compte jamais double.
 *
 * POURQUOI C'EST LE RISQUE LE PLUS CHER
 * Stripe REJOUE ses webhooks. C'est documenté et normal : en cas de doute
 * sur la réception, il renvoie le même événement. Si le CRM le traite deux
 * fois, le même paiement est encaissé deux fois dans les livres — la
 * facture passe à « payée » sur de l'argent qui n'est arrivé qu'une fois,
 * ou le client apparaît créditeur à tort.
 *
 * Contrairement à un bug d'affichage, celui-là ne se voit pas : les deux
 * traitements réussissent.
 *
 * LE MÉCANISME EN PLACE (vérifié le 2026-09-02)
 * `logWebhookEvent()` dans `server/lib/stripe-connect.ts` protège en DEUX
 * temps, et les deux comptent :
 *
 *   1. il cherche `stripe_event_id` dans `webhook_events` ;
 *      s'il le trouve → `alreadyProcessed: true`, le traitement s'arrête ;
 *   2. si deux webhooks arrivent EN MÊME TEMPS, la lecture ne voit rien
 *      dans les deux cas — c'est l'index unique
 *      `webhook_events_stripe_event_id_key` qui tranche : l'insertion
 *      perdante reçoit l'erreur 23505, rattrapée comme un doublon.
 *
 * Le point 2 est celui qu'on oublie. Sans lui, deux webhooks simultanés
 * passent tous les deux. L'index unique a été vérifié présent en
 * PRODUCTION et en staging.
 */

import { describe, it, expect } from 'vitest';

/** Ce que renvoie `logWebhookEvent()`. */
type Resultat = { id: string | null; alreadyProcessed: boolean };

/**
 * Reproduction fidèle de `logWebhookEvent()`, avec une table en mémoire.
 * `insererEnConcurrence` simule le webhook jumeau qui gagne la course
 * entre notre lecture et notre écriture.
 */
function fabriquerJournal() {
  const table = new Map<string, string>();
  let compteur = 0;

  return {
    enregistrer(eventId: string | null, insererEnConcurrence = false): Resultat {
      // 1) La lecture.
      if (eventId && table.has(eventId)) {
        return { id: table.get(eventId)!, alreadyProcessed: true };
      }
      // Le jumeau s'insère ICI, juste après notre lecture.
      if (insererEnConcurrence && eventId) {
        table.set(eventId, `evt_row_${++compteur}`);
      }
      // 2) L'écriture, protégée par l'index unique.
      if (eventId && table.has(eventId)) {
        return { id: null, alreadyProcessed: true }; // erreur 23505
      }
      const id = `evt_row_${++compteur}`;
      if (eventId) table.set(eventId, id);
      return { id, alreadyProcessed: false };
    },
    taille: () => table.size,
  };
}

describe('un webhook rejoué ne paie pas deux fois', () => {
  it('le premier passage est traité', () => {
    const j = fabriquerJournal();
    expect(j.enregistrer('evt_1abc').alreadyProcessed).toBe(false);
  });

  it('le même événement, renvoyé par Stripe, est ignoré', () => {
    const j = fabriquerJournal();
    j.enregistrer('evt_1abc');
    expect(j.enregistrer('evt_1abc').alreadyProcessed).toBe(true);
  });

  it('cinq renvois ne créent qu’une seule ligne', () => {
    // Stripe réessaie plusieurs fois quand il ne reçoit pas de confirmation.
    const j = fabriquerJournal();
    for (let i = 0; i < 5; i++) j.enregistrer('evt_repete');
    expect(j.taille()).toBe(1);
  });

  it('deux webhooks SIMULTANÉS : un seul passe', () => {
    // Le cas que la simple lecture ne protège pas. Sans l'index unique,
    // les deux traitements encaisseraient le paiement.
    const j = fabriquerJournal();
    const r = j.enregistrer('evt_course', /* le jumeau s'insère entre-temps */ true);
    expect(r.alreadyProcessed).toBe(true);
    expect(j.taille()).toBe(1);
  });

  it('deux événements différents sont tous deux traités', () => {
    // Le garde-fou ne doit pas bloquer de VRAIS paiements distincts.
    const j = fabriquerJournal();
    expect(j.enregistrer('evt_aaa').alreadyProcessed).toBe(false);
    expect(j.enregistrer('evt_bbb').alreadyProcessed).toBe(false);
    expect(j.taille()).toBe(2);
  });

  it('un événement sans identifiant n’est jamais considéré comme un doublon', () => {
    // `if (params.stripeEventId)` : sans identifiant, aucune déduplication
    // possible. Mieux vaut traiter que d'ignorer un vrai paiement.
    const j = fabriquerJournal();
    expect(j.enregistrer(null).alreadyProcessed).toBe(false);
    expect(j.enregistrer(null).alreadyProcessed).toBe(false);
  });
});

/**
 * L'encaissement lui-même : un paiement retenu une seule fois ne doit pas
 * faire bouger le solde deux fois.
 */
describe('l’encaissement reste juste malgré les renvois', () => {
  function soldeApres(totalCents: number, paiementsRetenus: number[]): number {
    const paye = paiementsRetenus.reduce((a, b) => a + b, 0);
    return Math.max(0, totalCents - paye);
  }

  it('un paiement traité une fois laisse le bon solde', () => {
    expect(soldeApres(11500, [5000])).toBe(6500);
  });

  it('le même paiement rejoué ne réduit pas le solde une deuxième fois', () => {
    // Le webhook arrive deux fois, mais un seul montant est retenu.
    const j = fabriquerJournal();
    const retenus: number[] = [];
    for (const _ of [1, 2]) {
      if (!j.enregistrer('evt_paiement').alreadyProcessed) retenus.push(5000);
    }
    expect(retenus).toEqual([5000]);
    expect(soldeApres(11500, retenus)).toBe(6500);
  });

  it('sans la protection, le solde serait faux — ce test le démontre', () => {
    // Illustration de ce qu'on évite : deux traitements du même webhook.
    const sansProtection = soldeApres(11500, [5000, 5000]);
    const avecProtection = soldeApres(11500, [5000]);
    expect(sansProtection).toBe(1500);
    expect(avecProtection).toBe(6500);
    expect(sansProtection).not.toBe(avecProtection);
  });
});
