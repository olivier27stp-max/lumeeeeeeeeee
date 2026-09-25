/**
 * Export Excel (.xlsx) des rapports — écrit en flux (exceljs WorkbookWriter),
 * donc la mémoire reste plate quel que soit le nombre de lignes.
 *
 * Ce qu'un comptable attend d'un classeur « propre » :
 *  - un bloc d'en-tête (entreprise, rapport, période, filtres, auteur) ;
 *  - une ligne d'en-têtes de colonnes stylée, figée au défilement, filtrable ;
 *  - de VRAIS nombres et de VRAIES dates (pas du texte) avec un format
 *    d'affichage : les montants se somment, les dates se trient ;
 *  - une ligne de totaux en formules SUM, qui se recalculent si on filtre ;
 *  - une mise en page paysage ajustée à la largeur pour l'impression.
 *
 * Les valeurs texte restent des chaînes (jamais interprétées comme formules
 * par Excel), donc pas de neutralisation à faire — contrairement au CSV.
 */
import ExcelJS from 'exceljs';
import type { Writable } from 'stream';
import { FUSEAU_PAR_DEFAUT } from '../date-seule';
import type { Lang, ReportColumn, Row } from './types';
import type { ExportMeta } from './meta';

/** Ligne des en-têtes de colonnes (1-based) : 5 lignes de bloc d'en-tête + 1 vide. */
export const XLSX_HEADER_ROW = 7;

const INK = 'FF171717';
const INK_SOFT = 'FF6B6B6B';
const HEADER_FILL = 'FF171717';
const HEADER_TEXT = 'FFFFFFFF';
const TOTAL_FILL = 'FFF3F4F6';
const LINE = 'FFE5E7EB';
const FONT = 'Calibri';

const NUMERIC_TYPES = new Set(['money', 'integer', 'number', 'hours', 'percent']);

export function numFmt(col: ReportColumn, lang: Lang): string | undefined {
  switch (col.type) {
    case 'money': return lang === 'fr' ? '#,##0.00 "$";[Red]-#,##0.00 "$"' : '"$"#,##0.00;[Red]-"$"#,##0.00';
    case 'integer': return '#,##0';
    case 'number': return '#,##0.##';
    case 'hours': return '0.00';
    case 'percent': return '0.0" %"';
    case 'date': return 'yyyy-mm-dd';
    case 'datetime': return 'yyyy-mm-dd hh:mm';
    default: return undefined;
  }
}

/** Largeur (en caractères Excel) selon le type et la largeur suggérée à l'écran. */
export function columnWidth(col: ReportColumn): number {
  switch (col.type) {
    case 'money': return 15;
    case 'date': return 12;
    case 'datetime': return 18;
    case 'integer': case 'number': case 'hours': case 'percent': return 11;
    case 'enum': return 16;
    default: {
      const w = String(col.width || '');
      const fr = w.endsWith('fr') ? Number(w.slice(0, -2)) : NaN;
      if (Number.isFinite(fr)) return Math.min(50, Math.max(18, Math.round(fr * 24)));
      const px = w.endsWith('px') ? Number(w.slice(0, -2)) : NaN;
      if (Number.isFinite(px)) return Math.min(50, Math.max(10, Math.round(px / 7)));
      return 24;
    }
  }
}

function localParts(value: unknown, tz: string): Date | null {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Excel n'a pas de fuseau : on écrit les composantes LOCALES de l'org comme
  // si elles étaient UTC, ce qu'exceljs sérialise tel quel.
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')));
}

/** Valeur de cellule typée pour exceljs (nombre, Date UTC ou chaîne). */
export function xlsxValue(col: ReportColumn, value: unknown, lang: Lang, tz: string = FUSEAU_PAR_DEFAUT): number | Date | string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (col.type) {
    case 'money': {
      const cents = Number(value);
      return Number.isFinite(cents) ? Math.round(cents) / 100 : null;
    }
    case 'integer': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    case 'number': case 'hours': case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'date': {
      const s = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
      }
      const local = localParts(value, tz);
      return local ? new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())) : null;
    }
    case 'datetime':
      return localParts(value, tz);
    case 'enum': {
      const key = String(value);
      const label = col.labels?.[key];
      return label ? label[lang] : key;
    }
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** Nom d'onglet Excel valide (31 caractères max, sans []:*?/\). */
export function sheetName(title: string): string {
  const cleaned = title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Rapport').slice(0, 31);
}

