/**
 * CLIQUET — la page qui suit un paiement ne montre jamais de message technique.
 *
 * Constaté le 2026-09-24 en cliquant les boutons des courriels de Lume : le
 * bouton « Configurer mon compte » du courriel de bienvenue aboutissait sur
 * « Something went wrong / Internal server error ». Le message venait du
 * serveur, affiché tel quel à quelqu'un qui vient de payer 569 $.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'src/pages/CheckoutSuccess.tsx'), 'utf8');

describe('CheckoutSuccess', () => {
  it('ne rend jamais le message brut du serveur à l’écran', () => {
    // Il reste dans la console pour le diagnostic.
    expect(src).toContain("console.error('[CheckoutSuccess]', err.message)");
    expect(src).not.toMatch(/setErrorMsg\(err\.message\)/);
  });

  it('dit que le paiement est passé : c’est la confirmation qui tarde', () => {
    // « Votre paiement n'a pas pu être confirmé » laissait croire à un échec,
    // alors que Stripe a déjà encaissé.
    expect(src).toMatch(/paiement est bien passé/);
    expect(src).not.toMatch(/n’a pas pu être confirmé/);
    // Et une porte de sortie utile.
    expect(src).toContain('support@lumecrm.net');
  });

  it('ne renvoie pas vers la page de paiement — risque de double paiement', () => {
    const bloc = src.slice(src.indexOf("status === 'error'"));
    expect(bloc).not.toMatch(/navigate\('\/checkout'\)/);
    expect(bloc).toContain('window.location.reload()');
  });
});
