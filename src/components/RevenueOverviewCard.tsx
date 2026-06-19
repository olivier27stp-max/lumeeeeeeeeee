/**
 * RevenueOverviewCard — wide horizontal revenue card for the Home page.
 *
 *  ┌────────────────────────────────────────────────────────────┐
 *  │ Revenue                              [ Today · Week · Month ]│
 *  │  ╱╲___ area chart (collected vs scheduled) ________________  │
 *  │ ● Collected $X            ● Schedule $Y     View financials →│
 *  └────────────────────────────────────────────────────────────┘
 */
import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../i18n';
import { formatCurrency } from '../lib/utils';
import { getRevenueSeries, type RevenuePeriod } from '../lib/revenueSeriesApi';

const COLLECTED_COLOR = 'var(--color-primary)';
const SCHEDULED_COLOR = '#3b82f6';

function useIsDark() {
  return document.documentElement.classList.contains('dark');
}

export default function RevenueOverviewCard() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const dark = useIsDark();
  const [period, setPeriod] = useState<RevenuePeriod>('week');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-revenue-series', period],
    queryFn: () => getRevenueSeries(period),
    staleTime: 60_000,
  });

  const points = data?.points ?? [];
  const collectedTotal = data?.collectedTotal ?? 0;
  const scheduledTotal = data?.scheduledTotal ?? 0;

  const periods: { key: RevenuePeriod; label: string }[] = [
    { key: 'today', label: fr ? "Aujourd'hui" : 'Today' },
    { key: 'week', label: fr ? 'Semaine' : 'Week' },
    { key: 'month', label: fr ? 'Mois' : 'Month' },
  ];

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 mb-5">
      {/* Header: title (top-left) + period toggle (top-right) */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-text-primary">
          {fr ? 'Revenus' : 'Revenue'}
        </h3>
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-tertiary p-0.5">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={
                'h-7 px-3 rounded-md text-[12px] font-medium transition-colors ' +
                (period === p.key
                  ? 'bg-surface-card text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Collected / Scheduled totals — big & bold, at the top of the chart */}
      <div className="flex items-start gap-10 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLLECTED_COLOR }} />
            <span className="text-[16px] font-bold text-text-primary">{fr ? 'Collecté' : 'Collected'}</span>
          </div>
          <p className="text-[28px] font-bold text-text-primary tabular-nums tracking-tight mt-1 leading-none">
            {formatCurrency(collectedTotal)}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SCHEDULED_COLOR }} />
            <span className="text-[16px] font-bold text-text-primary">{fr ? 'Planifié' : 'Schedule'}</span>
          </div>
          <p className="text-[28px] font-bold text-text-primary tabular-nums tracking-tight mt-1 leading-none">
            {formatCurrency(scheduledTotal)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[180px] w-full">
        {isLoading ? (
          <div className="h-full w-full bg-surface-tertiary/50 rounded-lg animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="revCollected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLLECTED_COLOR} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLLECTED_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="revScheduled" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SCHEDULED_COLOR} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={SCHEDULED_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={dark ? '#3f3f46' : '#f4f4f5'} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
                tick={{ fill: dark ? '#a1a1aa' : '#71717a', fontSize: 11, fontWeight: 500 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={40}
                tick={{ fill: dark ? '#71717a' : '#a1a1aa', fontSize: 11 }}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: `1px solid ${dark ? '#3f3f46' : '#e4e4e7'}`,
                  backgroundColor: dark ? '#18181b' : '#ffffff',
                  color: dark ? '#fafafa' : '#18181b',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  fontSize: 13,
                }}
                formatter={(value: number, name: string) => [
                  formatCurrency(value),
                  name === 'collected'
                    ? fr ? 'Collecté' : 'Collected'
                    : fr ? 'Planifié' : 'Schedule',
                ]}
              />
              <Area
                type="monotone"
                dataKey="scheduled"
                stroke={SCHEDULED_COLOR}
                strokeWidth={2}
                strokeDasharray="4 3"
                fill="url(#revScheduled)"
              />
              <Area
                type="monotone"
                dataKey="collected"
                stroke={COLLECTED_COLOR}
                strokeWidth={2}
                fill="url(#revCollected)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer: View finances button (bottom-right) */}
      <div className="flex items-center justify-end mt-3 pt-3 border-t border-border">
        <button
          onClick={() => navigate('/finances')}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-primary hover:bg-surface-tertiary transition-colors"
        >
          {fr ? 'Voir les finances' : 'View financials'}
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
