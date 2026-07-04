/**
 * FinancesOverview — "Vue d'ensemble" tab of the Finances page.
 * A calm, table-first financial summary (no heavy charts):
 *   • 4 KPIs (encaissé, A/R, en retard, facture moyenne)
 *   • Comptes clients — ancienneté (aging) + principaux débiteurs
 *   • Commissions & paie — par représentant + prochaine paie
 * All figures come from existing APIs (invoice KPIs, invoice list, revenue
 * series, commission payroll preview) — nothing is fabricated.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../i18n';
import { formatCurrency } from '../lib/utils';
import {
  fetchInvoicesKpis30d,
  listInvoices,
  formatMoneyFromCents,
  type InvoiceRow,
} from '../lib/invoicesApi';
import { getRevenueSeries } from '../lib/revenueSeriesApi';
import { getPayrollPreview } from '../lib/commissionsApi';
import RevenueOverviewCard from './RevenueOverviewCard';
import type { FsCommissionEntry } from '../types';

/* ── Aging computation ─────────────────────────────────────────── */
type AgingBucket = { key: string; label: string; hint: string; cents: number; count: number };

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeAging(rows: InvoiceRow[], fr: boolean) {
  const today = startOfToday();
  const buckets: AgingBucket[] = [
    { key: 'current', label: fr ? 'Courant' : 'Current', hint: fr ? 'non échu' : 'not due', cents: 0, count: 0 },
    { key: 'd30', label: fr ? '1–30 jours' : '1–30 days', hint: '', cents: 0, count: 0 },
    { key: 'd60', label: fr ? '31–60 jours' : '31–60 days', hint: '', cents: 0, count: 0 },
    { key: 'd90', label: fr ? '61–90 jours' : '61–90 days', hint: '', cents: 0, count: 0 },
    { key: 'd90p', label: fr ? '90 jours et +' : '90+ days', hint: fr ? 'à relancer' : 'follow up', cents: 0, count: 0 },
  ];
  const byBucket = (i: number, cents: number) => {
    buckets[i].cents += cents;
    buckets[i].count += 1;
  };

  // Top debtors, keyed by client
  const debtorMap = new Map<string, { name: string; cents: number; maxDays: number; count: number }>();

  for (const r of rows) {
    const bal = r.balance_cents || 0;
    if (bal <= 0) continue;
    const due = r.due_date ? new Date(r.due_date).getTime() : null;
    const days = due != null ? Math.floor((today - due) / 86_400_000) : 0;

    if (due == null || days <= 0) byBucket(0, bal);
    else if (days <= 30) byBucket(1, bal);
    else if (days <= 60) byBucket(2, bal);
    else if (days <= 90) byBucket(3, bal);
    else byBucket(4, bal);

    const k = r.client_id || r.client_name;
    const prev = debtorMap.get(k) || { name: r.client_name || '—', cents: 0, maxDays: 0, count: 0 };
    prev.cents += bal;
    prev.maxDays = Math.max(prev.maxDays, days);
    prev.count += 1;
    debtorMap.set(k, prev);
  }

  const total = buckets.reduce((s, b) => s + b.cents, 0);
  const debtors = Array.from(debtorMap.values())
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 6);

  return { buckets, total, debtors };
}

/* ── Commissions grouping (per rep) ───────────────────────────── */
type RepRow = { name: string; base: number; commission: number; status: string };

function groupCommissions(entries: FsCommissionEntry[], fr: boolean): RepRow[] {
  const map = new Map<string, { name: string; base: number; commission: number; statuses: Set<string> }>();
  for (const e of entries) {
    const k = e.user_id;
    const prev = map.get(k) || { name: e.rep_name || '—', base: 0, commission: 0, statuses: new Set<string>() };
    prev.base += Number(e.base_amount || 0);
    prev.commission += Number(e.amount || 0);
    prev.statuses.add(e.status);
    map.set(k, prev);
  }
  const statusLabel = (s: Set<string>): string => {
    if (s.has('pending')) return fr ? 'À approuver' : 'To approve';
    if (s.has('approved')) return fr ? 'Approuvé' : 'Approved';
    if (s.has('paid')) return fr ? 'Payé' : 'Paid';
    return '—';
  };
  return Array.from(map.values())
    .map((r) => ({ name: r.name, base: r.base, commission: r.commission, status: statusLabel(r.statuses) }))
    .sort((a, b) => b.commission - a.commission);
}

