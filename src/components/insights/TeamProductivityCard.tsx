import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [{ data: jobs }, { data: teams }] = await Promise.all([
    supabase.from('jobs').select('team_id,status').eq('org_id', orgId).is('deleted_at', null).gte('created_at', monthStart).in('status', ['completed', 'closed', 'done']),
    supabase.from('teams').select('id,name').eq('org_id', orgId).is('deleted_at', null),
  ]);
  const nameMap = new Map<string, string>((teams || []).map((t: any) => [t.id, t.name || 'Unnamed']));
  const counts = new Map<string, number>();
  for (const j of jobs || []) {
    const k = (j as any).team_id || 'unassigned';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, count]) => ({ name: k === 'unassigned' ? 'Unassigned' : nameMap.get(k) || 'Unknown', count }))
    .sort((a, b) => b.count - a.count);
}

export default function TeamProductivityCard() {
  const { t } = useTranslation();
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-team-productivity'], queryFn: fetchData, staleTime: 60_000 });

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.teamProductivity || 'Team Productivity'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.jobsCompletedThisMonth || 'Jobs completed this month'}</p>
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[200px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : data.length === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="flex-1 min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid horizontal={false} stroke="#e4e4e7" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 6, 6, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
