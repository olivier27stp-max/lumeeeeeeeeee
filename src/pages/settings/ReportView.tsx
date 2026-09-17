import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import {
  fetchReportDefinition, fetchReportRows, downloadReportCsv, saveBlob, ReportExportTooLarge,
  type ReportParams,
} from '../../lib/reportsApi';
import { presetRange } from '../../lib/reportFormat';
import ReportToolbar, { type ToolbarState } from '../../components/reports/ReportToolbar';
import ReportTable from '../../components/reports/ReportTable';
import { captureClientException } from '../../lib/sentry';

const PAGE_SIZES = [20, 50, 100];

/**
 * Page d'un rapport : filtres → tableau paginé → export CSV complet.
 * L'état (période, filtres, tri, page) vit dans l'URL : un rapport filtré
 * se partage par lien. L'export reprend EXACTEMENT ces paramètres.
 */
export default function ReportView() {
  const { reportId = '' } = useParams();
  const { language } = useTranslation();
  const lang = language === 'fr' ? 'fr' : 'en';
  const fr = lang === 'fr';
  const [searchParams, setSearchParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);

  const defQ = useQuery({
    queryKey: ['report-definition', reportId, lang],
    queryFn: () => fetchReportDefinition(reportId, lang),
    staleTime: 5 * 60_000,
    enabled: !!reportId,
  });
  const definition = defQ.data;

  // ── État lu depuis l'URL ────────────────────────────────────────
  const state = useMemo(() => {
    const filters: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) if (k.startsWith('f_')) filters[k.slice(2)] = v;
    const dir = searchParams.get('dir');
    const pageSize = Number(searchParams.get('pageSize'));
    return {
      from: searchParams.get('from') || '',
      to: searchParams.get('to') || '',
      dateField: searchParams.get('dateField') || '',
      filters,
      sort: searchParams.get('sort') || '',
      dir: (dir === 'asc' || dir === 'desc' ? dir : '') as '' | 'asc' | 'desc',
      page: Math.max(1, Number(searchParams.get('page')) || 1),
      pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 50,
      initialized: searchParams.get('init') === '1',
    };
  }, [searchParams]);

  // Préréglage de période et filtres par défaut appliqués une seule fois à l'ouverture.
  useEffect(() => {
    if (!definition || state.initialized) return;
    const next = new URLSearchParams(searchParams);
    if (definition.dateFilter && !next.get('from') && !next.get('to')) {
      const r = presetRange(definition.dateFilter.default);
      if (r) { next.set('from', r.from); next.set('to', r.to); }
    }
    for (const f of definition.filters) {
      if (f.default && !next.get(`f_${f.key}`)) next.set(`f_${f.key}`, f.default);
    }
    next.set('init', '1');
    setSearchParams(next, { replace: true });
  }, [definition, state.initialized, searchParams, setSearchParams]);

  const update = useCallback((patch: Partial<ToolbarState> & { sort?: string; dir?: 'asc' | 'desc'; page?: number; pageSize?: number }) => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (k: string, v: string | undefined) => { if (v) next.set(k, v); else next.delete(k); };
    if (patch.from !== undefined) setOrDelete('from', patch.from);
    if (patch.to !== undefined) setOrDelete('to', patch.to);
    if (patch.dateField !== undefined) setOrDelete('dateField', patch.dateField);
    if (patch.filters) {
      for (const k of Array.from(next.keys())) if (k.startsWith('f_')) next.delete(k);
      for (const [k, v] of Object.entries(patch.filters)) if (v && v !== 'all') next.set(`f_${k}`, v);
    }
    if (patch.sort !== undefined) setOrDelete('sort', patch.sort);
    if (patch.dir !== undefined) setOrDelete('dir', patch.dir);
    if (patch.pageSize !== undefined) next.set('pageSize', String(patch.pageSize));
    // Tout changement de filtre/tri ramène à la première page.
    if (patch.page !== undefined) next.set('page', String(patch.page)); else next.delete('page');
    next.set('init', '1');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const sort = useMemo(() => ({
    key: state.sort || definition?.defaultSort.key || '',
    dir: (state.dir || definition?.defaultSort.dir || 'desc') as 'asc' | 'desc',
  }), [state.sort, state.dir, definition]);

  const params = useMemo<ReportParams>(() => ({
    from: state.from || undefined,
    to: state.to || undefined,
    dateField: state.dateField || undefined,
    sort: sort.key,
    dir: sort.dir,
    filters: state.filters,
    lang,
  }), [state.from, state.to, state.dateField, state.filters, sort, lang]);

  const rowsQ = useQuery({
    queryKey: ['report-rows', reportId, params, state.page, state.pageSize],
    queryFn: () => fetchReportRows(reportId, { ...params, page: state.page, pageSize: state.pageSize }),
    enabled: !!definition && state.initialized,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const onSort = (key: string) => {
    const dir = sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : 'desc';
    update({ sort: key, dir });
  };

  const total = rowsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const exportMax = rowsQ.data?.exportMaxRows ?? 50_000;
  const tooLarge = total > exportMax;

  const handleExport = async () => {
    if (!definition) return;
    setExporting(true);
    try {
      const { blob, fileName, rows } = await downloadReportCsv(reportId, params);
      saveBlob(blob, fileName);
      toast.success(fr ? `CSV exporté (${rows.toLocaleString('fr-CA')} lignes)` : `CSV exported (${rows.toLocaleString('en-CA')} rows)`);
    } catch (err: unknown) {
      if (err instanceof ReportExportTooLarge) {
        toast.error(err.message);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        captureClientException(err, { where: 'ReportView.export', reportId });
        toast.error(message || (fr ? "Échec de l'export" : 'Export failed'));
      }
    } finally {
      setExporting(false);
    }
  };

  const hasActiveFilters = !!(state.from || state.to || Object.values(state.filters).some((v) => v && v !== 'all'));

  return (
    <div className="max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <Link to="/settings/reports" className="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary hover:text-text-primary mb-2 rounded focus-visible:ring-1 focus-visible:ring-[#94a3b8]">
            <ArrowLeft size={13} /> {fr ? 'Tous les rapports' : 'All reports'}
          </Link>
          <h1 className="text-2xl font-semibold text-text-primary truncate">{definition?.title[lang] || (fr ? 'Rapport' : 'Report')}</h1>
          {definition && <p className="text-sm text-text-tertiary mt-0.5">{definition.description[lang]}</p>}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!definition || exporting || tooLarge || rowsQ.isLoading || total === 0}
          title={tooLarge
            ? (fr ? `Plus de ${exportMax.toLocaleString('fr-CA')} lignes : réduis la période.` : `More than ${exportMax.toLocaleString('en-CA')} rows: narrow the period.`)
            : undefined}
          className="inline-flex items-center gap-2 h-9 px-4 bg-primary text-white rounded-md text-[13px] font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#94a3b8] shrink-0"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {fr ? 'Exporter CSV' : 'Export CSV'}
          {total > 0 && !tooLarge && <span className="opacity-80 tabular-nums">({total.toLocaleString(fr ? 'fr-CA' : 'en-CA')})</span>}
        </button>
      </div>

      {defQ.isError && (
        <div className="mt-4 rounded-2xl border border-outline bg-surface-card p-6 text-sm text-text-secondary">
          {fr ? 'Rapport introuvable ou accès refusé.' : 'Report not found or access denied.'} {(defQ.error as Error)?.message}
        </div>
      )}

      {definition && (
        <>
          <ReportToolbar
            definition={definition}
            lang={lang}
            state={{ from: state.from, to: state.to, dateField: state.dateField, filters: state.filters }}
            onChange={(patch) => update(patch)}
          />

          {tooLarge && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-[12px] text-amber-900 dark:text-amber-200">
              {fr
                ? `Ce résultat compte ${total.toLocaleString('fr-CA')} lignes, au-delà du plafond d'export de ${exportMax.toLocaleString('fr-CA')}. Réduis la période ou ajoute un filtre pour exporter.`
                : `This result has ${total.toLocaleString('en-CA')} rows, above the ${exportMax.toLocaleString('en-CA')} row export limit. Narrow the period or add a filter to export.`}
            </div>
          )}

          {rowsQ.isError && (
            <div className="mb-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-[12px] text-red-800 dark:text-red-200">
              {(rowsQ.error as Error)?.message || (fr ? 'Erreur de chargement.' : 'Load error.')}
            </div>
          )}

          <ReportTable
            columns={definition.columns}
            rows={rowsQ.data?.rows || []}
            totals={rowsQ.data?.totals ?? null}
            totalsSkipped={rowsQ.data?.totalsSkipped ?? false}
            loading={rowsQ.isFetching}
            lang={lang}
            sort={sort}
            onSort={onSort}
            hasActiveFilters={hasActiveFilters}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
            <span className="text-[13px] text-text-secondary tabular-nums">
              {fr ? `${total.toLocaleString('fr-CA')} ligne(s)` : `${total.toLocaleString('en-CA')} row(s)`}
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="report-page-size" className="text-[12px] text-text-tertiary">{fr ? 'Par page' : 'Per page'}</label>
              <select
                id="report-page-size"
                value={state.pageSize}
                onChange={(e) => update({ pageSize: Number(e.target.value) })}
                className="h-9 px-2 text-[13px] bg-surface-card border border-outline rounded-md text-text-primary focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button
                type="button"
                disabled={state.page <= 1}
                onClick={() => update({ page: state.page - 1 })}
                className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] text-text-primary disabled:opacity-40 hover:bg-surface-secondary focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
              >
                {fr ? 'Précédent' : 'Previous'}
              </button>
              <span className="text-[13px] text-text-muted tabular-nums px-1">{state.page} / {totalPages}</span>
              <button
                type="button"
                disabled={state.page >= totalPages}
                onClick={() => update({ page: state.page + 1 })}
                className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] text-text-primary disabled:opacity-40 hover:bg-surface-secondary focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
              >
                {fr ? 'Suivant' : 'Next'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
