/**
 * [B] Entrées externes : formulaire de demande public, webhooks Stripe
 * SIGNÉS (charge utile construite localement, jamais d'appel à l'API Stripe),
 * adresse d'appel /api/hooks/:clé (voir aussi 10-b-declencheurs, B-049).
 *
 * Les secrets sont ceux du TEST, posés avant tout import du serveur (config.ts
 * les lit au chargement) : jamais ceux de .env.local, absents en CI.
 *
 * Matrice : tests/automations-suite/matrice/B.md (B-400 à B-499).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { marque, attendre, envoisSimules, appelsHttpBloques } from '../harnais/moteur';
import {
  preparerBureau, apiEnMemoire, creerRegle, supprimerRegles, tachesTitrees, journaux, lignesDAction,
  creerClient, creerDevis, creerFacture, drapeau, ok, type Api, type Bureau,
} from './10-b-outils';

const SECRET_STRIPE = 'whsec_test_qa_automatisations';
process.env.STRIPE_WEBHOOK_SECRET = SECRET_STRIPE;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = '';
// Clé factice : le client Stripe n'existe que pour vérifier la signature
// (locale). Aucun chemin éprouvé ici n'appelle l'API (pas de latest_charge).
process.env.STRIPE_SECRET_KEY = 'sk_test_qa_factice_automatisations';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];

beforeAll(async () => {
  b = await preparerBureau();
  const [formulaires, regles_, paiements] = await Promise.all([
    import('../../../server/routes/request-forms'),
    import('../../../server/routes/automation-rules'),
    import('../../../server/routes/payments'),
  ]);
  api = await apiEnMemoire(b, [
    { brut: '/api/webhooks/stripe', routeur: paiements.stripeWebhookHandler },
    { routeur: formulaires.default }, { routeur: regles_.default },
  ]);
});
afterEach(async () => { await supprimerRegles(b.admin, regles.splice(0)); });
afterAll(async () => {
  await supprimerRegles(b.admin, regles);
  await api?.fermer();
});

async function regle(nom: string, declencheur: string, conditions: Record<string, unknown> = {}) {
  const id = await creerRegle(api, { nom, declencheur, conditions, actions: [{ type: 'create_task', config: { title: nom } }] });
  regles.push(id);
  return id;
}

/** Un événement Stripe signé comme Stripe le fait (en-tête t=…,v1=…). */
async function envoyerStripe(evenement: Record<string, unknown>) {
  const Stripe = (await import('stripe')).default;
  const corps = JSON.stringify(evenement);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: corps, secret: SECRET_STRIPE });
  return api.publique('POST', '/api/webhooks/stripe', corps, { 'Content-Type': 'application/json', 'Stripe-Signature': signature });
}

function intention(type: string, id: string, objet: Record<string, unknown>) {
  return { id: `evt_qa_${randomBytes(8).toString('hex')}`, object: 'event', type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object: { object: 'payment_intent', id, currency: 'cad', payment_method_types: ['card'], latest_charge: null, created: Math.floor(Date.now() / 1000), ...objet } } };
}

