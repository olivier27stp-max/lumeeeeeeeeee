/**
 * Launch 2026-09-28 — une facture en retard = UNE relance, pas trois.
 *
 * Le cron « Rappels de paiement », le parcours « Relance de facture » du pack
 * et une automatisation « Facture en retard » relançaient la même facture
 * sans se coordonner. Quand une automatisation PUBLIÉE couvre la facture,
 * le cron la saute. On joue la VRAIE route du cron sur une base simulée.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const etat = vi.hoisted(() => ({ client: null as any, courriels: [] as any[] }));
vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client }));
vi.mock('../../server/lib/advisory-lock', () => ({ withAdvisoryLock: async (_n: string, fn: () => Promise<unknown>) => ({ acquired: true, result: await fn() }) }));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: vi.fn(async (p: any) => { etat.courriels.push(p); return { sent: true, messageId: 'm' }; }),
}));
vi.mock('../../server/lib/stripe-connect', async (orig) => ({ ...(await orig<any>()), createPaymentRequest: async () => { throw new Error('pas de Stripe'); } }));
vi.mock('../../server/lib/courriels/modeles', async (orig) => ({ ...(await orig<any>()), texteDuCourriel: async () => null }));
vi.mock('../../server/routes/emails', async (orig) => ({
  ...(await orig<any>()),
  getCompanySettings: async () => ({ company_name: 'Lavage Test', default_language: 'fr' }),
  senderForOrg: async () => ({ from: 'Lavage Test <no-reply@lume.test>' }),
}));

import { clientEnregistreur } from './filet-regression/_enregistreur';
import router from '../../server/routes/reminders-cron';

const ORG = '11111111-1111-4111-8111-111111111111';
const FACTURE = { id: 'aaaaaaaa-0000-4000-8000-000000000005', org_id: ORG, client_id: 'c1', invoice_number: 'INV-042', total_cents: 50000, balance_cents: 50000, currency: 'CAD', due_date: new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10), status: 'sent', subject: null };

function monde(regles: any[], tachesPack: any[]) {
  return clientEnregistreur({
    reminder_settings: { data: [{ org_id: ORG, schedule: [{ days_after_due: 3, channel: 'email' }], enabled: true, custom_email_subject: null, custom_email_body: null, custom_sms_body: null }] },
    company_settings: { data: [{ company_name: 'Lavage Test', email: 'info@lavage.test', phone: null }] },
    invoices: { data: [FACTURE] },
    reminder_log: (req) => (req.op === 'select' ? { data: [] } : { data: [{ id: 'log' }] }),
    clients: { data: [{ id: 'c1', first_name: 'Marie', last_name: 'Tremblay', email: 'marie@exemple.test', phone: null }] },
    automation_rules: { data: regles },
    automation_scheduled_tasks: { data: tachesPack },
  }).client;
}

let url = '';
const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/cron/payment-reminders`;
afterAll(() => serveur.close());
process.env.CRON_SECRET = 'secret-test';
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';

const lancer = () => fetch(url, { method: 'POST', headers: { 'x-cron-secret': 'secret-test', 'content-type': 'application/json' } });

// Midi à Toronto, le jour même : une relance de paiement ne part que dans la fenêtre d'envoi de l'entreprise
// (8 h-20 h, mission finale, point 11) — sans horloge figée, ce fichier échouait le soir.
const MIDI = new Date(`${new Date().toISOString().slice(0, 10)}T16:00:00Z`);
beforeEach(() => {
  etat.courriels.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIDI);
});
afterEach(() => vi.useRealTimers());

describe('relance de facture : une seule source', () => {
  it('sans automatisation de relance publiée : le cron relance (comme avant)', async () => {
    etat.client = monde([], []);
    expect((await lancer()).status).toBe(200);
    expect(etat.courriels).toHaveLength(1);
  });

  it('parcours « Relance de facture » publié et engagé pour cette facture : le cron ne relance PAS', async () => {
    etat.client = monde([{ id: 'pack', trigger_event: 'invoice.sent', preset_key: 'pack_relance_facture', conditions: {} }], [{ id: 't1' }]);
    expect((await lancer()).status).toBe(200);
    expect(etat.courriels).toHaveLength(0);
  });

  it('automatisation « Facture en retard » publiée : le cron ne relance PAS', async () => {
    etat.client = monde([{ id: 'retard', trigger_event: 'invoice.overdue', preset_key: null, conditions: {} }], []);
    expect((await lancer()).status).toBe(200);
    expect(etat.courriels).toHaveLength(0);
  });

  it('« Facture en retard » limitée aux gros montants (≥ 1 000 $) : la facture de 500 $ reste relancée par le cron', async () => {
    etat.client = monde([{ id: 'retard', trigger_event: 'invoice.overdue', preset_key: null, conditions: { montant__gte: 1000 } }], []);
    expect((await lancer()).status).toBe(200);
    expect(etat.courriels).toHaveLength(1);
  });
});
