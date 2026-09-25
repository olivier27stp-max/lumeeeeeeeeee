/**
 * Écriture CSV des rapports.
 *
 * Conventions (mêmes que l'export de paie, qui est lu par Excel/QuickBooks
 * sans mauvaise surprise) :
 *  - BOM UTF-8 en tête pour que les accents s'affichent dans Excel ;
 *  - séparateur virgule, fins de ligne CRLF ;
 *  - CHAQUE champ entre guillemets, guillemets internes doublés ;
 *  - neutralisation de l'injection de formule (`=`, `+`, `-`, `@` en tête)
 *    via le neutraliseur partagé de la migration assistée ;
 *  - montants en dollars avec point décimal et deux décimales (1234.56),
 *    dates seules en YYYY-MM-DD, horodatages en « YYYY-MM-DD HH:mm » local.
 */
import { sanitizeCellForDisplay } from '../migration/masks';
import type { Lang, ReportColumn, Row } from './types';
import { toLocalDate, toLocalDateTime } from './dates';

export const CSV_BOM = '﻿';

export function csvCell(value: unknown): string {
  const text = sanitizeCellForDisplay(String(value ?? ''));
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}

/** Valeur d'une cellule formatée pour le CSV selon le type de colonne. */
export function formatCsvValue(col: ReportColumn, value: unknown, lang: Lang): string {
  if (value === null || value === undefined || value === '') return '';
  switch (col.type) {
    case 'money': {
      const cents = Number(value);
      return Number.isFinite(cents) ? (cents / 100).toFixed(2) : '';
    }
    case 'date':
      // Date seule (10 caractères) telle quelle ; un timestamp est ramené à
      // la date LOCALE de l'org (pas la date UTC, qui décale les soirées).
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toLocalDate(value);
    case 'datetime':
      return toLocalDateTime(value);
    case 'hours': {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : '';
    }
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(1) : '';
    }
    case 'integer': {
      const n = Number(value);
      return Number.isFinite(n) ? String(Math.round(n)) : '';
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : '';
    }
    case 'enum': {
      const key = String(value);
      const label = col.labels?.[key];
      return label ? label[lang] : key;
    }
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

export function csvHeader(columns: ReportColumn[], lang: Lang): string {
  return CSV_BOM + csvLine(columns.map((c) => c.label[lang]));
}

export function csvRows(columns: ReportColumn[], rows: Row[], lang: Lang): string {
  let out = '';
  for (const row of rows) out += csvLine(columns.map((c) => formatCsvValue(c, row[c.key], lang)));
  return out;
}

/** Nom de fichier sûr : `rapport-<id>-<from>_<to>.<ext>` (ext = csv, xlsx, pdf). */
export function exportFilename(reportId: string, ext: 'csv' | 'xlsx' | 'pdf', from?: string, to?: string, today?: string): string {
  const safe = reportId.replace(/[^a-z0-9-]/gi, '');
  const period = from || to ? `${from || 'debut'}_${to || 'fin'}` : (today || new Date().toISOString().slice(0, 10));
  return `rapport-${safe}-${period}.${ext}`;
}

/** Nom de fichier CSV (alias historique de exportFilename). */
export function csvFilename(reportId: string, from?: string, to?: string, today?: string): string {
  return exportFilename(reportId, 'csv', from, to, today);
}
