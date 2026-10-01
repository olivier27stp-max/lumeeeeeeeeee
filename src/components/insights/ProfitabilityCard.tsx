/**
 * Profitability by job — the real P&L table, from the server action
 * analyze_profitability (same numbers as Lumi). Revenue is invoiced before taxes; labour is
 * derived from time entries × each employee's hourly rate; expenses are entered
 * per job right here (inline-editable "Dépenses" cell → margin updates live).
 * Monochrome, wired to fetchJobPnL over the selected period.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJobPnL, updateJobExpenses, RentabiliteRefusee } from '../../lib/profitabilityApi';
import { useTranslation } from '../../i18n';
import EnteteCarte from './EnteteCarte';
import { type InsightsRange } from '../../lib/insightsPeriod';
import { filtresNonAppliques, type Filtres } from '../../lib/statsFiltres';

function ExpenseInput({ jobId, cents, onSaved }: { jobId: string; cents: number; onSaved: () => void }) {
  const { language } = useTranslation();
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
        aria-label={language === 'fr' ? 'Dépenses du job' : 'Job expenses'}
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

/** Clé et chargement partagés avec la page (export CSV) : une seule lecture. */
export const cleRentabilite = (range: Pick<InsightsRange, 'from' | 'to'>, filtres: Filtres) => ['job-pnl', range.from, range.to, filtres];
export const lireRentabilitePage = (range: Pick<InsightsRange, 'from' | 'to'>, filtres: Filtres) =>
  fetchJobPnL({ from: range.from, to: range.to, filtres: { technicien: filtres.technicien, vendeur: filtres.vendeur, client: filtres.client, service: filtres.service } });

export default function ProfitabilityCard({
  range,
  filtres,
}: {
  range: InsightsRange;
  filtres: Filtres;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const qc = useQueryClient();

  const key = cleRentabilite(range, filtres);
  const q = useQuery({ queryKey: key, queryFn: () => lireRentabilitePage(range, filtres), staleTime: 30_000, refetchOnMount: 'always',
    retry: (n, err) => !(err instanceof RentabiliteRefusee) && n < 2 });

  const k = (cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
  const data = q.data;
  const rows = data?.rows || [];
  const onSaved = () => qc.invalidateQueries({ queryKey: key });

  return (
    <div className="flex flex-col">
      <EnteteCarte titre={fr ? 'Rentabilité par job' : 'Profitability by job'} nonAppliques={filtresNonAppliques('rentabilite', filtres)}
        definition={fr ? 'Avant taxes : facturé moins remboursements − main-d’œuvre − commissions − dépenses' : 'Before taxes: invoiced minus refunds − labour − commissions − expenses'} />

      {q.isLoading ? (
        <div className="h-[140px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" />
      ) : q.isError ? (
        <div role="status" className="h-[120px] flex items-center justify-center px-6 text-center text-[12.5px] text-text-tertiary">
          {q.error instanceof RentabiliteRefusee
            ? (fr ? 'Rentabilité réservée aux rôles qui voient les marges et profits (page Rôles).' : 'Profitability is limited to roles that can view margins & profits (Roles page).')
            : (fr ? 'Rentabilité indisponible pour le moment. Réessaie dans un instant.' : 'Profitability is unavailable right now. Try again in a moment.')}
        </div>
      ) : rows.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-[12.5px] text-text-tertiary">{fr ? 'Aucun job sur la période' : 'No jobs for this period'}</div>
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
                  <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">Commissions</th>
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
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums border-b border-border-light">{k(r.commissions_cents)}</td>
                    <td className="px-6 py-3 text-right border-b border-border-light">{r.expenses_editable
                      ? <ExpenseInput jobId={r.job_id} cents={r.expenses_cents} onSaved={onSaved} />
                      : <span className="text-text-tertiary tabular-nums" title={fr ? 'Dépenses du dossier « Dépenses » de la fiche du job' : 'Expenses from the job’s “Expenses” fields'}>{k(r.expenses_cents)}</span>}</td>
                    <td className="px-6 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">{k(r.profit_cents)}</td>
                    <td className="px-6 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">
                      {r.margin_pct == null ? <span className="text-text-tertiary" title={fr ? 'Pas assez de données pour une marge' : 'Not enough data for a margin'}>—</span> : (<>
                        <span className="inline-block w-11 h-[5px] rounded-full bg-surface-tertiary overflow-hidden align-middle mr-2"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, r.margin_pct))}%`, background: 'var(--color-text-primary)' }} /></span>{r.margin_is_maximum ? '≤ ' : ''}{r.margin_pct} %
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-surface-secondary">
                  <td className="px-6 py-3.5 border-t border-border">Total</td><td className="border-t border-border" />
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_revenue_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_labour_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_commissions_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_expenses_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(data?.total_profit_cents || 0)}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{data?.margin_pct == null ? '—' : `${data.margin_is_maximum ? '≤ ' : ''}${data.margin_pct} %`}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {(fr ? data?.summary_fr : data?.summary_en) && (
            <div className="px-6 mt-3 text-[11.5px] text-text-tertiary leading-relaxed">{fr ? data?.summary_fr : data?.summary_en}</div>
          )}
        </>
      )}
    </div>
  );
}
