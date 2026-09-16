/**
 * Outils « argent » de Lumi (server/lib/agent/tools-argent.ts) : devis,
 * factures, paiements — tout ce que l'utilisateur fait dans l'app et que
 * l'agent sait maintenant EXÉCUTER.
 *
 * Tout est simulé : un client Supabase chaînable qui journalise chaque appel
 * (table, filtres, corps), `appelInterne` et `executerIdempotent` remplacés.
 * On prouve, pour chaque écriture : le filtre `org_id` (ou le chemin de route
 * emprunté), la suppression DOUCE, le passage par executerIdempotent sous le
 * bon nom, et une note en français. Aucune base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  appelInterne: vi.fn(),
  executerIdempotent: vi.fn(),
  runOneSchedule: vi.fn(),
  admin: null as any,
}));

vi.mock('../server/lib/agent/tools-etendus', async (orig) => ({
  ...(await orig<typeof import('../server/lib/agent/tools-etendus')>()),
  appelInterne: h.appelInterne,
  executerIdempotent: h.executerIdempotent,
}));
vi.mock('../server/lib/supabase', async (orig) => ({
  ...(await orig<typeof import('../server/lib/supabase')>()),
  getServiceClient: () => h.admin,
}));
vi.mock('../server/lib/recurringInvoicesEngine', () => ({
  runOneSchedule: h.runOneSchedule,
  computeNextRunDate: vi.fn(),
}));

import { validerArgs } from '../server/lib/agent/validation-args';
import { AppelInterneIncertain } from '../server/lib/agent/tools-etendus';
import { OUTILS_ARGENT, REGISTRE_ARGENT, PERMISSIONS_ARGENT, TOPICS_ARGENT } from '../server/lib/agent/tools-argent';

/* ── Faux client Supabase chaînable + journal ───────────────────── */

type Op = [string, any[]];
interface Appel { table: string; ops: Op[] }
type Plan = (table: string, ops: Op[]) => any;

function fauxClient(plan: Plan = () => ({ data: null, error: null }), rpcPlan: (name: string, params: any) => any = () => ({ data: null, error: null })) {
  const journal: Appel[] = [];
  const rpcs: Array<{ name: string; params: any }> = [];
  const from = (table: string) => {
    const entree: Appel = { table, ops: [] };
    journal.push(entree);
    const p: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const r = Promise.resolve(plan(table, entree.ops));
          return r.then.bind(r);
        }
        return (...args: any[]) => { entree.ops.push([String(prop), args]); return p; };
      },
    });
    return p;
  };
  const rpc = async (name: string, params: any) => { rpcs.push({ name, params }); return rpcPlan(name, params); };
  return { client: { from, rpc } as any, journal, rpcs };
}

const ORG = 'org-1';
const ctxDe = (client: any) => ({ client, orgId: ORG, userId: 'user-1', accessToken: 'jeton' });
const a = (e: Appel, op: string) => e.ops.filter(([m]) => m === op).map(([, args]) => args);
const aFiltre = (e: Appel, op: string, ...args: any[]) => a(e, op).some((x) => JSON.stringify(x) === JSON.stringify(args));
const filtreOrg = (e: Appel) => aFiltre(e, 'eq', 'org_id', ORG);
const appels = (j: Appel[], table: string) => j.filter((e) => e.table === table);
const corps = (e: Appel, op: string) => a(e, op)[0]?.[0];
const outil = (nom: string) => {
  const t = OUTILS_ARGENT.find((o) => o.declaration.name === nom);
  if (!t?.handler) throw new Error(`outil ${nom} introuvable`);
  return t;
};
const lancer = (nom: string, args: Record<string, any>, client: any) => outil(nom).handler!(args, ctxDe(client) as any);
const estFrancais = (s: any) => typeof s === 'string' && /[éèêàçù]|\bdevis\b|\bfacture\b|\bpaiement\b|\bmodèle\b/i.test(s);

beforeEach(() => {
  h.appelInterne.mockReset();
  h.runOneSchedule.mockReset();
  h.executerIdempotent.mockReset();
  // Même contrat que le vrai : l'action tourne, une Error française devient { error }.
  h.executerIdempotent.mockImplementation(async (_ctx: any, _outil: string, _args: any, action: () => Promise<any>) => {
    try { return await action(); } catch (e: any) { return { error: String(e?.message || e) }; }
  });
  h.admin = fauxClient().client;
});

/* ═══════════════════════════════════════════════════════════════ */

