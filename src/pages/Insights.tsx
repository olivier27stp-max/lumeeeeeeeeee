import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import InsightsOverviewCards from '../components/insights/InsightsOverviewCards';
import InsightsTabs from '../components/insights/InsightsTabs';
import {
  fetchInsightsInvoicesSummary,
  fetchInsightsJobsSummary,
  fetchInsightsLeadConversion,
  fetchInsightsOverview,
  fetchInsightsRevenueSeries,
  InsightsTab,
} from '../lib/insightsApi';
import { formatMoneyFromCents } from '../lib/invoicesApi';
import { cn } from '../lib/utils';
import { PageHeader, StatCard } from '../components/ui';
import { useTranslation } from '../i18n';

const DONUT_COLORS = ['#1961ED', '#334155', '#64748B', '#94A3B8', '#CBD5E1'];

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultRange() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toIsoDate(monthStart), to: toIsoDate(monthEnd) };
}

function isIsoDate(value: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseTab(raw: string | null): InsightsTab {
  if (raw === 'revenue' || raw === 'lead_conversion' || raw === 'jobs' || raw === 'invoices') return raw;
  return 'revenue';
}

function formatMoneyCompactFromCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format((cents || 0) / 100);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export default function Insights() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => getDefaultRange(), []);

  const from = isIsoDate(searchParams.get('from')) ? (searchParams.get('from') as string) : defaults.from;
  const to = isIsoDate(searchParams.get('to')) ? (searchParams.get('to') as string) : defaults.to;
  const tab = parseTab(searchParams.get('tab'));

  const [showInvoicedSeries, setShowInvoicedSeries] = useState(true);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!isIsoDate(searchParams.get('from'))) { next.set('from', defaults.from); changed = true; }
    if (!isIsoDate(searchParams.get('to'))) { next.set('to', defaults.to); changed = true; }
    if (!searchParams.get('tab')) { next.set('tab', 'revenue'); changed = true; }
    if (changed) setSearchParams(next, { replace: true });
  }, [defaults.from, defaults.to, searchParams, setSearchParams]);

  const overviewQuery = useQuery({ queryKey: ['insightsOverview', from, to], queryFn: () => fetchInsightsOverview({ from, to }) });
  const revenueSeriesQuery = useQuery({ queryKey: ['insightsRevenueSeries', from, to], queryFn: () => fetchInsightsRevenueSeries({ from, to, granularity: 'month' }) });
  const leadConversionQuery = useQuery({ queryKey: ['insightsLeadConversion', from, to], queryFn: () => fetchInsightsLeadConversion({ from, to }) });
  const invoicesSummaryQuery = useQuery({ queryKey: ['insightsInvoicesSummary', from, to], queryFn: () => fetchInsightsInvoicesSummary({ from, to }) });
  const jobsSummaryQuery = useQuery({ queryKey: ['insightsJobsSummary', from, to], queryFn: () => fetchInsightsJobsSummary({ from, to }) });

  const loading = overviewQuery.isLoading || revenueSeriesQuery.isLoading || leadConversionQuery.isLoading || invoicesSummaryQuery.isLoading || jobsSummaryQuery.isLoading;

  const overview = overviewQuery.data;
  const revenueSeries = revenueSeriesQuery.data || [];
  const leadConversion = leadConversionQuery.data;
  const invoicesSummary = invoicesSummaryQuery.data;
  const jobsSummary = jobsSummaryQuery.data;

  const overviewItems = useMemo(() => {
    if (!overview) return [];
    return [
      { id: 'new_leads', label: t.insights.newLeads, value: overview.new_leads_count, format: 'count' as const },
      { id: 'converted_quotes', label: t.insights.convertedQuotes, value: overview.converted_quotes_count, format: 'count' as const },
      { id: 'new_jobs', label: t.insights.newOneOffJobs, value: overview.new_oneoff_jobs_count, format: 'count' as const },
      { id: 'invoiced', label: t.insights.invoicedValue, value: overview.invoiced_value_cents, format: 'money' as const },
    ];
  }, [overview, t]);

  const revenueChartData = useMemo(
    () => revenueSeries.map((row) => ({
      bucketLabel: new Date(`${row.bucket_start}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      revenue: Number((row.revenue_cents / 100).toFixed(2)),
      invoiced: Number((row.invoiced_cents / 100).toFixed(2)),
    })),
    [revenueSeries]
  );

  const revenueBySource = useMemo(() => {
    const rows = leadConversion?.breakdown || [];
    return rows.filter((row) => row.revenue_cents > 0).map((row) => ({ source: row.source, value: row.revenue_cents }));
  }, [leadConversion]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t.insights.title} subtitle={t.insights.subtitle} icon={TrendingUp} iconColor="cyan">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            <Calendar size={12} />
            {t.insights.range}
          </span>
          <input type="date" value={from} onChange={(e) => updateParam('from', e.target.value)} className="glass-input !py-1.5 text-xs" />
          <span className="text-xs text-text-tertiary">{t.insights.to}</span>
          <input type="date" value={to} onChange={(e) => updateParam('to', e.target.value)} className="glass-input !py-1.5 text-xs" />
        </div>
      </PageHeader>

      {loading ? (
        <div className="skeleton h-[360px]" />
      ) : (
        <>
          <InsightsOverviewCards items={overviewItems} />

          <div className="section-card p-4">
            <div className="mb-4">
              <InsightsTabs activeTab={tab} onTabChange={(nextTab) => updateParam('tab', nextTab)} />
            </div>

            {tab === 'revenue' && (
              <div className="space-y-5">
                <div className="section-card p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[15px] font-bold text-text-primary">{t.insights.revenue}</p>
                      <p className="text-xs text-text-tertiary">{from} {t.insights.to} {to}</p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[13px] text-text-secondary">
                      <input type="checkbox" checked={showInvoicedSeries} onChange={(e) => setShowInvoicedSeries(e.target.checked)} />
                      {t.insights.showInvoiced}
                    </label>
                  </div>

                  <div className="mb-3 flex items-center gap-6">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-text-tertiary">{t.insights.revenue}</p>
                      <p className="text-2xl font-bold text-text-primary tabular-nums">{formatMoneyCompactFromCents(overview?.revenue_cents || 0)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-text-tertiary">{t.insights.invoiced}</p>
                      <p className="text-2xl font-bold text-text-primary tabular-nums">{formatMoneyCompactFromCents(overview?.invoiced_value_cents || 0)}</p>
                    </div>
                  </div>

                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={revenueChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="bucketLabel" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                        <Tooltip formatter={(value: number, name: string) => [
                          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0)),
                          name === 'revenue' ? t.insights.revenue : t.insights.invoiced,
                        ]} />
                        <Legend />
                        <Bar dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name={t.insights.revenue} />
                        {showInvoicedSeries && <Bar dataKey="invoiced" fill="#94A3B8" radius={[4, 4, 0, 0]} name={t.insights.invoiced} />}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {revenueBySource.length > 0 && (
                  <div className="section-card p-4">
                    <p className="text-[15px] font-bold text-text-primary">{t.insights.revenueBySource}</p>
                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={revenueBySource} dataKey="value" nameKey="source" innerRadius={70} outerRadius={105}>
                              {revenueBySource.map((entry, index) => (
                                <Cell key={entry.source} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatMoneyFromCents(Number(value || 0))} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2">
                        {revenueBySource.map((row, index) => (
                          <div key={row.source} className="flex items-center justify-between rounded-xl bg-surface-secondary px-3 py-2">
                            <div className="inline-flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                              <span className="text-[13px] text-text-secondary">{row.source}</span>
                            </div>
                            <span className="text-[13px] font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(row.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'lead_conversion' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <StatCard label={t.insights.leadsCreated} value={leadConversion?.leads_created || 0} iconColor="blue" />
                  <StatCard label={t.insights.leadsClosed} value={leadConversion?.leads_closed || 0} iconColor="green" />
                  <StatCard label={t.insights.conversionRate} value={formatPercent(leadConversion?.conversion_rate || 0)} iconColor="purple" />
                </div>

                <div className="section-card p-4">
                  <p className="text-[15px] font-bold text-text-primary">{t.insights.funnel}</p>
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-text-tertiary">
                        <span>{t.insights.created}</span>
                        <span className="tabular-nums">{leadConversion?.leads_created || 0}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-surface-tertiary">
                        <div className="h-2.5 rounded-full bg-text-secondary" style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-text-tertiary">
                        <span>{t.insights.closed}</span>
                        <span className="tabular-nums">{leadConversion?.leads_closed || 0}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-surface-tertiary">
                        <div
                          className="h-2.5 rounded-full bg-primary"
                          style={{
                            width: `${(leadConversion?.leads_created || 0) > 0 ? Math.max(3, Math.min(100, ((leadConversion?.leads_closed || 0) / leadConversion!.leads_created) * 100)) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'jobs' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <StatCard label={t.insights.jobsCreated} value={jobsSummary?.totalJobs || 0} iconColor="blue" />
                  <StatCard label={t.insights.scheduled} value={jobsSummary?.scheduledJobs || 0} iconColor="green" />
                  <StatCard label={t.insights.unscheduled} value={jobsSummary?.unscheduledJobs || 0} iconColor="amber" />
                </div>

                <div className="section-card p-4">
                  <p className="text-[15px] font-bold text-text-primary">{t.insights.jobsByTeam}</p>
                  <div className="mt-3 h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(jobsSummary?.byTeam || []).map((row) => ({ name: row.teamName, count: row.count }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {tab === 'invoices' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <StatCard label={t.insights.draft} value={invoicesSummary?.count_draft || 0} iconColor="amber" />
                  <StatCard label={t.insights.sent} value={invoicesSummary?.count_sent || 0} iconColor="blue" />
                  <StatCard label={t.insights.paid} value={invoicesSummary?.count_paid || 0} iconColor="green" />
                  <StatCard label={t.insights.pastDue} value={invoicesSummary?.count_past_due || 0} iconColor="rose" />
                </div>

                <div className="section-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-text-tertiary">{t.insights.outstandingBalance}</p>
                      <p className="text-2xl font-bold text-text-primary tabular-nums">
                        {formatMoneyFromCents(invoicesSummary?.total_outstanding_cents || 0)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-tertiary">{t.insights.avgPaymentTime}</p>
                      <p className="text-2xl font-bold text-text-primary tabular-nums">
                        {invoicesSummary?.avg_payment_time_days == null ? '--' : `${invoicesSummary.avg_payment_time_days.toFixed(1)} ${t.insights.daysUnit}`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
