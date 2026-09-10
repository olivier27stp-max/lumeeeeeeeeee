/**
 * LE LIEN DE FACTURE QUI MENAIT À « SOUMISSION INTROUVABLE ».
 *
 * Audit QA prod du 2026-09-09, n°1 (prouvé en prod) : le bouton « Link »
 * d'une facture copiait /q/<view_token> ; la redirection envoyait vers
 * /quote/<token> ; la page de devis demandait /api/quotes/public/<token>, qui
 * cherche dans `quotes`. Un jeton de facture n'y est jamais : 404 pour TOUTES
 * les factures. Pire : la redirection comptait une vue avant de savoir si la
 * page allait s'afficher — le CRM disait « le client a ouvert la facture »,
 * l'entreprise ne relançait pas, et le client, lui, voyait « lien expiré ».
 *
 * Ces tests figent :
 *   - GET /api/invoices/public/:token sert la facture (lignes, client,
 *     branding, lien de paiement) sans exposer org_id
 *   - le suivi de vue est écrit quand la facture est SERVIE, jamais sur un 404
 *   - /q/:token redirige vers /invoice/:token et n'écrit rien
 *   - /invoice/ est reconnu comme page publique par le routeur et la porte mobile
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const TOKEN = '07c6fc57-8185-4c58-87b4-cd41fea70493';
const ORG = '11111111-2222-3333-4444-555555555555';

const ecritures: Array<{ table: string; op: string; row?: any }> = [];
const monde = { facture: null as any, items: [] as any[], client: null as any, payReq: null as any };

function chaine(table: string) {
  const c: any = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[m] = vi.fn(() => c);
  c.update = vi.fn((row: any) => { ecritures.push({ table, op: 'update', row }); return c; });
  c.insert = vi.fn(async (row: any) => { ecritures.push({ table, op: 'insert', row }); return { error: null }; });
  c.maybeSingle = vi.fn(async () => {
    if (table === 'invoices') return { data: monde.facture, error: null };
    if (table === 'clients') return { data: monde.client, error: null };
    if (table === 'payment_requests') return { data: monde.payReq, error: null };
    if (table === 'company_settings') return { data: { company_name: 'Coquin Lavage', brand_color: '#123456' }, error: null };
    return { data: null, error: null };
  });
  c.then = (resolve: any) => resolve(table === 'invoice_items' ? { data: monde.items, error: null } : { data: null, error: null });
  return c;
}
const admin = { from: vi.fn((table: string) => chaine(table)) };

vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => admin,
  requireAuthedClient: async () => null,
}));
vi.mock('../server/lib/companyBranding', () => ({
  getCompanyBranding: async () => ({ company_name: 'Coquin Lavage', logo_url: null, brand_color: '#123456' }),
}));
vi.mock('../server/lib/config', () => ({
  getBaseUrl: () => 'https://lumecrm.net',
  emailFrom: 'x@y', twilioClient: null, getTwilioStatusCallbackUrl: () => '',
}));

const { default: invoicesPublicRouter } = await import('../server/routes/invoices-public');

async function serveur() {
  const app = express();
  app.use(express.json());
  app.use('/api', invoicesPublicRouter);
  const srv = app.listen(0);
  const { port } = srv.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => srv.close() };
}

beforeEach(() => {
  vi.clearAllMocks();
  ecritures.length = 0;
  monde.facture = {
    id: 'inv-1', org_id: ORG, client_id: 'cli-1', invoice_number: 'INV-0001', status: 'sent',
    subject: 'Lavage', issued_at: '2026-09-01T00:00:00Z', due_date: '2026-09-30', sent_at: null, paid_at: null,
    subtotal_cents: 50000, discount_cents: 0, tax_cents: 7488, total_cents: 57488, paid_cents: 0, balance_cents: 57488,
    currency: 'CAD', notes: null, is_viewed: false, view_count: 0,
  };
  monde.items = [{ id: 'it-1', title: 'Lavage', description: null, qty: 1, unit_price_cents: 50000, line_total_cents: 50000, sort_order: 0 }];
  monde.client = { first_name: 'QA', last_name: 'Viktor', company: null, email: 'qa@example.test', phone: null };
  monde.payReq = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/invoices/public/:token', () => {
  it('LE BUG : la facture est servie (avant, aucune route publique n existait)', async () => {
    const s = await serveur();
    try {
      const res = await fetch(`${s.base}/api/invoices/public/${TOKEN}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invoice.invoice_number).toBe('INV-0001');
      expect(body.invoice.total_cents).toBe(57488);
      expect(body.items).toHaveLength(1);
      expect(body.client.first_name).toBe('QA');
      expect(body.company.company_name).toBe('Coquin Lavage');
      expect(body.pay_token).toBeNull();
    } finally { s.close(); }
  });

  it('n expose ni org_id ni client_id au client', async () => {
    const s = await serveur();
    try {
      const body = await (await fetch(`${s.base}/api/invoices/public/${TOKEN}`)).json();
      expect(body.invoice.org_id).toBeUndefined();
      expect(body.invoice.client_id).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(ORG);
    } finally { s.close(); }
  });

  it('le suivi de vue est écrit quand la facture est servie', async () => {
    const s = await serveur();
    try {
      await fetch(`${s.base}/api/invoices/public/${TOKEN}`);
      await new Promise((r) => setTimeout(r, 30));
      const maj = ecritures.find((e) => e.table === 'invoices' && e.op === 'update');
      expect(maj?.row).toMatchObject({ is_viewed: true, view_count: 1 });
      expect(ecritures.some((e) => e.table === 'quote_views' && e.op === 'insert')).toBe(true);
      // Première vue → notification « a ouvert la facture »
      const notif = ecritures.find((e) => e.table === 'notifications');
      expect(notif?.row.title).toContain('opened invoice INV-0001');
    } finally { s.close(); }
  });

  it('jeton inconnu → 404, et AUCUNE vue comptée (c était le second bug)', async () => {
    monde.facture = null;
    const s = await serveur();
    try {
      const res = await fetch(`${s.base}/api/invoices/public/${TOKEN}`);
      expect(res.status).toBe(404);
      await new Promise((r) => setTimeout(r, 30));
      expect(ecritures).toEqual([]);
    } finally { s.close(); }
  });

  it('jeton mal formé → 404 sans toucher la base', async () => {
    const s = await serveur();
    try {
      expect((await fetch(`${s.base}/api/invoices/public/pas-un-uuid`)).status).toBe(404);
      expect(admin.from).not.toHaveBeenCalled();
    } finally { s.close(); }
  });

  it('un lien de paiement actif expose son jeton → bouton Payer', async () => {
    monde.payReq = { public_token: 'pay-abc', status: 'sent', expires_at: null, amount_cents: 57488 };
    const s = await serveur();
    try {
      const body = await (await fetch(`${s.base}/api/invoices/public/${TOKEN}`)).json();
      expect(body.pay_token).toBe('pay-abc');
    } finally { s.close(); }
  });

  it('un lien de paiement expiré n est pas proposé', async () => {
    monde.payReq = { public_token: 'pay-old', status: 'sent', expires_at: '2020-01-01T00:00:00Z', amount_cents: 1 };
    const s = await serveur();
    try {
      const body = await (await fetch(`${s.base}/api/invoices/public/${TOKEN}`)).json();
      expect(body.pay_token).toBeNull();
    } finally { s.close(); }
  });
});

describe('la redirection /q/:token', () => {
  it('redirige vers /invoice/:token (plus /quote/) et n écrit rien', async () => {
    const { quoteRedirectRouter } = await import('../server/routes/quotes');
    const app = express();
    app.use('/', quoteRedirectRouter);
    const srv = app.listen(0);
    try {
      const { port } = srv.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/q/${TOKEN}`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`https://lumecrm.net/invoice/${TOKEN}`);
      await new Promise((r) => setTimeout(r, 30));
      expect(ecritures).toEqual([]);
    } finally { srv.close(); }
  });
});

describe('le front reconnaît /invoice/ comme page publique', () => {
  it('detectTokenKind et la porte mobile', async () => {
    const { detectTokenKind } = await import('../src/routes/TokenRoutes');
    const { estCheminPublic } = await import('../src/lib/mobileGate');
    expect(detectTokenKind(`/invoice/${TOKEN}`)).toBe('invoice');
    expect(estCheminPublic(`/invoice/${TOKEN}`)).toBe(true);
  });
  it('le préfixe API est public (RBAC + garde d abonnement)', async () => {
    const { PUBLIC_ROUTE_PREFIXES } = await import('../server/lib/route-permissions');
    expect(PUBLIC_ROUTE_PREFIXES).toContain('/api/invoices/public');
  });
});
