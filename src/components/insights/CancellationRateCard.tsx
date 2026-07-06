import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const { data } = await supabase
    .from('jobs')
    .select('status,created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', from.toISOString())
    .limit(5000);
  const buckets = new Map<string, { cancelled: number; completed: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, { cancelled: 0, completed: 0 });
  }
  for (const j of data || []) {
    const d = new Date((j as any).created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const b = buckets.get(key);
    if (!b) continue;
    const s = String((j as any).status || '').toLowerCase();
    if (s === 'cancelled' || s === 'canceled') b.cancelled += 1;
    else if (s === 'completed' || s === 'closed' || s === 'done') b.completed += 1;
  }
  return Array.from(buckets.entries()).map(([key, b]) => {
    const [y, m] = key.split('-').map(Number);
    const total = b.cancelled + b.completed;
    return {
      label: new Date(y, m, 1).toLocaleDateString('en-CA', { month: 'short' }),
      rate: total > 0 ? Number(((b.cancelled / total) * 100).toFixed(1)) : 0,
    };
  });
}

export default function CancellationRateCard() {
  const { t } = useTranslation();
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-cancellation-rate'], queryFn: fetchData, staleTime: 60_000 });
  const hasData = data.some((d) => d.rate > 0);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.cancellationRate || 'Cancellation Rate'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.percentJobsCancelled || '% of jobs cancelled monthly'}</p>
      </div>
      {isLoading ? (
        <div className="h-[240px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : !hasData ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Line type="monotone" dataKey="rate" stroke="var(--color-chart-primary)" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