function colLetter(index1: number): string {
  let n = index1; let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export interface XlsxInput {
  columns: ReportColumn[];
  meta: ExportMeta;
  rows: AsyncIterable<Row[]>;
  tz?: string;
}

/**
 * Écrit le classeur complet dans `out` et résout quand tout est vidé.
 * Une seule feuille ; l'en-tête de colonnes est figé et filtrable ; la ligne
 * de totaux (formules) suit la dernière ligne de données.
 */
export async function writeXlsx(out: Writable, input: XlsxInput): Promise<number> {
  const { columns, meta } = input;
  const lang = meta.lang;
  const fr = lang === 'fr';
  const tz = input.tz || FUSEAU_PAR_DEFAUT;
  const n = columns.length;
  const lastCol = colLetter(n);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = 'Lume CRM';
  wb.created = new Date(meta.generatedAt);

  const ws = wb.addWorksheet(sheetName(meta.title), {
    views: [{ state: 'frozen', ySplit: XLSX_HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: {
      oddHeader: `&L&"${FONT},Bold"${meta.company || ''}&R${meta.title}`,
      oddFooter: `&L${meta.period}&C${fr ? 'Page' : 'Page'} &P / &N&R${meta.generatedAtLabel}`,
    },
  });
  ws.columns = columns.map((c) => ({ key: c.key, width: columnWidth(c) }));

  // ── Bloc d'en-tête ─────────────────────────────────────────────
  const filtersText = meta.filters.map((f) => `${f.label} : ${f.value}`).join(' · ');
  const headerBlock: Array<{ text: string; size: number; bold: boolean; color: string }> = [
    { text: meta.company || (fr ? 'Rapport' : 'Report'), size: 14, bold: true, color: INK },
    { text: meta.title, size: 12, bold: true, color: INK },
    { text: `${fr ? 'Période' : 'Period'} : ${meta.period}${filtersText ? `   ·   ${filtersText}` : ''}`, size: 10, bold: false, color: INK_SOFT },
    { text: `${fr ? 'Généré le' : 'Generated'} ${meta.generatedAtLabel}${meta.generatedBy ? ` ${fr ? 'par' : 'by'} ${meta.generatedBy}` : ''} · ${meta.rowCount.toLocaleString(fr ? 'fr-CA' : 'en-CA')} ${fr ? 'ligne(s)' : 'row(s)'}`, size: 10, bold: false, color: INK_SOFT },
    { text: meta.description, size: 9, bold: false, color: INK_SOFT },
  ];
  headerBlock.forEach((h, i) => {
    const row = ws.addRow([h.text]);
    row.height = i === 0 ? 24 : i === 1 ? 20 : 16;
    const cell = row.getCell(1);
    cell.font = { name: FONT, size: h.size, bold: h.bold, italic: i === 4, color: { argb: h.color } };
    cell.alignment = { vertical: 'middle' };
    if (n > 1) ws.mergeCells(row.number, 1, row.number, n);
    row.commit();
  });
  ws.addRow([]).commit();

  // ── En-têtes de colonnes ───────────────────────────────────────
  const header = ws.addRow(columns.map((c) => c.label[lang]));
  header.height = 22;
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: NUMERIC_TYPES.has(c.type) ? 'right' : 'left', wrapText: false };
  });
  header.commit();
  if (header.number !== XLSX_HEADER_ROW) throw new Error(`xlsx: ligne d'en-tête attendue en ${XLSX_HEADER_ROW}, obtenue ${header.number}`);

  // ── Données ────────────────────────────────────────────────────
  const fmts = columns.map((c) => numFmt(c, lang));
  let written = 0;
  for await (const batch of input.rows) {
    for (const r of batch) {
      const row = ws.addRow(columns.map((c) => xlsxValue(c, r[c.key], lang, tz)));
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.font = { name: FONT, size: 10, color: { argb: INK } };
        if (fmts[i]) cell.numFmt = fmts[i] as string;
        cell.alignment = { vertical: 'middle', horizontal: NUMERIC_TYPES.has(c.type) ? 'right' : 'left' };
        cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      });
      row.commit();
      written += 1;
    }
  }

  // ── Totaux (formules : se recalculent si l'utilisateur filtre dans Excel) ──
  const firstData = XLSX_HEADER_ROW + 1;
  const lastData = XLSX_HEADER_ROW + written;
  const totalCols = columns.filter((c) => c.total === 'sum');
  if (totalCols.length && written > 0) {
    const values = columns.map((c, i) => {
      if (c.total === 'sum') return { formula: `SUBTOTAL(109,${colLetter(i + 1)}${firstData}:${colLetter(i + 1)}${lastData})` };
      return i === 0 ? (fr ? 'Totaux' : 'Totals') : null;
    });
    const totalRow = ws.addRow(values);
    totalRow.height = 20;
    columns.forEach((c, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      cell.border = { top: { style: 'thin', color: { argb: INK } } };
      cell.alignment = { vertical: 'middle', horizontal: NUMERIC_TYPES.has(c.type) ? 'right' : 'left' };
      if (fmts[i] && c.total === 'sum') cell.numFmt = fmts[i] as string;
    });
    totalRow.commit();
  }

  ws.autoFilter = `A${XLSX_HEADER_ROW}:${lastCol}${Math.max(XLSX_HEADER_ROW, lastData)}`;
  await ws.commit();
  await wb.commit();
  return written;
}
