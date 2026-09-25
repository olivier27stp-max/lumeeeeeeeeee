/**
 * Moteur des rapports : une seule façon de paginer, trier, totaliser et
 * itérer, quelle que soit la forme de la source (query / memory).
 *
 * Règle d'or : l'écran et le CSV passent par les MÊMES fonctions
 * (`fetchPage` et `iterateAll` partagent build/map/enrich), donc ce qui est
 * exporté est exactement ce qui est affiché, filtres et tri compris.
 */
import {
  BATCH_SIZE, TOTALS_MAX_ROWS,
  type ReportColumn, type ReportContext, type ReportDefinition, type ReportQuery, type Row,
} from './types';

export const COUNT_EXACT = { count: 'exact' as const };

function sortColumn(def: ReportDefinition, key: string | undefined): ReportColumn {
  const col = def.columns.find((c) => c.key === key && c.sortable);
  return col || def.columns.find((c) => c.key === def.defaultSort.key) || def.columns[0];
}

/** Tri sûr : seule une colonne déclarée triable est acceptée, sinon le tri par défaut. */
export function resolveSort(def: ReportDefinition, q: ReportQuery): { col: ReportColumn; dir: 'asc' | 'desc' } {
  const col = sortColumn(def, q.sort?.key);
  const dir = q.sort?.dir === 'asc' || q.sort?.dir === 'desc' ? q.sort.dir : def.defaultSort.dir;
  return { col, dir };
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function compareValues(a: unknown, b: unknown, type: ReportColumn['type']): number {
  if (['money', 'integer', 'number', 'hours', 'percent'].includes(type)) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

/** Tri stable ; les valeurs vides restent en fin de liste dans les deux sens. */
export function sortRows(rows: Row[], col: ReportColumn, dir: 'asc' | 'desc'): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = x[col.key]; const b = y[col.key];
    const aBlank = isBlank(a); const bBlank = isBlank(b);
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;
    if (bBlank) return -1;
    return sign * compareValues(a, b, col.type);
  });
}

function totalColumns(def: ReportDefinition): ReportColumn[] {
  return def.columns.filter((c) => c.total === 'sum');
}

function sumInto(acc: Record<string, number>, cols: ReportColumn[], rows: Row[]) {
  for (const row of rows) {
    for (const c of cols) {
      const n = Number(row[c.key]);
      if (Number.isFinite(n)) acc[c.key] = (acc[c.key] || 0) + n;
    }
  }
}

/** Totaux (colonnes `total: 'sum'`) sur un ensemble de lignes déjà chargé. */
export function sumTotals(def: ReportDefinition, rows: Row[]): Record<string, number> | null {
  const cols = totalColumns(def);
  if (!cols.length) return null;
  const acc: Record<string, number> = {};
  sumInto(acc, cols, rows);
  return roundTotals(acc, cols);
}

function roundTotals(acc: Record<string, number>, cols: ReportColumn[]) {
  for (const c of cols) {
    if (!(c.key in acc)) continue;
    acc[c.key] = c.type === 'money' || c.type === 'integer' ? Math.round(acc[c.key]) : Math.round(acc[c.key] * 100) / 100;
  }
  return acc;
}

async function runQueryBatch(def: ReportDefinition, ctx: ReportContext, q: ReportQuery, offset: number, limit: number) {
  if (def.source.kind !== 'query') throw new Error('runQueryBatch: source query attendue');
  const { col, dir } = resolveSort(def, q);
  const builder = def.source.build(ctx, q)
    .order(col.sortKey || col.key, { ascending: dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  const { data, error, count } = await builder;
  if (error) throw new Error(`[reports/${def.id}] ${error.message}`);
  const rows = (data || []).map((raw: Row) => def.source.kind === 'query' ? def.source.map(raw, ctx) : raw);
  return { rows: rows as Row[], count: typeof count === 'number' ? count : null };
}

export interface PageOutput {
  rows: Row[];
  total: number;
  totals: Record<string, number> | null;
  /** true quand les totaux ont été omis parce que le résultat dépasse TOTALS_MAX_ROWS. */
  totalsSkipped: boolean;
}

/** Une page de rapport, prête pour l'écran (lignes enrichies, totaux sur l'ensemble filtré). */
export async function fetchPage(def: ReportDefinition, ctx: ReportContext, q: ReportQuery, page: number, pageSize: number): Promise<PageOutput> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const tCols = totalColumns(def);

  if (def.source.kind === 'memory') {
    const all = await def.source.loadAll(ctx, q);
    const { col, dir } = resolveSort(def, q);
    const sorted = sortRows(all, col, dir);
    const totals: Record<string, number> = {};
    if (tCols.length) sumInto(totals, tCols, all);
    return {
      rows: sorted.slice(offset, offset + pageSize),
      total: all.length,
      totals: tCols.length ? roundTotals(totals, tCols) : null,
      totalsSkipped: false,
    };
  }

  const first = await runQueryBatch(def, ctx, q, offset, pageSize);
  const total = first.count ?? first.rows.length;
  if (def.source.enrich) await def.source.enrich(first.rows, ctx);

  let totals: Record<string, number> | null = null;
  let totalsSkipped = false;
  if (tCols.length) {
    if (total > TOTALS_MAX_ROWS) {
      totalsSkipped = true;
    } else {
      const acc: Record<string, number> = {};
      for (let off = 0; off < total; off += BATCH_SIZE) {
        const batch = off === offset && pageSize >= BATCH_SIZE ? first : await runQueryBatch(def, ctx, q, off, BATCH_SIZE);
        sumInto(acc, tCols, batch.rows);
        if (batch.rows.length < BATCH_SIZE) break;
      }
      totals = roundTotals(acc, tCols);
    }
  }
  return { rows: first.rows, total, totals, totalsSkipped };
}

/** Nombre total de lignes correspondant aux filtres (pour vérifier le plafond d'export). */
export async function countAll(def: ReportDefinition, ctx: ReportContext, q: ReportQuery): Promise<{ total: number; preloaded?: Row[] }> {
  if (def.source.kind === 'memory') {
    const all = await def.source.loadAll(ctx, q);
    return { total: all.length, preloaded: all };
  }
  const { count } = await runQueryBatch(def, ctx, q, 0, 1);
  return { total: count ?? 0 };
}

/**
 * Itère TOUTES les lignes filtrées et triées, par lots enrichis — la source
 * du CSV. `preloaded` évite de recharger une source mémoire déjà comptée.
 */
export async function* iterateAll(def: ReportDefinition, ctx: ReportContext, q: ReportQuery, preloaded?: Row[]): AsyncGenerator<Row[]> {
  if (def.source.kind === 'memory') {
    const all = preloaded ?? await def.source.loadAll(ctx, q);
    const { col, dir } = resolveSort(def, q);
    const sorted = sortRows(all, col, dir);
    for (let i = 0; i < sorted.length; i += BATCH_SIZE) yield sorted.slice(i, i + BATCH_SIZE);
    return;
  }
  for (let off = 0; ; off += BATCH_SIZE) {
    const batch = await runQueryBatch(def, ctx, q, off, BATCH_SIZE);
    if (batch.rows.length === 0) return;
    if (def.source.enrich) await def.source.enrich(batch.rows, ctx);
    yield batch.rows;
    if (batch.rows.length < BATCH_SIZE) return;
  }
}
