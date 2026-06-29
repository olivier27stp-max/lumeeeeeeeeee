import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ActionItem, getActionItems, getDashboard } from '@/lib/api/dashboard';
import { formatCurrencyCents } from '@/lib/format';
import { usePermissions } from '@/lib/usePermissions';

type Period = 'day' | 'week' | 'month';
type Filter = 'all' | 'invoice' | 'quote' | 'job';

function periodStart(p: Period): Date {
  const d = new Date();
  if (p === 'day') {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (p === 'week') {
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

const SHADOW = { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } } as const;

function Stat({ label, value, icon, tint }: { label: string; value: string; icon: string; tint?: string }) {
  return (
    <View className="flex-1 gap-1.5 rounded-2xl bg-white p-4" style={SHADOW}>
      <View className="flex-row items-center gap-1.5">
        <SymbolView name={icon as any} tintColor={tint ?? '#A3A3A3'} size={13} resizeMode="scaleAspectFit" />
        <Text className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{label}</Text>
      </View>
      <Text className="text-xl font-bold" style={{ color: tint ?? '#171717' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function Dashboard() {
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';
  const [period, setPeriod] = useState<Period>('month');
  const [filter, setFilter] = useState<Filter>('all');
  const start = useMemo(() => periodStart(period), [period]);

  const { data: stats } = useQuery({
    queryKey: ['dashboard', orgId, period],
    queryFn: () => getDashboard(orgId ?? '', start.toISOString()),
    enabled: !!orgId && isManager,
  });
  const { data: actions } = useQuery({
    queryKey: ['dashboard', 'actions', orgId],
    queryFn: () => getActionItems(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  if (!isManager) return <Redirect href="/(app)/(tabs)" />;

  const periodLabel = period === 'day' ? "aujourd'hui" : period === 'week' ? 'cette semaine' : 'ce mois';
  const filtered = (actions ?? []).filter((a) => filter === 'all' || a.kind === filter);
  const countByKind = (k: ActionItem['kind']) => (actions ?? []).filter((a) => a.kind === k).length;

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: `Tout (${actions?.length ?? 0})` },
    { key: 'invoice', label: `Factures (${countByKind('invoice')})` },
    { key: 'quote', label: `Soumissions (${countByKind('quote')})` },
    { key: 'job', label: `Jobs (${countByKind('job')})` },
  ];

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
      {/* Period toggle */}
      <View className="flex-row rounded-2xl bg-surface-sunken p-1">
        {(['day', 'week', 'month'] as Period[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            className={`flex-1 items-center rounded-xl py-2 ${period === p ? 'bg-white' : ''}`}
          >
            <Text className={`text-sm font-semibold ${period === p ? 'text-ink' : 'text-ink-muted'}`}>
              {p === 'day' ? 'Jour' : p === 'week' ? 'Semaine' : 'Mois'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Revenue hero */}
      <View className="gap-1 rounded-3xl bg-ink p-5" style={SHADOW}>
        <Text className="text-[11px] font-bold uppercase tracking-widest text-white/60">Encaissé {periodLabel}</Text>
        <Text className="text-3xl font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>
          {formatCurrencyCents(stats?.paidCents ?? 0, 'CAD')}
        </Text>
        <Text className="text-sm text-white/70">
          {formatCurrencyCents(stats?.invoicedCents ?? 0, 'CAD')} facturé · {stats?.paidInvoiceCount ?? 0}/{stats?.invoiceCount ?? 0} factures payées
        </Text>
      </View>

      {/* Stat grid */}
      <View className="gap-3">
        <View className="flex-row gap-3">
          <Stat label="Impayés" value={formatCurrencyCents(stats?.outstandingCents ?? 0, 'CAD')} icon="exclamationmark.circle" tint="#DC2626" />
          <Stat label="Jobs complétés" value={String(stats?.jobsCompleted ?? 0)} icon="checkmark.circle" tint="#16A34A" />
        </View>
        <View className="flex-row gap-3">
          <Stat label="Soumissions en attente" value={String(stats?.quotesPending ?? 0)} icon="doc.text" tint="#CA8A04" />
          <Stat label="Factures" value={String(stats?.invoiceCount ?? 0)} icon="dollarsign.circle" />
        </View>
      </View>

      {/* Action Required */}
      <View className="flex-row items-baseline justify-between px-1 pt-1">
        <Text className="text-lg font-bold text-ink">Action Required</Text>
        <Text className="text-sm font-semibold text-ink-muted">{actions?.length ?? 0}</Text>
      </View>

      {/* Filters */}
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {filters.map((f) => {
          const sel = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 ${sel ? 'bg-ink' : 'bg-white'}`}
              style={SHADOW}
            >
              <Text className={`text-xs font-semibold ${sel ? 'text-white' : 'text-ink'}`}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {filtered.length === 0 ? (
        <View className="items-center rounded-3xl bg-white p-8" style={SHADOW}>
          <SymbolView name="checkmark.seal" tintColor="#16A34A" size={32} resizeMode="scaleAspectFit" />
          <Text className="mt-2 text-sm text-ink-muted">Rien à traiter. 🎉</Text>
        </View>
      ) : (
        <View className="gap-2">
          {filtered.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => a.route && router.push(a.route as any)}
              className="flex-row items-center gap-3 rounded-2xl bg-white p-4"
              style={SHADOW}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: a.tint }} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink" numberOfLines={1}>{a.title}</Text>
                {a.subtitle ? <Text className="text-sm text-ink-muted" numberOfLines={1}>{a.subtitle}</Text> : null}
              </View>
              {a.route ? <SymbolView name="chevron.right" tintColor="#A3A3A3" size={14} resizeMode="scaleAspectFit" /> : null}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
