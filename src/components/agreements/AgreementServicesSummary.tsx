import React from 'react';
import { formatCents } from '../../lib/jobCalc';
import { useTranslation } from '../../i18n';

export interface AgreementSummaryData {
  items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
  subtotalCents: number;
  /** Quote discount (jobs have none). */
  discount?: { amountCents: number; percent?: number | null } | null;
  taxLines: Array<{ label: string; rate: number; amount_cents: number }>;
  totalCents: number;
}

/**
 * Compact, app-styled recap of the services and prices an agreement covers —
 * shown inside the job/quote creation forms and the hub contract cards so the
 * agreement visibly matches its page. The public document renders the same
 * numbers via AgreementDocument (snapshot once signed).
 */
export default function AgreementServicesSummary({ data, title }: { data: AgreementSummaryData; title?: string }) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  return (
    <div className="rounded-lg border border-outline-subtle bg-surface-secondary/40 px-3.5 py-3">
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.05em] mb-2">
        {title || (fr ? 'Services et prix au contrat' : 'Services and prices on the contract')}
      </p>
      <div className="space-y-1.5">
        {data.items.length === 0 ? (
          <p className="text-[12px] text-text-tertiary py-0.5">
            {fr
              ? 'Aucun service nommé — les items de cette page apparaîtront ici et au contrat.'
              : 'No named services — items on this page will appear here and on the contract.'}
          </p>
        ) : (
          data.items.map((item, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 truncate font-medium text-text-primary">
                {item.name}
                <span className="font-normal text-text-tertiary"> · {item.qty} × {formatCents(item.unit_price_cents)}</span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-text-primary">{formatCents(item.total_cents)}</span>
            </div>
          ))
        )}
        {/* Totals always visible — a manual-total job/quote has prices to mirror even without named items */}
        <div className="border-t border-outline-subtle pt-1.5 mt-1.5 space-y-1 text-[12px]">
          <div className="flex justify-between">
            <span className="text-text-tertiary">{fr ? 'Sous-total' : 'Subtotal'}</span>
            <span className="tabular-nums text-text-secondary">{formatCents(data.subtotalCents)}</span>
          </div>
          {data.discount && data.discount.amountCents > 0 && (
            <div className="flex justify-between">
              <span className="text-text-tertiary">
                {(fr ? 'Rabais' : 'Discount') + (data.discount.percent ? ` (${data.discount.percent}%)` : '')}
              </span>
              <span className="tabular-nums text-danger">-{formatCents(data.discount.amountCents)}</span>
            </div>
          )}
          {data.taxLines.map((tax, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-text-tertiary">{tax.label} ({tax.rate}%)</span>
              <span className="tabular-nums text-text-secondary">{formatCents(tax.amount_cents)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-outline-subtle pt-1.5 mt-1 text-[13px]">
            <span className="font-bold text-text-primary">Total</span>
            <span className="tabular-nums font-bold text-text-primary">{formatCents(data.totalCents)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
