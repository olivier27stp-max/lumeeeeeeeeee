// Admin/owner overview — port of the web
// `components/commissions/AdminCommissionOverview`: KPIs across all reps, rep
// breakdown, entries with approve/reverse, and upcoming payouts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import {
  approveCommission,
  getCommissionEntries,
  getPayrollPreview,
  reverseCommission,
} from '@/lib/api/commissionsServer';
import { supabase } from '@/lib/supabase';
import { useTranslation } from '@/lib/i18n';
import CommissionFiltersBar, { defaultRange, type CommissionFiltersValue } from './CommissionFiltersBar';
import CommissionStatsCards, { type CommissionStat } from './CommissionStatsCards';
import CommissionTable, { fmtMoney } from './CommissionTable';
import RepCommissionSummary from './RepCommissionSummary';
import UpcomingPayouts from './UpcomingPayouts';

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

export default function AdminCommissionOverview({ onSelectRep }: { onSelectRep?: (userId: string) => void }) {
  const { t } = useTranslation();
  const c = t.mobileCommissions;
  const qc = useQueryClient();
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => ({ status: 'all', ...defaultRange() }));
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const entriesQ = useQuery({
    queryKey: ['commission-entries', 'admin', filters.repId ?? 'all', filters.status, filters.from, filters.to],
    queryFn: () =>
      getCommissionEntries({
        userId: filters.repId, // undefined = all reps for admin/owner
        status: filters.status === 'all' ? undefined : filters.status,
        from: filters.from,
        to: filters.to,
      }),
  });
  const payrollQ = useQuery({
    queryKey: ['commission-payroll', 'admin', filters.repId ?? 'all', filters.from, filters.to],
    queryFn: () => getPayrollPreview(filters.from, filters.to, filters.repId),
  });

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const ids = useMemo(() => [...new Set(entries.map((e) => e.user_id).filter(Boolean))], [entries]);

  const profilesQ = useQuery({
    queryKey: ['commission-profiles', ids.join(',')],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = p.full_name ?? p.id;
      return map;
    },
    enabled: ids.length > 0,
  });
  const profileMap = useMemo(() => profilesQ.data ?? {}, [profilesQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['commission-entries'] });
    qc.invalidateQueries({ queryKey: ['commission-payroll'] });
  };
  const approveMut = useMutation({
    mutationFn: (id: string) => approveCommission(id),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert(c.title, e.message),
    onSettled: () => setActionLoading(null),
  });
  const reverseMut = useMutation({
    mutationFn: (id: string) => reverseCommission(id),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert(c.title, e.message),
    onSettled: () => setActionLoading(null),
  });

  const stats: CommissionStat[] = useMemo(() => {
    const totalCommissions = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pendingPayouts = payrollQ.data?.pending ?? 0;
    const paid = payrollQ.data?.paid ?? 0;

    const byRep = new Map<string, number>();
    for (const e of entries) byRep.set(e.user_id, (byRep.get(e.user_id) ?? 0) + Number(e.amount || 0));
    let topRepLabel = '—';
    let topRepValue = 0;
    for (const [uid, total] of byRep) {
      if (total > topRepValue) {
        topRepValue = total;
        topRepLabel = profileMap[uid] ?? uid;
      }
    }
    return [
      { label: c.totalCommissions, value: fmtMoney(totalCommissions), subtitle: c.thisPeriod },
      { label: c.pendingPayouts, value: fmtMoney(pendingPayouts), subtitle: c.awaitingApproval },
      { label: c.paidThisPeriod, value: fmtMoney(paid), subtitle: c.settled },
      { label: c.topEarningRep, value: topRepLabel, subtitle: fmtMoney(topRepValue) },
    ];
  }, [entries, payrollQ.data, profileMap, c]);

  const repOptions = useMemo(() => ids.map((id) => ({ id, label: profileMap[id] ?? id })), [ids, profileMap]);

  const loading = entriesQ.isLoading || payrollQ.isLoading;
  const error = (entriesQ.error ?? payrollQ.error) as Error | null;

  return (
    <View className="gap-4">
      <CommissionFiltersBar value={filters} onChange={setFilters} reps={repOptions} />

      {loading ? (
        <View className="items-center py-12">
          <ActivityIndicator color="#171717" />
          <Text className="mt-2 text-sm text-ink-muted">{c.loading}</Text>
        </View>
      ) : error ? (
        <View className="rounded-2xl bg-white p-5" style={CARD}>
          <Text className="text-sm" style={{ color: '#DC2626' }}>
            {error.message || c.loadFailed}
          </Text>
        </View>
      ) : (
        <>
          <CommissionStatsCards cards={stats} />

          <RepCommissionSummary entries={entries} profileMap={profileMap} onSelectRep={onSelectRep} />

          <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
            <View className="border-b border-surface-border px-4 py-3">
              <Text className="text-sm font-bold text-ink">{c.commissionEntries}</Text>
            </View>
            <CommissionTable
              entries={entries}
              profileMap={profileMap}
              showRep={true}
              showActions={true}
              actionLoading={actionLoading}
              onApprove={(id) => {
                setActionLoading(id);
                approveMut.mutate(id);
              }}
              onReverse={(id) => {
                setActionLoading(id);
                reverseMut.mutate(id);
              }}
            />
          </View>

          <UpcomingPayouts entries={entries} />
        </>
      )}
    </View>
  );
}
