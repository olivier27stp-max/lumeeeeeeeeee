/**
 * Un paiement Stripe compte UNE fois, et « Facture payée » ne part que pour une
 * facture payée (audit automatisations V2, 2026-09-29, C16/C17/C18).
 *
 * Mesuré sur staging avant le correctif : 40 $ payés sur 100 $ → paid_cents =
 * 80 $ ; le même PaymentIntent reçu sous un 2e événement → facture « payée » ;
 * `invoice.paid` émis au premier acompte. Cause : l'insertion du paiement
 * recalcule déjà la facture (trigger `trg_payments_recalculate_invoice`), puis
 * le webhook appelait `apply_invoice_payment`, qui AJOUTAIT le montant.
 *
 * La preuve de bout en bout (serveur réel, événements signés, base de staging)
 * est dans le rapport ; ce fichier garde les deux règles en CI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientEnregistreur } from './quarantaine/automation/_enregistreur';

const etat: { client: any } = { client: null };
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => etat.client }));
const emis: Array<{ type: string; entityId: string }> = [];
vi.mock('../server/lib/eventBus', () => ({
  eventBus: { emit: (type: string, e: { entityId: string }) => { emis.push({ type, entityId: e.entityId }); } },
}));

import { insertOrUpdatePaymentIdempotent } from '../server/lib/payments';

const ORG = '11111111-1111-4111-8111-111111111111';
const FACTURE = '22222222-2222-4222-8222-222222222222';

/** Le monde vu APRÈS l'insertion : le trigger a déjà posé le statut de la facture. */
function monde(statutRecalcule: string) {
  return clientEnregistreur({
    payments: (req) => (req.op === 'insert' ? { data: { id: 'paiement-1' } } : { data: null }),
    invoices: { data: { created_by: 'u-1', status: statutRecalcule } },
    memberships: { data: { user_id: 'u-1' } },
  });
}

const paiement = (cents: number) => ({
  org_id: ORG, invoice_id: FACTURE, client_id: null, job_id: null,
  provider: 'stripe' as const, provider_payment_id: 'pi_1', provider_event_id: 'evt_1',
  status: 'succeeded' as const, method: 'card', amount_cents: cents, currency: 'CAD',
});

beforeEach(() => { emis.length = 0; });

describe('« Facture payée » seulement quand elle l’est (C18)', () => {
  it('acompte : la facture reste partielle → aucun invoice.paid', async () => {
    etat.client = monde('partial').client;
    await insertOrUpdatePaymentIdempotent(paiement(4000));
    expect(emis.filter((e) => e.type === 'invoice.paid')).toEqual([]);
  });

  it('dernier paiement : la facture est soldée → un invoice.paid', async () => {
    etat.client = monde('paid').client;
    await insertOrUpdatePaymentIdempotent(paiement(6000));
    expect(emis).toEqual([{ type: 'invoice.paid', entityId: FACTURE }]);
  });

  it('statut illisible → rien d’émis plutôt qu’un faux « payée »', async () => {
    etat.client = clientEnregistreur({
      payments: (req) => (req.op === 'insert' ? { data: { id: 'paiement-1' } } : { data: null }),
      invoices: (req) => (req.filtres.length && req.op === 'select' && req.table === 'invoices'
        ? { data: null, error: { message: 'connexion perdue' } } : { data: null }),
      memberships: { data: { user_id: 'u-1' } },
    }).client;
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    await insertOrUpdatePaymentIdempotent(paiement(6000));
    expect(emis).toEqual([]);
    erreurs.mockRestore();
  });
});

describe('le webhook Stripe n’ajoute pas le paiement une seconde fois (C16/C17)', () => {
  it('le chemin Stripe relit la facture au lieu d’appeler apply_invoice_payment', () => {
    const source = readFileSync(join(__dirname, '..', 'server', 'routes', 'payments.ts'), 'utf8');
    // `apply_invoice_payment` ADDITIONNE : après insertOrUpdatePaymentIdempotent
    // (dont le trigger a déjà recalculé la facture), il compte le paiement deux fois.
    expect(source).not.toMatch(/rpc\(\s*['"]apply_invoice_payment['"]/);
  });
});
