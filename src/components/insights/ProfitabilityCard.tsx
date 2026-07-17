/**
 * Profitability by job — the real P&L table. Revenue is the job total; labour is
 * derived from time entries × each employee's hourly rate; expenses are entered
 * per job right here (inline-editable "Dépenses" cell → margin updates live).
 * Monochrome, wired to fetchJobPnL over the selected period.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJobPnL, updateJobExpenses } from '../../lib/profitabilityApi';
import { useTranslation } from '../../i18n';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod, type InsightsRange } from '../../lib/insightsPeriod';

function ExpenseInput({ jobId, cents, onSaved }: { jobId: string; cents: number; onSaved: () => void }) {
  const [val, setVal] = useState(cents > 0 ? String(cents / 100) : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(cents > 0 ? String(cents / 100) : ''); }, [cents]);

  const commit = async () => {
    const dollars = parseFloat(val.replace(/\s/g, '').replace(',', '.')) || 0;
    const newCents = Math.round(dollars * 100);
    if (newCents === cents) return;
    setSaving(true);
    try { await updateJobExpenses(jobId, newCents); onSaved(); } catch { setVal(cents > 0 ? String(cents / 100) : ''); } finally { setSaving(false); }
  };

  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      <span className="text-text-tertiary text-[12px]">$</span>
      <input
        value={val}
        inputMode="decimal"
        placeholder="0"
        disabled={saving}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        onClick={(e) => e.stopPropagation()}
        className="w-16 bg-transparent text-right tabular-nums text-text-primary border-b border-dashed border-border focus:border-text-primary focus:outline-none py-0.5 disabled:opacity-50"
      />
    </span>
  );
}

export default function ProfitabilityCard({
  range,
  period,
  onPeriod,
}: {
  range: InsightsRange;
  period: InsightsPeriod;
  onPeriod: (p: InsightsPeriod) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const qc = useQueryClient();

  const key = ['job-pnl', range.from, range.to];
  const q = useQuery({ queryKey: key, queryFn: () => fetchJobPnL({ from: range.from, to: range.to }), staleTime: 30_000 });

  const k = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
  const data = q.data;
  const rows = data?.rows || [];
  const onSaved = () => qc.invalidateQueries({ queryKey: key });

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{fr ? 'Rentabilité par job' : 'Profitability by job'}</div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {q.isLoading ? (
        <div className="h-[140px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-[12.5px] text-text-tertiary">{fr ? 'Aucun job complété sur la période' : 'No completed jobs for this period'}</div>
      ) : (
        <>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
                  <th className="text-left font-bold px-6 py-3 bg-surface-secondary border-b border-border">Client</th>
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">Job&nbsp;#</th>
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Montant' : 'Amount'}</th>
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? "Main-d'œuvre" : 'Labour'}</th>
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Dépenses' : 'Expenses'}</th>
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Profit' : 'Profit'}</th>
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Marge' : 'Margin'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.job_id} className="hover:bg-surface-secondary">
                    <td className="px-6 py-3 font-semibold text-text-primary border-b border-border-light">{r.client_name}</td>
                    <td className="px-6 py-3 text-right font-semibold text-text-secondary tabular-nums border-b border-border-light">{r.job_number}</td>
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums border-b border-border-light">{k(r.revenue_cents)}</td>
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums border-b border-border-light">{k(r.labour_cents)}</td>
                    <td className="px-6 py-3 text-right border-b border-border-light"><ExpenseInput jobId={r.job_id} cents={r.expenses_cents} onSaved={onSaved} /></td>
                    <td className="px-6 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">{k(r.profit_cents)}</td>
                    <td className="px-6 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">
                      <span className="inline-block w-11 h-[5px] rounded-full bg-surface-tertiary overflow-hidden align-middle mr-2"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, r.margin_pct))}%`, background: 'var(--color-text-primary)' }} /></span>{r.margin_pct} %
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-surface-secondary">
                  <td className="px-6 py-3.5 border-t border-border">Total</td><td className="border-t border-border" />
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_revenue_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_labour_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_expenses_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_profit_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{data?.margin_pct ?? 0} %</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {(data?.total_expenses_cents || 0) === 0 && (data?.total_labour_cents || 0) === 0 && (
            <div className="px-6 mt-3 text-[11.5px] text-text-tertiary">{fr ? '↑ Tape les dépenses par job pour une marge réelle. La main-d’œuvre se calcule à partir des heures × taux horaire des employés.' : '↑ Enter expenses per job for a real margin. Labour is computed from hours × employee hourly rate.'}</div>
          )}
        </>
      )}
    </div>
  );
}
