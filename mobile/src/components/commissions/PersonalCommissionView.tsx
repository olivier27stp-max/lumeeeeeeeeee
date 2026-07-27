// Personal commission dashboard — port of the web
// `components/commissions/PersonalCommissionView`. Used for the rep's own
// "My Commissions" view AND the admin per-rep drilldown (scoped by `userId`).

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { getCommissionEntries, getPayrollPreview } from '@/lib/api/commissionsServer';
import { useTranslation } from '@/lib/i18n';
import CommissionFiltersBar, { defaultRange, type CommissionFiltersValue } from './CommissionFiltersBar';
import CommissionStatsCards, { type CommissionStat } from './CommissionStatsCards';
import CommissionTable, { fmtMoney } from './CommissionTable';
import UpcomingPayouts from './UpcomingPayouts';

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

interface Props {
  /** Scope the data to this user. Omitted → the backend defaults to the caller. */
  userId?: string;
  /** Optional title override (e.g. the rep's name in the admin drilldown). */
  title?: string;
  subtitle?: string;
}

export default function PersonalCommissionView({ userId, title, subtitle }: Props) {
  const { t } = useTranslation();
  const c = t.mobileCommissions;
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => ({ status: 'all', ...defaultRange() }));

  const entriesQ = useQuery({
    queryKey: ['commission-entries', userId ?? 'me', filters.status, filters.from, filters.to],
    queryFn: () =>
      getCommissionEntries({
        userId,
        status: filters.status === 'all' ? undefined : filters.status,
        from: filters.from,
        to: filters.to,
      }),
  });
  const payrollQ = useQuery({
    queryKey: ['commission-payroll', userId ?? 'me', filters.from, filters.to],
    queryFn: () => getPayrollPreview(filters.from, filters.to, userId),
  });

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const loading = entriesQ.isLoading || payrollQ.isLoading;
  const error = (entriesQ.error ?? payrollQ.error) as Error | null;

  const stats: CommissionStat[] = useMemo(() => {
    const totalEarned = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pending = payrollQ.data?.pending ?? 0;
    const paid = payrollQ.data?.paid ?? 0;
    const next = entries.filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.amount || 0), 0);
    return [
      { label: c.totalEarned, value: fmtMoney(totalEarned), subtitle: c.thisPeriod },
      { label: c.statusPending, value: fmtMoney(pending), subtitle: c.awaitingApproval },
      { label: c.statusPaid, value: fmtMoney(paid), subtitle: c.thisPeriod },
      { label: c.nextPayout, value: fmtMoney(next), subtitle: c.nextPayoutSubtitle },
    ];
  }, [entries, payrollQ.data, c]);

  return (
    <View className="gap-4">
      {title ? (
        <View>
          <Text className="text-lg font-semibold text-ink">{title}</Text>
          {subtitle ? <Text className="text-xs text-ink-subtle">{subtitle}</Text> : null}
        </View>
      ) : null}

      <CommissionFiltersBar value={filters} onChange={setFilters} />

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

          <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
            <View className="border-b border-surface-border px-4 py-3">
              <Text className="text-sm font-bold text-ink">{c.recentCloses}</Text>
            </View>
            <CommissionTable
              entries={entries}
              profileMap={{}}
              showRep={false}
              showActions={false}
              emptyMessage={c.noClosesForPeriod}
            />
          </View>

          <UpcomingPayouts entries={entries} />
        </>
      )}
    </View>
  );
}
