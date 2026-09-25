/**
 * APPLE PAY / GOOGLE PAY : L'INTERRUPTEUR QUI NE POUVAIT RIEN ALLUMER
 * (2026-09-18).
 *
 * Les réglages Lume Payments offrent « Apple Pay & Google Pay », et la page
 * publique passe bien l'option au Payment Element. Pourtant, mesuré sur la
 * vraie page, Stripe.js répondait « apple_pay not enabled ». Cause : les
 * PaymentIntent des paiements CLIENTS étaient créés avec
 * `payment_method_types: ['card']`. Apple Pay et Google Pay ne sont pas des
 * types distincts — ce sont des façons de présenter une carte, et Stripe ne
 * les propose QUE sous `automatic_payment_methods`. Aucun réglage, aucun
 * enregistrement de domaine n'aurait pu les faire apparaître.
 *
 * `allow_redirects: 'never'` est indissociable : sans lui, Stripe peut
 * proposer des moyens qui envoient le payeur sur un site tiers, et le retour
 * sur /pay/:token n'est pas conçu pour ça.
 *
 * Ce test fige la distinction entre :
 *   - les paiements où un client est DEVANT l'écran → portefeuilles permis ;
 *   - les paiements HORS SESSION (carte au dossier, abonnement) et
 *     l'enregistrement d'une carte (SetupIntent) → carte imposée, un
 *     portefeuille n'a pas de sens sans personne pour approuver.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

/** Paiements présentés à un client sur une page publique. */
const AVEC_PORTEFEUILLES = [
  ['server/lib/stripe-connect.ts', 'createDestinationPaymentIntent'],
  ['server/lib/depositPayments.ts', 'dépôt via les clés de l’org'],
  ['server/routes/quotes.ts', 'dépôt de devis, repli clés de l’org'],
] as const;

describe('moyens de paiement offerts au client', () => {
  it.each(AVEC_PORTEFEUILLES)('%s laisse Stripe proposer les portefeuilles', (fichier) => {
    const src = lire(fichier);
    expect(src).toMatch(/automatic_payment_methods: \{ enabled: true, allow_redirects: 'never' \}/);
  });

  it('le paiement de la page publique n impose plus la carte seule', () => {
    const src = lire('server/lib/stripe-connect.ts');
    // Bloc de createDestinationPaymentIntent, jusqu'à sa clé d'idempotence.
    // Les commentaires sont retirés : ils CITENT la formule interdite pour
    // expliquer pourquoi elle l'est, ce qui ferait échouer un test naïf.
    const debut = src.indexOf('export async function createDestinationPaymentIntent');
    const bloc = src
      .slice(debut, src.indexOf('idempotencyKey: idemKey', debut))
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(bloc).not.toMatch(/payment_method_types: \['card'\]/);
    expect(bloc).toMatch(/automatic_payment_methods/);
  });

  it('les prélèvements hors session gardent la carte : un portefeuille exige une approbation', () => {
    const src = lire('server/lib/stripe-connect.ts');
    const debut = src.indexOf('export async function chargeInvoiceOnFile');
    const bloc = src.slice(debut);
    expect(bloc).toMatch(/off_session: true/);
    expect(bloc).toMatch(/payment_method_types: \['card'\]/);
  });

  it('l enregistrement d une carte au dossier reste une carte', () => {
    const src = lire('server/routes/agreements.ts');
    expect(src).toMatch(/setupIntents\.create\(\{[\s\S]{0,200}payment_method_types: \['card'\]/);
  });

  it('la page publique respecte le réglage wallets_enabled de l entreprise', () => {
    const src = lire('src/pages/PublicPayment.tsx');
    expect(src).toMatch(/wallets: \{ applePay: walletsEnabled \? 'auto' : 'never', googlePay: walletsEnabled \? 'auto' : 'never' \}/);
  });
});
