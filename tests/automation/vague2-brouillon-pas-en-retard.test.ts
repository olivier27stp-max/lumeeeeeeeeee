/**
 * Une facture BROUILLON n'est jamais « en retard » (audit V2, D-05).
 *
 * Le client ne l'a jamais reçue : lui envoyer « votre facture est en retard »
 * est faux. La détection excluait paid/cancelled/void mais pas draft — 4
 * brouillons échus en prod au 2026-09-30 l'auraient déclenché dès qu'une
 * règle « Facture en retard » est publiée. Le faux client ci-dessous APPLIQUE
 * les filtres de statut, comme la base.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.useRealTimers());

function fauxClient(lignes: Array<{ status: string } & Record<string, unknown>>) {
  return {
    from(table: string) {
      let garder = (_s: string) => true;
      const q: any = {};
      for (const m of ['select', 'lt', 'is', 'order', 'eq', 'limit', 'gte', 'range']) q[m] = () => q;
      q.in = (col: string, vals: string[]) => { if (col === 'status') { const g = garder; garder = (s) => g(s) && vals.includes(s); } return q; };
      q.not = (col: string, op: string, val: string) => {
        if (col === 'status' && op === 'in') { const exclus = val.replace(/[()"]/g, '').split(','); const g = garder; garder = (s) => g(s) && !exclus.includes(s); }
        return q;
      };
      q.insert = () => q; q.update = () => q;
      q.maybeSingle = async () => ({ data: table === 'company_settings' ? { timezone: 'America/Montreal' } : null, error: null });
      q.single = q.maybeSingle;
      q.then = (res: any, rej: any) => Promise.resolve(
        table === 'invoices' ? { data: lignes.filter((l) => garder(l.status)), error: null }
          : table === 'company_settings' ? { data: [{ timezone: 'America/Montreal' }], error: null }
            : { data: [], error: null },
      ).then(res, rej);
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

describe('D-05 — brouillon échu', () => {
  it('seules les factures envoyées (ou partiellement payées) sont « en retard »', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T16:00:00Z'));
    const emis: any[] = [];
    const { eventBus } = await import('../../server/lib/eventBus');
    eventBus.removeAllListeners();
    eventBus.on('invoice.overdue', (e: any) => emis.push(e));
    const { detectOverdueInvoices } = await import('../../server/lib/scheduler');
    const echue = { org_id: ORG, due_date: '2026-09-13', client_id: null };
    await detectOverdueInvoices(fauxClient([
      { ...echue, id: 'brouillon', invoice_number: 'D-1', status: 'draft' },
      { ...echue, id: 'envoyee', invoice_number: 'INV-1', status: 'sent' },
      { ...echue, id: 'partielle', invoice_number: 'INV-2', status: 'partial' },
    ]) as any);
    expect(emis.map((e) => e.entityId).sort()).toEqual(['envoyee', 'partielle']);
  });
});