describe('manifestes : outils, registre, permissions, topics', () => {
  const noms = OUTILS_ARGENT.map((t) => t.declaration.name);
  const ecritures = OUTILS_ARGENT.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

  it('38 outils aux noms uniques, tous avec handler, description en anglais', () => {
    expect(noms.length).toBe(38);
    expect(new Set(noms).size).toBe(noms.length);
    for (const t of OUTILS_ARGENT) {
      expect(typeof t.handler, t.declaration.name).toBe('function');
      expect(/[àéèêç]/.test(t.declaration.description || ''), `${t.declaration.name} : description en anglais`).toBe(false);
    }
  });

  it('chaque écriture est kind=write + needsIdentity ; le registre couvre exactement les écritures', () => {
    for (const t of OUTILS_ARGENT) if (t.kind === 'write') expect(t.needsIdentity, t.declaration.name).toBe(true);
    expect(Object.keys(REGISTRE_ARGENT).sort()).toEqual([...ecritures].sort());
    expect(ecritures.length).toBe(32);
  });

  it('envois et mouvements d argent : sensible + irréversible + vers le client', () => {
    for (const n of ['send_quote_sms', 'create_payment_request', 'resend_payment_request', 'refund_payment', 'charge_card_on_file']) {
      expect(REGISTRE_ARGENT[n], n).toEqual({ sensible: true, reversible: false, vers_client: true });
    }
    for (const [n, r] of Object.entries(REGISTRE_ARGENT)) if (r.vers_client) expect(r.reversible, n).toBe(false);
    expect(REGISTRE_ARGENT.record_invoice_payment).toEqual({ sensible: true, reversible: false, vers_client: false });
  });

  it('permissions : une clé par outil (lectures comprises), record_invoice_payment = même clé que mark_invoice_paid', () => {
    expect(Object.keys(PERMISSIONS_ARGENT).sort()).toEqual([...noms].sort());
    expect(PERMISSIONS_ARGENT.record_invoice_payment.cle).toBe('financial.view_payments');
    expect(PERMISSIONS_ARGENT.refund_payment.cle).toBe('payments.refund');
    expect(PERMISSIONS_ARGENT.update_reminder_settings.cle).toBe('settings.update');
    for (const p of Object.values(PERMISSIONS_ARGENT)) expect(p.capacite.length).toBeGreaterThan(3);
  });

  it('topics : tous les outils dans « facturation », une seule fois', () => {
    expect(Object.keys(TOPICS_ARGENT)).toEqual(['facturation']);
    expect([...(TOPICS_ARGENT.facturation || [])].sort()).toEqual([...noms].sort());
    expect(new Set(TOPICS_ARGENT.facturation).size).toBe(noms.length);
  });

  it('chaque déclaration accepte un exemple minimal conforme (sous-ensemble validerArgs)', () => {
    for (const t of OUTILS_ARGENT) {
      const p: any = t.declaration.parameters ?? { type: 'object', properties: {} };
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${t.declaration.name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });

  it('chaque écriture passe par executerIdempotent sous son propre nom', async () => {
    for (const t of OUTILS_ARGENT) {
      if (t.kind !== 'write') continue;
      h.executerIdempotent.mockClear();
      h.appelInterne.mockResolvedValue({ ok: true, status: 200, json: {} });
      const p: any = t.declaration.parameters;
      const args: Record<string, any> = {};
      for (const k of p.required ?? []) args[k] = p.properties?.[k]?.type === 'array' ? [] : p.properties?.[k]?.type === 'integer' ? 1 : 'x';
      await lancer(t.declaration.name, args, fauxClient().client);
      expect(h.executerIdempotent).toHaveBeenCalledTimes(1);
      expect(h.executerIdempotent.mock.calls[0][1]).toBe(t.declaration.name);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */

describe('devis', () => {
  const devis = { id: 'q1', quote_number: 'Q-0007', title: 'Lavage', status: 'draft', total_cents: 12500, valid_until: '2026-10-16' };

  it('update_quote : filtre org partout, remplace les articles (delete + insert avec org_id) et recalcule en base', async () => {
    const f = fauxClient((t) => ({ data: t === 'quotes' ? devis : null, error: null }));
    const r = await lancer('update_quote', { quote_id: 'q1', title: 'Lavage complet', line_items: [{ name: 'Vitres', quantity: 2, unit_price_cents: 5000 }] }, f.client);
    expect(r.updated).toBe(true);
    expect(estFrancais(r.note)).toBe(true);
    for (const e of appels(f.journal, 'quotes')) expect(filtreOrg(e)).toBe(true);
    const items = appels(f.journal, 'quote_line_items');
    expect(items.length).toBe(2);
    expect(aFiltre(items[0], 'eq', 'org_id', ORG) && aFiltre(items[0], 'eq', 'quote_id', 'q1') && a(items[0], 'delete').length === 1).toBe(true);
    expect(corps(items[1], 'insert')).toEqual([expect.objectContaining({ org_id: ORG, quote_id: 'q1', name: 'Vitres', quantity: 2, unit_price_cents: 5000, total_cents: 10000, sort_order: 0 })]);
    expect(f.rpcs).toEqual([{ name: 'rpc_recalculate_quote', params: { p_quote_id: 'q1' } }]);
    expect(corps(appels(f.journal, 'quotes')[1], 'update')).toMatchObject({ title: 'Lavage complet' });
  });

  it('update_quote : un devis converti ne se modifie plus ; sans champ → erreur claire', async () => {
    const f = fauxClient(() => ({ data: { ...devis, status: 'converted' }, error: null }));
    expect((await lancer('update_quote', { quote_id: 'q1', title: 'X' }, f.client)).error).toMatch(/converti/);
    const g = fauxClient(() => ({ data: devis, error: null }));
    expect((await lancer('update_quote', { quote_id: 'q1' }, g.client)).error).toMatch(/Aucun champ/);
  });

  it('delete_quote : suppression DOUCE (deleted_at + deleted_by), jamais un DELETE, filtrée org ; refus si converti', async () => {
    const f = fauxClient(() => ({ data: devis, error: null }));
    const r = await lancer('delete_quote', { quote_id: 'q1' }, f.client);
    expect(r.deleted).toBe(true);
    const maj = appels(f.journal, 'quotes')[1];
    expect(filtreOrg(maj)).toBe(true);
    expect(corps(maj, 'update')).toMatchObject({ deleted_by: 'user-1' });
    expect(corps(maj, 'update').deleted_at).toBeTruthy();
    expect(f.journal.some((e) => a(e, 'delete').length)).toBe(false);
    const g = fauxClient(() => ({ data: { ...devis, status: 'converted' }, error: null }));
    expect((await lancer('delete_quote', { quote_id: 'q1' }, g.client)).error).toMatch(/converti/);
  });

  it('unarchive_quote : restaure le statut d avant l archivage et journalise', async () => {
    const f = fauxClient((t, ops) => {
      if (t === 'quote_status_history') return { data: ops.some(([m]) => m === 'insert') ? null : { old_status: 'awaiting_response' }, error: null };
      return { data: { ...devis, status: ops.some(([m]) => m === 'update') ? 'awaiting_response' : 'archived' }, error: null };
    });
    const r = await lancer('unarchive_quote', { quote_id: 'q1' }, f.client);
    expect(r.restored).toBe(true);
    expect(r.quote.statut).toBe('en attente de réponse');
    const maj = appels(f.journal, 'quotes')[1];
    expect(filtreOrg(maj) && corps(maj, 'update').status === 'awaiting_response').toBe(true);
    expect(corps(appels(f.journal, 'quote_status_history')[1], 'insert')).toMatchObject({ quote_id: 'q1', old_status: 'archived', new_status: 'awaiting_response' });
  });

  it('send_quote_sms : emprunte POST /quotes/send-sms ; réponse perdue = incertain (pas de renvoi)', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true } });
    const r = await lancer('send_quote_sms', { quote_id: 'q1' }, fauxClient().client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG }), '/quotes/send-sms', { quoteId: 'q1' });
    expect(r).toMatchObject({ sent: true, channel: 'sms' });
    expect(estFrancais(r.note)).toBe(true);
    h.appelInterne.mockRejectedValueOnce(new AppelInterneIncertain('timeout'));
    const i = await lancer('send_quote_sms', { quote_id: 'q1' }, fauxClient().client);
    expect(i).toMatchObject({ incertain: true, sent: null });
    h.appelInterne.mockResolvedValueOnce({ ok: false, status: 409, json: { error: 'This recipient has opted out of SMS from your organization.' } });
    expect((await lancer('send_quote_sms', { quote_id: 'q1' }, fauxClient().client)).error).toMatch(/opted out/);
  });

  it('convert_quote_to_invoice : emprunte POST /quotes/convert-to-invoice et relit la facture filtrée org', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true, invoiceId: 'i9', quoteId: 'q1' } });
    const f = fauxClient(() => ({ data: { invoice_number: 'INV-0042', total_cents: 12500 }, error: null }));
    const r = await lancer('convert_quote_to_invoice', { quote_id: 'q1' }, f.client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.anything(), '/quotes/convert-to-invoice', { quoteId: 'q1' });
    expect(r).toMatchObject({ converted: true, invoice_id: 'i9', statut: 'brouillon', invoice: { invoice_number: 'INV-0042' } });
    expect(filtreOrg(appels(f.journal, 'invoices')[0])).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════ */

describe('pré-réglages et modèles de devis (table quote_templates)', () => {
  const modele = { id: 'p1', name: 'Résidentiel', services: [{ id: 's1', name: 'Vitres', quantity: 2, unit_price_cents: 5000, is_optional: false }], is_active: true, is_default: false };

  it('list_quote_presets : org + deleted_at, services SANS prix ; list_quote_templates : AVEC prix', async () => {
    const f = fauxClient(() => ({ data: [modele], error: null, count: 1 }));
    const r = await lancer('list_quote_presets', {}, f.client);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'is', 'deleted_at', null)).toBe(true);
    expect(r.presets[0].services[0]).toEqual({ name: 'Vitres', description: '', quantity: 2, is_optional: false });
    const g = fauxClient(() => ({ data: [modele], error: null, count: 1 }));
    const t = await lancer('list_quote_templates', { active_only: true }, g.client);
    expect(aFiltre(g.journal[0], 'eq', 'is_active', true)).toBe(true);
    expect(t.templates[0].services[0].unit_price_cents).toBe(5000);
  });

  it('create_quote_preset : POST /quote-templates, prix forcés à 0, sans taxes ni mise en page', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { template: { ...modele, id: 'p2' } } });
    const r = await lancer('create_quote_preset', { name: 'Commercial', services: [{ name: 'Sol', quantity: 3 }] }, fauxClient().client);
    const [, chemin, corpsEnvoye] = h.appelInterne.mock.calls[0];
    expect(chemin).toBe('/quote-templates');
    expect(corpsEnvoye).toMatchObject({ name: 'Commercial', tax_enabled: false, tax_rate: 0, layout_config: {} });
    expect(corpsEnvoye.services[0]).toMatchObject({ name: 'Sol', quantity: 3, unit_price_cents: 0 });
    expect(corpsEnvoye.services[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.created).toBe(true);
    expect(estFrancais(r.note)).toBe(true);
  });

  it('update / delete preset : écriture directe filtrée org, suppression douce', async () => {
    const f = fauxClient(() => ({ data: modele, error: null }));
    const r = await lancer('update_quote_preset', { preset_id: 'p1', notes: 'Merci' }, f.client);
    expect(r.updated).toBe(true);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'eq', 'id', 'p1') && aFiltre(f.journal[0], 'is', 'deleted_at', null)).toBe(true);
    expect(corps(f.journal[0], 'update')).toMatchObject({ notes: 'Merci' });
    const g = fauxClient(() => ({ data: { id: 'p1', name: 'Résidentiel' }, error: null }));
    const d = await lancer('delete_quote_preset', { preset_id: 'p1' }, g.client);
    expect(d.deleted).toBe(true);
    expect(filtreOrg(g.journal[0])).toBe(true);
    expect(corps(g.journal[0], 'update')).toMatchObject({ is_default: false });
    expect(corps(g.journal[0], 'update').deleted_at).toBeTruthy();
    expect(a(g.journal[0], 'delete').length).toBe(0);
  });

  it('duplicate_quote_preset : POST /quote-templates/:id/duplicate', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { template: { ...modele, name: 'Résidentiel (Copy)' } } });
    const r = await lancer('duplicate_quote_preset', { preset_id: 'p1' }, fauxClient().client);
    expect(h.appelInterne.mock.calls[0][1]).toBe('/quote-templates/p1/duplicate');
    expect(r.preset.name).toBe('Résidentiel (Copy)');
  });

  it('create_quote_template : POST /quote-templates avec les prix ; update is_default retire l ancien par défaut ; delete = doux', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { template: modele } });
    await lancer('create_quote_template', { name: 'Pro', services: [{ name: 'Vitres', unit_price_cents: 5000 }], tax_rate: 14.975, is_default: true }, fauxClient().client);
    const [, chemin, c] = h.appelInterne.mock.calls[0];
    expect(chemin).toBe('/quote-templates');
    expect(c).toMatchObject({ name: 'Pro', tax_rate: 14.975, is_default: true });
    expect(c.services[0].unit_price_cents).toBe(5000);

    const f = fauxClient(() => ({ data: modele, error: null }));
    await lancer('update_quote_template', { template_id: 'p1', is_default: true }, f.client);
    expect(f.journal.length).toBe(2);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'eq', 'is_default', true) && aFiltre(f.journal[0], 'neq', 'id', 'p1')).toBe(true);
    expect(filtreOrg(f.journal[1]) && corps(f.journal[1], 'update').is_default === true).toBe(true);

    const g = fauxClient(() => ({ data: { id: 'p1', name: 'Pro' }, error: null }));
    const d = await lancer('delete_quote_template', { template_id: 'p1' }, g.client);
    expect(d.deleted && filtreOrg(g.journal[0]) && !!corps(g.journal[0], 'update').deleted_at).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════ */

