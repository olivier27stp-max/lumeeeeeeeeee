/**
 * Taxes des devis et factures créés par Lumi (audit des outils, 2026-09-30).
 * Avant : la carte affichait TPS + TVQ (114,98 $) et la facture était créée à
 * 100 $ (tax_cents du modèle, 0 par défaut) ; le devis prenait 14,975 % pour
 * tout le monde. Maintenant la carte et l'outil passent par taxesPourDocument.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { etat } = vi.hoisted(() => ({
  etat: {
    taxes: [] as any[],
    exempt: false,
    rpc: [] as Array<[string, any]>,
    ecritures: [] as Array<[string, string, any]>,
    devis: {} as Record<string, any>,
    dejaExistante: false,
  },
}));

vi.mock('../server/lib/taxResolve', async (importActual) => ({
  ...(await importActual<typeof import('../server/lib/taxResolve')>()),
  resolveTaxesForOrg: async () => ({ taxes: etat.taxes, group: null, region: 'QC', exempt: etat.exempt }),
}));

// Service (agent_actions) : insertion toujours acceptée.
const service = () => {
  const q: any = {};
  for (const m of ['select', 'eq', 'update', 'delete']) q[m] = () => q;
  q.insert = () => q;
  q.maybeSingle = async () => ({ data: { id: 'a1' }, error: null });
  q.single = q.maybeSingle;
  q.then = (ok: any) => Promise.resolve({ data: null, error: null }).then(ok);
  return q;
};
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({ from: service }), companyOrgIds: async () => [] }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: () => {} }));
vi.mock('../server/lib/lumi/version-org', () => ({ invaliderOrg: async () => {}, versionOrg: async () => 0 }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));

import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { apercuProposition } from '../server/lib/lumi/fiches';

// Client de l'utilisateur : enregistre RPC et écritures ; le devis recalculé imite rpc_recalculate_quote.
const client: any = {
  rpc: async (fn: string, p: any) => {
    etat.rpc.push([fn, p]);
    if (fn === 'rpc_create_invoice_draft') return { data: { id: 'inv1' }, error: null };
    if (fn === 'rpc_create_quote') return { data: { quote_id: 'q1' }, error: null };
    if (fn === 'finish_job_and_prepare_invoice') return { data: [{ ok: true, invoice_id: 'inv9', already_exists: etat.dejaExistante }], error: null };
    if (fn === 'rpc_recalculate_quote') {
      const sub = etat.devis.subtotal_cents;
      const tax = Math.round(sub * (etat.devis.tax_rate ?? 14.975) / 100);
      Object.assign(etat.devis, { tax_cents: tax, total_cents: sub + tax, quote_number: 'Q-0001' });
    }
    return { data: null, error: null };
  },
  from: (table: string) => {
    const q: any = {};
    let op = 'select';
    let val: any = null;
    q.select = () => q; q.eq = () => q; q.is = () => q; q.in = () => q; q.order = () => q; q.limit = () => q;
    q.update = (v: any) => { op = 'update'; val = v; return q; };
    q.insert = (v: any) => { op = 'insert'; val = v; return q; };
    q.delete = () => { op = 'delete'; return q; };
    const fin = () => {
      if (op !== 'select') etat.ecritures.push([table, op, val]);
      if (table === 'quotes' && op === 'update') Object.assign(etat.devis, val);
      if (table === 'quote_line_items' && op === 'insert') etat.devis.subtotal_cents = (val as any[]).reduce((s, l) => s + l.total_cents, 0);
      if (table === 'quotes' && op === 'select') return { data: { ...etat.devis }, error: null };
      if (table === 'clients') return { data: { first_name: 'Marie', last_name: 'Tremblay' }, error: null };
      if (table === 'jobs') return { data: { total_cents: 20000, title: 'Vitres', job_number: 7 }, error: null };
      if (table === 'invoices' && op === 'select') return { data: { client_id: C1, status: 'draft', subtotal_cents: 20000, discount_cents: 0, tax_cents: 0 }, error: null };
      return { data: null, error: null };
    };
    q.maybeSingle = async () => fin();
    q.then = (ok: any) => Promise.resolve(fin()).then(ok);
    return q;
  },
};
const ctx = { client, orgId: 'org', userId: 'u' };
const QC = [{ id: 't1', name: 'TPS', rate: 5, is_active: true }, { id: 't2', name: 'TVQ', rate: 9.975, is_active: true }];
const C1 = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  etat.taxes = QC; etat.exempt = false; etat.rpc = []; etat.ecritures = []; etat.devis = {}; etat.dejaExistante = false;
});

describe('create_invoice : les taxes de la carte sont celles de la facture', () => {
  const args = { client_id: C1, items: [{ description: 'Lavage', qty: 1, unit_price_cents: 10000 }] };

  it('carte 114,98 $ = facture 114,98 $ (TPS 5,00 $ + TVQ 9,98 $), ventilation enregistrée', async () => {
    const carte: any = await apercuProposition('create_invoice', args, ctx);
    const r: any = await TOOLS_BY_NAME.create_invoice.handler(args, ctx as any);
    expect(carte.total_cents).toBe(11498);
    expect(r).toMatchObject({ created: true, subtotal_cents: 10000, tax_cents: 1498, total_cents: 11498 });
    const save = etat.rpc.find(([fn]) => fn === 'rpc_save_invoice_draft')![1];
    expect(save.p_tax_cents).toBe(1498);
    const ventilation = etat.ecritures.find(([t, op]) => t === 'applied_taxes' && op === 'insert')![2];
    expect(ventilation.map((l: any) => [l.name, l.amount_cents])).toEqual([['TPS', 500], ['TVQ', 998]]);
  });

  it('un tax_cents inventé par le modèle est ignoré ; no_taxes et client exempté = 0', async () => {
    const r: any = await TOOLS_BY_NAME.create_invoice.handler({ ...args, tax_cents: 99999 }, ctx as any);
    expect(r.tax_cents).toBe(1498);
    const sans: any = await TOOLS_BY_NAME.create_invoice.handler({ ...args, no_taxes: true, client_id: '22222222-2222-4222-8222-222222222222' }, ctx as any);
    expect(sans).toMatchObject({ tax_cents: 0, total_cents: 10000 });
    etat.taxes = []; etat.exempt = true;
    const ex: any = await TOOLS_BY_NAME.create_invoice.handler({ ...args, client_id: '33333333-3333-4333-8333-333333333333' }, ctx as any);
    expect(ex).toMatchObject({ tax_cents: 0, total_cents: 10000 });
  });
});

describe('create_quote : taux du client, total annoncé = total enregistré', () => {
  it('Ontario (TVH 13 %) : le devis prend 13 %, pas 14,975 % ; total taxes incluses', async () => {
    etat.taxes = [{ id: 'h', name: 'TVH', rate: 13, is_active: true }];
    const args = { client_id: C1, title: 'Vitres', line_items: [{ name: 'Vitres', quantity: 2, unit_price_cents: 10000 }] };
    const carte: any = await apercuProposition('create_quote', args, ctx);
    const r: any = await TOOLS_BY_NAME.create_quote.handler(args, ctx as any);
    expect(etat.devis.tax_rate).toBe(13);
    expect(r).toMatchObject({ subtotal_cents: 20000, tax_cents: 2600, total_cents: 22600, quote_number: 'Q-0001' });
    expect(carte.total_cents).toBe(r.total_cents);
  });

  it('Québec : TPS + TVQ, ventilation égale à la taxe enregistrée', async () => {
    const r: any = await TOOLS_BY_NAME.create_quote.handler({ client_id: C1, title: 'X', line_items: [{ name: 'X', quantity: 1, unit_price_cents: 43000 }] }, ctx as any);
    expect(r.tax_cents).toBe(6439);
    expect(r.taxes.reduce((s: number, t: any) => s + t.montant_cents, 0)).toBe(r.tax_cents);
  });
});

describe('create_invoice_from_job : la facture du job porte les taxes du client', () => {
  it('la RPC crée la facture à 0 $ de taxes : l’outil pose TPS + TVQ sur le brouillon', async () => {
    const r: any = await TOOLS_BY_NAME.create_invoice_from_job.handler({ job_id: 'J1' }, ctx as any);
    const maj = etat.ecritures.find(([t, op]) => t === 'invoices' && op === 'update')![2];
    expect(maj).toEqual({ tax_cents: 2995 });
    expect(r).toMatchObject({ created: true, subtotal_cents: 20000, tax_cents: 2995, total_cents: 22995 });
  });
  it('une facture existait déjà : désignée, jamais retaxée ni présentée comme créée', async () => {
    etat.dejaExistante = true;
    const r: any = await TOOLS_BY_NAME.create_invoice_from_job.handler({ job_id: 'J2' }, ctx as any);
    expect(r).toMatchObject({ created: false, deja_existante: true });
    expect(etat.ecritures.some(([t, op]) => t === 'invoices' && op === 'update')).toBe(false);
  });
});
