import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const { data } = await supabase
    .from('jobs')
    .select('scheduled_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', from.toISOString())
    .limit(5000);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const weekCounts = new Set<string>();
  for (const j of data || []) {
    const d = new Date((j as any).scheduled_at);
    counts[d.getDay()] += 1;
    const wk = `${d.getFullYear()}-${Math.floor(d.getDate() / 7)}-${d.getMonth()}`;
    weekCounts.add(wk);
  }
  const weeks = Math.max(1, weekCounts.size);
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return labels.map((label, i) => ({ label, value: Number((counts[i] / weeks).toFixed(1)) }));
}

export default function JobsPerWeekdayCard() {
  const { t } = useTranslation();
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-jobs-weekday'], queryFn: fetchData, staleTime: 60_000 });
  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.jobsPerWeekday || 'Jobs per Weekday'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.avgLast90 || 'Average, last 90 days'}</p>
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[200px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : !hasData ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="flex-1 min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#8B5CF6" radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
