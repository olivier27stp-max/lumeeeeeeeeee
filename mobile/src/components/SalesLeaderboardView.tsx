// Web-parity Leaderboard (src/pages/Leaderboard.tsx) adapted to mobile:
// period toggle → top-3 gradient podium cards (stacked, like the web's
// single-column mobile grid) → ranked list rows → rep detail bottom sheet
// (the web's right-side drawer) with KPI grid + conversion funnel.
// Same server routes as the web: GET /api/leaderboard + /api/leaderboard/rep/:id.

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import {
  getLeaderboard,
  getRepPerformance,
  LeaderboardEntry,
  LeaderboardPeriod,
  RepPerformanceDetail,
} from '@/lib/api/leaderboard';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

type Period = LeaderboardPeriod;

interface RepData {
  rank: number;
  name: string;
  userId: string;
  avatarUrl: string | null;
  closes: number;
  revenue: number;
  trend: number;
}

function apiToRepData(entries: LeaderboardEntry[]): RepData[] {
  return entries.map((e) => ({
    rank: e.rank,
    name: e.full_name,
    userId: e.user_id,
    avatarUrl: e.avatar_url,
    closes: e.closes,
    revenue: e.revenue,
    trend: e.trend,
  }));
}

// Same period → date-window mapping as the web page.
function getPeriodDates(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: string;
  if (period === 'daily') {
    from = to;
  } else if (period === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    from = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

function perfToKPIs(perf: RepPerformanceDetail): { key: string; value: string }[] {
  return [
    { key: 'leads', value: String(perf.doors_knocked) },
    { key: 'contacted', value: String(perf.conversations) },
    { key: 'deals', value: String(perf.demos_set) },
    { key: 'quotes_sent', value: String(perf.quotes_sent) },
    { key: 'closes', value: String(perf.closes) },
    { key: 'revenue', value: `$${perf.revenue.toLocaleString()}` },
    { key: 'conversion_rate', value: `${Math.round(perf.conversion_rate)}%` },
    { key: 'avg_ticket', value: `$${Math.round(perf.average_ticket || 0).toLocaleString()}` },
  ];
}

function perfToFunnel(perf: RepPerformanceDetail): { key: string; value: number; max: number }[] {
  const max = perf.doors_knocked || 1;
  return [
    { key: 'leads', value: perf.doors_knocked, max },
    { key: 'contacted', value: perf.conversations, max },
    { key: 'deals_open', value: perf.demos_set, max },
    { key: 'quotes_sent', value: perf.quotes_sent, max },
    { key: 'closes', value: perf.closes, max },
  ];
}

// ─── Podium card styles — exact web gradients (gold / slate / bronze) ───────

interface CardStyle {
  from: string;
  to: string;
  overlay: string;
  rankBg: string;
  rankBorder: string;
  rankIcon: string;
  shadowColor: string;
}

const CARD_STYLES: Record<number, CardStyle> = {
  1: {
    from: '#F59E0B',
    to: '#F97316',
    overlay: 'rgba(255,255,255,0.08)',
    rankBg: 'rgba(255,255,255,0.15)',
    rankBorder: 'rgba(255,255,255,0.25)',
    rankIcon: '#FFF7ED',
    shadowColor: '#F59E0B',
  },
  2: {
    from: '#64748B',
    to: '#334155',
    overlay: 'rgba(255,255,255,0.06)',
    rankBg: 'rgba(255,255,255,0.12)',
    rankBorder: 'rgba(255,255,255,0.2)',
    rankIcon: '#E2E8F0',
    shadowColor: '#334155',
  },
  3: {
    from: '#FB923C',
    to: '#EA580C',
    overlay: 'rgba(255,255,255,0.07)',
    rankBg: 'rgba(255,255,255,0.12)',
    rankBorder: 'rgba(255,255,255,0.2)',
    rankIcon: '#FFEDD5',
    shadowColor: '#EA580C',
  },
};

/** The web card's 135° gradient + the two radial white glass glows, as one SVG. */
function CardBackground({ style }: { style: CardStyle }) {
  return (
    <Svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={style.from} />
          <Stop offset="1" stopColor={style.to} />
        </LinearGradient>
        <RadialGradient id="r1" cx="20%" cy="30%" r="40%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.15" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="r2" cx="80%" cy="70%" r="50%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.1" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#g)" />
      <Rect width="100%" height="100%" fill="url(#r1)" />
      <Rect width="100%" height="100%" fill="url(#r2)" />
      <Rect width="100%" height="100%" fill={style.overlay} />
    </Svg>
  );
}

function TrendBadge({ trend }: { trend: number }) {
  if (trend === 0) return null;
  const up = trend > 0;
  const color = up ? '#059669' : '#DC2626';
  return (
    <View className="flex-row items-center gap-0.5">
      <SymbolView
        name={up ? 'arrow.up.right' : 'arrow.down.right'}
        tintColor={color}
        size={10}
        resizeMode="scaleAspectFit"
      />
      <Text style={{ color }} className="text-xs font-medium">
        {up ? '+' : ''}
        {trend}%
      </Text>
    </View>
  );
}

// ─── View ───────────────────────────────────────────────────────────────────

export function SalesLeaderboardView() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const insets = useSafeAreaInsets();
  const { orgId } = usePermissions();

  const periodLabels: Record<Period, string> = fr
    ? { daily: 'Quotidien', weekly: 'Hebdomadaire', monthly: 'Mensuel' }
    : { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

  const [period, setPeriod] = useState<Period>('weekly');
  const [selectedRep, setSelectedRep] = useState<RepData | null>(null);

  const [detailKPIs, setDetailKPIs] = useState<{ key: string; value: string }[]>([]);
  const [funnelSteps, setFunnelSteps] = useState<{ key: string; value: number; max: number }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-board', orgId, period],
    queryFn: () => getLeaderboard(period),
    enabled: !!orgId,
  });

  // Array.isArray guard: the offline cache can rehydrate query data as a non-array.
  const all = apiToRepData(Array.isArray(data) ? data : []);
  const podiumData = all.slice(0, 3);
  const leaderboardData = all.slice(3);

  const openProfile = (rep: RepData) =>
    router.push(`/(app)/rep/${rep.userId}?name=${encodeURIComponent(rep.name)}` as any);

  // Same behavior as the web drawer: fetch the rep's window on open.
  const openRepDrawer = useCallback(
    (rep: RepData) => {
      setSelectedRep(rep);
      setDetailLoading(true);
      const { from, to } = getPeriodDates(period);
      getRepPerformance(rep.userId, from, to)
        .then(({ performance }) => {
          setDetailKPIs(perfToKPIs(performance));
          setFunnelSteps(perfToFunnel(performance));
        })
        .catch(() => {
          setDetailKPIs([]);
          setFunnelSteps([]);
        })
        .finally(() => setDetailLoading(false));
    },
    [period],
  );

  const closeDrawer = () => setSelectedRep(null);

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 32 }}>
        {/* Header — title + period toggle (stacked: the web's inline toggle doesn't fit a phone) */}
        <View className="gap-3">
          <View>
            <Text className="text-lg font-semibold text-ink">{fr ? 'Classement' : 'Rankings'}</Text>
            <Text className="mt-1 text-sm text-ink-subtle">{fr ? "Classement de l'équipe" : 'Team ranking'}</Text>
          </View>
          <View className="flex-row overflow-hidden rounded-lg border border-surface-border">
            {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                className={`flex-1 items-center py-2 ${period === p ? 'bg-white' : ''}`}
                style={
                  period === p
                    ? {
                        shadowColor: '#000',
                        shadowOpacity: 0.05,
                        shadowRadius: 2,
                        shadowOffset: { width: 0, height: 1 },
                        elevation: 1,
                      }
                    : undefined
                }
              >
                <Text className={`text-xs font-medium ${period === p ? 'text-ink' : 'text-ink-subtle'}`}>
                  {periodLabels[p]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {isLoading ? (
          <View className="items-center justify-center py-20">
            <ActivityIndicator size="large" color="#A3A3A3" />
          </View>
        ) : all.length === 0 ? (
          <View className="items-center justify-center py-20">
            <SymbolView name="person.fill" tintColor="#E5E5E5" size={40} resizeMode="scaleAspectFit" />
            <Text className="mt-3 text-sm font-medium text-ink-muted">Aucune donnée</Text>
            <Text className="mt-1 text-xs text-ink-subtle">{"Aucun rep n'a de stats pour cette période."}</Text>
          </View>
        ) : (
          <>
            {/* Top 3 — the web's single-column mobile grid */}
            <View className="gap-5">
              {podiumData.map((rep) => {
                const s = CARD_STYLES[rep.rank];
                return (
                  <View
                    key={rep.rank}
                    style={{
                      borderRadius: 16,
                      shadowColor: s.shadowColor,
                      shadowOpacity: 0.25,
                      shadowRadius: 15,
                      shadowOffset: { width: 0, height: 10 },
                      elevation: 8,
                    }}
                  >
                    <Pressable
                      onPress={() => openProfile(rep)}
                      style={{ borderRadius: 16, overflow: 'hidden' }}
                      className="p-6"
                    >
                      <CardBackground style={s} />

                      {/* Rank badge */}
                      <View className="flex-row items-center justify-between">
                        <View
                          style={{ backgroundColor: s.rankBg, borderColor: s.rankBorder, borderWidth: 1 }}
                          className="h-9 w-9 items-center justify-center rounded-full"
                        >
                          {rep.rank === 1 ? (
                            <SymbolView name="crown.fill" tintColor={s.rankIcon} size={16} resizeMode="scaleAspectFit" />
                          ) : (
                            <Text style={{ color: s.rankIcon }} className="text-sm font-bold">
                              {rep.rank}
                            </Text>
                          )}
                        </View>
                      </View>

                      {/* Avatar + name */}
                      <View className="mt-5 items-center">
                        <View
                          style={{ borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 40 }}
                          className="p-0.5"
                        >
                          <UnifiedAvatar id={rep.userId} name={rep.name} size={72} url={rep.avatarUrl} />
                        </View>
                        <Text className="mt-3 text-base font-semibold text-white">{rep.name}</Text>
                      </View>

                      {/* Closes */}
                      <Text className="mt-4 text-center text-sm font-semibold text-white/90">
                        {rep.closes} {fr ? 'ventes' : 'closes'}
                      </Text>

                      {/* Revenue */}
                      <Text className="mt-3 text-center text-2xl font-bold text-white">
                        ${(rep.revenue / 1000).toFixed(1)}k
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {/* Rest of leaderboard */}
            {leaderboardData.length > 0 ? (
              <View className="overflow-hidden rounded-2xl border border-surface-border bg-white">
                {leaderboardData.map((rep, i) => (
                  <Pressable
                    key={rep.rank}
                    onPress={() => openRepDrawer(rep)}
                    className={`flex-row items-center gap-3 px-4 py-3 ${
                      i < leaderboardData.length - 1 ? 'border-b border-surface-border' : ''
                    }`}
                  >
                    <View className="h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
                      <Text className="text-xs font-semibold text-ink-subtle">{rep.rank}</Text>
                    </View>

                    {/* Avatar + name → straight to the profile, like the web's nested Link */}
                    <Pressable onPress={() => openProfile(rep)} className="min-w-0 flex-1 flex-row items-center gap-3">
                      <UnifiedAvatar id={rep.userId} name={rep.name} size={28} url={rep.avatarUrl} />
                      <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-ink">
                        {rep.name}
                      </Text>
                    </Pressable>

                    <View className="w-14 items-end">
                      <Text className="text-lg font-bold text-ink">{rep.closes}</Text>
                      <Text className="text-[10px] font-medium text-ink-subtle">{fr ? 'ventes' : 'closes'}</Text>
                    </View>

                    <View className="w-16 items-end">
                      <Text className="text-sm font-semibold text-ink-muted">${(rep.revenue / 1000).toFixed(1)}k</Text>
                      <Text className="text-[10px] font-medium text-ink-subtle">{fr ? 'revenu' : 'revenue'}</Text>
                    </View>

                    <View className="w-12 items-end">
                      <TrendBadge trend={rep.trend} />
                    </View>

                    <SymbolView name="chevron.right" tintColor="#A3A3A3" size={12} resizeMode="scaleAspectFit" />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Rep detail — bottom sheet standing in for the web's right-side drawer */}
      <Modal visible={!!selectedRep} transparent animationType="slide" onRequestClose={closeDrawer}>
        <View className="flex-1 justify-end bg-black/20">
          <Pressable className="flex-1" onPress={closeDrawer} />
          {selectedRep ? (
            <View
              className="rounded-t-3xl bg-white"
              style={{ maxHeight: '85%', paddingBottom: Math.max(insets.bottom, 16) }}
            >
              <View className="flex-row items-center justify-between border-b border-surface-border px-5 py-4">
                <View className="flex-row items-center gap-3">
                  <UnifiedAvatar id={selectedRep.userId} name={selectedRep.name} size={44} url={selectedRep.avatarUrl} />
                  <Text className="text-sm font-semibold text-ink">{selectedRep.name}</Text>
                </View>
                <Pressable onPress={closeDrawer} hitSlop={8} className="rounded-lg bg-surface-sunken p-1.5">
                  <SymbolView name="xmark" tintColor="#525252" size={14} resizeMode="scaleAspectFit" />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ padding: 20 }}>
                {detailLoading ? (
                  <View className="items-center py-12">
                    <ActivityIndicator color="#A3A3A3" />
                  </View>
                ) : (
                  <>
                    <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                      {fr ? 'Détails de performance' : 'Performance detail'} ({periodLabels[period]})
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {detailKPIs.map((kpi) => (
                        <View
                          key={kpi.key}
                          style={{ flexBasis: '48%', flexGrow: 1 }}
                          className="rounded-lg border border-surface-border bg-surface-sunken px-3 py-3"
                        >
                          <Text className="text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                            {kpi.key}
                          </Text>
                          <Text className="mt-1 text-base font-bold text-ink">{kpi.value}</Text>
                        </View>
                      ))}
                    </View>

                    <Text className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                      {fr ? 'Taux de conversion' : 'Conversion rate'}
                    </Text>
                    <View className="gap-3">
                      {funnelSteps.map((step) => (
                        <View key={step.key}>
                          <View className="mb-1 flex-row items-center justify-between">
                            <Text className="text-xs text-ink-subtle">{step.key}</Text>
                            <Text className="text-xs font-semibold text-ink">{step.value}</Text>
                          </View>
                          <View className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                            <View
                              className="h-1.5 rounded-full bg-ink"
                              style={{ width: `${(step.value / step.max) * 100}%` }}
                            />
                          </View>
                        </View>
                      ))}
                    </View>

                    <Pressable
                      onPress={() => {
                        closeDrawer();
                        openProfile(selectedRep);
                      }}
                      className="mt-6 flex-row items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3"
                    >
                      <SymbolView name="person.fill" tintColor="#FFFFFF" size={14} resizeMode="scaleAspectFit" />
                      <Text className="text-sm font-semibold text-white">
                        {fr ? 'Voir le profil complet' : 'View Full Profile'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
