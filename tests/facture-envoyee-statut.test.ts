/**
 * UNE FACTURE ENVOYÉE N'EST PLUS UN BROUILLON.
 *
 * Le client a reçu le courriel. Si Lume continue de la ranger dans les
 * brouillons, elle disparaît : absente des impayés, absente des relances,
 * absente du montant à recouvrer. Personne ne la réclame jamais.
 *
 * CONSTAT EN PRODUCTION (2026-09-03, lecture seule)
 *   9 factures en brouillon, dont 4 RÉELLEMENT envoyées — 919 $ partis
 *   chez des clients et invisibles côté Lume. Les plus anciennes dataient
 *   du 14 juin.
 *
 * LA CAUSE
 * `POST /emails/send-invoice` estampillait `sent_at` et `issued_at`, mais
 * jamais `status`. Le commentaire au-dessus annonçait pourtant « Update
 * invoice status to sent » : l'intention était là, l'écriture manquait.
 *
 * CE QUE CES TESTS FIGENT
 * Le statut suit l'envoi, et SEULEMENT depuis brouillon. Un renvoi de
 * courriel sur une facture payée, partielle ou annulée ne doit jamais la
 * rouvrir — ce serait remettre en circulation une facture réglée.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '..', 'server/routes/emails.ts'), 'utf8');

/** Le bloc qui estampille la facture après un envoi réussi. */
const BLOC = (() => {
  const i = SRC.indexOf("const { error: stampError }");
  return SRC.slice(i, i + 420);
})();

describe('l envoi d une facture met à jour son statut', () => {
  it('le statut passe à « sent »', () => {
    // Le cœur du correctif : sans cette ligne, la facture reste brouillon.
    expect(BLOC).toContain("status: 'sent'");
  });

  it('la date d envoi est toujours posée', () => {
    expect(BLOC).toContain('sent_at: now');
  });

  it('la date d émission accompagne le passage à « sent »', () => {
    // issued_at et status changent ensemble : une facture émise a une date
    // d'émission, sinon les rapports comptent mal.
    expect(BLOC).toContain('issued_at: now');
  });
});

describe('seul un brouillon change de statut', () => {
  it('la mise à jour est conditionnée au statut « draft »', () => {
    // Un renvoi sur une facture PAYÉE ne doit pas la faire repasser à
    // « sent » : elle réapparaîtrait dans les impayés, et une relance
    // partirait chez un client à jour.
    expect(BLOC).toMatch(/invoice\.status === 'draft'/);
  });

  it('le statut est posé par une propagation conditionnelle, pas en dur', () => {
    // `...(cond ? { status } : {})` — hors brouillon, la clé n'existe même
    // pas dans la requête : rien n'est écrasé.
    expect(BLOC).toMatch(/\.\.\.\(invoice\.status === 'draft' \? \{ status: 'sent'/);
  });

  it('sent_at est posé dans TOUS les cas, y compris hors brouillon', () => {
    // Un renvoi doit laisser une trace même si le statut ne bouge pas :
    // c'est ce qui permet de savoir quand le client a été relancé.
    const apresBloc = BLOC.slice(BLOC.indexOf('sent_at'));
    expect(apresBloc).toContain('sent_at: now');
    // sent_at ne doit PAS être enfermé dans la condition draft
    expect(BLOC).not.toMatch(/draft' \? \{[^}]*sent_at/);
  });
});

describe('un échec d écriture ne reste pas muet', () => {
  it('l erreur est journalisée avec l identifiant de la facture', () => {
    // Le courriel est déjà parti : on ne peut plus répondre en erreur sans
    // pousser l'utilisateur à renvoyer. La trace est le seul recours.
    expect(SRC).toContain('sent but sent_at not saved');
    expect(SRC).toMatch(/stampError[\s\S]{0,200}console\.error/);
  });

  it('la trace porte l organisation, pour retrouver le client concerné', () => {
    const i = SRC.indexOf('sent but sent_at not saved');
    expect(SRC.slice(i - 120, i + 160)).toContain('org ');
  });
});

describe('le devis suit la même règle', () => {
  it('l envoi d un devis passe aussi le statut à « sent »', () => {
    // send-quote le faisait déjà correctement — ce test empêche que la
    // correction de la facture soit un jour recopiée à l'envers.
    const i = SRC.indexOf("[emails/send-quote]");
    const bloc = SRC.slice(Math.max(0, i - 600), i);
    expect(bloc).toContain("status: 'sent'");
  });
});
