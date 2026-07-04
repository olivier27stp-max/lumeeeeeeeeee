import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { getLeaderboard, RepRank } from '@/lib/api/salesRep';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

type Period = 'day' | 'week' | 'month' | 'all';
type Metric = 'sales' | 'revenue';

type SalesT = ReturnType<typeof useTranslation>['t']['mobileSales'];

const PERIODS: { id: Period; labelKey: keyof SalesT }[] = [
  { id: 'day', labelKey: 'periodDay' },
  { id: 'week', labelKey: 'periodWeek' },
  { id: 'month', labelKey: 'periodMonth' },
  { id: 'all', labelKey: 'periodAll' },
];

// Each close = one treat. Cycle a few for variety; cap so rows don't overflow.
const TREATS = ['🍪', '🍩', '🧁', '🍫', '🍬', '🍭'];
function treats(n: number): string {
  if (!n || n <= 0) return '—';
  const cap = 6;
  const shown = Math.min(n, cap);
  let s = '';
  for (let i = 0; i < shown; i++) s += TREATS[i % TREATS.length];
  return n > cap ? `${s} +${n - cap}` : s;
}
const METRICS: { id: Metric; labelKey: keyof SalesT }[] = [
  { id: 'sales', labelKey: 'metricSales' },
  { id: 'revenue', labelKey: 'metricRevenue' },
];

const money = (cents: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);

function sinceISO(p: Period): string {
  if (p === 'all') return new Date(0).toISOString(); // 1970 → everything
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === 'week') d.setDate(d.getDate() - 6);
  else if (p === 'month') d.setDate(1);
  return d.toISOString();
}

const RANK_RING = ['#F59E0B', '#94A3B8', '#EA580C']; // gold / silver / bronze

// Sample reps so the board looks populated while you evaluate. SET false to ship real-only.
const SHOW_DEMO = true;
const DEMO: RepRank[] = [
  { user_id: 'demo-1', name: 'Olivier Tremblay', sales: 21, knocks: 0, avatarUrl: null, revenueCents: 5240000 },
  { user_id: 'demo-2', name: 'Maxime Gagné', sales: 18, knocks: 0, avatarUrl: null, revenueCents: 4310000 },
  { user_id: 'demo-3', name: 'Sophie Lavoie', sales: 16, knocks: 0, avatarUrl: null, revenueCents: 3980000 },
  { user_id: 'demo-4', name: 'Liam Bouchard', sales: 14, knocks: 0, avatarUrl: null, revenueCents: 3120000 },
  { user_id: 'demo-5', name: 'Emma Roy', sales: 12, knocks: 0, avatarUrl: null, revenueCents: 2670000 },
  { user_id: 'demo-6', name: 'Nathan Côté', sales: 11, knocks: 0, avatarUrl: null, revenueCents: 2410000 },
  { user_id: 'demo-7', name: 'Charlotte Fortin', sales: 9, knocks: 0, avatarUrl: null, revenueCents: 1890000 },
  { user_id: 'demo-8', name: 'Léa Pelletier', sales: 7, knocks: 0, avatarUrl: null, revenueCents: 1450000 },
  { user_id: 'demo-9', name: 'Thomas Girard', sales: 5, knocks: 0, avatarUrl: null, revenueCents: 980000 },
  { user_id: 'demo-10', name: 'Justin Roy', sales: 4, knocks: 0, avatarUrl: null, revenueCents: 760000 },
  { user_id: 'demo-11', name: 'Mia Bélanger', sales: 3, knocks: 0, avatarUrl: null, revenueCents: 540000 },
  { user_id: 'demo-12', name: 'Alexis Caron', sales: 2, knocks: 0, avatarUrl: null, revenueCents: 390000 },
  { user_id: 'demo-13', name: 'Rosalie Morin', sales: 1, knocks: 0, avatarUrl: null, revenueCents: 180000 },
];

function PodiumAvatar({ rank, id, name, size, url }: { rank: number; id: string; name: string; size: number; url: string | null }) {
  const ring = RANK_RING[rank - 1] ?? 'transparent';
  return (
    <View className="relative">
      <View style={{ borderWidth: 3, borderColor: ring, borderRadius: (size + 6) / 2 }}>
        <UnifiedAvatar id={id} name={name} size={size} url={url} />
      </View>
      <View style={{ backgroundColor: ring }} className="absolute -top-1 -right-1 h-6 w-6 items-center justify-center rounded-full border-2 border-white">
        <Text className="text-[11px] font-bold text-white">{rank}</Text>
      </View>
    </View>
  );
}

