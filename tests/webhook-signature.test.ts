/**
 * LA SIGNATURE DES WEBHOOKS STRIPE — prouver que ca vient bien de Stripe.
 *
 * POURQUOI C EST LE MAILLON LE PLUS SENSIBLE
 * L adresse `/api/webhooks/stripe` est publique : n importe qui sur Internet
 * peut lui envoyer une requete. Ce qui separe un vrai evenement Stripe d un
 * faux, c est UNIQUEMENT la signature.
 *
 * Sans elle, un inconnu pourrait poster « paiement reussi, 5000 $ » et le CRM
 * marquerait la facture payee. Il n aurait rien paye.
 *
 * CE FICHIER UTILISE LA VRAIE CRYPTOGRAPHIE DE STRIPE
 * On appelle `stripe.webhooks.constructEvent()` — la fonction meme que la
 * route utilise — avec des signatures fabriquees par la librairie officielle.
 * Aucun appel reseau, aucun argent, aucune cle de production : le secret est
 * invente pour le test.
 *
 * LES QUATRE PROTECTIONS DE LA ROUTE, relevees le 2026-09-02 :
 *   1. en-tete `stripe-signature` absent          -> 400
 *   2. signature invalide                          -> 400 + alerte CRITIQUE
 *   3. deux secrets acceptes (plateforme + Connect)
 *   4. evenement de plus de 5 minutes              -> ignore (anti-rejeu)
 *
 * ET UN PIEGE D ASSEMBLAGE
 * La verification exige le corps BRUT. Si `express.json()` passe avant
 * `express.raw()`, le corps est deja transforme et TOUTE signature devient
 * invalide — silencieusement. `server/index.ts` monte donc la route webhook
 * AVANT `express.json()`, et un test verifie que cet ordre tient.
 */

import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stripe = new Stripe('sk_test_factice_pour_les_tests', { apiVersion: '2025-01-27.acacia' as any });

const SECRET_PLATEFORME = 'whsec_secret_de_test_plateforme';
const SECRET_CONNECT = 'whsec_secret_de_test_connect';

/** Fabrique un corps d evenement et sa signature, comme Stripe le ferait. */
function evenementSigne(secret: string, options: { ageSecondes?: number; type?: string } = {}) {
  const cree = Math.floor(Date.now() / 1000) - (options.ageSecondes ?? 0);
  const corps = JSON.stringify({
    id: 'evt_test_123',
    object: 'event',
    type: options.type ?? 'payment_intent.succeeded',
    created: cree,
    data: { object: { id: 'pi_test_123', amount: 500000 } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload: corps, secret });
  return { corps, signature };
}

/** Reproduction de l enchainement de la route, avec la VRAIE verification. */
function recevoirLeWebhook(params: {
  signature?: string | null;
  corps: string | Buffer;
  secrets?: string[];
}): { code: number; note?: string; alerte?: string } {
  const secrets = (params.secrets ?? [SECRET_PLATEFORME, SECRET_CONNECT]).filter(Boolean);
  if (secrets.length === 0) return { code: 503 };

  // 1) L en-tete doit etre la.
  if (!params.signature) {
    return { code: 400, alerte: 'stripe_webhook_missing_signature' };
  }

  // 2) La signature doit correspondre a l un des secrets acceptes.
  const brut = params.corps instanceof Buffer ? params.corps : Buffer.from(params.corps);
  let evenement: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      evenement = stripe.webhooks.constructEvent(brut, params.signature, secret);
      break;
    } catch {
      // on essaie le secret suivant
    }
  }
  if (!evenement) {
    return { code: 400, alerte: 'stripe_webhook_invalid_signature' };
  }

  // 3) Anti-rejeu : rien de plus vieux que 5 minutes.
  const age = Math.floor(Date.now() / 1000) - evenement.created;
  if (age > 300) {
    return { code: 200, note: 'stale_event_ignored', alerte: 'stripe_webhook_stale_event' };
  }

  return { code: 200, note: 'traite' };
}

