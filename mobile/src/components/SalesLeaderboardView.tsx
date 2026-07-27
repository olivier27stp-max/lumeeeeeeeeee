// Web-parity Leaderboard — mirrors the DEPLOYED web page (src/pages/Leaderboard.tsx
// on main): date/period selector, scope + office filters, category tabs
// (all / rookie / experienced), search, avatar podium 2-1-3 with gold/silver/
// bronze rings, and expandable rows showing the Rep Hub period stats
// (Terrain pins + 8 KPIs). Same server route (GET /api/leaderboard?from&to…)
// and the same client-side Supabase stats reads as the web.

import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import {
  getLeaderboard,
  getOffices,
  getRepProfileInfo,
  LeaderboardEntry,
  LeaderboardRange,
} from '@/lib/api/leaderboard';
import { getRepPeriodStats, getRepPinCounts, RepPeriodStats, RepPinCounts } from '@/lib/api/repStats';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

type Category = 'all' | 'rookie' | 'experienced';

interface RepData {
  rank: number;
  name: string;
  userId: string;
  avatar: string | null;
  closes: number;
  revenue: number;
  officeName: string | null;
}

function apiToRepData(entries: LeaderboardEntry[]): RepData[] {
  return entries.map((e) => ({
    rank: e.rank,
    name: e.full_name,
    userId: e.user_id,
    avatar: e.avatar_url ?? null,
    closes: e.closes,
    revenue: e.revenue,
    officeName: e.office_name ?? null,
  }));
}

// Local YYYY-MM-DD (en-CA locale formats exactly that way)
function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

