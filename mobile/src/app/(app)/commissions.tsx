import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import {
  CommissionEntry,
  CommissionStatus,
  listCommissions,
  summarize,
} from '@/lib/api/commissions';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';
import { usePlanFeature } from '@/lib/usePlanFeature';

// Maps a commission status to its t.mobileD2D key (label resolved in render).
const STATUS_LABEL_KEY: Record<CommissionStatus, string> = {
  pending: 'commissionStatusPending',
  approved: 'commissionStatusApproved',
  paid: 'commissionStatusPaid',
  reversed: 'commissionStatusReversed',
};
const STATUS_COLOR: Record<CommissionStatus, string> = {
  pending: '#D97706',
  approved: '#2563EB',
  paid: '#16A34A',
  reversed: '#DC2626',
};

const money = (n: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

export default function Commissions() {
  const { session } = useAuth();
  const { orgId, role, can } = usePermissions();
  const hasD2D = usePlanFeature('includes_d2d').hasFeature;
  const { t } = useTranslation();
  const d2d = t.mobileD2D as Record<string, string>;
  const userId = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';
  const [scope, setScope] = useState<'mine' | 'org'>('mine');

  const { data: entries, isLoading } = useQuery({
    queryKey: ['commissions', orgId, scope, userId],
    queryFn: () => listCommissions(String(orgId), scope === 'mine' ? userId : null),
    enabled: !!orgId,
  });

  const summary = summarize(entries ?? []);

  // Same gates as the web: `commissions.read` permission (technicians can't view
  // commissions) AND the D2D plan flag (commissions are part of the D2D suite).
  // RLS limits rows to the caller, but the screen is deep-linkable.
  if (!can('commissions.read') || !hasD2D) return <Redirect href="/(app)/(tabs)/profile" />;

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 14 }}>
      {isManager ? (
        <View className="flex-row self-start rounded-2xl bg-surface-sunken p-1">
          {(['mine', 'org'] as const).map((s) => (
            <Pressable key={s} onPress={() => setScope(s)} className={`rounded-xl px-4 py-1.5 ${scope === s ? 'bg-white' : ''}`}>
              <Text className={`text-sm font-semibold ${scope === s ? 'text-ink' : 'text-ink-muted'}`}>
                {s === 'mine' ? t.mobileD2D.commissionsScopeMine : t.mobileD2D.commissionsScopeTeam}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Summary cards */}
      <View className="flex-row flex-wrap gap-3">
        <SummaryCard label={t.mobileD2D.commissionStatusPending} value={money(summary.pending)} color="#D97706" />
        <SummaryCard label={t.mobileD2D.commissionStatusApproved} value={money(summary.approved)} color="#2563EB" />
        <SummaryCard label={t.mobileD2D.commissionStatusPaid} value={money(summary.paid)} color="#16A34A" />
      </View>

      {isLoading ? (
        <ActivityIndicator color="#171717" />
      ) : (entries?.length ?? 0) === 0 ? (
        <View className="items-center py-16">
          <Text className="text-sm text-ink-muted">{t.mobileD2D.noCommissions}</Text>
        </View>
      ) : (
        <View className="gap-2">
          {entries!.map((e: CommissionEntry) => (
            <View key={e.id} className="flex-row items-center justify-between rounded-2xl bg-white p-4">
              <View className="flex-1 pr-3">
                <Text className="text-base font-semibold text-ink">{e.description ?? t.mobileD2D.commissionFallback}</Text>
                <Text className="text-xs text-ink-subtle">{new Date(e.created_at).toLocaleDateString()}</Text>
              </View>
              <View className="items-end">
                <Text className="text-base font-bold text-ink">{money(Number(e.amount))}</Text>
                <View className="mt-0.5 flex-row items-center gap-1">
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS_COLOR[e.status] }} />
                  <Text className="text-xs text-ink-subtle">{d2d[STATUS_LABEL_KEY[e.status]]}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View className="min-w-[30%] flex-1 gap-1 rounded-2xl bg-white p-4">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{label}</Text>
      <Text className="text-lg font-bold" style={{ color }}>
        {value}
      </Text>
    </View>
  );
}
