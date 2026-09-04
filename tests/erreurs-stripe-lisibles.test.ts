/**
 * QUAND STRIPE REFUSE, IL FAUT SAVOIR POURQUOI.
 *
 * Les routes de paiement répondaient « Internal server error » quelle que
 * soit la cause. Or Stripe dit précisément ce qui cloche.
 *
 * CONSTAT DU 2026-09-04
 * En testant le parcours d'abonnement avec une clé de TEST, Stripe a
 * répondu :
 *
 *     No such price 'price_1TqyQY…' ; a similar object exists in live mode,
 *     but a test mode key was used to make this request.
 *
 * Ce diagnostic — qui nomme exactement le problème — partait dans les
 * journaux du serveur, et l'appelant recevait « Internal server error ».
 * Le jour où une configuration Stripe dérive en production, personne ne
 * sait quoi chercher.
 *
 * CE QUE CES TESTS FIGENT
 * Le traducteur d'erreurs : chaque cas Stripe connu reçoit un message et
 * un code HTTP qui ont du sens, et rien d'interne ne fuit vers le client.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '..', 'server/routes/billing.ts'), 'utf8');

/** Le corps de la fonction de traduction. */
const BLOC = (() => {
  const i = SRC.indexOf('function messageStripe');
  return i === -1 ? '' : SRC.slice(i, i + 1400);
})();

describe('le traducteur d erreurs Stripe existe', () => {
  it('la fonction est définie', () => {
    expect(BLOC).not.toBe('');
    expect(BLOC).toContain('function messageStripe');
  });

  it('elle lit le code d erreur, y compris sous sa forme brute', () => {
    // Stripe expose parfois le code sous `err.code`, parfois sous
    // `err.raw.code` selon la version du SDK.
    expect(BLOC).toContain('err?.code');
    expect(BLOC).toContain('err?.raw?.code');
  });
});

describe('le mélange test / réel est nommé explicitement', () => {
  it('il est reconnu par le code ET le texte du message', () => {
    // `resource_missing` seul ne suffit pas : c'est le « live mode / test
    // mode » dans le message qui distingue ce cas d'un tarif simplement
    // supprimé.
    expect(BLOC).toContain("code === 'resource_missing'");
    expect(BLOC).toMatch(/live mode\|test mode/);
  });

  it('la réponse dit quoi vérifier, en français', () => {
    expect(BLOC).toContain('Configuration Stripe incohérente');
    expect(BLOC).toMatch(/mode test et le mode réel/);
  });

  it('elle répond 503, pas 500', () => {
    // 503 = le service ne peut pas répondre dans cette configuration.
    // 500 laisserait croire à un plantage du code.
    const i = BLOC.indexOf('live mode|test mode');
    expect(BLOC.slice(i, i + 200)).toContain('status: 503');
  });
});

describe('les autres cas Stripe sont couverts', () => {
  it('un tarif introuvable oriente vers la configuration des forfaits', () => {
    expect(BLOC).toContain('Tarif introuvable chez Stripe');
  });

  it('une clé invalide est distinguée', () => {
    expect(BLOC).toContain('StripeAuthenticationError');
    expect(BLOC).toContain('Clé Stripe invalide');
  });

  it('une carte refusée renvoie 402, le code prévu pour ça', () => {
    expect(BLOC).toContain('StripeCardError');
    expect(BLOC).toContain('status: 402');
  });

  it('un cas inconnu retombe sur 500 sans rien divulguer', () => {
    // Le repli ne doit jamais renvoyer err.message brut : il pourrait
    // contenir un identifiant interne ou une clé partielle.
    expect(BLOC).toContain("status: 500, error: 'Internal server error'");
  });
});

describe('les routes de paiement utilisent le traducteur', () => {
  for (const route of ['create-payment-intent', 'create-checkout-session']) {
    it(`${route} traduit son erreur au lieu de l avaler`, () => {
      // Viser le gestionnaire d'ERREUR, pas les autres traces qui portent
      // le même préfixe (vérification d'email, blocages métier…).
      const i = SRC.indexOf(`console.error('[billing/${route}]'`);
      expect(i).toBeGreaterThan(-1);
      const apres = SRC.slice(i, i + 260);
      expect(apres).toContain('messageStripe(err)');
      expect(apres).toContain('res.status(r.status)');
    });

    it(`${route} journalise toujours le détail complet côté serveur`, () => {
      // Le message précis de Stripe reste dans les journaux : c'est là
      // qu'on retrouve l'identifiant exact du tarif fautif.
      expect(SRC).toContain(`console.error('[billing/${route}]', err.message)`);
    });
  }
});
