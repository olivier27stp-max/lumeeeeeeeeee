/**
 * get_invoice et get_quote : une facture, une soumission au complet (2026-10-01).
 *
 * Inventaire des trous de Lumi : « qu'est-ce qu'il y a sur la facture 12 », « elle a payé
 * comment », « est-ce que Marie a ouvert sa soumission » n'avaient aucune réponse — les
 * listes ne donnent qu'une ligne par fiche. Et une facture hors des 30 plus récentes
 * était introuvable : list_invoices ne passait pas la recherche à sa RPC.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { PERMISSION_PAR_OUTIL, OUTILS_FINANCIERS, masquerMontants } from '../server/lib/agent/garde';
import { outilsDuSousAgent } from '../server/lib/lumi/sous-agents';

const ORG = '11111111-1111-4111-8111-111111111111';
const FACTURE = '22222222-2222-4222-8222-222222222222';
const DEVIS = '33333333-3333-4333-8333-333333333333';
const CLIENT = '44444444-4444-4444-8444-444444444444';

type Appel = { table: string; ops: Array<[string, unknown[]]> };
function ctxFactice(tables: Record<string, unknown>) {
  const appels: Appel[] = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const appel: Appel = { table, ops: [] };
      appels.push(appel);
      const q: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[m] = (...a: unknown[]) => { appel.ops.push([m, a]); return q; };
      q.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
      q.then = (ok: (r: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { data: [], error: null }; },
  };
  return { ctx: { client, orgId: ORG, userId: 'u' } as any, appels, rpcs };
}
const filtreOrg = (a: Appel) => a.ops.some(([op, args]) => op === 'eq' && args[0] === 'org_id' && args[1] === ORG);

describe('get_invoice', () => {
  const tables = {
    invoices: { id: FACTURE, invoice_number: 'INV-000012', status: 'sent', subject: 'Lavage de vitres', due_date: '2026-10-15', sent_at: '2026-10-01T14:00:00Z', subtotal_cents: 10000, discount_cents: 0, tax_cents: 1498, total_cents: 11498, paid_cents: 5000, balance_cents: 6498, currency: 'CAD', client_id: CLIENT, client_name_snapshot: 'Marie Tremblay', client_email_snapshot: 'marie@exemple.invalid', job_id: null, is_viewed: true, viewed_at: '2026-10-01T15:00:00Z', last_viewed_at: '2026-10-02T09:00:00Z', view_count: 3, is_recurring: false },
    invoice_items: [{ title: 'Lavage de vitres', description: 'Extérieur', qty: 1, unit_price_cents: 10000, line_total_cents: 10000, sort_order: 0 }],
    payments: [{ id: 'p1', amount_cents: 5000, refunded_cents: 0, tip_cents: 0, paid_at: '2026-10-02T10:00:00Z', method: 'card', provider: 'stripe', status: 'succeeded', card_brand: 'visa', card_last4: '4242' }],
  };

  it('rend les lignes, les paiements, le solde et les ouvertures par le client', async () => {
    const { ctx, appels } = ctxFactice(tables);
    const r: any = await TOOLS_BY_NAME.get_invoice.handler!({ invoice_id: FACTURE }, ctx);
    expect(r).toMatchObject({
      invoice_number: 'INV-000012', client_name: 'Marie Tremblay', total_cents: 11498, paid_cents: 5000, balance_cents: 6498,
      ouverte_par_le_client: true, nombre_ouvertures: 3,
      line_items: [{ name: 'Lavage de vitres', description: 'Extérieur', qty: 1, unit_price_cents: 10000, total_cents: 10000 }],
      payments: [{ payment_id: 'p1', amount_cents: 5000, method: 'card', carte: 'visa •••• 4242' }],
    });
    expect(r.statut).toBeTruthy();
    // Chaque lecture est bornée à l'org.
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    expect(appels.map((a) => a.table).sort()).toEqual(['invoice_items', 'invoices', 'payments']);
  });

  it('un numéro que la garde n’a pas pu résoudre : introuvable, sans requête', async () => {
    const { ctx, appels } = ctxFactice(tables);
    const r: any = await TOOLS_BY_NAME.get_invoice.handler!({ invoice_id: '999' }, ctx);
    expect(r.introuvable).toBe(true);
    expect(r.message).toMatch(/list_invoices/);
    expect(appels).toEqual([]);
  });

  it('une facture d’une autre entreprise ou supprimée : introuvable, jamais une erreur', async () => {
    const { ctx } = ctxFactice({});
    const r: any = await TOOLS_BY_NAME.get_invoice.handler!({ invoice_id: FACTURE }, ctx);
    expect(r).toMatchObject({ introuvable: true });
    expect(r.error).toBeUndefined();
  });

  it('un membre sans accès aux montants ne voit aucun montant', async () => {
    const { ctx } = ctxFactice(tables);
    const r: any = masquerMontants(await TOOLS_BY_NAME.get_invoice.handler!({ invoice_id: FACTURE }, ctx));
    expect(r.total_cents).toBeNull();
    expect(r.balance_cents).toBeNull();
    expect(r.line_items[0].unit_price_cents).toBeNull();
    expect(r.payments[0].amount_cents).toBeNull();
    expect(r.invoice_number).toBe('INV-000012');
  });
});

describe('get_quote', () => {
  const tables = {
    quotes: { id: DEVIS, quote_number: '19', title: 'Lumières de Noël', status: 'sent', valid_until: '2026-11-01', subtotal_cents: 250000, discount_type: 'percent', discount_value: 10, discount_cents: 25000, tax_cents: 33694, total_cents: 258694, currency: 'CAD', deposit_required: true, deposit_type: 'percent', deposit_value: 25, deposit_cents: 64674, deposit_status: 'pending', sent_via_email_at: '2026-09-28T13:00:00Z', is_viewed: true, viewed_at: '2026-09-28T18:00:00Z', last_viewed_at: '2026-09-30T08:00:00Z', view_count: 4, client_id: CLIENT, lead_id: null, job_id: null },
    quote_line_items: [{ name: 'Installation', description: null, quantity: 1, unit_price_cents: 200000, total_cents: 200000, is_optional: false, sort_order: 0 }, { name: 'Retrait en janvier', description: null, quantity: 1, unit_price_cents: 50000, total_cents: 50000, is_optional: true, sort_order: 1 }],
    clients: { first_name: 'Sophie', last_name: 'Bouchard', company: null, display_as_company: false, email: 'sophie@exemple.invalid', phone: '418-555-0101' },
  };

  it('rend les lignes, le rabais, le dépôt, les envois et les ouvertures', async () => {
    const { ctx, appels } = ctxFactice(tables);
    const r: any = await TOOLS_BY_NAME.get_quote.handler!({ quote_id: DEVIS }, ctx);
    expect(r).toMatchObject({
      quote_number: '19', title: 'Lumières de Noël', client_name: 'Sophie Bouchard', total_cents: 258694,
      discount: { type: 'percent', value_amount: 10, discount_cents: 25000 },
      deposit: { type: 'percent', value_amount: 25, deposit_cents: 64674, statut: 'pending' },
      envoyee_par_courriel: '2026-09-28T13:00:00Z', ouverte_par_le_client: true, nombre_ouvertures: 4,
    });
    expect(r.line_items).toHaveLength(2);
    expect(r.line_items[1]).toMatchObject({ name: 'Retrait en janvier', optionnelle: true });
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
  });

  it('sans rabais ni dépôt : null, pas un objet vide', async () => {
    const { ctx } = ctxFactice({ ...tables, quotes: { ...tables.quotes, discount_cents: 0, deposit_required: false } });
    const r: any = await TOOLS_BY_NAME.get_quote.handler!({ quote_id: DEVIS }, ctx);
    expect(r.discount).toBeNull();
    expect(r.deposit).toBeNull();
  });

  it('les montants du rabais et du dépôt sont masqués pour qui ne voit pas les montants', async () => {
    const { ctx } = ctxFactice(tables);
    const r: any = masquerMontants(await TOOLS_BY_NAME.get_quote.handler!({ quote_id: DEVIS }, ctx));
    expect(r.total_cents).toBeNull();
    expect(r.discount).toMatchObject({ value_amount: null, discount_cents: null });
    expect(r.deposit).toMatchObject({ value_amount: null, deposit_cents: null });
  });
});

describe('list_invoices cherche enfin', () => {
  it('la recherche est passée à la RPC ; sans recherche, null comme avant', async () => {
    const { ctx, rpcs } = ctxFactice({});
    await TOOLS_BY_NAME.list_invoices.handler!({ query: 'Gagnon' }, ctx);
    await TOOLS_BY_NAME.list_invoices.handler!({}, ctx);
    expect(rpcs[0]).toMatchObject({ fn: 'rpc_list_invoices', args: { p_q: 'Gagnon', p_org: ORG } });
    expect(rpcs[1].args.p_q).toBeNull();
  });
});

describe('branchement', () => {
  it('lectures, gardées par la consultation des factures et des devis, classées financières', () => {
    for (const n of ['get_invoice', 'get_quote']) {
      expect(AGENT_TOOLS.find((t) => t.declaration.name === n)?.kind, n).toBe('read');
      expect(OUTILS_FINANCIERS.has(n), n).toBe(true);
    }
    expect(PERMISSION_PAR_OUTIL.get_invoice.cle).toBe('invoices.read');
    expect(PERMISSION_PAR_OUTIL.get_quote.cle).toBe('quotes.read');
  });
  it('chargées avec leur sujet', () => {
    expect(outilsDuSousAgent('facturation')).toContain('get_invoice');
    expect(outilsDuSousAgent('devis')).toContain('get_quote');
  });
});

describe('pointer sur un job : l’outil de pointage est chargé avec les jobs', () => {
  it('le sous-agent « planification » porte punch_in et punch_out (terrain-05, 2026-10-01)', () => {
    // « Punch-moi in sur la job du restaurant » est classé « job » : sans l'outil dans ce jeu,
    // Lumi répondait « pas d'outil punch_in dans Lume ».
    expect(outilsDuSousAgent('planification')).toEqual(expect.arrayContaining(['list_jobs', 'punch_in', 'punch_out']));
    // Ils restent des outils du sujet « equipe » : un outil n'appartient qu'à un sujet.
    expect(outilsDuSousAgent('equipe')).toEqual(expect.arrayContaining(['punch_in', 'punch_out']));
  });
});

describe('un outil chargé là où la question arrive (passe en prod du 2026-10-02)', () => {
  it('« qui travaille demain » : l’horaire des employés est chargé avec les jobs', () => {
    expect(outilsDuSousAgent('planification')).toEqual(expect.arrayContaining(['query_schedule', 'get_team_schedule']));
  });

  it('« quelle équipe a rapporté le plus » : la performance par équipe est chargée avec la facturation', () => {
    expect(outilsDuSousAgent('facturation')).toEqual(expect.arrayContaining(['analyze_profitability', 'get_team_performance']));
  });

  it('ils restent des outils du sujet « equipe »', () => {
    expect(outilsDuSousAgent('equipe')).toEqual(expect.arrayContaining(['get_team_schedule', 'get_team_performance']));
  });
});