// "mercredi 16 juillet 2026" for a single day, "12 juill. – 16 juill. 2026" for a range
function formatRangeLabel(range: LeaderboardRange, fr: boolean): string {
  const locale = fr ? 'fr-CA' : 'en-CA';
  if (range.from === range.to) {
    return parseIsoDate(range.from).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  const short: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${parseIsoDate(range.from).toLocaleDateString(locale, short)} – ${parseIsoDate(range.to).toLocaleDateString(locale, short)}`;
}

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v || 0);

// Les 8 KPIs du Rep Hub (mêmes libellés que le web), format leaderboard
function statsToKPIs(stats: RepPeriodStats): { label: string; value: string }[] {
  return [
    { label: 'Revenue', value: money(stats.revenue) },
    { label: 'Jobs', value: String(stats.jobs) },
    { label: 'Serviced Revenue', value: money(stats.servicedRevenue) },
    { label: 'Serviced Jobs', value: String(stats.servicedJobs) },
    { label: 'Avg Contract Value', value: stats.avgContractValue != null ? money(stats.avgContractValue) : '—' },
    { label: 'Closing Rate', value: stats.contractClosingRate != null ? `${stats.contractClosingRate}%` : '—' },
    { label: 'Cancel Rate', value: stats.cancelRate != null ? `${stats.cancelRate}%` : '—' },
    { label: 'Days Worked', value: String(stats.daysWorked) },
  ];
}

// Podium ring colors — gold / silver / bronze (same as the web page)
const RANK_RING = ['#F59E0B', '#94A3B8', '#EA580C'];

function PodiumAvatar({ rep, size }: { rep: RepData; size: number }) {
  const ring = RANK_RING[rep.rank - 1] ?? 'transparent';
  return (
    <View className="relative">
      <View style={{ borderWidth: 3, borderColor: ring, borderRadius: (size + 10) / 2, padding: 2 }}>
        <UnifiedAvatar id={rep.userId} name={rep.name} size={size} url={rep.avatar} />
      </View>
      <View
        style={{ backgroundColor: ring }}
        className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full border-2 border-white"
      >
        <Text className="text-[11px] font-bold text-white">{rep.rank}</Text>
      </View>
    </View>
  );
}

export function SalesLeaderboardView() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const insets = useSafeAreaInsets();
  const { orgId } = usePermissions();

  // Date / période sélectionnée — toutes les stats de la page suivent cette fenêtre.
  const [range, setRange] = useState<LeaderboardRange>(() => ({ from: todayIso(), to: todayIso() }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<LeaderboardRange>(range);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [category, setCategory] = useState<Category>('all');
  const [officeId, setOfficeId] = useState<string>(''); // '' = follow the scope toggle
  const [officePickerOpen, setOfficePickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Rangée dépliée + cache des stats Rep Hub, clé userId:from:to (période-scopé).
  // undefined = fetch en cours, null = échec, objet = stats chargées.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStats, setExpandedStats] = useState<Record<string, RepPeriodStats | null>>({});
  const [expandedPins, setExpandedPins] = useState<Record<string, RepPinCounts | null>>({});

  const officesQ = useQuery({ queryKey: ['leaderboard-offices'], queryFn: getOffices });
  const offices = officesQ.data?.offices ?? [];

  // Picking a specific office scopes to that org; otherwise follow the toggle.
  const effectiveScope = officeId ? ('mine' as const) : scope;
  const effectiveOrgId = officeId || (orgId ? String(orgId) : undefined);

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', range.from, range.to, effectiveScope, effectiveOrgId, category],
    queryFn: () =>
      getLeaderboard(range, {
        scope: effectiveScope,
        orgId: effectiveOrgId,
        experience: category === 'all' ? undefined : category,
      }),
    enabled: !!orgId,
  });

  // Stats Rep Hub de la rangée dépliée — org du rep résolue côté serveur
  // (scope 'all offices' : le rep peut appartenir à un autre bureau).
  useEffect(() => {
    if (!expandedId) return;
    const key = `${expandedId}:${range.from}:${range.to}`;
    if (expandedStats[key] !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await getRepProfileInfo(expandedId);
        const [stats, pins] = await Promise.all([
          getRepPeriodStats(expandedId, info.orgId, range.from, range.to),
          getRepPinCounts(expandedId, info.orgId, range.from, range.to),
        ]);
        if (!cancelled) {
          setExpandedStats((m) => ({ ...m, [key]: stats }));
          setExpandedPins((m) => ({ ...m, [key]: pins }));
        }
      } catch {
        if (!cancelled) {
          setExpandedStats((m) => ({ ...m, [key]: null }));
          setExpandedPins((m) => ({ ...m, [key]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, range.from, range.to]);

  // Classement : revenus, puis ventes (comme le web).
  const reps = apiToRepData(Array.isArray(data) ? data : []);
  const board = reps.slice().sort((a, b) => b.revenue - a.revenue || b.closes - a.closes);
  const salesText = (r: RepData) => `${r.closes} ${fr ? 'ventes' : 'sales'}`;

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const filtered = searching ? board.filter((r) => r.name.toLowerCase().includes(q)) : board;

  // Podium: places 2-1-3 so #1 sits in the middle, raised.
  const podium = board.slice(0, 3);
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as RepData[];

  const openProfile = (r: RepData) =>
    router.push(`/(app)/rep/${r.userId}?name=${encodeURIComponent(r.name)}` as any);

  const officeName = officeId ? (offices.find((o) => o.id === officeId)?.name ?? '') : fr ? 'Tous les bureaux' : 'All offices';

  const isoToDate = (s: string) => parseIsoDate(s);
  const dateToIso = (d: Date) => d.toLocaleDateString('en-CA');

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="gap-3">
          <View>
            <Text className="text-lg font-semibold text-ink">{fr ? 'Classement' : 'Rankings'}</Text>
            <Text className="mt-1 text-sm text-ink-subtle">{fr ? "Classement de l'équipe" : 'Team ranking'}</Text>
          </View>
          {/* Scope toggle — seulement si la compagnie a 2+ offices, et caché
              quand un office précis est sélectionné (redondant). */}
          {offices.length > 1 && !officeId ? (
            <View className="flex-row overflow-hidden rounded-lg border border-surface-border">
              {(['mine', 'all'] as const).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setScope(s)}
                  className={`flex-1 items-center py-2 ${scope === s ? 'bg-white' : ''}`}
                >
                  <Text className={`text-xs font-medium ${scope === s ? 'text-ink' : 'text-ink-subtle'}`}>
                    {s === 'mine' ? (fr ? 'Mon bureau' : 'My office') : fr ? 'Tous les bureaux' : 'All offices'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* Date / period selector — every stat on this page follows this window */}
        <View className="flex-row items-center justify-between gap-3 rounded-2xl border border-surface-border bg-white px-4 py-2.5">
          <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
            <SymbolView name="calendar" tintColor="#A3A3A3" size={16} resizeMode="scaleAspectFit" />
            <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-ink">
              {formatRangeLabel(range, fr)}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setDraft(range);
              setPickerOpen(true);
            }}
            className="shrink-0 rounded-lg border border-surface-border bg-white px-3 py-1.5"
          >
            <Text className="text-xs font-semibold text-ink">{fr ? 'Changer' : 'Change'}</Text>
          </Pressable>
        </View>

        {/* Category tabs (all / rookie / experienced) + office filter */}
        <View className="gap-2">
          <View className="flex-row rounded-xl border border-surface-border bg-white p-0.5">
            {(
              [
                ['all', fr ? 'Tous' : 'All'],
                ['rookie', fr ? '1re année' : 'First year'],
                ['experienced', fr ? 'Expérimentés' : 'Experienced'],
              ] as [Category, string][]
            ).map(([c, label]) => (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                className={`flex-1 items-center rounded-lg px-3 py-1.5 ${category === c ? 'bg-ink' : ''}`}
              >
                <Text className={`text-xs font-semibold ${category === c ? 'text-white' : 'text-ink-subtle'}`}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {offices.length > 1 ? (
            <Pressable
              onPress={() => setOfficePickerOpen(true)}
              className="flex-row items-center justify-between rounded-lg border border-surface-border bg-white px-3 py-2"
            >
              <Text className="text-xs font-medium text-ink">{officeName}</Text>
              <SymbolView name="chevron.down" tintColor="#A3A3A3" size={12} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>

        {/* Search */}
        <View className="flex-row items-center gap-2 rounded-2xl border border-surface-border bg-white px-3.5 py-2.5">
          <SymbolView name="magnifyingglass" tintColor="#A3A3A3" size={16} resizeMode="scaleAspectFit" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={fr ? 'Rechercher un rep…' : 'Search a rep…'}
            placeholderTextColor="#A3A3A3"
            className="flex-1 text-sm text-ink"
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searching ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <SymbolView name="xmark.circle.fill" tintColor="#A3A3A3" size={16} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>

        {/* Loading / empty / content */}
        {isLoading ? (
          <View className="items-center justify-center py-20">
            <ActivityIndicator size="large" color="#A3A3A3" />
          </View>
        ) : board.length === 0 ? (
          <View className="items-center justify-center py-20">
            <SymbolView name="trophy" tintColor="#D4D4D4" size={44} resizeMode="scaleAspectFit" />
            <Text className="mt-3 text-sm font-medium text-ink-muted">{fr ? 'Aucune activité' : 'No activity'}</Text>
            <Text className="mt-1 text-xs text-ink-subtle">
              {fr ? "Aucun rep n'a de stats pour cette période." : 'No rep has stats for this period.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Podium 2-1-3 (only when not searching) */}
            {!searching ? (
              <View className="flex-row items-start justify-center gap-6 pb-2 pt-3">
                {podiumOrder.map((rep) => {
                  const isFirst = rep.rank === 1;
                  return (
                    <Pressable
                      key={rep.userId}
                      onPress={() => openProfile(rep)}
                      className="items-center"
                      style={{ marginTop: isFirst ? 0 : 20 }}
                    >
                      <PodiumAvatar rep={rep} size={isFirst ? 84 : 64} />
                      <Text numberOfLines={1} className="mt-2 max-w-[120px] text-center text-sm font-semibold text-ink">
                        {rep.name}
                      </Text>
                      <Text className={`text-center font-bold text-ink ${isFirst ? 'text-xl' : 'text-lg'}`}>
                        {money(rep.revenue)}
                      </Text>
                      <Text className="text-center text-xs font-semibold text-ink-subtle">{salesText(rep)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* Ranking list */}
            <View className="overflow-hidden rounded-2xl border border-surface-border bg-white">
              {filtered.map((rep, i) => {
                const expanded = expandedId === rep.userId;
                const stats = expandedStats[`${rep.userId}:${range.from}:${range.to}`];
                const pins = expandedPins[`${rep.userId}:${range.from}:${range.to}`];
                return (
                  <View key={rep.userId} className={i < filtered.length - 1 ? 'border-b border-surface-border' : ''}>
                    <Pressable
                      onPress={() => setExpandedId((cur) => (cur === rep.userId ? null : rep.userId))}
                      className="flex-row items-center gap-3 px-4 py-3"
                    >
                      <Text className="w-6 text-center text-base font-bold text-ink-subtle">{rep.rank}</Text>

                      {/* Avatar + name → straight to the profile, like the web's nested Link */}
                      <Pressable onPress={() => openProfile(rep)} className="min-w-0 flex-1 flex-row items-center gap-3">
                        <UnifiedAvatar id={rep.userId} name={rep.name} size={36} url={rep.avatar} />
                        <View className="min-w-0 flex-1">
                          <Text numberOfLines={1} className="text-sm font-semibold text-ink">
                            {rep.name}
                          </Text>
                          {/* Bureau du rep — pertinent seulement quand la compagnie a 2+ offices */}
                          {offices.length > 1 && rep.officeName ? (
                            <Text numberOfLines={1} className="text-xs text-ink-subtle">
                              {rep.officeName}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>

                      <Text className="shrink-0 text-base font-bold text-ink">
                        {rep.closes} <Text className="text-xs font-semibold text-ink-subtle">{fr ? 'ventes' : 'sales'}</Text>
                      </Text>
                      <Text className="shrink-0 text-right text-base font-bold text-ink">{money(rep.revenue)}</Text>
                      <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
                        <SymbolView name="chevron.down" tintColor="#A3A3A3" size={13} resizeMode="scaleAspectFit" />
                      </View>
                    </Pressable>

                    {/* Rangée dépliée — les stats du Rep Hub pour la période sélectionnée */}
                    {expanded ? (
                      <View className="border-t border-surface-border bg-surface-alt px-4 py-4">
                        {stats === undefined ? (
                          <View className="items-center py-6">
                            <ActivityIndicator color="#A3A3A3" />
                          </View>
                        ) : stats === null ? (
                          <Text className="py-4 text-center text-xs text-ink-subtle">
                            {fr ? 'Stats indisponibles' : 'Stats unavailable'}
                          </Text>
                        ) : (
                          <>
                            {/* Terrain — portes / conversations / ventes de la période (dérivé des pins) */}
                            {pins ? (
                              <View className="mb-2 rounded-lg border border-surface-border bg-white px-4 py-3">
                                <Text className="text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                                  Terrain
                                </Text>
                                <View className="mt-2.5 flex-row">
                                  {(
                                    [
                                      ['house.fill', pins.total, fr ? 'Portes' : 'Doors', 1],
                                      [
                                        'bubble.left.and.bubble.right.fill',
                                        pins.total - pins.byKind.no_answer,
                                        fr ? 'Conversations' : 'Talks',
                                        1.4,
                                      ],
                                      ['chart.line.uptrend.xyaxis', pins.byKind.closed_won, fr ? 'Ventes' : 'Sales', 1],
                                    ] as [string, number, string, number][]
                                  ).map(([icon, value, label, flex], idx) => (
                                    <View
                                      key={label}
                                      style={{ flex }}
                                      className={`min-w-0 gap-1.5 ${idx > 0 ? 'border-l border-surface-border pl-4' : ''}`}
                                    >
                                      <SymbolView name={icon as any} tintColor="#171717" size={16} resizeMode="scaleAspectFit" style={{ alignSelf: 'flex-start' }} />
                                      <View className="min-w-0">
                                        <Text className="text-xl font-extrabold text-ink">{value}</Text>
                                        <Text numberOfLines={1} className="mt-1 text-[9px] font-bold uppercase tracking-widest text-ink-subtle">
                                          {label}
                                        </Text>
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            ) : null}

                            <View className="flex-row flex-wrap gap-2">
                              {statsToKPIs(stats).map((kpi) => (
                                <View
                                  key={kpi.label}
                                  style={{ flexBasis: '31%', flexGrow: 1 }}
                                  className="rounded-lg border border-surface-border bg-white px-3 py-2.5"
                                >
                                  <Text className="text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                                    {kpi.label}
                                  </Text>
                                  <Text className="mt-0.5 text-sm font-bold text-ink">{kpi.value}</Text>
                                </View>
                              ))}
                            </View>

                            <Pressable
                              onPress={() => openProfile(rep)}
                              className="mt-3 flex-row items-center justify-center gap-2 rounded-lg border border-surface-border bg-white px-4 py-2"
                            >
                              <SymbolView name="person.fill" tintColor="#171717" size={13} resizeMode="scaleAspectFit" />
                              <Text className="text-xs font-semibold text-ink">
                                {fr ? 'Voir le profil complet' : 'View full profile'}
                              </Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Date range picker — bottom sheet standing in for the web's popover */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View className="flex-1 justify-end bg-black/20">
          <Pressable className="flex-1" onPress={() => setPickerOpen(false)} />
          <View className="rounded-t-3xl bg-white p-5" style={{ paddingBottom: Math.max(insets.bottom, 20) }}>
            <Text className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              {fr ? 'Date ou période' : 'Date or period'}
            </Text>
            <View className="gap-2.5">
              <View className="flex-row items-center justify-between rounded-xl border border-surface-border bg-surface-sunken px-4 py-2.5">
                <Text className="text-xs font-medium text-ink-muted">{fr ? 'Du' : 'From'}</Text>
                <DateTimePicker
                  value={isoToDate(draft.from)}
                  mode="date"
                  display="compact"
                  themeVariant="light"
                  accentColor="#171717"
                  maximumDate={new Date()}
                  onChange={(_, d) => {
                    if (!d) return;
                    const v = dateToIso(d);
                    setDraft((prev) => ({ from: v, to: v > prev.to ? v : prev.to }));
                  }}
                />
              </View>
              <View className="flex-row items-center justify-between rounded-xl border border-surface-border bg-surface-sunken px-4 py-2.5">
                <Text className="text-xs font-medium text-ink-muted">{fr ? 'Au' : 'To'}</Text>
                <DateTimePicker
                  value={isoToDate(draft.to)}
                  mode="date"
                  display="compact"
                  themeVariant="light"
                  accentColor="#171717"
                  maximumDate={new Date()}
                  onChange={(_, d) => {
                    if (!d) return;
                    const v = dateToIso(d);
                    setDraft((prev) => ({ from: v < prev.from ? v : prev.from, to: v }));
                  }}
                />
              </View>
            </View>
            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => {
                  const t = todayIso();
                  setDraft({ from: t, to: t });
                }}
                className="flex-1 items-center rounded-lg border border-surface-border bg-white px-3 py-2.5"
              >
                <Text className="text-xs font-semibold text-ink">{fr ? "Aujourd'hui" : 'Today'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setRange(draft);
                  setPickerOpen(false);
                }}
                className="flex-1 items-center rounded-lg bg-ink px-3 py-2.5"
              >
                <Text className="text-xs font-semibold text-white">{fr ? 'Appliquer' : 'Apply'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Office picker — the web's <select> as a bottom sheet */}
      <Modal visible={officePickerOpen} transparent animationType="slide" onRequestClose={() => setOfficePickerOpen(false)}>
        <View className="flex-1 justify-end bg-black/20">
          <Pressable className="flex-1" onPress={() => setOfficePickerOpen(false)} />
          <View className="rounded-t-3xl bg-white p-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
            {[{ id: '', name: fr ? 'Tous les bureaux' : 'All offices' }, ...offices].map((o) => (
              <Pressable
                key={o.id || 'all'}
                onPress={() => {
                  setOfficeId(o.id);
                  setOfficePickerOpen(false);
                }}
                className={`flex-row items-center justify-between rounded-xl px-4 py-3 ${officeId === o.id ? 'bg-surface-sunken' : ''}`}
              >
                <Text className="text-sm font-medium text-ink">{o.name}</Text>
                {officeId === o.id ? (
                  <SymbolView name="checkmark" tintColor="#171717" size={14} resizeMode="scaleAspectFit" />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}