export function SalesLeaderboardView() {
  const { t } = useTranslation();
  const { orgId } = usePermissions();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const [period, setPeriod] = useState<Period>('week');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [query, setQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', orgId, period],
    queryFn: () => getLeaderboard(String(orgId), sinceISO(period)),
    enabled: !!orgId,
  });

  // .slice() (not spread) + Array.isArray guard: the offline cache can rehydrate
  // query data as a non-array, and spreading it crashes Hermes ("iterator not callable").
  const sortBy = (list: RepRank[]) =>
    (Array.isArray(list) ? list.slice() : []).sort((a, b) =>
      metric === 'revenue' ? b.revenueCents - a.revenueCents || b.sales - a.sales : b.sales - a.sales || b.revenueCents - a.revenueCents,
    );

  const real: RepRank[] = Array.isArray(data) ? data : [];
  // Blend demo reps in alongside the real ones (concat, not spread → no Hermes crash)
  // so the board always looks full while you evaluate.
  const merged = SHOW_DEMO
    ? real.concat(DEMO.filter((d) => !real.some((r) => r.user_id === d.user_id)))
    : real;
  const usingDemo = SHOW_DEMO && DEMO.length > 0;
  const board = sortBy(merged);
  const valText = (r: RepRank) => (metric === 'revenue' ? money(r.revenueCents) : treats(r.sales));
  // The OTHER metric, shown as a subtitle so both numbers are always visible.
  const subText = (r: RepRank) => (metric === 'revenue' ? treats(r.sales) : money(r.revenueCents));

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const filtered = searching ? board.filter((r) => r.name.toLowerCase().includes(q)) : [];

  const Row = ({ r }: { r: RepRank }) => {
    const place = board.indexOf(r) + 1;
    const mine = r.user_id === me;
    return (
      <Pressable
        onPress={() => router.push(`/(app)/rep/${r.user_id}?name=${encodeURIComponent(r.name)}` as any)}
        className={`flex-row items-center gap-3 px-2 py-2.5 ${mine ? 'rounded-xl bg-brand/5' : ''}`}
      >
        <Text className="w-5 text-center text-base font-bold text-ink-muted">{place}</Text>
        <UnifiedAvatar id={r.user_id} name={r.name} size={38} url={r.avatarUrl} />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base font-medium text-ink">
            {r.name}
            {mine ? ` (${t.mobileSales.me})` : ''}
          </Text>
          <Text className="text-xs text-ink-muted">{subText(r)}</Text>
        </View>
        <Text className="text-right text-base font-bold text-ink">{valText(r)}</Text>
      </Pressable>
    );
  };

  const podium = board.slice(0, 3);
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as RepRank[];
  const openRep = (r: RepRank) => router.push(`/(app)/rep/${r.user_id}?name=${encodeURIComponent(r.name)}` as any);

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View className="gap-2">
          <View className="flex-row rounded-2xl bg-surface-sunken p-1">
            {PERIODS.map((p) => (
              <Pressable key={p.id} onPress={() => setPeriod(p.id)} className={`flex-1 items-center rounded-xl py-2 ${period === p.id ? 'bg-white' : ''}`}>
                <Text className={`text-sm font-semibold ${period === p.id ? 'text-ink' : 'text-ink-muted'}`}>{t.mobileSales[p.labelKey]}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row justify-center gap-2">
            {METRICS.map((mt) => (
              <Pressable
                key={mt.id}
                onPress={() => setMetric(mt.id)}
                className={`rounded-full border px-4 py-1.5 ${metric === mt.id ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
              >
                <Text className={`text-xs font-semibold ${metric === mt.id ? 'text-white' : 'text-ink'}`}>{t.mobileSales[mt.labelKey]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Search */}
        <View className="flex-row items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5">
          <SymbolView name="magnifyingglass" tintColor="#A3A3A3" size={16} resizeMode="scaleAspectFit" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.mobileSales.searchRepPlaceholder}
            placeholderTextColor="#A3A3A3"
            className="flex-1 text-base text-ink"
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searching ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <SymbolView name="xmark.circle.fill" tintColor="#A3A3A3" size={16} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>

        {usingDemo && !searching ? (
          <View className="flex-row items-center justify-center gap-1.5 rounded-full bg-surface-sunken px-3 py-1.5">
            <SymbolView name="sparkles" tintColor="#A3A3A3" size={12} resizeMode="scaleAspectFit" />
            <Text className="text-xs text-ink-subtle">{t.mobileSales.includesSampleData}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View className="items-center py-20">
            <ActivityIndicator color="#171717" />
          </View>
        ) : searching ? (
          filtered.length === 0 ? (
            <View className="items-center py-16">
              <Text className="text-sm text-ink-muted">{t.mobileSales.noRepForQuery.replace('{query}', query)}</Text>
            </View>
          ) : (
            <View className="rounded-2xl bg-white px-2 py-1">
              {filtered.map((r, i) => (
                <View key={r.user_id} className={i > 0 ? 'border-t border-surface-border' : ''}>
                  <Row r={r} />
                </View>
              ))}
            </View>
          )
        ) : board.length === 0 ? (
          <View className="items-center py-20">
            <SymbolView name="trophy" tintColor="#D4D4D4" size={44} resizeMode="scaleAspectFit" />
            <Text className="mt-2 text-sm text-ink-muted">{t.mobileSales.noActivityForPeriod}</Text>
          </View>
        ) : (
          <>
            {/* Podium */}
            <View className="flex-row items-start justify-center gap-5 pb-2 pt-3">
              {podiumOrder.map((r) => {
                const place = board.indexOf(r) + 1;
                const isFirst = place === 1;
                return (
                  <Pressable key={r.user_id} onPress={() => openRep(r)} className="items-center" style={{ marginTop: isFirst ? 0 : 16 }}>
                    <PodiumAvatar rank={place} id={r.user_id} name={r.name} size={isFirst ? 76 : 58} url={r.avatarUrl} />
                    <Text numberOfLines={1} className="mt-2 max-w-[100px] text-center text-sm font-semibold text-ink">
                      {r.name}
                      {r.user_id === me ? ` (${t.mobileSales.me})` : ''}
                    </Text>
                    <Text className={`text-center font-bold text-ink ${isFirst ? 'text-xl' : 'text-lg'}`}>{valText(r)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Full ranking — the top 3 show both on the podium AND here as rows */}
            <View className="rounded-2xl bg-white px-2 py-1">
              {board.map((r, i) => (
                <View key={r.user_id} className={i > 0 ? 'border-t border-surface-border' : ''}>
                  <Row r={r} />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
