/**
 * Rapports (Réglages → Rapports) — client de l'API /api/reports/*.
 *
 * Toutes les pages et boutons « Exporter CSV » de l'app passent par ici :
 * une seule logique de filtres, de colonnes et d'échappement, côté serveur.
 */
import { supabase } from './supabase';

export type Lang = 'fr' | 'en';
export type Bilingue = { fr: string; en: string };
export type ReportCategory = 'finances' | 'operations' | 'team' | 'clients' | 'field';
export type ColumnType = 'text' | 'money' | 'date' | 'datetime' | 'integer' | 'number' | 'hours' | 'percent' | 'enum';

export interface ReportColumn {
  key: string;
  label: Bilingue;
  type: ColumnType;
  sortable?: boolean;
  total?: 'sum';
  labels?: Record<string, Bilingue>;
  width?: string;
}

export interface FilterOption { value: string; label: Bilingue }

export interface ReportFilter {
  key: string;
  label: Bilingue;
  type: 'select' | 'search';
  options: FilterOption[];
  default?: string;
  placeholder?: Bilingue;
}

export type PeriodPreset = 'thisMonth' | 'last30' | 'last90' | 'last12m' | 'thisYear' | 'all';

export interface DateFilterSpec {
  label: Bilingue;
  default: PeriodPreset;
  fields?: FilterOption[];
}

export interface ReportSummary {
  id: string;
  category: ReportCategory;
  title: Bilingue;
  description: Bilingue;
  link: string | null;
}

export interface ReportCatalogue {
  categories: Array<{ key: ReportCategory; label: Bilingue }>;
  reports: ReportSummary[];
  canExport: boolean;
  exportMaxRows: number;
}

export interface ReportDefinition {
  id: string;
  category: ReportCategory;
  title: Bilingue;
  description: Bilingue;
  columns: ReportColumn[];
  filters: ReportFilter[];
  dateFilter: DateFilterSpec | null;
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  link: string | null;
}

export interface ReportParams {
  from?: string;
  to?: string;
  dateField?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  /** Filtres nommés (clé → valeur) ; vide ou 'all' = sans filtre. */
  filters?: Record<string, string | undefined>;
  lang?: Lang;
}

export interface ReportRows {
  rows: Record<string, unknown>[];
  total: number;
  totals: Record<string, number> | null;
  totalsSkipped: boolean;
  page: number;
  pageSize: number;
  exportMaxRows: number;
}

export class ReportExportTooLarge extends Error {
  total: number;
  max: number;
  constructor(message: string, total: number, max: number) {
    super(message);
    this.name = 'ReportExportTooLarge';
    this.total = total;
    this.max = max;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  // Office actif — le serveur scope dessus si l'utilisateur en est membre.
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch { activeOrg = ''; }
  return { Authorization: `Bearer ${token}`, 'x-org-id': activeOrg };
}

function toQueryString(params: ReportParams & { report: string }): string {
  const qs = new URLSearchParams();
  qs.set('report', params.report);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.dateField) qs.set('dateField', params.dateField);
  if (params.sort) qs.set('sort', params.sort);
  if (params.dir) qs.set('dir', params.dir);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.lang) qs.set('lang', params.lang);
  for (const [k, v] of Object.entries(params.filters || {})) {
    if (v && v !== 'all') qs.set(`f_${k}`, v);
  }
  return qs.toString();
}

async function apiGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchReportCatalogue(lang: Lang): Promise<ReportCatalogue> {
  return apiGet<ReportCatalogue>(`/reports/catalogue?lang=${lang}`);
}

export function fetchReportDefinition(reportId: string, lang: Lang): Promise<ReportDefinition> {
  return apiGet<ReportDefinition>(`/reports/definition?report=${encodeURIComponent(reportId)}&lang=${lang}`);
}

export function fetchReportRows(reportId: string, params: ReportParams): Promise<ReportRows> {
  return apiGet<ReportRows>(`/reports/rows?${toQueryString({ ...params, report: reportId })}`);
}

/**
 * Télécharge le CSV complet (toutes les lignes filtrées et triées). Lève
 * ReportExportTooLarge quand le serveur refuse au-delà du plafond.
 */
export async function downloadReportCsv(reportId: string, params: ReportParams): Promise<{ blob: Blob; fileName: string; rows: number }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/reports/export.csv?${toQueryString({ ...params, report: reportId })}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 413 && body?.code === 'EXPORT_TOO_LARGE') {
      throw new ReportExportTooLarge(body.error || 'Export too large', Number(body.total) || 0, Number(body.max) || 0);
    }
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="?([^";]+)"?/i);
  const fileName = match?.[1] || `rapport-${reportId}.csv`;
  const rows = Number(res.headers.get('X-Report-Rows')) || 0;
  return { blob: await res.blob(), fileName, rows };
}

/** Déclenche l'enregistrement d'un Blob côté navigateur. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Télécharge et enregistre en une étape (raccourci pour les boutons des pages). */
export async function exportReportToFile(reportId: string, params: ReportParams): Promise<number> {
  const { blob, fileName, rows } = await downloadReportCsv(reportId, params);
  saveBlob(blob, fileName);
  return rows;
}
