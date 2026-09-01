/**
 * Profitability by job — the real P&L table. Revenue is the job total; labour is
 * derived from time entries × each employee's hourly rate; expenses are itemized
 * lines (job_expenses) — the "Dépenses" cell opens the per-job breakdown where
 * lines are added/removed (catalog picks included) and the margin updates live.
 * Monochrome, wired to fetchJobPnL over the selected period.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, X } from 'lucide-react';
import { fetchJobPnL } from '../../lib/profitabilityApi';
import ExpensesEditor from '../expenses/ExpensesEditor';
import { useTranslation } from '../../i18n';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod, type InsightsRange } from '../../lib/insightsPeriod';

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
  const [editJob, setEditJob] = useState<{ id: string; label: string } | null>(null);

  const key = ['job-pnl', range.from, range.to];
  const q = useQuery({ queryKey: key, queryFn: () => fetchJobPnL({ from: range.from, to: range.to }), staleTime: 30_000 });

  const k = (cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
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
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">Profit</th>
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
                    <td className="px-6 py-3 text-right border-b border-border-light">
                      <button
                        onClick={() => setEditJob({ id: r.job_id, label: `${r.client_name} — #${r.job_number}` })}
                        className="group inline-flex items-center gap-1.5 tabular-nums text-text-primary border-b border-dashed border-border hover:border-text-primary py-0.5"
                        title={fr ? 'Voir / modifier le détail des dépenses' : 'View / edit expense detail'}
                      >
                        {k(r.expenses_cents)}
                        <Pencil size={11} className="text-text-tertiary group-hover:text-text-primary" />
                      </button>
                    </td>
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
            <div className="px-6 mt-3 text-[11.5px] text-text-tertiary">{fr ? '↑ Clique une cellule Dépenses pour détailler les coûts d’un job (catalogue inclus). La main-d’œuvre se calcule à partir des heures × taux horaire des employés.' : '↑ Click an Expenses cell to itemize a job’s costs (catalog included). Labour is computed from hours × employee hourly rate.'}</div>
          )}
        </>
      )}

      <AnimatePresence>
        {editJob && (
          <motion.div
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setEditJob(null); }}
          >
            <motion.div
              className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl max-h-[85vh] overflow-y-auto"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <div>
                  <h3 className="text-[13px] font-semibold text-text-primary">{fr ? 'Dépenses du job' : 'Job expenses'}</h3>
                  <p className="text-[11.5px] text-text-tertiary">{editJob.label}</p>
                </div>
                <button onClick={() => setEditJob(null)} className="p-1 rounded text-text-tertiary hover:text-text-primary">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5">
                <ExpensesEditor jobId={editJob.id} onChanged={onSaved} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
