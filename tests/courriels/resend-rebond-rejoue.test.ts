/**
 * Vague 3 (audit V2, C2, Faible) — un rebond Resend rejoué avec le même
 * svix-id créait une DEUXIÈME notification « Courriel non livré »
 * (preuve de l'audit : 3 notifications pour 2 événements).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { clientEnregistreur, requetes } from '../automation/filet-regression/_enregistreur';

const etat = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../server/lib/supabase', () => ({ getServiceClient: () => etat.client }));

const SECRET_BRUT = Buffer.from('cle-de-test-svix-vague3-0123456789').toString('base64');
const SECRET = `whsec_${SECRET_BRUT}`;
const signer = (corps: string, id: string) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(SECRET_BRUT, 'base64')).update(`${id}.${ts}.${corps}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
};

/** `webhook_receipts` avec mémoire : ce qui a été inséré est relu. */
function monde() {
  const recus: Array<{ reference: string; outcome: string }> = [];
  const r = clientEnregistreur({
    email_deliveries: { data: [{ id: 'd1', org_id: 'org-1', to_email: 'client@example.invalid', entity_type: 'invoice', entity_id: 'inv-1' }] },
    memberships: { data: [] },
    webhook_receipts: (req) => {
      if (req.op === 'insert') { recus.push(req.valeur as { reference: string; outcome: string }); return { data: null }; }
      const ref = req.filtres.find(([m, c]) => m === 'eq' && c === 'reference')?.[2];
      return { data: recus.filter((x) => x.reference === ref && x.outcome === 'counted').map(() => ({ id: 'r' })) };
    },
  });
  etat.client = r.client;
  return r.journal;
}

async function poster(corps: string, headers: Record<string, string>) {
  const prev = process.env.RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  const { emailWebhookHandler } = await import('../../server/routes/webhooks-email');
  const app = express();
  app.post('/api/webhooks/email', express.raw({ type: 'application/json' }), emailWebhookHandler);
  const srv = app.listen(0);
  try {
    const { port } = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: corps });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    srv.close();
    if (prev === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = prev;
  }
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('C2 — rebond Resend rejoué', () => {
  it('le même svix-id deux fois : UNE notification, le 2e est un doublon', async () => {
    const journal = monde();
    const corps = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_1', bounce: { message: 'Mailbox does not exist' } } });
    const r1 = await poster(corps, signer(corps, 'msg_rebond'));
    const r2 = await poster(corps, signer(corps, 'msg_rebond'));
    expect(r1.status).toBe(200);
    expect(r2.json).toMatchObject({ duplicate: true });
    expect(requetes(journal, 'notifications', 'insert')).toHaveLength(1);
    expect(requetes(journal, 'email_deliveries', 'update')).toHaveLength(1);
  });

  it('deux rebonds DIFFÉRENTS : deux notifications', async () => {
    const journal = monde();
    const corps = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_1' } });
    await poster(corps, signer(corps, 'msg_a'));
    await poster(corps, signer(corps, 'msg_b'));
    expect(requetes(journal, 'notifications', 'insert')).toHaveLength(2);
  });
});
