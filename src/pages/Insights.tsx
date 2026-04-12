import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Calendar, Download, Minus, TrendingUp, Users, Zap,
  Target, DollarSign, BarChart3, Clock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import InsightsTabs from '../components/insights/InsightsTabs';
import DrilldownModal from '../components/insights/DrilldownModal';
import {
  fetchInsightsInvoicesSummary,
  fetchInsightsJobsSummary,
  fetchInsightsOverview,
  fetchInsightsRevenueSeries,
  fetchPeriodComparison,
  fetchTopServices,
  drilldownRevenueByMonth,
  drilldownJobsByTeam,
  InsightsTab,
} from '../lib/insightsApi';

import {
  fetchRecentTransactions,
} from '../lib/financeDashboardApi';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

/* ── Finance tab components ──────────────────────────────────── */
import { BalanceCard, PendingInvoicesCard } from '../components/insights/finance/StatKpiCard';
import IncomeSourcesCard from '../components/insights/finance/IncomeSourcesCard';
import MonthlyRevenueChart from '../components/insights/finance/MonthlyRevenueChart';
import SummaryDonutCard from '../components/insights/finance/SummaryDonutCard';
import TransactionsTableCard from '../components/insights/finance/TransactionsTableCard';
import RevenueGoalCard from '../components/insights/finance/RevenueGoalCard';

const TEAM_COLORS = ['#1961ED', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

function toIsoDate(date: Date) { return date.toISOString().slice(0, 10); }

function getDefaultRange() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toIsoDate(monthStart), to: toIsoDate(monthEnd) };
}

function isIsoDate(value: string | null) { return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value); }

function parseTab(raw: string | null): InsightsTab {
  if (raw === 'finance') return 'finance';
  if (raw === 'revenue') return 'revenue';
  return 'finance';
}

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
}


function formatDateRange(from: string, to: string) {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${f.toLocaleDateString('en-US', opts)} - ${t.toLocaleDateString('en-US', opts)}`;
}

/* ── Change Indicator ─────────────────────────────────────── */
function ChangeIndicator({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-text-tertiary">--</span>;
  const isUp = value > 0;
  const isDown = value < 0;
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : Minus;
  const color = isUp ? 'text-emerald-600' : isDown ? 'text-rose-500' : 'text-text-tertiary';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${color}`}>
      <Icon size={11} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ── Metric Card with comparison ──────────────────────────── */
