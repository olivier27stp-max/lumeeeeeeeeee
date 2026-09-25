import React from 'react';
import type { Lang, ReportColumn } from '../../lib/reportsApi';
import { formatTotal } from '../../lib/reportFormat';

interface ReportSummaryProps {
  columns: ReportColumn[];
  total: number;
  totals: Record<string, number> | null;
  totalsSkipped: boolean;
  loading: boolean;
  lang: Lang;
  /** Période et filtres en clair, affichés sous les chiffres. */
  context: string[];
}

/**
 * Bande de chiffres clés au-dessus du tableau : nombre de lignes et totaux
 * des colonnes sommables, calculés côté serveur sur TOUT le résultat filtré
 * (pas seulement la page affichée). Le PDF reprend ces mêmes cases.
 */
export default function ReportSummary({ columns, total, totals, totalsSkipped, loading, lang, context }: ReportSummaryProps) {
  const fr = lang === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const sumCols = columns.filter((c) => c.total === 'sum').slice(0, 6);
  const tiles: Array<{ key: string; label: string; value: string; muted?: boolean }> = [
    { key: '__rows', label: fr ? 'Lignes' : 'Rows', value: total.toLocaleString(locale) },
    ...sumCols.map((c) => ({
      key: c.key,
      label: c.label[lang],
      value: totalsSkipped ? '—' : totals && totals[c.key] !== undefined ? formatTotal(c, totals[c.key], lang) : (loading ? '…' : '—'),
      muted: totalsSkipped,
    })),
  ];

  return (
    <div className="rounded-xl border border-outline bg-surface-card overflow-hidden mb-4">
      <div className="grid divide-x divide-outline" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
        {tiles.map((t) => (
          <div key={t.key} className="px-4 py-3 min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary truncate">{t.label}</div>
            <div className={`mt-1 text-[20px] font-semibold tracking-tight tabular-nums truncate ${t.muted ? 'text-text-tertiary' : 'text-text-primary'} ${loading ? 'opacity-60' : ''}`}>
              {t.value}
            </div>
          </div>
        ))}
      </div>
      {(context.length > 0 || totalsSkipped) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-t border-outline bg-surface-secondary/60 text-[12px] text-text-secondary">
          {context.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-text-tertiary">·</span>}
              {c}
            </span>
          ))}
          {totalsSkipped && (
            <span className="text-text-tertiary">
              {fr ? 'Totaux non calculés au-delà de 20 000 lignes : réduis la période.' : 'Totals not computed above 20,000 rows: narrow the period.'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
