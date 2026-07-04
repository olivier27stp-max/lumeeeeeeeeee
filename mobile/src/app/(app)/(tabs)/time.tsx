import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { getActiveLiveLocations } from '@/lib/api/tracking';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { MK } from '@/lib/offline/mutationKeys';
import {
  getActiveTimesheet,
  listActiveOrgEntries,
  listEntriesInRange,
  listTodaysEntries,
  TimeEntryRow,
  workedMs,
} from '@/lib/api/timesheets';

function fmtTimer(ms: number): string {
  const t = Math.floor(ms / 1000);
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function fmtHM(ms: number): string {
  const min = Math.floor(ms / 60000);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}
function fmtClock(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Timesheets() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { current } = useMembership();
  const { orgId, teamId, role } = usePermissions();
  const employeeId = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';

  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<'day' | 'week'>('day');
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Real-time foreground GPS for the *current* user. Reads the device position
  // directly (not the round-trip via tracking_live_locations, which can be stale
  // — that's why the map used to be stuck on the last recorded point). Active
  // only while this screen is focused, to spare the battery. The map's native
  // blue dot (showsUserLocation) + this watcher keep the camera following you.
  const mapRef = useRef<MapView>(null);
  const [mePos, setMePos] = useState<{ latitude: number; longitude: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let sub: Location.LocationSubscription | null = null;
      (async () => {
        const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
        if (!perm || perm.status !== 'granted' || !active) return;
        // Ask iOS to upgrade to "Always" so background tracking works during a
        // shift. iOS still shows its own prompt (Apple forbids defaulting to
        // Always) and only once per install — best effort, never blocks the map.
        Location.requestBackgroundPermissionsAsync().catch(() => {});
        try {
          const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          if (!active) return;
          const c = { latitude: cur.coords.latitude, longitude: cur.coords.longitude };
          setMePos(c);
          mapRef.current?.animateCamera({ center: c, zoom: 15 }, { duration: 500 });
        } catch {
          /* first fix can fail; the watcher below will catch up */
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 10 },
          (loc) => {
            const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            setMePos(c);
            mapRef.current?.animateCamera({ center: c }, { duration: 800 });
          },
        );
      })();
      return () => {
        active = false;
        sub?.remove();
      };
    }, []),
  );

  const weekStart = useMemo(() => startOfWeek(new Date()), []);

  const activeQ = useQuery({
    queryKey: ['timesheet', 'active', employeeId],
    queryFn: () => getActiveTimesheet(employeeId),
    enabled: !!employeeId,
  });
  const todayQ = useQuery({
    queryKey: ['timesheet', 'today', employeeId],
    queryFn: () => listTodaysEntries(employeeId),
    enabled: !!employeeId,
  });
  const weekQ = useQuery({
    queryKey: ['timesheet', 'week', employeeId, localDate(weekStart)],
    queryFn: () => listEntriesInRange(employeeId, localDate(weekStart), localDate(addDays(weekStart, 6))),
    enabled: !!employeeId,
  });
  // Admin/owner only: who's currently on the clock across the org.
  const rosterQ = useQuery({
    queryKey: ['timesheet', 'roster', orgId],
    queryFn: () => listActiveOrgEntries(orgId ?? ''),
    enabled: !!orgId && isManager,
    refetchInterval: 30000,
  });
  // Live technician positions for the admin/owner map.
  const liveQ = useQuery({
    queryKey: ['tracking', 'live', orgId],
    queryFn: () => getActiveLiveLocations(orgId ?? ''),
    enabled: !!orgId && isManager,
    refetchInterval: 10000,
  });
  const live = liveQ.data ?? [];
  // Other teammates' markers — exclude self; the live blue dot + camera follow
  // already represent the current user accurately (the self row can be stale).
  const otherLive = live.filter((l) => l.user_id !== employeeId);
  const liveAvg =
    live.length > 0
      ? {
          latitude: live.reduce((s, l) => s + l.latitude, 0) / live.length,
          longitude: live.reduce((s, l) => s + l.longitude, 0) / live.length,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }
      : null;
  // Center on the device's real position when we have it, else the team average.
  const initialRegion = mePos
    ? { ...mePos, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : liveAvg;

  const onErr = (e: Error) => Alert.alert(t.mobileField.timeTracking, e.message);
  const punchInMut = useMutation<unknown, Error, { orgId: string; employeeId: string; employeeName: string | null; teamId: string | null }>({ mutationKey: MK.punchIn, onError: onErr });
  const punchOutMut = useMutation<unknown, Error, { entryId: string }>({ mutationKey: MK.punchOut, onError: onErr });
  const startBreakMut = useMutation<unknown, Error, { entryId: string }>({ mutationKey: MK.startBreak, onError: onErr });
  const endBreakMut = useMutation<unknown, Error, { entryId: string }>({ mutationKey: MK.endBreak, onError: onErr });

  const active = activeQ.data ?? null;
  const onBreak = active?.status === 'paused';
  const busy = punchInMut.isPending || punchOutMut.isPending || startBreakMut.isPending || endBreakMut.isPending;

  const todayEntries = todayQ.data ?? [];
  const todayTotal = todayEntries.reduce((s, e) => s + workedMs(e, now), 0);

  const weekDays = useMemo(() => {
    const entries = weekQ.data ?? [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      const ds = localDate(d);
      const ms = entries.filter((e) => e.date === ds).reduce((s, e) => s + workedMs(e, now), 0);
      return { date: d, label: DAY_ABBR[i], ms };
    });
  }, [weekQ.data, weekStart, now]);
  const weekTotal = weekDays.reduce((s, d) => s + d.ms, 0);
  const maxDay = Math.max(1, ...weekDays.map((d) => d.ms));

  const punchIn = () =>
    punchInMut.mutate({
      orgId: orgId ?? '',
      employeeId,
      employeeName: current?.fullName ?? session?.user.email ?? null,
      teamId: teamId ?? null,
    });

  useEffect(() => {
    if (!busy) qc.invalidateQueries({ queryKey: ['timesheet'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <Text className="pb-3 pt-3 text-2xl font-bold text-ink">{t.mobileField.timesheets}</Text>

        {/* Timer card */}
        <View
          className="items-center rounded-3xl bg-white py-8"
          style={{ shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
        >
          <View className="flex-row items-center gap-2">
            <View
              style={{ width: 8, height: 8, borderRadius: 4 }}
              className={active ? (onBreak ? 'bg-status-inProgress' : 'bg-status-completed') : 'bg-surface-border'}
            />
            <Text className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {active ? (onBreak ? t.mobileField.onBreak : t.mobileField.onTheClock) : t.mobileField.notPunchedIn}
            </Text>
          </View>
          <Text className="mt-2 text-5xl font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
            {active ? fmtTimer(workedMs(active, now)) : '00:00:00'}
          </Text>
          {active?.punch_in_at ? (
            <Text className="mt-1 text-sm text-ink-muted">{t.mobileField.started.replace('{time}', fmtClock(active.punch_in_at))}</Text>
          ) : null}

          <View className="mt-6 w-full gap-3 px-6">
            {!active ? (
              <Button title={t.mobileField.punchIn} onPress={punchIn} loading={busy} disabled={!orgId} />
            ) : (
              <>
                {onBreak ? (
                  <Button title={t.mobileField.endBreak} onPress={() => endBreakMut.mutate({ entryId: active.id })} loading={busy} />
                ) : (
                  <Button title={t.mobileField.startBreak} variant="secondary" onPress={() => startBreakMut.mutate({ entryId: active.id })} loading={busy} />
                )}
                <Button
                  title={t.mobileField.punchOut}
                  variant="danger"
                  loading={busy}
                  onPress={() =>
                    Alert.alert(t.mobileField.punchOut, t.mobileField.endYourShiftNow, [
                      { text: t.mobileField.cancel, style: 'cancel' },
                      { text: t.mobileField.punchOut, style: 'destructive', onPress: () => punchOutMut.mutate({ entryId: active.id }) },
                    ])
                  }
                />
              </>
            )}
          </View>
        </View>

        {/* Live technician map — admin/owner only */}
        {isManager && (initialRegion || mePos) ? (
          <View className="mt-5">
            <View className="flex-row items-center justify-between px-1 pb-3">
              <Text className="text-sm text-ink-muted">{t.mobileField.liveTechnicians.replace('{count}', String(live.length))}</Text>
              <Pressable onPress={() => router.push('/(app)/tech-history' as any)}>
                <Text className="text-sm font-medium text-brand">{t.mobileField.history}</Text>
              </Pressable>
            </View>
            <View
              className="h-56 overflow-hidden rounded-3xl border border-surface-border"
              style={{ shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}
            >
              <MapView
                ref={mapRef}
                style={{ flex: 1 }}
                initialRegion={initialRegion ?? undefined}
                showsUserLocation
                showsMyLocationButton
                userInterfaceStyle="light"
              >
                {otherLive.map((l) => {
                  const color = l.tracking_status === 'active' ? '#22C55E' : l.tracking_status === 'idle' ? '#F59E0B' : '#9CA3AF';
                  return (
                    <Marker
                      key={l.user_id}
                      coordinate={{ latitude: l.latitude, longitude: l.longitude }}
                      title={l.user_name ?? t.mobileField.technician}
                      description={l.is_moving ? t.mobileField.moving : t.mobileField.onSite}
                    >
                      <View
                        className="h-7 w-7 items-center justify-center rounded-full border-2 border-white"
                        style={{ backgroundColor: color }}
                      >
                        <Text className="text-[11px] font-bold text-white">
                          {(l.user_name ?? '?').trim().charAt(0).toUpperCase() || '?'}
                        </Text>
                      </View>
                    </Marker>
                  );
                })}
              </MapView>
            </View>
          </View>
        ) : null}

        {/* On the clock — admin/owner only roster of who's punched in right now */}
        {isManager && (rosterQ.data?.length ?? 0) > 0 ? (
          <View className="mt-5">
            <View className="flex-row items-center justify-between px-1 pb-3">
              <Text className="text-sm text-ink-muted">{t.mobileField.onTheClock}</Text>
              <Text className="text-base font-bold text-ink">{rosterQ.data!.length}</Text>
            </View>
            <View
              className="gap-3 rounded-3xl bg-white p-4"
              style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
            >
              {rosterQ.data!.map((e: TimeEntryRow) => {
                const paused = e.status === 'paused';
                return (
                  <View key={e.id} className="flex-row items-center gap-3">
                    <UnifiedAvatar id={e.employee_id} name={e.employee_name ?? t.mobileField.unknown} size={36} />
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                        {e.employee_name ?? t.mobileField.unknown}
                      </Text>
                      <View className="flex-row items-center gap-1.5">
                        <View
                          style={{ width: 6, height: 6, borderRadius: 3 }}
                          className={paused ? 'bg-status-inProgress' : 'bg-status-completed'}
                        />
                        <Text className="text-xs text-ink-muted">
                          {paused ? t.mobileField.onBreak : t.mobileField.onTheClock} · {t.mobileField.since} {fmtClock(e.punch_in_at)}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-sm font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
                      {fmtHM(workedMs(e, now))}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Day / Week toggle */}
        <View className="mt-5 flex-row rounded-2xl bg-surface-sunken p-1">
          {(['day', 'week'] as const).map((v) => (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              className={`flex-1 items-center rounded-xl py-2 ${view === v ? 'bg-white' : ''}`}
            >
              <Text className={`text-sm font-semibold ${view === v ? 'text-ink' : 'text-ink-muted'}`}>
                {v === 'day' ? t.mobileField.today : t.mobileField.thisWeek}
              </Text>
            </Pressable>
          ))}
        </View>

        {view === 'day' ? (
          <View className="mt-4 gap-3">
            <View className="flex-row items-center justify-between px-1">
              <Text className="text-sm text-ink-muted">{t.mobileField.today}</Text>
              <Text className="text-base font-bold text-ink">{fmtHM(todayTotal)}</Text>
            </View>
            {todayEntries.length === 0 ? (
              <View className="items-center rounded-3xl bg-white p-8">
                <Text className="text-sm text-ink-muted">{t.mobileField.noPunchesToday}</Text>
              </View>
            ) : (
              todayEntries.map((e: TimeEntryRow) => (
                <View
                  key={e.id}
                  className="flex-row items-center justify-between rounded-3xl bg-white p-4"
                  style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
                >
                  <View>
                    <Text className="text-base font-semibold text-ink">
                      {fmtClock(e.punch_in_at)} → {e.punch_out_at ? fmtClock(e.punch_out_at) : t.mobileField.inProgress}
                    </Text>
                    {(e.breaks?.length ?? 0) > 0 ? (
                      <Text className="text-xs text-ink-muted">
                        {e.breaks.length} {e.breaks.length === 1 ? t.mobileField.breakSingular : t.mobileField.breakPlural}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-base font-bold text-ink">{fmtHM(workedMs(e, now))}</Text>
                </View>
              ))
            )}
          </View>
        ) : (
          <View className="mt-4">
            <View className="flex-row items-center justify-between px-1 pb-3">
              <Text className="text-sm text-ink-muted">{t.mobileField.thisWeek}</Text>
              <Text className="text-base font-bold text-ink">{fmtHM(weekTotal)}</Text>
            </View>
            <View
              className="gap-3 rounded-3xl bg-white p-5"
              style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
            >
              {weekDays.map((d) => (
                <View key={d.label} className="flex-row items-center gap-3">
                  <Text className="w-9 text-xs font-medium text-ink-muted">{d.label}</Text>
                  <View className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <View style={{ width: `${(d.ms / maxDay) * 100}%` }} className="h-full rounded-full bg-ink" />
                  </View>
                  <Text className="w-16 text-right text-xs font-semibold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
                    {d.ms > 0 ? fmtHM(d.ms) : '—'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