function MetricCard({ label, value, prevValue, changePct, format = 'count', icon: IconComp }: {
  label: string; value: number; prevValue?: number; changePct?: number | null;
  format?: 'count' | 'money' | 'percent' | 'days';
  icon?: React.ElementType;
}) {
  const formatted = format === 'money' ? fmtMoney(value)
    : format === 'percent' ? `${value.toFixed(1)}%`
    : format === 'days' ? `${value.toFixed(1)}d`
    : String(value);

  return (
    <div className="rounded-2xl bg-surface-card border border-border shadow-card p-5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</span>
        {IconComp && <IconComp size={14} className="text-text-tertiary" />}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-[22px] font-semibold text-text-primary tabular-nums tracking-tight leading-none">{formatted}</span>
        {changePct !== undefined && <ChangeIndicator value={changePct ?? null} />}
      </div>
      {prevValue !== undefined && prevValue > 0 && (
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
            <div
              className={cn('h-1.5 rounded-full transition-all', (changePct ?? 0) >= 0 ? 'bg-emerald-500' : 'bg-rose-400')}
              style={{ width: `${Math.min(100, Math.max(5, (value / (Math.max(value, prevValue) || 1)) * 100))}%` }}
            />
          </div>
          <span className="text-[10px] text-text-tertiary whitespace-nowrap">
            vs {format === 'money' ? fmtMoney(prevValue) : prevValue}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────── */
export default function Insights() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => getDefaultRange(), []);

  const from = isIsoDate(searchParams.get('from')) ? (searchParams.get('from') as string) : defaults.from;
  const to = isIsoDate(searchParams.get('to')) ? (searchParams.get('to') as string) : defaults.to;
  const tab = parseTab(searchParams.get('tab'));

  // Drill-down state
  const [drilldown, setDrilldown] = useState<{ title: string; subtitle?: string; columns: any[]; data: any[]; loading: boolean } | null>(null);

  async function openDrilldown(title: string, subtitle: string, columns: any[], fetcher: () => Promise<any[]>) {
    setDrilldown({ title, subtitle, columns, data: [], loading: true });
    try {
      const data = await fetcher();
      setDrilldown((prev) => prev ? { ...prev, data, loading: false } : null);
    } catch {
      setDrilldown((prev) => prev ? { ...prev, data: [], loading: false } : null);
    }
  }

  function exportCsv() {
    let rows: Record<string, any>[] = [];
    let filename = `insights-${tab}-${from}-${to}.csv`;

    if (tab === 'finance') {
      rows = revenueChartData.map((r) => ({ period: r.label, revenue: r.revenue, invoiced: r.invoiced }));
      filename = `finance-${from}-${to}.csv`;
    } else if (tab === 'revenue') {
      rows = revenueChartData.map((r) => ({ period: r.label, revenue: r.revenue, invoiced: r.invoiced }));
      filename = `performance-${from}-${to}.csv`;
    }

    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => { const v = String(r[h] ?? ''); return v.includes(',') ? `"${v}"` : v; }).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!isIsoDate(searchParams.get('from'))) { next.set('from', defaults.from); changed = true; }
    if (!isIsoDate(searchParams.get('to'))) { next.set('to', defaults.to); changed = true; }
    if (!searchParams.get('tab')) { next.set('tab', 'finance'); changed = true; }
    if (changed) setSearchParams(next, { replace: true });
  }, [defaults.from, defaults.to, searchParams, setSearchParams]);

  // ── Queries ──────────────────────────────────────────────
  const overviewQ = useQuery({ queryKey: ['insightsOverview', from, to], queryFn: () => fetchInsightsOverview({ from, to }), refetchInterval: 60_000 });
  // Pick granularity based on date range span
  const rangeSpanDays = Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000));
  const autoGranularity: 'day' | 'week' | 'month' = rangeSpanDays <= 35 ? 'day' : rangeSpanDays <= 100 ? 'week' : 'month';
  const revenueSeriesQ = useQuery({ queryKey: ['insightsRevenueSeries', from, to], queryFn: () => fetchInsightsRevenueSeries({ from, to, granularity: autoGranularity }) });
  const invoicesSummaryQ = useQuery({ queryKey: ['insightsInvoicesSummary', from, to], queryFn: () => fetchInsightsInvoicesSummary({ from, to }) });
  const jobsSummaryQ = useQuery({ queryKey: ['insightsJobsSummary', from, to], queryFn: () => fetchInsightsJobsSummary({ from, to }) });
  const comparisonQ = useQuery({ queryKey: ['insightsPeriodComparison', from, to], queryFn: () => fetchPeriodComparison({ from, to }) });

  // Finance-specific queries
  const transactionsQ = useQuery({ queryKey: ['financeRecentTransactions'], queryFn: () => fetchRecentTransactions(8), enabled: tab === 'finance' });
  const topServicesQ = useQuery({ queryKey: ['insightsTopServices', from, to], queryFn: () => fetchTopServices({ from, to }), enabled: tab === 'finance' });

  const loading = overviewQ.isLoading;
  const overview = overviewQ.data;
  const revenueSeries = revenueSeriesQ.data || [];

  const invoicesSummary = invoicesSummaryQ.data;
  const jobsSummary = jobsSummaryQ.data;
  const comparisons = comparisonQ.data || [];

  const transactions = transactionsQ.data || [];
  const topServices = topServicesQ.data || [];

  function cmp(metric: string) {
    const row = comparisons.find((c) => c.metric === metric);
    return row ? { prev: row.previous_value, pct: row.change_pct } : { prev: undefined, pct: undefined };
  }

  const revenueChartData = useMemo(() => revenueSeries.map((row) => ({
    label: new Date(`${row.bucket_start}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    revenue: Number((row.revenue_cents / 100).toFixed(2)),
    invoiced: Number((row.invoiced_cents / 100).toFixed(2)),
  })), [revenueSeries]);

  // ── Finance derived data ──
  const totalIncomeCents = overview?.revenue_cents || 0;
  const pendingCents = invoicesSummary?.total_outstanding_cents || 0;
  const overdueCount = invoicesSummary?.count_past_due || 0;
  const { data: orgSettings } = useQuery({
    queryKey: ['org-revenue-goal'],
    queryFn: async () => {
      const { supabase } = await import('../lib/supabase');
      const { getCurrentOrgIdOrThrow } = await import('../lib/orgApi');
      const orgId = await getCurrentOrgIdOrThrow();
      const { data } = await supabase.from('company_settings').select('revenue_goal_cents').eq('org_id', orgId).maybeSingle();
      return data;
    },
    staleTime: 300_000,
  });
  const revenueGoalTarget = orgSettings?.revenue_goal_cents ?? 0;
  const revenueGoalCurrent = overview?.revenue_cents || 0;

  const financeRevenueChartData = useMemo(
    () => revenueSeries.map((row) => {
      const d = new Date(`${row.bucket_start}T00:00:00`);
      const label = autoGranularity === 'day'
        ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
        : autoGranularity === 'week'
        ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
        : d.toLocaleDateString('en-US', { month: 'short' });
      return { label, value: Number((row.revenue_cents / 100).toFixed(0)) };
    }),
    [revenueSeries, autoGranularity]
  );


  const financeSummaryCategories = useMemo(() => {
    const paid = invoicesSummary?.count_paid || 0;
    const sent = invoicesSummary?.count_sent || 0;
    const draft = invoicesSummary?.count_draft || 0;
    const overdue = invoicesSummary?.count_past_due || 0;
    const total = paid + sent + draft + overdue || 1;
    return [
      { name: 'Paid Invoices', value: paid, pct: Math.round((paid / total) * 100) },
      { name: 'Pending', value: sent, pct: Math.round((sent / total) * 100) },
      { name: 'Drafts', value: draft, pct: Math.round((draft / total) * 100) },
      { name: 'Overdue', value: overdue, pct: Math.round((overdue / total) * 100) },
    ].filter((c) => c.value > 0);
  }, [invoicesSummary]);


  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function updateRange(newFrom: string, newTo: string, period?: string) {
    const next = new URLSearchParams(searchParams);
    next.set('from', newFrom);
    next.set('to', newTo);
    if (period) next.set('period', period);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{t.insights.title}</h1>
          <p className="text-[13px] text-text-tertiary mt-1">{t.insights.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date presets */}
          {(() => {
            const now = new Date();
            const y = now.getFullYear(), m = now.getMonth();
            const q = Math.floor(m / 3) * 3;
            return [
              { id: 'month', label: language === 'fr' ? 'Mois' : 'Month', from: toIsoDate(new Date(y, m, 1)), to: toIsoDate(now) },
              { id: 'quarter', label: language === 'fr' ? 'Trimestre' : 'Quarter', from: toIsoDate(new Date(y, q, 1)), to: toIsoDate(now) },
              { id: 'yearly', label: language === 'fr' ? 'Annuel' : 'Yearly', from: toIsoDate(new Date(y, 0, 1)), to: toIsoDate(now) },
            ];
          })().map((preset) => (
            <button key={preset.id} onClick={() => updateRange(preset.from, preset.to, preset.id)}
              className={cn('h-9 px-3.5 rounded-lg text-[13px] font-medium transition-colors border',
                searchParams.get('period') === preset.id
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-secondary border-outline hover:bg-surface-secondary')}>
              {preset.label}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => updateParam('from', e.target.value)} className="h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary outline-none" />
          <input type="date" value={to} onChange={(e) => updateParam('to', e.target.value)} className="h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary outline-none" />
          <button onClick={exportCsv} className="inline-flex items-center gap-2 h-9 px-4 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-2xl bg-surface-card border border-border shadow-card p-5 h-24 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <div className="flex items-center justify-between">
            <InsightsTabs activeTab={tab} onTabChange={(nextTab) => updateParam('tab', nextTab)} />
          </div>

          {/* ═══════════════════════════════════════════════════
              FINANCE TAB
              ═══════════════════════════════════════════════════ */}
          {tab === 'finance' && (
            <div className="space-y-5">
              {/* ROW 1 — 3 KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <BalanceCard
                  value={overview?.revenue_cents || 0}
                  changePct={cmp('revenue').pct ?? null}
                  onViewPayments={() => navigate('/payments')}
                  onExport={exportCsv}
                />
                <PendingInvoicesCard
                  value={pendingCents}
                  overdueCount={overdueCount}
                />
                <MetricCard label={fr ? 'Nouveaux clients' : 'New Clients'} value={overview?.new_leads_count || 0} prevValue={cmp('new_leads').prev} changePct={cmp('new_leads').pct} icon={Users} />
              </div>

              {/* ROW 2 — Income Sources / Monthly Chart / Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: 420 }}>
                <IncomeSourcesCard
                  totalIncome={totalIncomeCents}
                  changePct={cmp('revenue').pct ?? null}
                  sources={topServices}
                />
                <MonthlyRevenueChart
                  data={financeRevenueChartData}
                  trendPct={cmp('revenue').pct ?? null}
                  onViewReport={() => updateParam('tab', 'revenue')}
                />
                <SummaryDonutCard
                  categories={
                    financeSummaryCategories.length > 0
                      ? financeSummaryCategories
                      : [
                          { name: 'Paid Invoices', value: 48, pct: 48 },
                          { name: 'Pending', value: 32, pct: 32 },
                          { name: 'Drafts', value: 13, pct: 13 },
                          { name: 'Overdue', value: 7, pct: 7 },
                        ]
                  }
                  totalCents={overview?.invoiced_value_cents || 0}
                  dateRange={`Data from ${formatDateRange(from, to)}`}
                />
              </div>

              {/* ROW 3 — Transactions / Revenue Goal + Client Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
                <TransactionsTableCard
                  transactions={transactions}
                  onViewAll={() => navigate('/invoices')}
                />
                <div className="space-y-4">
                  <RevenueGoalCard
                    currentCents={revenueGoalCurrent}
                    targetCents={revenueGoalTarget}
                    onViewReport={() => updateParam('tab', 'revenue')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════
              PERFORMANCE TAB — consolidated dashboard
              ═══════════════════════════════════════════════════ */}
          {tab === 'revenue' && (
            <div className="space-y-5">
              {/* KPI Row */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <MetricCard label={t.insights.revenue} value={overview?.revenue_cents || 0} format="money" changePct={cmp('revenue').pct} icon={DollarSign} />
                <MetricCard label={fr ? 'Jobs fermés' : 'Closed Jobs'} value={jobsSummary?.scheduledJobs || 0} icon={Target} />
                <MetricCard label={fr ? 'Jobs ouverts' : 'Open Jobs'} value={jobsSummary?.unscheduledJobs || 0} icon={Zap} />
              </div>

              {/* ── CHART 1: Revenue par mois ── */}
              <div className="rounded-2xl bg-surface-card border border-border shadow-card p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[16px] font-semibold text-text-primary">{t.insights.revenue}</p>
                    <p className="text-[12px] text-text-tertiary">{from} — {to}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.insights.revenue}</p>
                      <p className="text-[20px] font-bold text-text-primary tabular-nums">{fmtMoney(overview?.revenue_cents || 0)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.insights.invoiced}</p>
                      <p className="text-[20px] font-bold text-text-primary tabular-nums">{fmtMoney(overview?.invoiced_value_cents || 0)}</p>
                    </div>
                  </div>
                </div>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={revenueChartData} style={{ cursor: 'pointer' }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                      <Tooltip formatter={(value: number, name: string) => [
                        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0)),
                        name === 'revenue' ? t.insights.revenue : t.insights.invoiced,
                      ]} />
                      <Legend />
                      <Bar dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name={t.insights.revenue} onClick={(entry: any) => {
                        if (!entry?.label) return;
                        const matchedSeries = revenueSeries.find((rs) => new Date(`${rs.bucket_start}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) === entry.label);
                        if (!matchedSeries) return;
                        openDrilldown(
                          `Invoices — ${entry.label}`,
                          'Click a bar to see invoice details for that period',
                          [
                            { key: 'invoice_number', label: 'Invoice #' },
                            { key: 'status', label: 'Status', render: (v: string) => <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', v === 'paid' ? 'bg-emerald-100 text-emerald-700' : v === 'sent' ? 'bg-surface-secondary text-text-secondary' : 'bg-surface-secondary text-text-tertiary')}>{v}</span> },
                            { key: 'total_cents', label: 'Amount', align: 'right' as const, render: (v: number) => fmtMoney(v) },
                            { key: 'issued_at', label: 'Issued', render: (v: string) => v ? new Date(v).toLocaleDateString() : '--' },
                          ],
                          () => drilldownRevenueByMonth({ month: matchedSeries.bucket_start }),
                        );
                      }} />
                      <Bar dataKey="invoiced" fill="#94A3B8" radius={[4, 4, 0, 0]} name={t.insights.invoiced} />
                      <Line type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ── CHART 2: Jobs by team ── */}
              <div className="rounded-2xl bg-surface-card border border-border shadow-card p-5">
                <p className="text-[16px] font-semibold text-text-primary mb-1">{t.insights.jobsByTeam || 'Jobs by Team'}</p>
                <p className="text-[12px] text-text-tertiary mb-4">
                  {jobsSummary ? `${jobsSummary.totalJobs} total · ${jobsSummary.scheduledJobs} scheduled · ${jobsSummary.unscheduledJobs} unscheduled` : 'Loading...'}
                </p>
                {(jobsSummary?.byTeam || []).length > 0 ? (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(jobsSummary?.byTeam || []).map((row) => ({ name: row.teamName, count: row.count, teamId: row.teamId }))} layout="vertical" style={{ cursor: 'pointer' }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis type="number" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} onClick={(entry: any) => {
                          const teamId = entry?.teamId || 'unassigned';
                          openDrilldown(
                            `Jobs — ${entry?.name || 'Team'}`, `${from} to ${to}`,
                            [
                              { key: 'title', label: 'Job Title' },
                              { key: 'client_name', label: 'Client' },
                              { key: 'status', label: 'Status', render: (v: string) => <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-text-secondary">{v}</span> },
                              { key: 'total_cents', label: 'Value', align: 'right' as const, render: (v: number) => v ? fmtMoney(v) : '--' },
                            ],
                            () => drilldownJobsByTeam({ teamId, from, to }),
                          );
                        }}>
                          {(jobsSummary?.byTeam || []).map((_, idx) => (
                            <Cell key={idx} fill={TEAM_COLORS[idx % TEAM_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="py-10 text-center text-[13px] text-text-tertiary">No job data available.</div>
                )}
              </div>

            </div>
          )}
        </>
      )}

      {/* Drill-down modal */}
      {drilldown && (
        <DrilldownModal
          isOpen={!!drilldown}
          onClose={() => setDrilldown(null)}
          title={drilldown.title}
          subtitle={drilldown.subtitle}
          columns={drilldown.columns}
          data={drilldown.data}
          loading={drilldown.loading}
        />
      )}
    </div>
  );
}
