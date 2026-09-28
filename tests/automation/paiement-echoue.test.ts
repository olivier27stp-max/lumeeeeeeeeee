/**
 * PR 4 — Paiement échoué (drapeau `auto_paiement_echoue`).
 *
 *  - Webhook rejoué 2 fois = 1 seul déclenchement (réservation par id
 *    d'événement Stripe, clé primaire en base).
 *  - Événement d'une autre entreprise (facture hors de l'entreprise des
 *    métadonnées) → ignoré. Événement venu d'un compte connecté → ignoré.
 *  - Échec de l'abonnement Lume (PaymentIntent de Stripe Billing) → ignoré.
 *  - Chaque raison traduite, jamais le code brut ; variables du message.
 *  - Drapeau OFF → rien d'émis (et le webhook ne change pas : le filet).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ client: { current: null as any } }));
vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client.current }));

import { traiterPaiementEchoue, raisonLisible, CODES_TRADUITS } from '../../server/lib/paiement-echoue';
import { eventBus } from '../../server/lib/eventBus';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { resolveEntityVariables, resolveTemplate } from '../../server/lib/actions';
import { DECLENCHEURS, declencheurOffert } from '../../src/lib/automationCatalogue';
import { typeEnvoi } from '../../server/lib/desabonnement';
import { clientEnregistreur, requetes } from './filet-regression/_enregistreur';
import { monde, IDS, ORG } from './filet-regression/_banc';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
const AUTRE_ORG = '22222222-2222-4222-8222-222222222222';
const ON = { data: [{ feature: 'auto_paiement_echoue', enabled: true }] };

const evenement = (surcharge: Record<string, unknown> = {}, intent: Record<string, unknown> = {}) => ({
  id: 'evt_1', type: 'payment_intent.payment_failed', account: null,
  data: { object: {
    id: 'pi_1', amount: 162690, invoice: null,
    metadata: { org_id: ORG, invoice_id: IDS.facture, client_id: IDS.client },
    last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
    ...intent,
  } },
  ...surcharge,
});

/** La base vue par le webhook. `reserves` simule la clé primaire des événements traités. */
function base(opts: { drapeau?: boolean; facture?: boolean } = {}) {
  const reserves = new Set<string>();
  const r = clientEnregistreur({
    org_features: opts.drapeau === false ? { data: [] } : ON,
    invoices: { data: opts.facture === false ? [] : [{ id: IDS.facture, org_id: ORG, invoice_number: 'INV-000042', client_id: IDS.client }] },
    payments: { data: [] },
    paiements_echoues_traites: (req) => {
      if (req.op !== 'insert') return { data: [] };
      const id = (req.valeur as any).stripe_event_id;
      if (reserves.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      reserves.add(id);
      return { data: [{}] };
    },
  });
  return r;
}

let emis: any[] = [];
beforeEach(() => {
  oublierDrapeaux();
  emis = [];
  eventBus.removeAllListeners();
  eventBus.on('payment.failed', (e: unknown) => { emis.push(e); });
});

describe('le webhook devient un déclencheur', () => {
  it('émet payment.failed avec montant, facture, raison et origine', async () => {
    const { client, journal } = base();
    expect(await traiterPaiementEchoue(client, evenement())).toBe('emis');
    expect(emis).toHaveLength(1);
    expect(emis[0]).toMatchObject({ type: 'payment.failed', orgId: ORG, entityType: 'invoice', entityId: IDS.facture });
    expect(emis[0].metadata).toMatchObject({ montant_cents: 162690, raison_code: 'insufficient_funds', invoice_number: 'INV-000042', origine: 'paiement_en_ligne' });
    // La raison est posée sur la ligne de paiement (jusqu'ici jamais remplie).
    const maj = requetes(journal, 'payments', 'update')[0];
    expect(maj.valeur).toEqual({ failure_reason: 'insufficient_funds' });
    expect(maj.filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'provider_payment_id', 'pi_1']]));
  });

  it('webhook rejoué 2 fois = 1 seul déclenchement', async () => {
    const { client } = base();
    expect(await traiterPaiementEchoue(client, evenement())).toBe('emis');
    expect(await traiterPaiementEchoue(client, evenement())).toBe('deja_traite');
    expect(emis).toHaveLength(1);
  });

  it('carte au dossier : l\'origine est dite', async () => {
    const { client } = base();
    await traiterPaiementEchoue(client, evenement({}, { metadata: { org_id: ORG, invoice_id: IDS.facture, charged_from: 'card_on_file' } }));
    expect(emis[0].metadata.origine).toBe('carte_au_dossier');
  });
});

