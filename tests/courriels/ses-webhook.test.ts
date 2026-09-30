/**
 * Vague 3 (audit V2) — le webhook SES de bout en bout (Express réel, base
 * simulée, aucun appel réseau).
 *
 *  C4 : un rebond (ou une plainte) SES prévient l'entreprise, exactement
 *       comme un rebond Resend : une notification « Courriel non livré » par
 *       propriétaire / administrateur, dans sa langue.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { clientEnregistreur, requetes, type Preparee } from '../automation/filet-regression/_enregistreur';

const etat = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../server/lib/supabase', () => ({ getServiceClient: () => etat.client }));

const JETON = 'jeton-ses-de-test-0123456789';
const prevJeton = process.env.SES_WEBHOOK_TOKEN;
process.env.SES_WEBHOOK_TOKEN = JETON;
afterAll(() => { if (prevJeton === undefined) delete process.env.SES_WEBHOOK_TOKEN; else process.env.SES_WEBHOOK_TOKEN = prevJeton; });

const LIVRAISON = { id: 'd1', org_id: 'org-b', to_email: 'client@example.invalid', entity_type: 'invoice', entity_id: 'inv-1' };
const GESTIONNAIRES = [
  { user_id: 'u-fr', role: 'owner', status: 'active', language: 'fr' },
  { user_id: 'u-en', role: 'admin', status: 'active', language: 'en' },
  { user_id: 'u-tech', role: 'technician', status: 'active', language: 'fr' },
];

function monde(extra: Record<string, Preparee> = {}) {
  const r = clientEnregistreur({
    email_deliveries: { data: [LIVRAISON] },
    memberships: { data: GESTIONNAIRES },
    webhook_receipts: { data: [] },
    ...extra,
  });
  etat.client = r.client;
  return r.journal;
}

const sns = (message: Record<string, unknown>, id = 'sns-1') => JSON.stringify({ Type: 'Notification', MessageId: id, Message: JSON.stringify(message) });
const rebond = (type: 'Permanent' | 'Transient' = 'Permanent') => ({
  notificationType: 'Bounce',
  mail: { messageId: '010001999abc-rebond', timestamp: '2026-09-30T12:00:00Z' },
  bounce: { bounceType: type, bouncedRecipients: [{ emailAddress: 'client@example.invalid', diagnosticCode: 'smtp; 550 5.1.1 user unknown' }] },
});

async function poster(corps: string) {
  const { sesWebhookHandler } = await import('../../server/routes/webhooks-ses');
  const app = express();
  app.post('/api/webhooks/ses', express.raw({ type: '*/*' }), sesWebhookHandler);
  const srv = app.listen(0);
  try {
    const { port } = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/ses?token=${JETON}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: corps });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    srv.close();
  }
}

const notifications = (journal: ReturnType<typeof monde>) =>
  requetes(journal, 'notifications', 'insert').flatMap((r) => (Array.isArray(r.valeur) ? r.valeur : [r.valeur])) as Array<Record<string, any>>;

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('C4 — un rebond SES prévient l’entreprise comme Resend', () => {
  it('rebond définitif : statut bounced + une notification par gestionnaire, dans sa langue', async () => {
    const journal = monde();
    const r = await poster(sns(rebond()));
    expect(r.status).toBe(200);
    expect(requetes(journal, 'email_deliveries', 'update')[0].valeur).toMatchObject({ status: 'bounced' });
    const n = notifications(journal);
    expect(n.map((x) => x.user_id).sort()).toEqual(['u-en', 'u-fr']);
    const fr = n.find((x) => x.user_id === 'u-fr')!;
    const en = n.find((x) => x.user_id === 'u-en')!;
    expect(fr).toMatchObject({ org_id: 'org-b', type: 'email_bounced', link: '/invoices/inv-1', title: 'Courriel non livré à client@example.invalid' });
    expect(en.title).toBe('Email not delivered to client@example.invalid');
    expect(fr.body).toContain('550 5.1.1');
  });

  it('plainte : « Plainte pourriel » / « Spam complaint »', async () => {
    const journal = monde();
    await poster(sns({ notificationType: 'Complaint', mail: { messageId: '010001999abc-plainte' }, complaint: { complainedRecipients: [{ emailAddress: 'client@example.invalid' }], complaintFeedbackType: 'abuse' } }, 'sns-2'));
    const n = notifications(journal);
    expect(n.find((x) => x.user_id === 'u-fr')?.title).toBe('Plainte pourriel de client@example.invalid');
    expect(n.find((x) => x.user_id === 'u-en')?.title).toBe('Spam complaint from client@example.invalid');
  });

  it('rebond transitoire (boîte pleine) : ni statut, ni notification', async () => {
    const journal = monde();
    await poster(sns(rebond('Transient'), 'sns-3'));
    expect(requetes(journal, 'email_deliveries', 'update')).toHaveLength(0);
    expect(notifications(journal)).toHaveLength(0);
  });

  it('livraison réussie : aucune notification', async () => {
    const journal = monde();
    await poster(sns({ notificationType: 'Delivery', mail: { messageId: '010001999abc-ok' }, delivery: { recipients: ['client@example.invalid'] } }, 'sns-4'));
    expect(notifications(journal)).toHaveLength(0);
  });
});

describe('C5 — une écriture ratée n’est plus perdue', () => {
  it('échec de mise à jour : 500 (SNS rejoue) et aucun accusé « counted »', async () => {
    const journal = monde({ email_deliveries: { data: null, error: { message: 'panne' } } });
    const r = await poster(sns(rebond(), 'sns-panne'));
    expect(r.status).toBe(500);
    expect(requetes(journal, 'webhook_receipts', 'insert')).toHaveLength(0);
    expect(notifications(journal)).toHaveLength(0);
  });

  it('succès : 200 et accusé consigné', async () => {
    const journal = monde();
    const r = await poster(sns(rebond(), 'sns-ok'));
    expect(r.status).toBe(200);
    expect(requetes(journal, 'webhook_receipts', 'insert')).toHaveLength(1);
  });
});
