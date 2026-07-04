import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { CircleButton } from '@/components/CircleButton';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { listClientPhones } from '@/lib/api/clients';
import { listConversations } from '@/lib/api/messaging';
import { listTeams } from '@/lib/api/org';
import { listNotifications, unreadCount } from '@/lib/api/notifications';
import { listJobsInRange, listTodaysJobs, spreadJobsAcrossTodayTomorrow } from '@/lib/api/jobs';
import { getActiveTimesheet, workedMs } from '@/lib/api/timesheets';
import { MK } from '@/lib/offline/mutationKeys';
import { openDirections, promptCall } from '@/lib/contact';
import { formatTime } from '@/lib/format';
import { Job } from '@/types/db';
import { statusLabel, statusStyle } from '@/lib/statusColors';
import { useViewMode } from '@/lib/view-mode';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { useTranslation } from '@/lib/i18n';

// Full-screen construction-site backdrop, desaturated (B&W) and very light.
// `sat=-100` removes colour; we keep a low opacity so content stays readable.
const FIELD_BG =
  'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1200&q=50&sat=-100';
const CARD_W = Math.round(Dimensions.get('window').width * 0.82);
const CARD_SHADOW = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

function directionsTo(j: Job) {
  openDirections({ latitude: j.latitude, longitude: j.longitude, address: j.property_address ?? j.title });
}

function sortByTime(a: Job, b: Job): number {
  return ((a.scheduled_at ?? a.start_at ?? '') as string).localeCompare(
    (b.scheduled_at ?? b.start_at ?? '') as string,
  );
}

// (C) Swipeable carousel with page dots.
function Carousel({
  jobs,
  renderCard,
  empty,
}: {
  jobs: Job[];
  renderCard: (item: Job) => any;
  empty: string;
}) {
  if (jobs.length === 0) {
    return (
      <View className="mx-5 items-center rounded-3xl bg-white p-8" style={CARD_SHADOW}>
        <SymbolView name="checkmark.circle" tintColor="#A3A3A3" size={36} resizeMode="scaleAspectFit" />
        <Text className="mt-2 text-sm text-ink-muted">{empty}</Text>
      </View>
    );
  }
  return (
    <FlatList
      horizontal
      data={jobs}
      keyExtractor={(j) => j.id}
      showsHorizontalScrollIndicator={false}
      snapToInterval={CARD_W + 12}
      decelerationRate="fast"
      contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingVertical: 4 }}
      renderItem={({ item }) => renderCard(item)}
    />
  );
}