describe('factures', () => {
  const facture = { id: 'i1', invoice_number: 'INV-0042', status: 'sent', subject: 'Lavage', due_date: '2026-10-01', notes: null, internal_notes: null, tax_cents: 1500, discount_cents: 0, template_id: null, total_cents: 11500, paid_cents: 0, balance_cents: 11500, client_id: 'c1' };

  it('update_invoice : champs simples → update filtré org, sans RPC', async () => {
    const f = fauxClient(() => ({ data: facture, error: null }));
    const r = await lancer('update_invoice', { invoice_id: 'i1', subject: 'Lavage automne', due_date: '2026-11-01' }, f.client);
    expect(r.updated).toBe(true);
    const maj = appels(f.journal, 'invoices')[1];
    expect(filtreOrg(maj) && aFiltre(maj, 'is', 'deleted_at', null)).toBe(true);
    expect(corps(maj, 'update')).toMatchObject({ subject: 'Lavage automne', due_date: '2026-11-01' });
    expect(f.rpcs.length).toBe(0);
    expect((await lancer('update_invoice', { invoice_id: 'i1', due_date: 'demain' }, fauxClient(() => ({ data: facture, error: null })).client)).error).toMatch(/AAAA-MM-JJ/);
  });

  it('update_invoice : les articles ne changent que sur un BROUILLON, via rpc_save_invoice_draft avec les valeurs actuelles', async () => {
    expect((await lancer('update_invoice', { invoice_id: 'i1', items: [{ description: 'X', unit_price_cents: 100 }] }, fauxClient(() => ({ data: facture, error: null })).client)).error).toMatch(/brouillon/);
    const f = fauxClient(() => ({ data: { ...facture, status: 'draft' }, error: null }));
    const r = await lancer('update_invoice', { invoice_id: 'i1', items: [{ description: 'Vitres', qty: 2, unit_price_cents: 5000 }] }, f.client);
    expect(r.updated).toBe(true);
    expect(f.rpcs[0].name).toBe('rpc_save_invoice_draft');
    expect(f.rpcs[0].params).toMatchObject({ p_invoice_id: 'i1', p_subject: 'Lavage', p_due_date: '2026-10-01', p_tax_cents: 1500, p_items: [{ description: 'Vitres', qty: 2, unit_price_cents: 5000 }] });
  });

  it('void_invoice : refuse une facture payée, annule les autres (statut traduit)', async () => {
    expect((await lancer('void_invoice', { invoice_id: 'i1' }, fauxClient(() => ({ data: { ...facture, status: 'paid' }, error: null })).client)).error).toMatch(/payée/);
    const f = fauxClient((_t, ops) => ({ data: { ...facture, status: ops.some(([m]) => m === 'update') ? 'void' : 'sent' }, error: null }));
    const r = await lancer('void_invoice', { invoice_id: 'i1' }, f.client);
    expect(r).toMatchObject({ voided: true, invoice: { invoice_number: 'INV-0042', statut: 'annulée' } });
    expect(filtreOrg(f.journal[1]) && corps(f.journal[1], 'update').status === 'void').toBe(true);
  });

  it('revert_invoice_to_draft : refus si un paiement existe ; sinon draft + issued_at/sent_at à null', async () => {
    expect((await lancer('revert_invoice_to_draft', { invoice_id: 'i1' }, fauxClient(() => ({ data: { ...facture, paid_cents: 500 }, error: null })).client)).error).toMatch(/paiement/);
    const f = fauxClient((_t, ops) => ({ data: { ...facture, status: ops.some(([m]) => m === 'update') ? 'draft' : 'sent' }, error: null }));
    const r = await lancer('revert_invoice_to_draft', { invoice_id: 'i1' }, f.client);
    expect(r.reverted).toBe(true);
    expect(corps(f.journal[1], 'update')).toMatchObject({ status: 'draft', issued_at: null, sent_at: null });
    expect(filtreOrg(f.journal[1])).toBe(true);
  });

  it('duplicate_invoice : mêmes RPC que l écran (create_draft puis save_draft avec les articles)', async () => {
    const f = fauxClient(
      (t) => ({ data: t === 'invoice_items' ? [{ description: 'Vitres', qty: 2, unit_price_cents: 5000 }] : facture, error: null }),
      (n) => ({ data: n === 'rpc_create_invoice_draft' ? [{ id: 'i2', invoice_number: 'INV-0043' }] : {}, error: null }),
    );
    const r = await lancer('duplicate_invoice', { invoice_id: 'i1' }, f.client);
    expect(r).toMatchObject({ created: true, invoice_id: 'i2', invoice_number: 'INV-0043', statut: 'brouillon', total_cents: 11500 });
    expect(f.rpcs[0]).toEqual({ name: 'rpc_create_invoice_draft', params: { p_client_id: 'c1', p_subject: 'Lavage (Copy)', p_due_date: null } });
    expect(f.rpcs[1].params).toMatchObject({ p_invoice_id: 'i2', p_tax_cents: 1500, p_items: [{ description: 'Vitres', qty: 2, unit_price_cents: 5000 }] });
    expect(filtreOrg(appels(f.journal, 'invoice_items')[0]) && aFiltre(appels(f.journal, 'invoice_items')[0], 'is', 'deleted_at', null)).toBe(true);
  });

  it('delete_invoice : refus si payée ; sinon suppression DOUCE filtrée org, jamais de DELETE', async () => {
    expect((await lancer('delete_invoice', { invoice_id: 'i1' }, fauxClient(() => ({ data: { ...facture, paid_cents: 100 }, error: null })).client)).error).toMatch(/void_invoice/);
    const f = fauxClient(() => ({ data: facture, error: null }));
    const r = await lancer('delete_invoice', { invoice_id: 'i1' }, f.client);
    expect(r.deleted).toBe(true);
    expect(filtreOrg(f.journal[1]) && !!corps(f.journal[1], 'update').deleted_at && corps(f.journal[1], 'update').deleted_by === 'user-1').toBe(true);
    expect(f.journal.some((e) => a(e, 'delete').length)).toBe(false);
  });

  it('record_invoice_payment : refuse au-dessus du solde, renvoie vers mark_invoice_paid au solde exact, refuse un brouillon', async () => {
    const f = fauxClient(() => ({ data: facture, error: null }));
    expect((await lancer('record_invoice_payment', { invoice_id: 'i1', amount_cents: 20000 }, f.client)).error).toMatch(/dépasse le solde/);
    expect((await lancer('record_invoice_payment', { invoice_id: 'i1', amount_cents: 11500 }, f.client)).error).toMatch(/mark_invoice_paid/);
    expect((await lancer('record_invoice_payment', { invoice_id: 'i1', amount_cents: 0 }, f.client)).error).toMatch(/positif/);
    expect((await lancer('record_invoice_payment', { invoice_id: 'i1', amount_cents: 100 }, fauxClient(() => ({ data: { ...facture, status: 'draft' }, error: null })).client)).error).toMatch(/brouillon/);
    expect(f.rpcs.length).toBe(0);
  });

  it('record_invoice_payment : paiement partiel via la RPC apply_invoice_payment (service), filtrée org', async () => {
    const admin = fauxClient(() => ({ data: { invoice_number: 'INV-0042', balance_cents: 9000, status: 'partial' }, error: null }));
    h.admin = admin.client;
    const f = fauxClient(() => ({ data: facture, error: null }));
    const r = await lancer('record_invoice_payment', { invoice_id: 'i1', amount_cents: 2500, method: 'cash' }, f.client);
    expect(admin.rpcs).toEqual([{ name: 'apply_invoice_payment', params: { p_invoice_id: 'i1', p_org_id: ORG, p_amount_cents: 2500 } }]);
    expect(r).toMatchObject({ recorded: true, amount_cents: 2500, balance_cents: 9000, methode_paiement: 'cash', invoice: { statut: 'partiellement payée' } });
    expect(estFrancais(r.note)).toBe(true);
    expect(filtreOrg(f.journal[0])).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════ */

describe('factures récurrentes (écriture directe : la route serveur n existe plus)', () => {
  const sched = { id: 'r1', org_id: ORG, client_id: 'c1', subject: 'Entretien', items: [{ description: 'Mensuel', qty: 1, unit_price_cents: 8000 }], frequency: 'monthly', start_date: '2026-10-01', end_date: null, next_run_date: '2026-10-01', due_days_offset: 30, auto_send: false, is_active: true, last_run_at: null, client: { first_name: 'Marie', last_name: 'Tremblay' } };

  it('list : org + actives seulement par défaut, montant calculé, fréquence en français', async () => {
    const f = fauxClient(() => ({ data: [sched], error: null, count: 1 }));
    const r = await lancer('list_recurring_invoices', {}, f.client);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'eq', 'is_active', true)).toBe(true);
    expect(r.schedules[0]).toMatchObject({ subject: 'Entretien', client_name: 'Marie Tremblay', frequence: 'chaque mois', amount_cents: 8000 });
    const g = fauxClient(() => ({ data: [], error: null, count: 0 }));
    await lancer('list_recurring_invoices', { include_inactive: true }, g.client);
    expect(aFiltre(g.journal[0], 'eq', 'is_active', true)).toBe(false);
  });

  it('create : vérifie le client dans l org, insère org_id et next_run_date = start_date ; refuse fin < début', async () => {
    const f = fauxClient((t) => ({ data: t === 'clients' ? { id: 'c1', first_name: 'Marie', last_name: 'Tremblay' } : sched, error: null }));
    const r = await lancer('create_recurring_invoice', { client_id: 'c1', subject: 'Entretien', items: [{ description: 'Mensuel', unit_price_cents: 8000 }], frequency: 'monthly', start_date: '2026-10-01', auto_send: true }, f.client);
    expect(r.created).toBe(true);
    expect(estFrancais(r.note)).toBe(true);
    expect(filtreOrg(appels(f.journal, 'clients')[0])).toBe(true);
    expect(corps(appels(f.journal, 'recurring_invoice_schedules')[0], 'insert')).toMatchObject({ org_id: ORG, client_id: 'c1', next_run_date: '2026-10-01', start_date: '2026-10-01', frequency: 'monthly', auto_send: true, is_active: true, due_days_offset: 30 });
    expect((await lancer('create_recurring_invoice', { client_id: 'c1', subject: 'X', items: [{ description: 'a', unit_price_cents: 1 }], frequency: 'weekly', start_date: '2026-10-01', end_date: '2026-09-01' }, f.client)).error).toMatch(/précède/);
    expect((await lancer('create_recurring_invoice', { client_id: 'zz', subject: 'X', items: [{ description: 'a', unit_price_cents: 1 }], frequency: 'weekly', start_date: '2026-10-01' }, fauxClient(() => ({ data: null, error: null })).client)).error).toMatch(/Client introuvable/);
  });

  it('update / delete : filtrés org ; « supprimer » = désactivation (pas de deleted_at sur la table), jamais un DELETE', async () => {
    const f = fauxClient(() => ({ data: { ...sched, is_active: false }, error: null }));
    const r = await lancer('update_recurring_invoice', { schedule_id: 'r1', is_active: false }, f.client);
    expect(r.note).toMatch(/pause/);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'eq', 'id', 'r1') && corps(f.journal[0], 'update').is_active === false).toBe(true);
    const g = fauxClient(() => ({ data: { id: 'r1', subject: 'Entretien' }, error: null }));
    const d = await lancer('delete_recurring_invoice', { schedule_id: 'r1' }, g.client);
    expect(d.deleted).toBe(true);
    expect(filtreOrg(g.journal[0]) && corps(g.journal[0], 'update').is_active === false && a(g.journal[0], 'delete').length === 0).toBe(true);
  });

  it('run_recurring_invoice_now : lit la récurrence à l identité (org), puis le moteur du cron SANS avancer la date', async () => {
    h.runOneSchedule.mockResolvedValueOnce({ invoice_id: 'i7', invoice_number: 'INV-0050', advanced_to: null, deactivated: false });
    const f = fauxClient(() => ({ data: sched, error: null }));
    const r = await lancer('run_recurring_invoice_now', { schedule_id: 'r1' }, f.client);
    expect(filtreOrg(f.journal[0])).toBe(true);
    expect(h.runOneSchedule).toHaveBeenCalledWith(h.admin, expect.objectContaining({ id: 'r1', org_id: ORG }), { advance: false });
    expect(r).toMatchObject({ created: true, invoice_id: 'i7', invoice_number: 'INV-0050', statut: 'brouillon' });
    expect((await lancer('run_recurring_invoice_now', { schedule_id: 'zz' }, fauxClient(() => ({ data: null, error: null })).client)).error).toMatch(/introuvable/);
  });
});

