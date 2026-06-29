import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import {
  CommissionEntry,
  CommissionStatus,
  listCommissions,
  summarize,
} from '@/lib/api/commissions';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

const STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: 'En attente',
  approved: 'Approuvée',
  paid: 'Payée',
  reversed: 'Annulée',
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
  const { orgId, role } = usePermissions();
  const userId = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';
  const [scope, setScope] = useState<'mine' | 'org'>('mine');

  const { data: entries, isLoading } = useQuery({
    queryKey: ['commissions', orgId, scope, userId],
    queryFn: () => listCommissions(String(orgId), scope === 'mine' ? userId : null),
    enabled: !!orgId,
  });

  const summary = summarize(entries ?? []);

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 14 }}>
      {isManager ? (
        <View className="flex-row self-start rounded-2xl bg-surface-sunken p-1">
          {(['mine', 'org'] as const).map((s) => (
            <Pressable key={s} onPress={() => setScope(s)} className={`rounded-xl px-4 py-1.5 ${scope === s ? 'bg-white' : ''}`}>
              <Text className={`text-sm font-semibold ${scope === s ? 'text-ink' : 'text-ink-muted'}`}>
                {s === 'mine' ? 'Mes commissions' : 'Équipe'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Summary cards */}
      <View className="flex-row flex-wrap gap-3">
        <SummaryCard label="En attente" value={money(summary.pending)} color="#D97706" />
        <SummaryCard label="Approuvées" value={money(summary.approved)} color="#2563EB" />
        <SummaryCard label="Payées" value={money(summary.paid)} color="#16A34A" />
      </View>

      {isLoading ? (
        <ActivityIndicator color="#171717" />
      ) : (entries?.length ?? 0) === 0 ? (
        <View className="items-center py-16">
          <Text className="text-sm text-ink-muted">Aucune commission pour l’instant.</Text>
        </View>
      ) : (
        <View className="gap-2">
          {entries!.map((e: CommissionEntry) => (
            <View key={e.id} className="flex-row items-center justify-between rounded-2xl bg-white p-4">
              <View className="flex-1 pr-3">
                <Text className="text-base font-semibold text-ink">{e.description ?? 'Commission'}</Text>
                <Text className="text-xs text-ink-subtle">{new Date(e.created_at).toLocaleDateString()}</Text>
              </View>
              <View className="items-end">
                <Text className="text-base font-bold text-ink">{money(Number(e.amount))}</Text>
                <View className="mt-0.5 flex-row items-center gap-1">
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS_COLOR[e.status] }} />
                  <Text className="text-xs text-ink-subtle">{STATUS_LABEL[e.status]}</Text>
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