/** Local-day start/end ISO for `now + offsetDays`. */
function dayRange(offsetDays: number): { startISO: string; endISO: string } {
  const s = new Date();
  s.setDate(s.getDate() + offsetDays);
  s.setHours(0, 0, 0, 0);
  const e = new Date(s);
  e.setHours(23, 59, 59, 999);
  return { startISO: s.toISOString(), endISO: e.toISOString() };
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { orgId, teamId, scope, permissions, role, can, canSeePricing } = usePermissions();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { current: membership } = useMembership();
  const employeeId = session?.user.id ?? '';
  const access = { teamId, scope, permissions, role };
  // App mode (Technician vs Sales reps) is global — switched in More, not here.
  const { mode } = useViewMode();
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const createOptions: { label: string; icon: string; route: string }[] = [];
  if (can('jobs.create')) createOptions.push({ label: t.mobileHome.newJob, icon: 'wrench.and.screwdriver', route: '/(app)/jobs/new' });
  if (can('clients.create')) createOptions.push({ label: t.mobileHome.newClient, icon: 'person.badge.plus', route: '/(app)/clients/new' });
  if (can('quotes.create') || canSeePricing) createOptions.push({ label: t.mobileHome.newQuote, icon: 'doc.text', route: '/(app)/quotes/new' });
  if (can('invoices.create') || canSeePricing) createOptions.push({ label: t.mobileHome.newInvoice, icon: 'dollarsign.circle', route: '/(app)/invoices/new' });
  const canCreateAny = createOptions.length > 0;

  const goCreate = (route: string) => {
    setMenuOpen(false);
    router.push(route as any);
  };

  // Today + tomorrow jobs, scoped to the user's team (owner/company sees all).
  const tomorrow = useMemo(() => dayRange(1), []);
  const { data: todayJobs } = useQuery({
    queryKey: ['jobs', 'today', orgId, role, teamId],
    queryFn: () => listTodaysJobs(access),
    enabled: !!orgId,
  });
  const { data: tomorrowJobs } = useQuery({
    queryKey: ['jobs', 'range', tomorrow.startISO, orgId, role, teamId],
    queryFn: () => listJobsInRange(tomorrow.startISO, tomorrow.endISO, access),
    enabled: !!orgId,
  });

  const todays = useMemo(
    () => (todayJobs ?? []).filter((j) => j.status !== 'cancelled').sort(sortByTime),
    [todayJobs],
  );
  const tomorrows = useMemo(
    () => (tomorrowJobs ?? []).filter((j) => j.status !== 'cancelled').sort(sortByTime),
    [tomorrowJobs],
  );

  // Phones for every job shown, so each card can offer a one-tap Call button.
  const phoneClientIds = [...todays, ...tomorrows].map((j) => j.client_id).filter(Boolean) as string[];
  const { data: phoneMap } = useQuery({
    queryKey: ['clients', 'phones', [...phoneClientIds].sort().join(',')],
    queryFn: () => listClientPhones(phoneClientIds),
    enabled: phoneClientIds.length > 0,
  });

  // Header badges: unread client messages + unread notifications.
  const { data: convs } = useQuery({
    queryKey: ['conversations', orgId, ''],
    queryFn: () => listConversations(orgId ?? ''),
    enabled: !!orgId,
  });
  const unreadMsgs = (convs ?? []).reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const { data: notifs } = useQuery({
    queryKey: ['notifications', orgId, employeeId],
    queryFn: () => listNotifications(orgId ?? '', employeeId),
    enabled: !!orgId,
  });
  const unreadNotifs = unreadCount(notifs ?? []);

  // (E) Team colours, to show a small coloured dot on each job card.
  const { data: teams } = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(orgId ?? ''),
    enabled: !!orgId,
  });
  const teamColor = (id: string | null): string | null =>
    id ? (teams ?? []).find((t) => t.id === id)?.color_hex ?? null : null;

  // (B) Greeting + date for the header.
  const firstName = (membership?.fullName ?? '').trim().split(' ')[0];
  const greeting = `${t.mobileHome.greeting}${firstName ? ` ${firstName}` : ''} 👋`;
  const dateLabel = new Date().toLocaleDateString('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const completeMut = useMutation<unknown, Error, { id: string }>({
    mutationKey: MK.jobComplete,
    onSuccess: () => Alert.alert(t.mobileHome.jobCompletedTitle, t.mobileHome.jobCompletedMsg),
    onError: (e) => Alert.alert(t.mobileHome.error, e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  // Test helper: spread real jobs over today/tomorrow to demo the carousels.
  const spreadMut = useMutation({
    mutationFn: () => spreadJobsAcrossTodayTomorrow(String(orgId)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      Alert.alert(
        t.mobileHome.testJobsTitle,
        t.mobileHome.testJobsMsg
          .replace('{today}', String(r.today))
          .replace('{tomorrow}', String(r.tomorrow)),
      );
    },
    onError: (e: Error) => Alert.alert(t.mobileHome.error, e.message),
  });

  // Time clock — shares the ['timesheet','active'] key with the Time tab.
  const { data: activeEntry } = useQuery({
    queryKey: ['timesheet', 'active', employeeId],
    queryFn: () => getActiveTimesheet(employeeId),
    enabled: !!employeeId,
  });
  const isClockedIn = !!activeEntry && activeEntry.status !== 'completed';

  const punchInMut = useMutation<
    unknown,
    Error,
    { orgId: string; employeeId: string; employeeName?: string | null; teamId?: string | null; jobId?: string | null }
  >({
    mutationKey: MK.punchIn,
    onError: (e) => Alert.alert(t.mobileHome.clockInLabel, e.message),
  });
  const punchOutMut = useMutation<unknown, Error, { entryId: string }>({
    mutationKey: MK.punchOut,
    onError: (e) => Alert.alert(t.mobileHome.clockOutLabel, e.message),
  });
  const startBreakMut = useMutation<unknown, Error, { entryId: string }>({
    mutationKey: MK.startBreak,
    onError: (e) => Alert.alert(t.mobileHome.breakLabel, e.message),
  });
  const endBreakMut = useMutation<unknown, Error, { entryId: string }>({
    mutationKey: MK.endBreak,
    onError: (e) => Alert.alert(t.mobileHome.breakLabel, e.message),
  });
  const onBreak = activeEntry?.status === 'paused';
  const clockBusy =
    punchInMut.isPending || punchOutMut.isPending || startBreakMut.isPending || endBreakMut.isPending;

  const toggleBreak = () => {
    if (!activeEntry) return;
    if (onBreak) endBreakMut.mutate({ entryId: activeEntry.id });
    else startBreakMut.mutate({ entryId: activeEntry.id });
  };

  const toggleClock = () => {
    if (!orgId || !employeeId) return;
    if (isClockedIn && activeEntry) {
      Alert.alert(t.mobileHome.clockOutLabel, t.mobileHome.endShiftConfirm, [
        { text: t.mobileHome.cancel, style: 'cancel' },
        { text: t.mobileHome.clockOutLabel, onPress: () => punchOutMut.mutate({ entryId: activeEntry.id }) },
      ]);
    } else {
      punchInMut.mutate({
        orgId,
        employeeId,
        employeeName: membership?.fullName ?? session?.user.email ?? null,
        teamId: teamId ?? null,
        jobId: todays[0]?.id ?? null,
      });
    }
  };

  // Tick once a minute while clocked in so the elapsed label stays fresh.
  useEffect(() => {
    if (!isClockedIn) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [isClockedIn]);

  const clockedLabel = (() => {
    if (!activeEntry) return '';
    const min = Math.floor(workedMs(activeEntry, now) / 60_000);
    return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  })();

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['jobs'] }),
      qc.invalidateQueries({ queryKey: ['conversations'] }),
      qc.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
    setRefreshing(false);
  };

  const openJob = (j: Job) => router.push(`/(app)/jobs/${j.id}` as any);

  const confirmComplete = (j: Job) => {
    Alert.alert(t.mobileHome.completeJobTitle, t.mobileHome.completeJobMsg, [
      { text: t.mobileHome.cancel, style: 'cancel' },
      { text: t.mobileHome.complete, onPress: () => completeMut.mutate({ id: j.id }) },
    ]);
  };

  const phoneFor = (j: Job): string | null => (j.client_id ? phoneMap?.[j.client_id] ?? null : null);

  const renderJobActions = (j: Job) => {
    const p = phoneFor(j);
    return (
      <View className="flex-row gap-2">
        {p ? <CircleButton icon="phone.fill" onPress={() => promptCall(j.client_name ?? t.mobileHome.client, p)} /> : null}
        <CircleButton icon="location.north.fill" onPress={() => directionsTo(j)} />
        <CircleButton icon="checkmark" onPress={() => confirmComplete(j)} />
      </View>
    );
  };

  // A single swipeable job card with start → finish time in the top-right.
  const renderJobCard = (j: Job) => {
    const start = j.scheduled_at ?? j.start_at;
    const startStr = start ? formatTime(start) : '—';
    const endStr = j.end_at ? formatTime(j.end_at) : null;
    return (
      <Pressable
        key={j.id}
        onPress={() => openJob(j)}
        style={{ width: CARD_W, ...CARD_SHADOW, borderLeftWidth: 4, borderLeftColor: statusStyle(j.status).solid }}
        className="overflow-hidden rounded-3xl bg-white p-5"
      >
        <View className="flex-row items-start gap-3">
          <UnifiedAvatar id={j.client_id || j.id} name={j.client_name || j.title} size={42} />
          <View className="flex-1">
            <Text className="text-lg font-bold text-ink" numberOfLines={1}>
              {j.client_name ?? j.title}
            </Text>
            <Text className="text-sm text-ink-muted" numberOfLines={1}>
              {j.title}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-sm font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
              {startStr}
            </Text>
            {endStr ? (
              <Text className="text-xs text-ink-muted" style={{ fontVariant: ['tabular-nums'] }}>
                → {endStr}
              </Text>
            ) : null}
          </View>
        </View>
        <View className="mt-2 flex-row items-center gap-1.5">
          {teamColor(j.team_id) ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: teamColor(j.team_id) as string }} />
          ) : null}
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            {statusLabel(j.status, t.mobileComp)}
          </Text>
        </View>
        {j.property_address ? (
          <Text className="mt-1 text-sm text-ink-muted" numberOfLines={1}>
            {j.property_address}
          </Text>
        ) : null}
        <View className="mt-4 flex-row justify-end">{renderJobActions(j)}</View>
      </Pressable>
    );
  };

  // Sales mode lands on the full-screen D2D map (Home is technician-only).
  if (mode === 'sales') return <Redirect href={'/(app)/(tabs)/d2d' as any} />;

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      {/* Full-screen B&W construction backdrop, kept very light for readability */}
      {!bgFailed ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <Image
            source={{ uri: FIELD_BG }}
            style={{ width: '100%', height: '100%', opacity: 0.2 }}
            contentFit="cover"
            transition={300}
            onError={() => setBgFailed(true)}
          />
        </View>
      ) : null}
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#171717" />}
      >
        {/* Top bar: greeting + two-way texting bubble + notifications bell */}
        <View className="flex-row items-center justify-between gap-3 px-5 pt-1">
          <View className="flex-1">
            <Text className="text-xl font-bold text-ink" numberOfLines={1}>{greeting}</Text>
            <Text className="text-xs capitalize text-ink-muted">{dateLabel}</Text>
          </View>
          <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => router.push('/(app)/messages')}
            className="relative h-10 w-10 items-center justify-center rounded-full bg-white"
            style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
          >
            <SymbolView name="bubble.left.and.bubble.right.fill" tintColor="#171717" size={18} resizeMode="scaleAspectFit" />
            {unreadMsgs > 0 ? (
              <View className="absolute -right-1 -top-1 h-4 min-w-[16px] items-center justify-center rounded-full bg-status-late px-1">
                <Text className="text-[10px] font-bold text-white">{unreadMsgs > 9 ? '9+' : unreadMsgs}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => router.push('/(app)/notifications')}
            className="relative h-10 w-10 items-center justify-center rounded-full bg-white"
            style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
          >
            <SymbolView name="bell.fill" tintColor="#171717" size={18} resizeMode="scaleAspectFit" />
            {unreadNotifs > 0 ? (
              <View className="absolute -right-1 -top-1 h-4 min-w-[16px] items-center justify-center rounded-full bg-status-late px-1">
                <Text className="text-[10px] font-bold text-white">{unreadNotifs > 9 ? '9+' : unreadNotifs}</Text>
              </View>
            ) : null}
          </Pressable>
          </View>
        </View>

        {/* Search bar → client search */}
        <Pressable
          onPress={() => router.push('/(app)/search')}
          className="mx-5 mt-3 flex-row items-center gap-2 rounded-2xl bg-white px-4 py-3"
          style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
        >
          <SymbolView name="magnifyingglass" tintColor="#A3A3A3" size={16} resizeMode="scaleAspectFit" />
          <Text className="text-sm text-ink-muted">{t.mobileHome.searchClientPlaceholder}</Text>
        </Pressable>

        {/* Test helper — spread real jobs across today/tomorrow to demo carousels (dev builds only) */}
        {__DEV__ && can('jobs.update') ? (
          <Pressable
            onPress={() => spreadMut.mutate()}
            disabled={spreadMut.isPending}
            className="mx-5 mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-surface-sunken py-2.5 active:opacity-70"
          >
            <SymbolView name="calendar.badge.clock" tintColor="#525252" size={13} resizeMode="scaleAspectFit" />
            <Text className="text-[13px] font-semibold text-ink-muted">
              {spreadMut.isPending ? t.mobileHome.rescheduling : t.mobileHome.testSpreadJobs}
            </Text>
          </Pressable>
        ) : null}

        {/* Clock — in / pause / end */}
        {employeeId ? (
          isClockedIn ? (
            <View className="mx-5 mt-4 gap-2">
              <View
                className="flex-row items-center gap-2 rounded-3xl bg-ink px-5 py-3.5"
                style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
              >
                <SymbolView name={onBreak ? 'pause.circle.fill' : 'clock.badge.checkmark'} tintColor="#FFFFFF" size={16} resizeMode="scaleAspectFit" />
                <Text className="text-base font-semibold text-white">
                  {onBreak ? `${t.mobileHome.onBreak} · ${clockedLabel}` : `${t.mobileHome.atWork} · ${clockedLabel}`}
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={toggleBreak}
                  disabled={clockBusy}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-white py-3"
                  style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
                >
                  <SymbolView name={onBreak ? 'play.fill' : 'pause.fill'} tintColor="#171717" size={14} resizeMode="scaleAspectFit" />
                  <Text className="text-sm font-semibold text-ink">{onBreak ? t.mobileHome.resume : t.mobileHome.pause}</Text>
                </Pressable>
                <Pressable
                  onPress={toggleClock}
                  disabled={clockBusy}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-status-late py-3"
                >
                  <SymbolView name="stop.fill" tintColor="#FFFFFF" size={14} resizeMode="scaleAspectFit" />
                  <Text className="text-sm font-semibold text-white">{t.mobileHome.finish}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={toggleClock}
              disabled={clockBusy}
              className="mx-5 mt-4 flex-row items-center justify-center gap-2 rounded-3xl bg-white py-4"
              style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
            >
              <SymbolView name="clock" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
              <Text className="text-base font-semibold text-ink">{t.mobileHome.clockIn}</Text>
            </Pressable>
          )
        ) : null}

        {/* Today's Jobs — pushed down to where "Tomorrow's Jobs" used to sit,
            so the construction backdrop shows through the top of the screen. */}
        <View className="flex-row items-baseline gap-2 px-5 pb-3 pt-[230px]">
          <Text className="text-2xl font-bold text-ink">{t.mobileHome.todaysJobs}</Text>
          {todays.length > 0 ? (
            <Text className="text-lg font-semibold text-ink-muted">· {todays.length}</Text>
          ) : null}
        </View>
        <Carousel jobs={todays} renderCard={renderJobCard} empty={t.mobileHome.noJobsToday} />
      </ScrollView>

      {/* Tap-outside catcher */}
      {menuOpen ? <Pressable className="absolute inset-0" onPress={() => setMenuOpen(false)} /> : null}

      {/* Create menu (popover) */}
      {canCreateAny && menuOpen ? (
        <View
          className="absolute bottom-24 right-6 w-52 overflow-hidden rounded-2xl bg-white"
          style={{ shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }}
        >
          {createOptions.map((o) => (
            <Pressable
              key={o.route}
              onPress={() => goCreate(o.route)}
              className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3.5 active:bg-surface-sunken"
            >
              <SymbolView name={o.icon as any} tintColor="#171717" size={18} resizeMode="scaleAspectFit" />
              <Text className="text-base text-ink">{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {canCreateAny ? (
        <Pressable
          onPress={() => setMenuOpen((o) => !o)}
          className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-ink"
          style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
        >
          <SymbolView name={menuOpen ? 'xmark' : 'plus'} tintColor="#FFFFFF" size={24} resizeMode="scaleAspectFit" />
        </Pressable>
      ) : null}
    </View>
  );
}
