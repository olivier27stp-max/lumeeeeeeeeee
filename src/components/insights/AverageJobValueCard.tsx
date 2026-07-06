import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
}

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const { data, error } = await supabase
    .from('jobs')
    .select('total_cents,created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', from.toISOString())
    .limit(5000);
  if (error) throw error;
  const buckets = new Map<string, { sum: number; count: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, { sum: 0, count: 0 });
  }
  for (const row of data || []) {
    const d = new Date((row as any).created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const b = buckets.get(key);
    if (b) {
      b.sum += Number((row as any).total_cents || 0);
      b.count += 1;
    }
  }
  return Array.from(buckets.entries()).map(([key, b]) => {
    const [y, m] = key.split('-').map(Number);
    return {
      label: new Date(y, m, 1).toLocaleDateString('en-CA', { month: 'short' }),
      value: b.count > 0 ? Math.round(b.sum / b.count) : 0,
    };
  });
}

export default function AverageJobValueCard() {
  const { t } = useTranslation();
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-avg-job-value'], queryFn: fetchData, staleTime: 60_000 });
  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.avgJobValue || 'Average Job Value'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.last6Months || 'Last 6 months'}</p>
      </div>
      {isLoading ? (
        <div className="h-[240px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : !hasData ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="value" fill="var(--color-primary)" radius={[6, 6, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
