// Rep-facing payroll summary for the current pay period — port of the web
// `components/payroll/PayrollSummaryCard` (deals metric variant used on the
// Commissions page). Server-computed via GET /api/payroll/current-period.

import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Text, View } from 'react-native';

import { getCurrentPayPeriod } from '@/lib/api/server';
import { useTranslation } from '@/lib/i18n';

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

function fmtMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | undefined, locale: string) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export default function PayrollSummaryCard({ userId, metric = 'deals' }: { userId?: string; metric?: 'hours' | 'deals' }) {
  const { t, language } = useTranslation();
  const c = t.mobileCommissions;
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';

  const { data, isLoading, error } = useQuery({
    queryKey: ['pay-period', userId ?? 'me'],
    queryFn: () => getCurrentPayPeriod(userId),
  });

  if (isLoading) {
    return (
      <View className="items-center rounded-2xl bg-white py-8" style={CARD}>
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="rounded-2xl bg-white p-5" style={CARD}>
        <Text className="text-sm text-ink-muted">{(error as Error)?.message || c.noPayrollData}</Text>
      </View>
    );
  }

  const { period, hours, commission } = data;
  // What's actually heading to their account: not-yet-paid commission.
  const upcoming = (commission.pending || 0) + (commission.approved || 0);

  return (
    <View className="gap-4 rounded-2xl bg-white p-5" style={CARD}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken">
            <SymbolView name="calendar.badge.clock" tintColor="#171717" size={17} resizeMode="scaleAspectFit" />
          </View>
          <View>
            <Text className="text-sm font-bold text-ink">{c.currentPeriod}</Text>
            <Text className="text-xs text-ink-subtle">
              {fmtDate(period.start, locale)} – {fmtDate(period.end, locale)}
            </Text>
          </View>
        </View>
        <View className="items-end">
          <Text className="text-[10px] uppercase tracking-wide text-ink-subtle">{c.payday}</Text>
          <Text className="text-[13px] font-semibold text-ink">{fmtDate(period.payDate, locale)}</Text>
        </View>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1 rounded-xl bg-surface-sunken p-4">
          <View className="flex-row items-center gap-1.5">
            <SymbolView
              name={metric === 'deals' ? 'hands.clap' : 'clock'}
              tintColor="#737373"
              size={13}
              resizeMode="scaleAspectFit"
            />
            <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
              {metric === 'deals' ? c.dealsMetric : c.hoursWorkedLabel}
            </Text>
          </View>
          <Text className="mt-1.5 text-2xl font-bold text-ink">
            {metric === 'deals' ? (commission.count ?? 0) : `${hours.toFixed(2)}h`}
          </Text>
        </View>
        <View className="flex-1 rounded-xl bg-surface-sunken p-4">
          <View className="flex-row items-center gap-1.5">
            <SymbolView name="wallet.bifold" tintColor="#737373" size={13} resizeMode="scaleAspectFit" />
            <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">{c.commissionComing}</Text>
          </View>
          <Text className="mt-1.5 text-2xl font-bold" style={{ color: '#059669' }}>
            {fmtMoney(upcoming)}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between pt-1">
        <Text className="text-xs text-ink-subtle">
          {c.statusPending}: <Text className="font-semibold text-ink-muted">{fmtMoney(commission.pending)}</Text>
        </Text>
        <Text className="text-xs text-ink-subtle">
          {c.statusApproved}: <Text className="font-semibold text-ink-muted">{fmtMoney(commission.approved)}</Text>
        </Text>
        <Text className="text-xs text-ink-subtle">
          {c.statusPaid}: <Text className="font-semibold text-ink-muted">{fmtMoney(commission.paid)}</Text>
        </Text>
      </View>
    </View>
  );
}