/* ── Small presentational bits ────────────────────────────────── */
function Kpi({ label, value, sub, loading, danger }: { label: string; value: string; sub?: string; loading?: boolean; danger?: boolean }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl p-4">
      <div className="text-[12px] font-semibold text-text-tertiary">{label}</div>
      {loading ? (
        <div className="h-6 w-24 bg-surface-tertiary/60 rounded animate-pulse mt-2.5" />
      ) : (
        <div className={`text-[24px] font-bold tracking-tight tabular-nums mt-2.5 leading-none ${danger ? 'text-danger' : 'text-text-primary'}`}>
          {value}
        </div>
      )}
      {sub && <div className="text-[12px] font-medium text-text-muted mt-1.5">{loading ? ' ' : sub}</div>}
    </div>
  );
}

export default function FinancesOverview() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['fin-overview-kpis'],
    queryFn: fetchInvoicesKpis30d,
    staleTime: 60_000,
  });

  const { data: revenue } = useQuery({
    queryKey: ['fin-overview-encaisse', 'month'],
    queryFn: () => getRevenueSeries('month'),
    staleTime: 60_000,
  });

  const { data: outstanding, isLoading: agingLoading } = useQuery({
    queryKey: ['fin-overview-outstanding'],
    queryFn: async () => {
      const base = { range: 'all' as const, q: '', sort: 'due_date_asc' as const, page: 1, pageSize: 200 };
      const [pastDue, sent] = await Promise.all([
        listInvoices({ ...base, status: 'past_due' }),
        listInvoices({ ...base, status: 'sent_not_due' }),
      ]);
      return [...pastDue.rows, ...sent.rows];
    },
    staleTime: 60_000,
  });

  const monthRange = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
  }, []);

  const { data: payroll, isLoading: payrollLoading } = useQuery({
    queryKey: ['fin-overview-payroll', monthRange.from, monthRange.to],
    queryFn: () => getPayrollPreview(monthRange.from, monthRange.to),
    staleTime: 60_000,
  });

  const aging = useMemo(() => computeAging(outstanding || [], fr), [outstanding, fr]);
  const reps = useMemo(() => groupCommissions(payroll?.entries || [], fr), [payroll, fr]);
  const maxBucket = Math.max(1, ...aging.buckets.map((b) => b.cents));
  const nextPayroll = (payroll?.pending || 0) + (payroll?.approved || 0);

  const arCents = (kpis?.past_due_total_cents || 0) + (kpis?.sent_not_due_total_cents || 0);
  const arCount = (kpis?.past_due_count || 0) + (kpis?.sent_not_due_count || 0);

  return (
    <div className="mt-2">
      {/* Hero — real interactive revenue chart (encaissé vs planifié) */}
      <RevenueOverviewCard className="mb-3" />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <Kpi
          label={fr ? 'Encaissé (mois)' : 'Collected (month)'}
          value={formatCurrency(revenue?.collectedTotal ?? 0)}
          sub={fr ? 'paiements reçus' : 'payments received'}
          loading={!revenue}
        />
        <Kpi
          label={fr ? 'À recevoir (A/R)' : 'Receivable (A/R)'}
          value={formatMoneyFromCents(arCents)}
          sub={`${arCount} ${fr ? 'factures ouvertes' : 'open invoices'}`}
          loading={kpisLoading}
        />
        <Kpi
          label={fr ? 'En retard' : 'Overdue'}
          value={formatMoneyFromCents(kpis?.past_due_total_cents || 0)}
          sub={`${kpis?.past_due_count || 0} ${fr ? 'factures' : 'invoices'}`}
          loading={kpisLoading}
          danger={(kpis?.past_due_total_cents || 0) > 0}
        />
        <Kpi
          label={fr ? 'Facture moyenne' : 'Avg invoice'}
          value={formatMoneyFromCents(kpis?.avg_invoice_30d_cents || 0)}
          sub={fr ? '30 derniers jours' : 'last 30 days'}
          loading={kpisLoading}
        />
      </div>

      {/* Comptes clients — ancienneté */}
      <div className="bg-surface-card border border-border rounded-xl p-5 mb-3">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {fr ? 'Comptes clients — ancienneté' : 'Accounts receivable — aging'}
          </h3>
          <button onClick={() => navigate('/finances')} className="text-[12px] font-medium text-text-tertiary hover:text-text-primary">
            {fr ? 'Voir les factures →' : 'View invoices →'}
          </button>
        </div>

        <div className="flex items-baseline justify-between pb-3.5 mb-3.5 border-b border-border">
          <span className="text-[12px] font-semibold text-text-tertiary">{fr ? 'Total à recevoir' : 'Total receivable'}</span>
          <span className="text-[22px] font-bold text-text-primary tracking-tight tabular-nums">
            {agingLoading ? '—' : formatMoneyFromCents(aging.total)}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {aging.buckets.map((b) => {
            const atRisk = b.key === 'd90p' && b.cents > 0;
            return (
              <div key={b.key}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[12.5px] font-semibold text-text-secondary">
                    {b.label}
                    {(b.hint || b.count > 0) && (
                      <span className="text-text-muted font-medium ml-1.5">
                        {[b.hint, b.count > 0 ? `${b.count} ${fr ? 'fact.' : 'inv.'}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className={`text-[13px] font-bold tabular-nums ${atRisk ? 'text-danger' : 'text-text-primary'}`}>
                    {formatMoneyFromCents(b.cents)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${atRisk ? 'bg-danger' : 'bg-primary'}`}
                    style={{ width: `${Math.max(2, (b.cents / maxBucket) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Principaux débiteurs */}
        <div className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mt-5 mb-2">
          {fr ? 'Principaux débiteurs' : 'Top debtors'}
        </div>
        {aging.debtors.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-text-muted">{fr ? 'Aucun solde à recevoir' : 'Nothing outstanding'}</div>
        ) : (
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-tertiary">
                <th className="text-left font-semibold pb-2 border-b border-border">{fr ? 'Client' : 'Client'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Solde' : 'Balance'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Retard' : 'Overdue'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Fact.' : 'Inv.'}</th>
              </tr>
            </thead>
            <tbody>
              {aging.debtors.map((d, i) => (
                <tr key={i}>
                  <td className="py-2 border-b border-border-light font-semibold text-text-primary">{d.name}</td>
                  <td className="py-2 border-b border-border-light text-right font-bold text-text-primary tabular-nums">{formatMoneyFromCents(d.cents)}</td>
                  <td className={`py-2 border-b border-border-light text-right tabular-nums ${d.maxDays > 90 ? 'text-danger font-semibold' : 'text-text-muted'}`}>
                    {d.maxDays > 0 ? `${d.maxDays} j` : '—'}
                  </td>
                  <td className="py-2 border-b border-border-light text-right text-text-muted tabular-nums">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Commissions & paie */}
      <div className="bg-surface-card border border-border rounded-xl p-5">
        <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
          <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Commissions & paie' : 'Commissions & payroll'}</h3>
          <span className="text-[11.5px] text-text-muted font-medium">
            {fr ? 'Cycle en cours · à payer ' : 'Current cycle · to pay '}
            <strong className="text-text-primary tabular-nums">{formatCurrency(nextPayroll)}</strong>
          </span>
        </div>
        {payrollLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-8 bg-surface-tertiary/50 rounded animate-pulse" />)}
          </div>
        ) : reps.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-text-muted">{fr ? 'Aucune commission ce cycle' : 'No commissions this cycle'}</div>
        ) : (
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-tertiary">
                <th className="text-left font-semibold pb-2 border-b border-border">{fr ? 'Représentant' : 'Rep'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Ventes' : 'Sales'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Taux' : 'Rate'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Commission' : 'Commission'}</th>
                <th className="text-right font-semibold pb-2 border-b border-border">{fr ? 'Statut' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r, i) => (
                <tr key={i}>
                  <td className="py-2 border-b border-border-light font-semibold text-text-primary">{r.name}</td>
                  <td className="py-2 border-b border-border-light text-right text-text-muted tabular-nums">{formatCurrency(r.base)}</td>
                  <td className="py-2 border-b border-border-light text-right text-text-muted tabular-nums">
                    {r.base > 0 ? `${Math.round((r.commission / r.base) * 100)} %` : '—'}
                  </td>
                  <td className="py-2 border-b border-border-light text-right font-bold text-text-primary tabular-nums">{formatCurrency(r.commission)}</td>
                  <td className="py-2 border-b border-border-light text-right">
                    <span className="inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded-full border border-border text-text-secondary bg-surface-secondary">
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