describe('ce qui n\'est JAMAIS un déclencheur', () => {
  it('échec de l\'abonnement Lume (PaymentIntent de Stripe Billing) : ignoré', async () => {
    const { client } = base();
    expect(await traiterPaiementEchoue(client, evenement({}, { invoice: 'in_abonnement_lume' }))).toBe('abonnement_lume');
    expect(emis).toHaveLength(0);
  });

  it('abonnement Lume sans métadonnées de facture : ignoré', async () => {
    const { client } = base();
    expect(await traiterPaiementEchoue(client, evenement({}, { metadata: {} }))).toBe('hors_facture');
  });

  it('événement d\'une autre entreprise : la facture n\'est pas dans l\'entreprise des métadonnées → ignoré', async () => {
    const { client, journal } = base({ facture: false });
    const r = await traiterPaiementEchoue(client, evenement({}, { metadata: { org_id: AUTRE_ORG, invoice_id: IDS.facture } }));
    expect(r).toBe('facture_inconnue');
    expect(emis).toHaveLength(0);
    // La facture a bien été cherchée DANS l'entreprise des métadonnées.
    expect(requetes(journal, 'invoices')[0].filtres).toEqual(expect.arrayContaining([['eq', 'org_id', AUTRE_ORG]]));
  });

  it('événement venu d\'un compte connecté (métadonnées fabricables) : ignoré', async () => {
    const { client } = base();
    expect(await traiterPaiementEchoue(client, evenement({ account: 'acct_marchand' }))).toBe('compte_connecte');
    expect(emis).toHaveLength(0);
  });

  it('drapeau OFF : rien d\'émis, rien d\'écrit', async () => {
    const { client, journal } = base({ drapeau: false });
    expect(await traiterPaiementEchoue(client, evenement())).toBe('drapeau_off');
    expect(emis).toHaveLength(0);
    expect(journal.filter((q) => q.op !== 'select')).toHaveLength(0);
  });

  it('une panne ne lève jamais (le webhook répond 200 à Stripe)', async () => {
    const { client } = clientEnregistreur({ org_features: ON, invoices: { data: null, error: { message: 'panne' } } });
    expect(await traiterPaiementEchoue(client, evenement())).toBe('erreur');
  });
});

describe('les raisons, en mots de client', () => {
  it.each(CODES_TRADUITS)('« %s » est traduit, jamais affiché brut', (code) => {
    const fr = raisonLisible(code, 'fr');
    const en = raisonLisible(code, 'en');
    expect(fr).not.toContain('_');
    expect(en).not.toContain('_');
    expect(fr).not.toBe(code);
  });
  it('les principales', () => {
    expect(raisonLisible('insufficient_funds')).toBe('fonds insuffisants');
    expect(raisonLisible('expired_card')).toBe('carte expirée');
    expect(raisonLisible('generic_decline')).toBe('carte refusée par la banque');
    // « fraude » ne s'écrit pas à un client.
    expect(raisonLisible('fraudulent')).toBe('carte refusée par la banque');
    expect(raisonLisible('un_code_inconnu')).toBe('paiement refusé');
    expect(raisonLisible(null, 'en')).toBe('payment declined');
  });
});

describe('les variables du message', () => {
  it('montant, raison lisible, facture, lien pour payer', async () => {
    const m = monde({ id: 'x', trigger_event: 'payment.failed' });
    const { client } = clientEnregistreur({
      ...m,
      org_features: ON,
      payments: { data: [{ amount_cents: 50000, failure_reason: 'expired_card' }] },
      payment_requests: { data: [{ public_token: 'a1b2c3' }] },
    });
    const vars = await resolveEntityVariables(client, ORG, 'invoice', IDS.facture);
    // fr-CA sépare « 500,00 » et « $ » par une espace insécable : on compare le sens.
    expect(resolveTemplate('{{paiement.facture}} : {{paiement.montant}} refusé ({{paiement.raison}}). Payer : {{paiement.lien}}', vars).replace(/\s/g, ' '))
      .toBe('INV-000042 : 500,00 $ refusé (carte expirée). Payer : https://app.lume.test/pay/a1b2c3');
  });
  it('un litige n\'est pas un « paiement échoué »', async () => {
    const m = monde({ id: 'x', trigger_event: 'payment.failed' });
    const { client } = clientEnregistreur({ ...m, org_features: ON, payments: { data: [{ amount_cents: 1, failure_reason: 'dispute:fraudulent' }] } });
    const vars = await resolveEntityVariables(client, ORG, 'invoice', IDS.facture);
    expect(vars['paiement.raison']).toBe('');
  });
  it('drapeau OFF : aucune variable de paiement', async () => {
    const { client } = clientEnregistreur(monde({ id: 'x', trigger_event: 'payment.failed' }));
    const vars = await resolveEntityVariables(client, ORG, 'invoice', IDS.facture);
    expect(Object.keys(vars).some((k) => k.startsWith('paiement.'))).toBe(false);
  });
});

describe('catalogue et classement', () => {
  const d = DECLENCHEURS.find((x) => x.cle === 'payment.failed')!;
  it('« Paiement échoué », offert seulement avec le drapeau', () => {
    expect(d.fr).toBe('Paiement échoué');
    expect(declencheurOffert(d, new Set())).toBe(false);
    expect(declencheurOffert(d, new Set(['auto_paiement_echoue']))).toBe(true);
  });
  it('un message après un paiement échoué est transactionnel (encaisser une dette)', () => {
    expect(typeEnvoi({ actionType: 'send_sms', declencheur: 'payment.failed', delaiSecondes: 86400 })).toBe('transactionnel');
  });
});