/* ═══════════════════════════════════════════════════════════════ */

describe('modèles de facture (écriture directe : la route serveur n existe plus)', () => {
  const tpl = { id: 't1', name: 'Standard', title: '', description: '', line_items: [{ description: 'Main-d’œuvre', qty: 1, unit_price_cents: 6000 }], taxes: [{ name: 'TPS', rate: 5 }], payment_terms: 'Net 30', client_note: '', email_subject: '', email_body: '', is_default: true, layout_type: 'classic' };

  it('list : org + deleted_at + archived_at ; montant calculé', async () => {
    const f = fauxClient(() => ({ data: [tpl], error: null, count: 1 }));
    const r = await lancer('list_invoice_templates', {}, f.client);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'is', 'deleted_at', null) && aFiltre(f.journal[0], 'is', 'archived_at', null)).toBe(true);
    expect(r.templates[0]).toMatchObject({ name: 'Standard', amount_cents: 6000, is_default: true });
  });

  it('create : insert org_id + created_by, is_default retire l ancien ; mise en page hors liste refusée', async () => {
    const f = fauxClient(() => ({ data: tpl, error: null }));
    const r = await lancer('create_invoice_template', { name: 'Standard', line_items: [{ description: 'Main-d’œuvre', unit_price_cents: 6000 }], is_default: true }, f.client);
    expect(r.created).toBe(true);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'eq', 'is_default', true) && corps(f.journal[0], 'update').is_default === false).toBe(true);
    expect(corps(f.journal[1], 'insert')).toMatchObject({ org_id: ORG, created_by: 'user-1', name: 'Standard', is_default: true, layout_type: 'classic', line_items: [{ description: 'Main-d’œuvre', qty: 1, unit_price_cents: 6000 }] });
    expect((await lancer('create_invoice_template', { name: 'X', layout_type: 'fancy' }, f.client)).error).toMatch(/Mise en page/);
  });

  it('update / delete : filtrés org ; suppression douce (deleted_at + archived_at)', async () => {
    const f = fauxClient(() => ({ data: tpl, error: null }));
    await lancer('update_invoice_template', { template_id: 't1', payment_terms: 'Net 15' }, f.client);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'eq', 'id', 't1') && corps(f.journal[0], 'update').payment_terms === 'Net 15').toBe(true);
    const g = fauxClient(() => ({ data: { id: 't1', name: 'Standard' }, error: null }));
    const d = await lancer('delete_invoice_template', { template_id: 't1' }, g.client);
    expect(d.deleted).toBe(true);
    const c = corps(g.journal[0], 'update');
    expect(filtreOrg(g.journal[0]) && !!c.deleted_at && !!c.archived_at && c.is_default === false && a(g.journal[0], 'delete').length === 0).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════ */

