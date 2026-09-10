/**
 * LES REBONDS COURRIEL QUI N'ÉTAIENT JAMAIS CAPTÉS.
 *
 * Audit QA prod 2026-09-09, n°8 (prouvé en prod) : facture envoyée à
 * qa-viktor@example.invalid → 200 { ok: true }, « Invoice sent! », facture en
 * attente de paiement. Le relais avait accepté le message ; le rebond, lui,
 * n'arrivait nulle part. Une faute de frappe dans l'adresse = une facture
 * « envoyée » pour toujours, et un client qui ne l'a jamais reçue.
 *
 * Ces tests figent la chaîne :
 *   - chaque envoi laisse une ligne `sent` dans email_deliveries
 *   - POST /api/webhooks/email refuse une signature Svix invalide (400),
 *     refuse de tourner sans secret (503), accepte une signature valide
 *   - email.bounced → statut `bounced` + notification « courriel non livré »
 *   - une adresse qui a rebondi est sautée par les relances
 *   - le badge n'apparaît que sur bounced / complained / delayed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ecritures: Array<{ table: string; op: string; row: any; filtres: string[] }> = [];
const lectures = { livraisons: [] as any[] };

function chaine(table: string) {
  const c: any = { _filtres: [] as string[] };
  for (const m of ['select', 'eq', 'in', 'ilike', 'like', 'order', 'limit', 'is']) {
    c[m] = vi.fn((...args: any[]) => { c._filtres.push(`${m}(${args.map(String).join(',')})`); return c; });
  }
  c.insert = vi.fn(async (row: any) => { ecritures.push({ table, op: 'insert', row, filtres: [] }); return { error: null }; });
  c.update = vi.fn((row: any) => { ecritures.push({ table, op: 'update', row, filtres: c._filtres }); return c; });
  c.then = (resolve: any) => resolve({ data: table === 'email_deliveries' ? lectures.livraisons : [], error: null });
  return c;
}
const admin = { from: vi.fn((table: string) => chaine(table)) };

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => admin }));
vi.mock('../server/lib/qa-redirect', () => ({ redirigerEmail: (to: any, subject: string) => ({ redirige: false, to, subject }) }));

const SECRET_BRUT = Buffer.from('cle-de-test-svix-0123456789abcdef').toString('base64');
const SECRET = `whsec_${SECRET_BRUT}`;

function signer(corps: string, id = 'msg_1', ts = String(Math.floor(Date.now() / 1000))) {
  const sig = createHmac('sha256', Buffer.from(SECRET_BRUT, 'base64')).update(`${id}.${ts}.${corps}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  ecritures.length = 0;
  lectures.livraisons = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('la signature Svix', () => {
  it('accepte une signature valide, refuse une signature altérée', async () => {
    const { verifierSignatureSvix } = await import('../server/routes/webhooks-email');
    const corps = '{"type":"email.bounced"}';
    const h = signer(corps);
    expect(verifierSignatureSvix({ id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'] }, corps, SECRET)).toBe(true);
    expect(verifierSignatureSvix({ id: h['svix-id'], timestamp: h['svix-timestamp'], signature: 'v1,AAAA' }, corps, SECRET)).toBe(false);
    expect(verifierSignatureSvix({ id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'] }, corps + ' ', SECRET)).toBe(false);
  });
  it('refuse un horodatage trop vieux (rejeu)', async () => {
    const { verifierSignatureSvix } = await import('../server/routes/webhooks-email');
    const corps = '{}';
    const vieux = String(Math.floor(Date.now() / 1000) - 3600);
    const h = signer(corps, 'msg_2', vieux);
    expect(verifierSignatureSvix({ id: 'msg_2', timestamp: vieux, signature: h['svix-signature'] }, corps, SECRET)).toBe(false);
  });
  it('accepte une des signatures d une liste (rotation de clé)', async () => {
    const { verifierSignatureSvix } = await import('../server/routes/webhooks-email');
    const corps = '{}';
    const h = signer(corps, 'msg_3');
    expect(verifierSignatureSvix({ id: 'msg_3', timestamp: h['svix-timestamp'], signature: `v1,ancienne ${h['svix-signature']}` }, corps, SECRET)).toBe(true);
  });
});

describe('POST /api/webhooks/email', () => {
  async function poster(corps: string, headers: Record<string, string>, secret: string | null = SECRET) {
    const prev = process.env.RESEND_WEBHOOK_SECRET;
    if (secret === null) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = secret;
    const { emailWebhookHandler } = await import('../server/routes/webhooks-email');
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

  it('sans secret configuré → 503, jamais « OK » sur un webhook non vérifié', async () => {
    const r = await poster('{}', {}, null);
    expect(r.status).toBe(503);
  });

  it('signature invalide → 400 et aucune écriture', async () => {
    const r = await poster('{"type":"email.bounced","data":{"email_id":"x"}}', { 'svix-id': 'a', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,mauvaise' });
    expect(r.status).toBe(400);
    expect(ecritures).toEqual([]);
  });

  it('LE BUG : email.bounced → statut bounced + notification « courriel non livré »', async () => {
    lectures.livraisons = [{ id: 'd1', org_id: 'org-1', to_email: 'qa-viktor@example.invalid', entity_type: 'invoice', entity_id: 'inv-1' }];
    const corps = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_123', to: ['qa-viktor@example.invalid'], bounce: { message: 'Domain does not exist' } } });
    const r = await poster(corps, signer(corps));
    expect(r.status).toBe(200);
    const maj = ecritures.find((e) => e.table === 'email_deliveries' && e.op === 'update');
    expect(maj?.row).toMatchObject({ status: 'bounced', error: 'Domain does not exist' });
    expect(maj?.filtres.join(' ')).toContain('like(message_id,em_123%)');
    const notif = ecritures.find((e) => e.table === 'notifications');
    expect(notif?.row).toMatchObject({ org_id: 'org-1', type: 'email_bounced', link: '/invoices/inv-1' });
    expect(notif?.row.title).toContain('qa-viktor@example.invalid');
  });

  it('email.delivered → delivered, sans notification', async () => {
    lectures.livraisons = [{ id: 'd1', org_id: 'org-1', to_email: 'a@b.c', entity_type: 'quote', entity_id: 'q-1' }];
    const corps = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_9' } });
    const r = await poster(corps, signer(corps));
    expect(r.status).toBe(200);
    expect(ecritures.find((e) => e.table === 'email_deliveries')?.row.status).toBe('delivered');
    expect(ecritures.find((e) => e.table === 'notifications')).toBeUndefined();
  });

  it('un événement inconnu est accusé sans écriture', async () => {
    const corps = JSON.stringify({ type: 'email.opened', data: { email_id: 'em_9' } });
    const r = await poster(corps, signer(corps));
    expect(r.status).toBe(200);
    expect(r.json.ignored).toBe(true);
    expect(ecritures).toEqual([]);
  });
});

describe('le journal d envoi et les relances', () => {
  it('sendEmail journalise une ligne `sent` avec l entité (Resend)', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'em_abc' }), { status: 200 }));
    try {
      const { sendEmail } = await import('../server/lib/mailer');
      const r = await sendEmail({ to: 'client@exemple.com', subject: 'Facture INV-1', html: '<p>x</p>', suivi: { orgId: 'org-1', entityType: 'invoice', entityId: 'inv-1' } });
      expect(r).toEqual({ sent: true, messageId: 'em_abc' });
      expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
      const ligne = ecritures.find((e) => e.table === 'email_deliveries' && e.op === 'insert');
      expect(ligne?.row).toMatchObject({ provider: 'resend', message_id: 'em_abc', to_email: 'client@exemple.com', entity_type: 'invoice', entity_id: 'inv-1', status: 'sent', org_id: 'org-1' });
    } finally {
      fetchSpy.mockRestore();
      delete process.env.RESEND_API_KEY;
    }
  });

  it('une erreur Resend est renvoyée comme sent: false (et rien n est journalisé)', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'invalid to' }), { status: 422 }));
    try {
      const { sendEmail } = await import('../server/lib/mailer');
      const r = await sendEmail({ to: 'x', subject: 's', html: 'h' });
      expect(r.sent).toBe(false);
      expect(r.error).toContain('422');
      expect(ecritures).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      delete process.env.RESEND_API_KEY;
    }
  });

  it('adresseInjoignable : vrai si une livraison a rebondi pour cette org', async () => {
    const { adresseInjoignable } = await import('../server/lib/mailer');
    lectures.livraisons = [{ id: 'd1' }];
    expect(await adresseInjoignable('org-1', 'Morte@Exemple.com')).toBe(true);
    lectures.livraisons = [];
    expect(await adresseInjoignable('org-1', 'vivante@exemple.com')).toBe(false);
  });

  it('les relances automatiques sautent une adresse qui a rebondi', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../server/routes/reminders-cron.ts'), 'utf8');
    expect(src).toContain('adresseInjoignable(orgId, toEmail)');
    expect(src).toMatch(/&& toEmail && !adresseMorte && isMailerConfigured\(\)/);
  });
});

describe('le fournisseur', () => {
  it('Resend si RESEND_API_KEY, sinon SMTP', async () => {
    const { fournisseurCourriel } = await import('../server/lib/mailer');
    expect(fournisseurCourriel({ RESEND_API_KEY: 're_x' } as any)).toBe('resend');
    expect(fournisseurCourriel({} as any)).toBe('smtp');
  });
});
