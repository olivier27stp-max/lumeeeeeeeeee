import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data } = await supabase
    .from('jobs')
    .select('title')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(5000);
  const counts = new Map<string, number>();
  for (const j of data || []) {
    const title = ((j as any).title || 'Untitled').trim();
    counts.set(title, (counts.get(title) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export default function TopServicesByCountCard() {
  const { t } = useTranslation();
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-top-services-count'], queryFn: fetchData, staleTime: 60_000 });

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.topServicesByCount || 'Top Services by Count'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.byJobCount || 'Most-booked services'}</p>
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[240px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : data.length === 0 ? (
        <div className="flex-1 min-h-[240px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="flex-1 min-h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid horizontal={false} stroke="#e4e4e7" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1961ED" radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
