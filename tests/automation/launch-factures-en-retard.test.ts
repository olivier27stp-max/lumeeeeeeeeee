/**
 * Launch 2026-09-28 — détection des factures en retard.
 *   · paginée : au-delà de 1 000 factures, PostgREST tronquait SANS erreur ;
 *   · « aujourd'hui » dans le fuseau de l'entreprise, pas en UTC.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.useRealTimers());

/** Faux client minimal : rend la page 2 quand `range` commence à 1 000. */
function fauxClient(page1: any[], page2: any[]) {
  return {
    from(table: string) {
      let debut = 0;
      const q: any = {};
      for (const m of ['select', 'not', 'lt', 'is', 'order', 'eq', 'in', 'limit', 'gte']) q[m] = () => q;
      q.range = (a: number) => { debut = a; return q; };
      q.insert = () => q; q.update = () => q;
      q.maybeSingle = async () => ({ data: table === 'company_settings' ? { timezone: 'America/Montreal' } : null, error: null });
      q.single = q.maybeSingle;
      q.then = (res: any, rej: any) => Promise.resolve(
        table === 'invoices' ? { data: debut >= 1000 ? page2 : page1, error: null }
          : table === 'company_settings' ? { data: [{ timezone: 'America/Montreal' }], error: null }
            : { data: [], error: null },
      ).then(res, rej);
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

async function detecter(page1: any[], page2: any[]) {
  const emis: any[] = [];
  const { eventBus } = await import('../../server/lib/eventBus');
  eventBus.removeAllListeners();
  eventBus.on('invoice.overdue', (e: any) => emis.push(e));
  const { detectOverdueInvoices } = await import('../../server/lib/scheduler');
  await detectOverdueInvoices(fauxClient(page1, page2) as any);
  return emis;
}

describe('factures en retard', () => {
  it('fuseau de l’entreprise : 23 h à Montréal le 13, due le 12 → 1 jour de retard (pas 2 comme en UTC)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T03:00:00Z'));
    const emis = await detecter([{ id: 'f1', org_id: ORG, invoice_number: 'INV-1', due_date: '2026-09-12', client_id: null }], []);
    expect(emis.map((e) => e.metadata.days_overdue)).toEqual([1]);
  });

  it('plus de 1 000 factures : la 1 001e est vue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T16:00:00Z'));
    const bruit = Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}`, org_id: ORG, invoice_number: `B-${i}`, due_date: '2026-09-10', client_id: null }));
    const emis = await detecter(bruit, [{ id: 'f-1001', org_id: ORG, invoice_number: 'INV-1001', due_date: '2026-09-13', client_id: null }]);
    expect(emis.some((e) => e.entityId === 'f-1001')).toBe(true);
  });
});
