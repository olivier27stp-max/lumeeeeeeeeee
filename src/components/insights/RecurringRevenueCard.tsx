import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

function fmtMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
}

async function fetchData(locale: string) {
  const orgId = await getCurrentOrgIdOrThrow();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const { data } = await supabase
    .from('jobs')
    .select('total_cents,job_type,created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('job_type', 'recurring')
    .gte('created_at', from.toISOString())
    .limit(5000);
  const buckets = new Map<string, number>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
  }
  for (const j of data || []) {
    const d = new Date((j as any).created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + Number((j as any).total_cents || 0));
  }
  return Array.from(buckets.entries()).map(([key, value]) => {
    const [y, m] = key.split('-').map(Number);
    return { label: new Date(y, m, 1).toLocaleDateString(locale, { month: 'short' }), value };
  });
}

export default function RecurringRevenueCard() {
  const { t, language } = useTranslation();
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-recurring-revenue', language], queryFn: () => fetchData(locale), staleTime: 60_000 });
  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.recurringRevenue || 'Recurring Revenue'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.mrrFromRecurring || 'Revenue from recurring jobs'}</p>
      </div>
      {isLoading ? (
        <div className="h-[240px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : !hasData ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400">{ti.noRecurring || 'No recurring jobs yet'}</div>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
              <Tooltip formatter={(v: number) => fmtMoney(v, locale)} />
              <Line type="monotone" dataKey="value" stroke="var(--color-chart-primary)" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