describe('la signature du webhook', () => {
  it('un evenement correctement signe est accepte', () => {
    const { corps, signature } = evenementSigne(SECRET_PLATEFORME);
    const r = recevoirLeWebhook({ corps, signature });
    expect(r.code).toBe(200);
    expect(r.note).toBe('traite');
  });

  it('SANS en-tete de signature, la requete est refusee', () => {
    const { corps } = evenementSigne(SECRET_PLATEFORME);
    const r = recevoirLeWebhook({ corps, signature: null });
    expect(r.code).toBe(400);
    expect(r.alerte).toBe('stripe_webhook_missing_signature');
  });

  it('une signature INVENTEE est refusee', () => {
    // Le scenario qui compte : un inconnu poste « paiement reussi » sans
    // connaitre le secret. Il ne doit jamais passer.
    const { corps } = evenementSigne(SECRET_PLATEFORME);
    const r = recevoirLeWebhook({ corps, signature: 't=1,v1=signature_bidon' });
    expect(r.code).toBe(400);
    expect(r.alerte).toBe('stripe_webhook_invalid_signature');
  });

  it('une signature valide mais d un AUTRE secret est refusee', () => {
    const { corps, signature } = evenementSigne('whsec_secret_dun_inconnu');
    const r = recevoirLeWebhook({ corps, signature });
    expect(r.code).toBe(400);
  });

  it('le CORPS MODIFIE apres signature est refuse', () => {
    // Le coeur de la protection : quelqu un intercepte un vrai webhook et
    // change le montant. La signature ne correspond plus.
    const { corps, signature } = evenementSigne(SECRET_PLATEFORME);
    const falsifie = corps.replace('"amount":500000', '"amount":999999999');
    expect(falsifie).not.toBe(corps);
    const r = recevoirLeWebhook({ corps: falsifie, signature });
    expect(r.code).toBe(400);
  });

  it('le secret Connect est accepte aussi', () => {
    // Les paiements passent par deux canaux : la plateforme et Connect.
    // Les deux secrets doivent fonctionner, sinon la moitie des paiements
    // seraient rejetes.
    const { corps, signature } = evenementSigne(SECRET_CONNECT);
    expect(recevoirLeWebhook({ corps, signature }).code).toBe(200);
  });

  it('sans aucun secret configure, le serveur refuse de deviner', () => {
    const { corps, signature } = evenementSigne(SECRET_PLATEFORME);
    expect(recevoirLeWebhook({ corps, signature, secrets: [] }).code).toBe(503);
  });

  it('un corps vide avec une signature valide ailleurs est refuse', () => {
    const { signature } = evenementSigne(SECRET_PLATEFORME);
    expect(recevoirLeWebhook({ corps: Buffer.from(''), signature }).code).toBe(400);
  });
});

describe('l anti-rejeu', () => {
  it('un evenement recent est traite', () => {
    const { corps, signature } = evenementSigne(SECRET_PLATEFORME, { ageSecondes: 60 });
    expect(recevoirLeWebhook({ corps, signature }).note).toBe('traite');
  });

  it('un evenement de plus de 5 minutes est ignore', () => {
    // Meme PARFAITEMENT signe : un webhook capture aujourd hui ne doit pas
    // pouvoir etre rejoue demain pour encaisser une deuxieme fois.
    const { corps, signature } = evenementSigne(SECRET_PLATEFORME, { ageSecondes: 400 });
    const r = recevoirLeWebhook({ corps, signature });
    expect(r.note).toBe('stale_event_ignored');
    expect(r.alerte).toBe('stripe_webhook_stale_event');
  });

  it('un evenement ignore repond quand meme 200', () => {
    // Important : repondre 200 empeche Stripe de reessayer indefiniment un
    // evenement qu on a volontairement ecarte.
    const { corps, signature } = evenementSigne(SECRET_PLATEFORME, { ageSecondes: 400 });
    expect(recevoirLeWebhook({ corps, signature }).code).toBe(200);
  });

  it('la limite est bien a 5 minutes', () => {
    const juste = evenementSigne(SECRET_PLATEFORME, { ageSecondes: 290 });
    const trop = evenementSigne(SECRET_PLATEFORME, { ageSecondes: 310 });
    expect(recevoirLeWebhook({ corps: juste.corps, signature: juste.signature }).note).toBe('traite');
    expect(recevoirLeWebhook({ corps: trop.corps, signature: trop.signature }).note).toBe('stale_event_ignored');
  });
});

/**
 * LE PIEGE D ASSEMBLAGE.
 *
 * `stripe.webhooks.constructEvent()` exige le corps BRUT, octet pour octet.
 * Si `express.json()` s execute avant, le corps arrive deja transforme en
 * objet et AUCUNE signature ne correspond plus — sans message d erreur
 * explicite, juste des webhooks tous rejetes.
 *
 * Ce test lit `server/index.ts` et verifie l ordre de montage. C est le seul
 * moyen d attraper une reorganisation malheureuse des middlewares : aucun
 * test de comportement ne la verrait, puisque le code « fonctionne ».
 */
describe('le corps brut du webhook', () => {
  const source = readFileSync(resolve(__dirname, '../server/index.ts'), 'utf8');

  it('la route webhook est montee AVANT express.json()', () => {
    const posWebhook = source.indexOf("app.post('/api/webhooks/stripe'");
    const posJson = source.indexOf('app.use(express.json(');
    expect(posWebhook).toBeGreaterThan(-1);
    expect(posJson).toBeGreaterThan(-1);
    expect(posWebhook).toBeLessThan(posJson);
  });

  it('la route webhook utilise express.raw()', () => {
    const ligne = source.split('\n').find((l) => l.includes("app.post('/api/webhooks/stripe'"));
    expect(ligne).toBeDefined();
    expect(ligne).toContain('express.raw(');
  });

  it('la route Connect suit la meme regle', () => {
    const posConnect = source.indexOf("app.post('/api/webhooks/stripe-connect'");
    const posJson = source.indexOf('app.use(express.json(');
    expect(posConnect).toBeGreaterThan(-1);
    expect(posConnect).toBeLessThan(posJson);
  });
});
