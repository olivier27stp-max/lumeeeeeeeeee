// Upcoming payouts panel — port of the web `components/commissions/UpcomingPayouts`.
// Entries not yet paid, sorted by approval date (then created date).

import { Text, View } from 'react-native';

import type { FsCommissionEntry } from '@/lib/api/commissionsServer';
import { useTranslation } from '@/lib/i18n';
import { StatusPill, fmtMoney } from './CommissionTable';

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

export default function UpcomingPayouts({ entries, limit = 5 }: { entries: FsCommissionEntry[]; limit?: number }) {
  const { t, language } = useTranslation();
  const c = t.mobileCommissions;
  const locale = language === 'fr' ? 'fr-CA' : 'en-US';

  const upcoming = entries
    .filter((e) => e.status === 'pending' || e.status === 'approved')
    .sort((a, b) => {
      const ax = a.approved_at ?? a.created_at;
      const bx = b.approved_at ?? b.created_at;
      return new Date(bx).getTime() - new Date(ax).getTime();
    })
    .slice(0, limit);

  return (
    <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
      <View className="border-b border-surface-border px-4 py-3">
        <Text className="text-sm font-bold text-ink">{c.upcomingPayouts}</Text>
      </View>
      {upcoming.length === 0 ? (
        <View className="items-center py-8">
          <Text className="text-sm text-ink-muted">{c.noUpcomingPayouts}</Text>
        </View>
      ) : (
        upcoming.map((e, i) => (
          <View
            key={e.id}
            className={`flex-row items-center justify-between gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-surface-border'}`}
          >
            <View className="flex-1">
              <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                {e.description ?? e.lead_id ?? '—'}
              </Text>
              <Text className="text-xs text-ink-subtle">
                {c.closed} {new Date(e.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <StatusPill status={e.status} />
              <Text className="text-sm font-semibold text-ink">{fmtMoney(e.amount)}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
