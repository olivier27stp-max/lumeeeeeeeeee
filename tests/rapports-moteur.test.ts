/**
 * Rapports — moteur (tri, pagination, totaux, itération) et bornes de période.
 */
import { describe, it, expect } from 'vitest';
import { fetchPage, iterateAll, countAll, resolveSort, sortRows } from '../server/lib/reports/engine';
import { startOfDayIso, endOfDayExclusiveIso, applyPeriod, inPeriod, addDays, daysBetween, toLocalDate } from '../server/lib/reports/dates';
import { applySearch, eqFilter, dollarsToCents, hoursBetween } from '../server/lib/reports/helpers';
import { __test as feuilles } from '../server/lib/reports/definitions/team';
import type { ReportContext, ReportDefinition, ReportQuery, Row } from '../server/lib/reports/types';

const ctx = { lang: 'fr', today: '2026-09-17', orgId: 'org', userId: 'u', isAdmin: true, role: 'owner' } as unknown as ReportContext;

function memoryReport(rows: Row[]): ReportDefinition {
  return {
    id: 'test', category: 'finances', title: { fr: 't', en: 't' }, description: { fr: 'd', en: 'd' },
    permission: 'financial.view_reports',
    columns: [
      { key: 'name', label: { fr: 'Nom', en: 'Name' }, type: 'text', sortable: true },
      { key: 'total_cents', label: { fr: 'Total', en: 'Total' }, type: 'money', sortable: true, total: 'sum' },
      { key: 'note', label: { fr: 'Note', en: 'Note' }, type: 'text' },
    ],
    filters: [],
    defaultSort: { key: 'total_cents', dir: 'desc' },
    source: { kind: 'memory', loadAll: async () => rows },
  };
}

const q = (sort?: Partial<ReportQuery['sort']>): ReportQuery => ({ filters: {}, sort: { key: sort?.key || '', dir: sort?.dir as 'asc' } });

describe('tri', () => {
  it('retombe sur le tri par défaut pour une clé inconnue ou non triable', () => {
    const def = memoryReport([]);
    expect(resolveSort(def, q({ key: 'hack' })).col.key).toBe('total_cents');
    expect(resolveSort(def, q({ key: 'note' })).col.key).toBe('total_cents');
    expect(resolveSort(def, q({ key: 'name', dir: 'asc' })).dir).toBe('asc');
    expect(resolveSort(def, q({ key: 'name', dir: 'sideways' as 'asc' })).dir).toBe('desc');
  });
  it('trie les nombres numériquement et met les vides à la fin', () => {
    const col = memoryReport([]).columns[1];
    const rows = [{ total_cents: 5 }, { total_cents: null }, { total_cents: 100 }, { total_cents: 20 }];
    expect(sortRows(rows, col, 'asc').map((r) => r.total_cents)).toEqual([5, 20, 100, null]);
    expect(sortRows(rows, col, 'desc').map((r) => r.total_cents)).toEqual([100, 20, 5, null]);
  });
  it('trie le texte avec les accents et les numéros naturels', () => {
    const col = memoryReport([]).columns[0];
    const rows = [{ name: 'Éric' }, { name: 'Job 10' }, { name: 'Job 9' }, { name: 'alice' }];
    expect(sortRows(rows, col, 'asc').map((r) => r.name)).toEqual(['alice', 'Éric', 'Job 9', 'Job 10']);
  });
});

describe('source mémoire : page, total, totaux, itération', () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: String(i), name: `r${i}`, total_cents: (i + 1) * 100, note: '' }));
  const def = memoryReport(rows);

  it('pagine après tri et totalise sur TOUT le résultat, pas la page', async () => {
    const page = await fetchPage(def, ctx, q(), 2, 10);
    expect(page.total).toBe(23);
    expect(page.rows).toHaveLength(10);
    expect(page.rows[0].total_cents).toBe(1300); // tri desc : 2300..1400 en page 1, 1300 en tête de page 2
    expect(page.totals).toEqual({ total_cents: 100 * (23 * 24) / 2 });
    expect(page.totalsSkipped).toBe(false);
  });
  it('itère toutes les lignes dans le même ordre que l écran', async () => {
    const out: Row[] = [];
    for await (const batch of iterateAll(def, ctx, q({ key: 'name', dir: 'asc' }))) out.push(...batch);
    expect(out).toHaveLength(23);
    expect(out[0].name).toBe('r0');
    expect(out[22].name).toBe('r22');
    expect((await countAll(def, ctx, q())).total).toBe(23);
  });
});

describe('source query : le builder reçoit tri + range et le total vient du count', () => {
  it('appelle order/range et enrichit les lignes', async () => {
    const calls: string[] = [];
    const fakeRows = [{ id: 'a', amount: 5 }, { id: 'b', amount: 7 }];
    const builder: any = {
      order: (c: string, o: any) => { calls.push(`order:${c}:${o.ascending}`); return builder; },
      range: (a: number, b: number) => { calls.push(`range:${a}-${b}`); return builder; },
      then: (resolve: any) => resolve({ data: fakeRows, error: null, count: 2 }),
    };
    const def: ReportDefinition = {
      ...memoryReport([]),
      columns: [
        { key: 'id', label: { fr: 'Id', en: 'Id' }, type: 'text', sortable: true },
        { key: 'amount_cents', label: { fr: 'M', en: 'M' }, type: 'money', sortable: true, sortKey: 'amount', total: 'sum' },
        { key: 'label', label: { fr: 'L', en: 'L' }, type: 'text' },
      ],
      defaultSort: { key: 'amount_cents', dir: 'desc' },
      source: {
        kind: 'query',
        build: () => builder,
        map: (raw) => ({ id: raw.id, amount_cents: Number(raw.amount) * 100, label: '' }),
        enrich: async (rows) => { for (const r of rows) r.label = `L-${r.id}`; },
      },
    };
    const page = await fetchPage(def, ctx, q(), 1, 50);
    expect(calls[0]).toBe('order:amount:false'); // sortKey utilisé, desc
    expect(calls).toContain('range:0-49');
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.label)).toEqual(['L-a', 'L-b']);
    expect(page.totals).toEqual({ amount_cents: 1200 });
  });
});