describe('paiements', () => {
  it('create_payment_request : POST /payment-requests/create, link_only par défaut, notifications résumées', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { payment_request: { payment_url: 'https://lume/pay/abc', amount_cents: 11500 }, notifications: {} } });
    const r = await lancer('create_payment_request', { invoice_id: 'i1' }, fauxClient().client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.anything(), '/payment-requests/create', { invoiceId: 'i1', sendVia: 'link_only' });
    expect(r).toMatchObject({ created: true, payment_url: 'https://lume/pay/abc', amount_cents: 11500 });
    expect(r.note).toMatch(/rien n.a été envoyé/i);
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { payment_request: { payment_url: 'u' }, notifications: { email: { sent: true }, sms: { sent: false, reason: 'no number' } } } });
    const b = await lancer('create_payment_request', { invoice_id: 'i1', send_via: 'both' }, fauxClient().client);
    expect(h.appelInterne.mock.calls[1][2]).toEqual({ invoiceId: 'i1', sendVia: 'both' });
    expect(b.notifications).toEqual({ email: 'envoyé', sms: 'non envoyé (no number)' });
    h.appelInterne.mockRejectedValueOnce(new AppelInterneIncertain('timeout'));
    expect((await lancer('create_payment_request', { invoice_id: 'i1', send_via: 'email' }, fauxClient().client)).incertain).toBe(true);
  });

  it('resend_payment_request : POST /payment-requests/resend, courriel par défaut', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { payment_request: { payment_url: 'u' }, notifications: { email: { sent: true } } } });
    const r = await lancer('resend_payment_request', { invoice_id: 'i1' }, fauxClient().client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.anything(), '/payment-requests/resend', { invoiceId: 'i1', sendVia: 'email' });
    expect(r.sent).toBe(true);
    expect(estFrancais(r.note)).toBe(true);
    h.appelInterne.mockResolvedValueOnce({ ok: false, status: 404, json: { error: 'No active payment request found for this invoice.' } });
    expect((await lancer('resend_payment_request', { invoice_id: 'i1' }, fauxClient().client)).error).toMatch(/No active payment request/);
  });

  it('refund_payment : POST /payments/refund (paymentId, amountCents, reason) ; synchro ratée = fait, on ne retente pas', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true, refund_id: 're_1', refund_amount: 2500, refund_status: 'succeeded', full_refund: false } });
    const r = await lancer('refund_payment', { payment_id: 'p1', amount_cents: 2500, reason: 'duplicate' }, fauxClient().client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.anything(), '/payments/refund', { paymentId: 'p1', amountCents: 2500, reason: 'duplicate' });
    expect(r).toMatchObject({ refunded: true, refund_amount_cents: 2500, full_refund: false });
    expect(r.note).toMatch(/partiel/);
    h.appelInterne.mockResolvedValueOnce({ ok: false, status: 500, json: { error: 'Refund issued but DB sync failed', refund_id: 're_2', code: 'DB_SYNC_FAILED' } });
    const s = await lancer('refund_payment', { payment_id: 'p1' }, fauxClient().client);
    expect(s).toMatchObject({ refunded: true, incomplet: true, refund_id: 're_2' });
    expect(h.appelInterne.mock.calls[1][2]).toEqual({ paymentId: 'p1' });
    expect((await lancer('refund_payment', { payment_id: 'p1', amount_cents: -5 }, fauxClient().client)).error).toMatch(/positif/);
    expect(h.appelInterne).toHaveBeenCalledTimes(2);
  });

  it('charge_card_on_file : POST /payments/card-on-file/charge ; refus 402 traduit en français', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true, status: 'processing', paymentIntentId: 'pi_1' } });
    const r = await lancer('charge_card_on_file', { invoice_id: 'i1' }, fauxClient().client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.anything(), '/payments/card-on-file/charge', { invoiceId: 'i1' });
    expect(r).toMatchObject({ charged: true, statut: 'en traitement' });
    h.appelInterne.mockResolvedValueOnce({ ok: false, status: 402, json: { ok: false, status: 'no_card_on_file', reason: 'No card on file for this client.' } });
    expect((await lancer('charge_card_on_file', { invoice_id: 'i1' }, fauxClient().client)).error).toMatch(/pas de carte au dossier/);
  });

  it('remove_card_on_file : POST /payments/card-on-file/remove ; 404 en français', async () => {
    h.appelInterne.mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true } });
    const r = await lancer('remove_card_on_file', { client_id: 'c1' }, fauxClient().client);
    expect(h.appelInterne).toHaveBeenCalledWith(expect.anything(), '/payments/card-on-file/remove', { clientId: 'c1' });
    expect(r.removed).toBe(true);
    h.appelInterne.mockResolvedValueOnce({ ok: false, status: 404, json: { error: 'No card on file for this client.' } });
    expect((await lancer('remove_card_on_file', { client_id: 'c1' }, fauxClient().client)).error).toMatch(/pas de carte/);
  });

  it('update_reminder_settings : upsert filtré org (onConflict org_id), calendrier assaini, bornes de la route', async () => {
    const f = fauxClient(() => ({ data: { enabled: true, schedule: [{ days_after_due: 3, channel: 'email' }] }, error: null }));
    const r = await lancer('update_reminder_settings', { enabled: true, schedule: [{ days_after_due: 3.7, channel: 'EMAIL' }] }, f.client);
    expect(r.updated).toBe(true);
    expect(r.schedule).toEqual([{ jours_apres_echeance: 3, canal: 'email' }]);
    const [ligne, opts] = a(f.journal[0], 'upsert')[0];
    expect(ligne).toMatchObject({ org_id: ORG, enabled: true, schedule: [{ days_after_due: 3, channel: 'email' }] });
    expect(opts).toEqual({ onConflict: 'org_id' });
    expect((await lancer('update_reminder_settings', { schedule: [{ days_after_due: 400, channel: 'sms' }] }, f.client)).error).toMatch(/365/);
    expect((await lancer('update_reminder_settings', { custom_sms_body: 'x'.repeat(321) }, f.client)).error).toMatch(/320/);
    expect((await lancer('update_reminder_settings', {}, f.client)).error).toMatch(/Aucun réglage/);
  });

  it('list_payments : org + deleted_at, filtres optionnels, somme des paiements réussis seulement, statuts traduits', async () => {
    const rows = [
      { id: 'p1', amount_cents: 5000, currency: 'CAD', status: 'succeeded', method: 'card', provider: 'stripe', payment_date: '2026-09-10T10:00:00Z', invoice: { invoice_number: 'INV-1' }, client: { first_name: 'Marie', last_name: 'Tremblay' } },
      { id: 'p2', amount_cents: 2000, currency: 'CAD', status: 'refunded', method: null, provider: 'manual', payment_date: '2026-09-09T10:00:00Z', invoice: null, client: { company: 'ACME' } },
    ];
    const f = fauxClient(() => ({ data: rows, error: null, count: 5 }));
    const r = await lancer('list_payments', { status: 'succeeded', from: '2026-09-01', limit: 2 }, f.client);
    expect(filtreOrg(f.journal[0]) && aFiltre(f.journal[0], 'is', 'deleted_at', null) && aFiltre(f.journal[0], 'eq', 'status', 'succeeded') && aFiltre(f.journal[0], 'gte', 'payment_date', '2026-09-01T00:00:00')).toBe(true);
    expect(r).toMatchObject({ total_matching: 5, shown: 2, sum_amount_cents: 5000 });
    expect(r.note).toMatch(/2 paiements sur 5/);
    expect(r.payments[0]).toMatchObject({ id: 'p1', statut: 'réussi', fournisseur: 'Stripe', invoice_number: 'INV-1', client_name: 'Marie Tremblay' });
    expect(r.payments[1]).toMatchObject({ statut: 'remboursé', fournisseur: 'manuel', client_name: 'ACME' });
    const g = fauxClient(() => ({ data: null, error: { message: 'relation payments does not exist' } }));
    const e = await lancer('list_payments', {}, g.client);
    expect(e.error).not.toMatch(/relation/);
  });
});
