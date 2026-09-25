import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, FileBarChart } from 'lucide-react';
import type { Lang, ReportColumn } from '../../lib/reportsApi';
import { formatCell, formatTotal, isNumericColumn } from '../../lib/reportFormat';

interface ReportTableProps {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, number> | null;
  totalsSkipped: boolean;
  loading: boolean;
  lang: Lang;
  sort: { key: string; dir: 'asc' | 'desc' };
  onSort: (key: string) => void;
  hasActiveFilters: boolean;
}

/**
 * Tableau de rapport : grille CSS (même patron que la page Factures), en-tête
 * collant et triable, lignes alternées, squelette de chargement, état vide,
 * ligne de totaux calculée côté serveur sur l'ensemble filtré (pas seulement
 * la page). Les colonnes numériques sont alignées à droite en chiffres
 * tabulaires pour que les montants se lisent en colonne.
 */
export default function ReportTable({ columns, rows, totals, totalsSkipped, loading, lang, sort, onSort, hasActiveFilters }: ReportTableProps) {
  const fr = lang === 'fr';
  const gridTemplateColumns = columns.map((c) => c.width || (isNumericColumn(c) ? '120px' : '1fr')).join(' ');
  const minWidth = Math.max(860, columns.length * 130);
  const hasTotals = totals !== null && columns.some((c) => c.total === 'sum');
  const firstSumIdx = columns.findIndex((c) => c.total === 'sum');

  return (
    <div className="border border-outline rounded-xl overflow-hidden bg-white dark:bg-[#0e0e11] shadow-card">
      <div className="overflow-x-auto max-h-[calc(100vh-260px)] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns, minWidth: `${minWidth}px` }}>
          {columns.map((c) => {
            const active = sort.key === c.key;
            const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
            const align = isNumericColumn(c) ? 'justify-end text-right' : '';
            return (
              <div
                key={c.key}
                className={`sticky top-0 z-10 py-2.5 px-4 bg-surface-secondary border-b border-outline flex items-center text-[11.5px] font-semibold uppercase tracking-wide text-text-secondary ${align}`}
              >
                {c.sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={`inline-flex items-center gap-1 rounded focus-visible:ring-1 focus-visible:ring-[#94a3b8] ${active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    aria-label={fr ? `Trier par ${c.label.fr}` : `Sort by ${c.label.en}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="truncate">{c.label[lang]}</span>
                    <Icon size={12} className={active ? 'opacity-100' : 'opacity-50'} />
                  </button>
                ) : (
                  <span className="truncate">{c.label[lang]}</span>
                )}
              </div>
            );
          })}

          {loading && rows.length === 0 && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              {columns.map((c) => (
                <div key={c.key} className="py-3 px-4 border-b border-outline/30">
                  <div className="h-3.5 w-24 max-w-full bg-surface-tertiary rounded animate-pulse" />
                </div>
              ))}
            </React.Fragment>
          ))}

          {!loading && rows.length === 0 && (
            <div style={{ gridColumn: `span ${columns.length}` }} className="py-20 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center mb-3">
                <FileBarChart size={22} className="text-text-tertiary" />
              </div>
              <div className="text-sm font-semibold text-text-primary">{fr ? 'Aucune ligne pour ces filtres' : 'No rows for these filters'}</div>
              <div className="text-xs text-text-muted mt-1">
                {hasActiveFilters
                  ? (fr ? 'Élargis la période ou retire un filtre.' : 'Widen the period or remove a filter.')
                  : (fr ? 'Aucune donnée à afficher pour le moment.' : 'Nothing to show yet.')}
              </div>
            </div>
          )}

          {rows.map((row, idx) => (
            <React.Fragment key={String(row.id ?? idx)}>
              {columns.map((c) => {
                const raw = row[c.key];
                const text = formatCell(c, raw, lang);
                const numeric = isNumericColumn(c);
                const zebra = idx % 2 === 1 ? 'bg-surface-secondary/40' : '';
                const blank = text === '';
                const negative = numeric && Number(raw) < 0;
                return (
                  <div
                    key={c.key}
                    className={`group py-2 px-4 border-b border-outline/30 text-[13px] flex items-center min-w-0 ${zebra} ${numeric ? 'justify-end tabular-nums' : ''} ${loading ? 'opacity-60' : ''}`}
                    title={typeof raw === 'string' && raw.length > 40 ? raw : undefined}
                  >
                    {c.type === 'enum' && !blank ? (
                      <span className="inline-flex items-center max-w-full px-2 py-0.5 rounded-full bg-surface-secondary border border-outline text-[12px] text-text-secondary truncate">
                        {text}
                      </span>
                    ) : (
                      <span className={`truncate ${blank ? 'text-text-tertiary' : negative ? 'text-red-600 dark:text-red-400' : c.type === 'money' ? 'text-text-primary font-medium' : 'text-text-primary'}`}>
                        {blank ? '—' : text}
                      </span>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}

          {hasTotals && rows.length > 0 && columns.map((c, i) => (
            <div
              key={`total-${c.key}`}
              className={`sticky bottom-0 z-10 py-2.5 px-4 border-t-2 border-text-primary bg-surface-secondary text-[13px] font-semibold text-text-primary flex items-center ${isNumericColumn(c) ? 'justify-end tabular-nums' : ''}`}
            >
              {i === 0 && firstSumIdx !== 0
                ? (fr ? 'Totaux' : 'Totals')
                : (c.total === 'sum' ? formatTotal(c, totals?.[c.key], lang) : '')}
            </div>
          ))}
        </div>
      </div>
      {totalsSkipped && (
        <div className="px-4 py-2 text-[12px] text-text-muted border-t border-outline">
          {fr ? 'Totaux non calculés : plus de 20 000 lignes. Réduis la période pour les obtenir.' : 'Totals not computed: more than 20,000 rows. Narrow the period to get them.'}
        </div>
      )}
    </div>
  );
}