describe('[B] formulaire de demande public', () => {
  it('[B-400][B-401] POST /api/public/form/:clé/submit → lead.created source=request_form : règle vraie agit, source≠ n’agit pas', async () => {
    const m = marque('B-400');
    const { data: existant } = await b.admin.from('request_forms').select('api_key').eq('org_id', b.orgA).is('deleted_at', null).limit(1).maybeSingle();
    const cle = existant?.api_key ?? (await ok<{ api_key: string }>(b.admin.from('request_forms').insert({
      org_id: b.orgA, created_by: b.users.proprioA, title: 'Formulaire QA', enabled: true, notify_email: false, notify_in_app: false,
    }).select('api_key').single(), 'formulaire')).api_key;
    const faux = await regle(`${m} faux`, 'lead.created', { source: 'site_web' });
    const vrai = await regle(`${m} vrai`, 'lead.created', { source: 'request_form' });
    const email = `demande-${Date.now()}@lume-qa.test`;
    const httpAvant = appelsHttpBloques().length;
    const r = await api.publique('POST', `/api/public/form/${cle}/submit`, JSON.stringify({
      first_name: 'Demande', last_name: m, email, phone: '+15555550161',
    }), { 'Content-Type': 'application/json' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { data: lead } = await b.admin.from('clients').select('id, status').eq('org_id', b.orgA).eq('email', email).single();
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} vrai`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'lead', linked_entity_id: lead!.id });
    expect((await journaux(b.admin, vrai))[0]).toMatchObject({ trigger_event: 'lead.created', entity_id: lead!.id, result_success: true });
    // Écartée par sa condition : aucune action (seulement la trace « conditions non remplies », L-004).
    expect(lignesDAction(await journaux(b.admin, faux))).toHaveLength(0);
    expect(appelsHttpBloques().length, 'le formulaire a tenté un appel réseau').toBe(httpAvant);
  });
});

describe('[B] webhooks Stripe signés', () => {
  it('[B-402] signature invalide : 400, aucun événement', async () => {
    const m = marque('B-402');
    const id = await regle(m, 'invoice.paid');
    const corps = JSON.stringify(intention('payment_intent.succeeded', 'pi_qa_faux', { metadata: {} }));
    const r = await api.publique('POST', '/api/webhooks/stripe', corps, { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' });
    expect(r.status).toBe(400);
    expect(await journaux(b.admin, id)).toHaveLength(0);
  });

  it('[B-403][B-404] payment_intent.succeeded (facture soldée) → paiement écrit, facture payée, invoice.paid : provider=stripe vrai / manual faux', async () => {
    const m = marque('B-403');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 15_000);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const faux = await regle(`${m} faux`, 'invoice.paid', { provider: 'manual' });
    const vrai = await regle(`${m} vrai`, 'invoice.paid', { provider: 'stripe', amount_cents__gte: 15_000 });
    const pi = `pi_qa_${randomBytes(8).toString('hex')}`;
    const r = await envoyerStripe(intention('payment_intent.succeeded', pi, {
      amount: 15_000, amount_received: 15_000, status: 'succeeded',
      metadata: { org_id: b.orgA, invoice_id: f.id, client_id: client.id },
    }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { data: paiement } = await b.admin.from('payments').select('status, amount_cents, provider, invoice_id').eq('provider_payment_id', pi).single();
    expect(paiement).toMatchObject({ status: 'succeeded', amount_cents: 15_000, provider: 'stripe', invoice_id: f.id });
    const { data: facture } = await b.admin.from('invoices').select('status, balance_cents').eq('id', f.id).single();
    expect(facture).toMatchObject({ status: 'paid', balance_cents: 0 });
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} vrai`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'invoice', linked_entity_id: f.id });
    expect((await journaux(b.admin, vrai))[0]).toMatchObject({ trigger_event: 'invoice.paid', entity_type: 'invoice', entity_id: f.id, result_success: true });
    // Écartée par sa condition : aucune action (seulement la trace « conditions non remplies », L-004).
    expect(lignesDAction(await journaux(b.admin, faux))).toHaveLength(0);
    // Rejeu du même événement Stripe : idempotent, aucune 2e exécution.
  });

  it('[B-405] payment_intent.succeeded rejoué (même événement) : déjà traité, la règle ne repart pas', async () => {
    const m = marque('B-405');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 9_000);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const id = await regle(m, 'invoice.paid', { provider: 'stripe' });
    const ev = intention('payment_intent.succeeded', `pi_qa_${randomBytes(8).toString('hex')}`, {
      amount: 9_000, amount_received: 9_000, status: 'succeeded', metadata: { org_id: b.orgA, invoice_id: f.id, client_id: client.id },
    });
    expect((await envoyerStripe(ev)).status).toBe(200);
    await attendre(() => journaux(b.admin, id), (l) => l.length > 0);
    const r2 = await envoyerStripe(ev);
    expect(r2.status).toBe(200);
    expect(r2.json).toMatchObject({ note: 'already_processed' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(await journaux(b.admin, id)).toHaveLength(1);
  });

  it('[B-406] dépôt de soumission (entity_type quote_deposit) → invoice.paid porté par le DEVIS, payment_type=deposit', async () => {
    const m = marque('B-406');
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id, { status: 'approved', deposit_required: true });
    const id = await regle(m, 'invoice.paid', { payment_type: 'deposit' });
    const r = await envoyerStripe(intention('payment_intent.succeeded', `pi_qa_${randomBytes(8).toString('hex')}`, {
      amount: 5_000, amount_received: 5_000, status: 'succeeded',
      metadata: { entity_type: 'quote_deposit', quote_id: devis.id, org_id: b.orgA },
    }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, m), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'quote', linked_entity_id: devis.id });
    expect((await journaux(b.admin, id))[0]).toMatchObject({ trigger_event: 'invoice.paid', entity_type: 'quote', entity_id: devis.id });
    const { data } = await b.admin.from('quotes').select('deposit_status').eq('id', devis.id).single();
    expect(data!.deposit_status).toBe('paid');
  });

  it('[B-591] paiement Stripe qui SOLDE la facture → invoice.paid porte payment_type=full : la règle « full » part, « deposit » et « partial » non', async () => {
    const m = marque('B-591');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 12_000);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const depot = await regle(`${m} depot`, 'invoice.paid', { payment_type: 'deposit' });
    const partiel = await regle(`${m} partiel`, 'invoice.paid', { payment_type: 'partial' });
    const complet = await regle(`${m} complet`, 'invoice.paid', { payment_type: 'full' });
    const r = await envoyerStripe(intention('payment_intent.succeeded', `pi_qa_${randomBytes(8).toString('hex')}`, {
      amount: 12_000, amount_received: 12_000, status: 'succeeded',
      metadata: { org_id: b.orgA, invoice_id: f.id, client_id: client.id },
    }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} complet`), (x) => x.length > 0);
    expect(t, 'la règle « payment_type = full » n’est pas partie pour un paiement par carte').toMatchObject({ linked_entity_type: 'invoice', linked_entity_id: f.id });
    expect((await journaux(b.admin, complet))[0]).toMatchObject({ trigger_event: 'invoice.paid', entity_id: f.id, result_success: true });
    expect(await journaux(b.admin, depot)).toHaveLength(0);
    expect(await journaux(b.admin, partiel)).toHaveLength(0);
  });

  it('[B-591] paiement PayPal qui solde la facture → payment_type=full aussi (même émetteur, aucun appel à PayPal)', async () => {
    const m = marque('B-591p');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 8_000);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const depot = await regle(`${m} depot`, 'invoice.paid', { payment_type: 'deposit' });
    const complet = await regle(`${m} complet`, 'invoice.paid', { payment_type: 'full', provider: 'paypal' });
    const httpAvant = appelsHttpBloques().length;
    const { insertOrUpdatePaymentIdempotent } = await import('../../../server/lib/payments');
    const p = await insertOrUpdatePaymentIdempotent({
      org_id: b.orgA, client_id: client.id, invoice_id: f.id, provider: 'paypal',
      provider_payment_id: `PAYPAL-QA-${randomBytes(6).toString('hex')}`, status: 'succeeded', amount_cents: 8_000, currency: 'CAD',
    });
    expect(p.inserted).toBe(true);
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} complet`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'invoice', linked_entity_id: f.id });
    expect(await journaux(b.admin, depot)).toHaveLength(0);
    expect(appelsHttpBloques().length, 'un appel sortant (PayPal ?) a été tenté').toBe(httpAvant);
  });

  it('[B-591] témoin : un paiement PARTIEL en ligne n’émet pas invoice.paid — ni « full » ni « partial » ne partent, la facture reste à payer', async () => {
    const m = marque('B-591t');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 20_000);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const partiel = await regle(`${m} partiel`, 'invoice.paid', { payment_type: 'partial' });
    const complet = await regle(`${m} complet`, 'invoice.paid', { payment_type: 'full' });
    const r = await envoyerStripe(intention('payment_intent.succeeded', `pi_qa_${randomBytes(8).toString('hex')}`, {
      amount: 5_000, amount_received: 5_000, status: 'succeeded',
      metadata: { org_id: b.orgA, invoice_id: f.id, client_id: client.id },
    }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { data: facture } = await b.admin.from('invoices').select('status, balance_cents').eq('id', f.id).single();
    expect(facture).toMatchObject({ status: 'partial', balance_cents: 15_000 });
    await new Promise((res) => setTimeout(res, 2500));
    expect(await journaux(b.admin, partiel)).toHaveLength(0);
    expect(await journaux(b.admin, complet)).toHaveLength(0);
  });

  it('[B-407][B-408] payment_intent.payment_failed (drapeau auto_paiement_echoue) → paiement échoué écrit, payment.failed : raison vraie / autre fausse', async () => {
    const m = marque('B-407');
    await drapeau(b, 'auto_paiement_echoue', true);
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 7_700);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const faux = await regle(`${m} faux`, 'payment.failed', { raison_code: 'expired_card' });
    const vrai = await regle(`${m} vrai`, 'payment.failed', { raison_code: 'insufficient_funds', montant_cents: 7_700 });
    const pi = `pi_qa_${randomBytes(8).toString('hex')}`;
    const r = await envoyerStripe(intention('payment_intent.payment_failed', pi, {
      amount: 7_700, status: 'requires_payment_method',
      last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
      metadata: { org_id: b.orgA, invoice_id: f.id, client_id: client.id },
    }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} vrai`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'invoice', linked_entity_id: f.id });
    expect((await journaux(b.admin, vrai))[0]).toMatchObject({ trigger_event: 'payment.failed', entity_id: f.id, result_success: true });
    // Écartée par sa condition : aucune action (seulement la trace « conditions non remplies », L-004).
    expect(lignesDAction(await journaux(b.admin, faux))).toHaveLength(0);
    const { data: p } = await b.admin.from('payments').select('status, failure_reason').eq('provider_payment_id', pi).single();
    expect(p).toMatchObject({ status: 'failed', failure_reason: 'insufficient_funds' });
  });

  it('[B-409] payment_intent.payment_failed drapeau COUPÉ : aucun déclenchement', async () => {
    const m = marque('B-409');
    await drapeau(b, 'auto_paiement_echoue', false);
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 4_400);
    const id = await regle(m, 'payment.failed');
    const r = await envoyerStripe(intention('payment_intent.payment_failed', `pi_qa_${randomBytes(8).toString('hex')}`, {
      amount: 4_400, last_payment_error: { code: 'card_declined' }, metadata: { org_id: b.orgA, invoice_id: f.id },
    }));
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 1500));
    expect(await journaux(b.admin, id)).toHaveLength(0);
  });
});

describe('[B] webhook entrant : aucun courriel ni texto ne part d’un appel externe sans règle', () => {
  it('[B-410] un envoi simulé ne naît que d’une règle : appel /api/hooks sans règle active = aucun envoi', async () => {
    const depuis = new Date().toISOString();
    const [hooks] = await Promise.all([import('../../../server/routes/webhooks-entrants')]);
    const api2 = await apiEnMemoire(b, [{ routeur: hooks.default, avant: true }, { routeur: (await import('../../../server/routes/automation-rules')).default }]);
    try {
      const cree = await api2.appeler('POST', '/api/automations/webhooks', { name: 'Sans règle' });
      expect(cree.status).toBe(201);
      const r = await api2.publique('POST', `/api/hooks/${cree.json.api_key}`, JSON.stringify({ a: 1 }), { 'Content-Type': 'application/json' });
      expect(r.status).toBeLessThan(300);
      await new Promise((res) => setTimeout(res, 1000));
      expect(await envoisSimules(b.admin, b.orgA, depuis)).toHaveLength(0);
    } finally {
      await api2.fermer();
    }
  });
});
