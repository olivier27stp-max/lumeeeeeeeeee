// Per-rep summary — port of the web `components/commissions/RepCommissionSummary`.
// Used in the admin/owner overview to surface top performers and drill in.

import { Pressable, Text, View } from 'react-native';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import type { FsCommissionEntry } from '@/lib/api/commissionsServer';
import { useTranslation } from '@/lib/i18n';
import { fmtMoney } from './CommissionTable';

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

interface RepRow {
  userId: string;
  name: string;
  deals: number;
  totalEarned: number;
  pending: number;
  paid: number;
}

interface Props {
  entries: FsCommissionEntry[];
  profileMap: Record<string, string>;
  onSelectRep?: (userId: string) => void;
}

export default function RepCommissionSummary({ entries, profileMap, onSelectRep }: Props) {
  const { t } = useTranslation();
  const c = t.mobileCommissions;

  const byRep = new Map<string, RepRow>();
  for (const e of entries) {
    const row = byRep.get(e.user_id) ?? {
      userId: e.user_id,
      name: profileMap[e.user_id] ?? e.rep_name ?? e.user_id,
      deals: 0,
      totalEarned: 0,
      pending: 0,
      paid: 0,
    };
    row.deals += 1;
    row.totalEarned += Number(e.amount || 0);
    if (e.status === 'pending') row.pending += Number(e.amount || 0);
    if (e.status === 'paid') row.paid += Number(e.amount || 0);
    byRep.set(e.user_id, row);
  }
  const rows = Array.from(byRep.values()).sort((a, b) => b.totalEarned - a.totalEarned);

  return (
    <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
      <View className="border-b border-surface-border px-4 py-3">
        <Text className="text-sm font-bold text-ink">{c.salesReps}</Text>
      </View>
      {rows.length === 0 ? (
        <View className="items-center py-8">
          <Text className="text-sm text-ink-muted">{c.noRepsWithCommissions}</Text>
        </View>
      ) : (
        rows.map((r, i) => (
          <Pressable
            key={r.userId}
            onPress={() => onSelectRep?.(r.userId)}
            className={`flex-row items-center gap-3 px-4 py-3 active:bg-surface-sunken ${i === 0 ? '' : 'border-t border-surface-border'}`}
          >
            <UnifiedAvatar id={r.userId} name={r.name} size={32} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                {r.name}
              </Text>
              <Text className="text-xs text-ink-subtle">
                {r.deals} {c.dealsMetric.toLowerCase()} · {c.statusPending.toLowerCase()} {fmtMoney(r.pending)} ·{' '}
                {c.statusPaid.toLowerCase()} {fmtMoney(r.paid)}
              </Text>
            </View>
            <Text className="text-sm font-bold text-ink">{fmtMoney(r.totalEarned)}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}