describe('bornes de période (fuseau America/Toronto)', () => {
  it('convertit une date seule en instants UTC du début du jour et du lendemain', () => {
    expect(startOfDayIso('2026-07-01')).toBe('2026-07-01T04:00:00.000Z'); // EDT
    expect(startOfDayIso('2026-01-15')).toBe('2026-01-15T05:00:00.000Z'); // EST
    expect(endOfDayExclusiveIso('2026-07-01')).toBe('2026-07-02T04:00:00.000Z');
  });
  it('applique gte/lt sur un timestamp et gte/lte sur une date', () => {
    const calls: string[] = [];
    const b: any = {
      gte: (c: string, v: string) => { calls.push(`gte:${c}:${v}`); return b; },
      lte: (c: string, v: string) => { calls.push(`lte:${c}:${v}`); return b; },
      lt: (c: string, v: string) => { calls.push(`lt:${c}:${v}`); return b; },
    };
    applyPeriod(b, 'paid_at', 'timestamp', '2026-07-01', '2026-07-31');
    applyPeriod(b, 'due_date', 'date', '2026-07-01', '2026-07-31');
    applyPeriod(b, 'x', 'date', 'pas-une-date', undefined);
    expect(calls).toEqual([
      'gte:paid_at:2026-07-01T04:00:00.000Z', 'lt:paid_at:2026-08-01T04:00:00.000Z',
      'gte:due_date:2026-07-01', 'lte:due_date:2026-07-31',
    ]);
  });
  it('inPeriod / toLocalDate / addDays / daysBetween', () => {
    expect(toLocalDate('2026-07-02T02:00:00Z')).toBe('2026-07-01');
    expect(inPeriod('2026-07-02T02:00:00Z', 'timestamp', '2026-07-01', '2026-07-01')).toBe(true);
    expect(inPeriod('2026-07-02T05:00:00Z', 'timestamp', '2026-07-01', '2026-07-01')).toBe(false);
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });
});

describe('helpers', () => {
  it('applySearch échappe les métacaractères et retire les séparateurs PostgREST', () => {
    const calls: string[] = [];
    const b: any = { or: (s: string) => { calls.push(s); return b; } };
    applySearch(b, ' 50% (test), x_y ', ['a', 'b']);
    expect(calls[0]).toBe('a.ilike.%50\\% test x\\_y%,b.ilike.%50\\% test x\\_y%');
    expect(applySearch(b, '   ', ['a'])).toBe(b);
    expect(calls).toHaveLength(1);
  });
  it('eqFilter ignore all et vide', () => {
    const calls: string[] = [];
    const b: any = { eq: (c: string, v: string) => { calls.push(`${c}=${v}`); return b; } };
    eqFilter(b, 'all', 'status'); eqFilter(b, '', 'status'); eqFilter(b, undefined, 'status'); eqFilter(b, 'paid', 'status');
    expect(calls).toEqual(['status=paid']);
  });
  it('dollarsToCents et hoursBetween', () => {
    expect(dollarsToCents('12.345')).toBe(1235);
    expect(dollarsToCents(null)).toBe(0);
    expect(hoursBetween('2026-01-01T08:00:00Z', '2026-01-01T09:30:00Z')).toBe(1.5);
    expect(hoursBetween('2026-01-01T09:00:00Z', '2026-01-01T08:00:00Z')).toBeNull();
  });
});

describe('feuilles de temps : pauses et heures', () => {
  it('additionne les pauses en HH:MM ou en ISO', () => {
    expect(feuilles.breakMinutes([{ start: '12:00', end: '12:30' }, { start: '15:00', end: '15:15' }])).toBe(45);
    expect(feuilles.breakMinutes([{ start: '2026-01-01T12:00:00Z', end: '2026-01-01T12:20:00Z' }])).toBe(20);
    expect(feuilles.breakMinutes([{ start: '12:00' }])).toBe(0);
    expect(feuilles.breakMinutes(null)).toBe(0);
  });
  it('calcule les heures nettes des pauses, à partir des horodatages sinon des heures', () => {
    expect(feuilles.timesheetHours({ punch_in_at: '2026-01-01T13:00:00Z', punch_out_at: '2026-01-01T21:30:00Z', breaks: [{ start: '12:00', end: '12:30' }] })).toBe(8);
    expect(feuilles.timesheetHours({ punch_in: '08:00:00', punch_out: '16:00:00', breaks: [] })).toBe(8);
    expect(feuilles.timesheetHours({ punch_in: '08:00:00', punch_out: null, breaks: [] })).toBeNull();
  });
});
