import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

async function fetchData(labels: { unnamed: string; unassigned: string; unknown: string }) {
  const orgId = await getCurrentOrgIdOrThrow();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  // Count jobs actually completed this month (by completion date, not creation).
  const [{ data: jobs }, { data: teams }] = await Promise.all([
    supabase.from('jobs').select('team_id,completed_at').eq('org_id', orgId).is('deleted_at', null).gte('completed_at', monthStart),
    supabase.from('teams').select('id,name').eq('org_id', orgId).is('deleted_at', null),
  ]);
  const nameMap = new Map<string, string>((teams || []).map((t: any) => [t.id, t.name || labels.unnamed]));
  const counts = new Map<string, number>();
  for (const j of jobs || []) {
    const k = (j as any).team_id || 'unassigned';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, count]) => ({ name: k === 'unassigned' ? labels.unassigned : nameMap.get(k) || labels.unknown, count }))
    .sort((a, b) => b.count - a.count);
}

export default function TeamProductivityCard() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({
    queryKey: ['report-team-productivity', language],
    queryFn: () => fetchData(fr
      ? { unnamed: 'Sans nom', unassigned: 'Non assigné', unknown: 'Inconnu' }
      : { unnamed: 'Unnamed', unassigned: 'Unassigned', unknown: 'Unknown' }),
    staleTime: 60_000,
  });

  return (
    <div className="rounded-xl border border-border bg-surface-card p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-[15px] font-semibold text-text-primary">{ti.teamProductivity || 'Team Productivity'}</h3>
        <p className="text-xs text-text-tertiary">{ti.jobsCompletedThisMonth || 'Jobs completed this month'}</p>
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[200px] animate-pulse bg-surface-tertiary/50 rounded-lg" />
      ) : data.length === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-text-tertiary">{ti.noData || 'No data'}</div>
      ) : (
        <div className="flex-1 min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid horizontal={false} stroke="var(--color-border)" />
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
