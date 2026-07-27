import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { getCurrentPayPeriod } from '@/lib/api/server';
import { useTranslation } from '@/lib/i18n';

const money = (n: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-CA') : '—');

export default function Payroll() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['pay-period'],
    queryFn: () => getCurrentPayPeriod(),
    retry: false,
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-8">
        <Text className="text-center text-sm text-ink-muted">
          {t.mobileD2D.payrollLoadError}
        </Text>
      </View>
    );
  }

  const c = data.commission ?? { total: 0, pending: 0, approved: 0, paid: 0 };

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View className="gap-1 rounded-2xl bg-white p-4">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileD2D.currentPeriod}</Text>
        <Text className="text-base font-semibold text-ink">
          {fmtDate(data.period?.start)} → {fmtDate(data.period?.end)}
        </Text>
        {data.period?.payDate ? (
          <Text className="text-sm text-ink-muted">{t.mobileD2D.payOnDate.replace('{date}', fmtDate(data.period.payDate))}</Text>
        ) : null}
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1 gap-1 rounded-2xl bg-white p-4">
          <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileD2D.hours}</Text>
          <Text className="text-2xl font-bold text-ink">{(data.hours ?? 0).toFixed(1)} h</Text>
        </View>
        <View className="flex-1 gap-1 rounded-2xl bg-white p-4">
          <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileD2D.commissions}</Text>
          <Text className="text-2xl font-bold text-status-completed">{money(c.total)}</Text>
        </View>
      </View>

      <View className="gap-2 rounded-2xl bg-white p-4">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileD2D.commissionDetail}</Text>
        <Row label={t.mobileD2D.payrollPending} value={money(c.pending)} />
        <Row label={t.mobileD2D.payrollApproved} value={money(c.approved)} />
        <Row label={t.mobileD2D.payrollPaid} value={money(c.paid)} />
      </View>

      <Text className="px-1 text-xs text-ink-subtle">
        {t.mobileD2D.payrollFooter}
      </Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between border-t border-surface-border pt-2 first:border-t-0 first:pt-0">
      <Text className="text-base text-ink-muted">{label}</Text>
      <Text className="text-base font-semibold text-ink">{value}</Text>
    </View>
  );
}
