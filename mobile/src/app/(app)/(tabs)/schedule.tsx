import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleButton } from '@/components/CircleButton';
import { CreateMenuFab } from '@/components/CreateMenuFab';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { listJobsInRange, updateJob } from '@/lib/api/jobs';
import { getClient } from '@/lib/api/clients';
import { findOrCreateConversation, logOutboundMessage } from '@/lib/api/messaging';
import { sendSmsViaServer, isSmsUnavailable } from '@/lib/api/server';
import { listTeams, getMember } from '@/lib/api/org';
import { deviceLanguage, newTimeLine, openDirections, packTemplate, rescheduleNiceMessage, textNumber, unpackTemplate } from '@/lib/contact';
import { formatTime, formatDateTime } from '@/lib/format';
import { statusStyle } from '@/lib/statusColors';
import { Job } from '@/types/db';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';

type ViewMode = 'list' | 'day' | 'month';

const DAY_ABBR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Day timeline bounds.
const DAY_START = 7; // 7 AM
const DAY_END = 20; // 8 PM
const HOUR_H = 64;
const GUTTER = 56; // hour-label column width
const SNAP_MIN = 15; // drag-and-drop snaps to 15-minute increments
const GRID_PX = (DAY_END - DAY_START) * HOUR_H;

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
const DONE = new Set(['completed', 'completed_paid', 'paid']);

/** A job block on the day timeline: tap opens it, long-press + drag reschedules. */
function DayJobBlock({
  job,
  top,
  height,
  bg,
  fg,
  done,
  onOpen,
  onDrop,
  onDragChange,
}: {
  job: Job;
  top: number;
  height: number;
  bg: string;
  fg: string;
  done: boolean;
  onOpen: (j: Job) => void;
  onDrop: (j: Job, newTopPx: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const ty = useSharedValue(0);
  const active = useSharedValue(false);
  const maxTop = Math.max(0, GRID_PX - height);

  const pan = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart(() => {
      active.value = true;
      // Freeze the day's ScrollView so it can't steal the vertical drag
      // (otherwise dragging toward the bottom cancels the gesture and the
      // drop — and the client text — never fires).
      runOnJS(onDragChange)(true);
    })
    .onUpdate((e) => {
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const newTop = Math.max(0, Math.min(top + e.translationY, maxTop));
      ty.value = 0;
      active.value = false;
      runOnJS(onDrop)(job, newTop);
    })
    .onFinalize(() => {
      ty.value = 0;
      active.value = false;
      runOnJS(onDragChange)(false);
    });
  const tap = Gesture.Tap().maxDuration(250).onEnd(() => {
    runOnJS(onOpen)(job);
  });
  const gesture = Gesture.Exclusive(pan, tap);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: active.value ? 1.03 : 1 }],
    zIndex: active.value ? 99 : 1,
    shadowColor: '#000',
    shadowOpacity: active.value ? 0.25 : 0,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          { position: 'absolute', top, height, left: GUTTER + 4, right: 10, backgroundColor: bg, borderRadius: 12, padding: 10 },
          aStyle,
        ]}
      >
        <View className="flex-row items-start gap-1.5">
          {done ? <SymbolView name="checkmark.circle.fill" tintColor="#94A3B8" size={15} resizeMode="scaleAspectFit" /> : null}
          <Text numberOfLines={2} style={{ color: fg, textDecorationLine: done ? 'line-through' : 'none' }} className="flex-1 text-sm font-bold">
            {job.title}
            {job.client_name ? ` · ${job.client_name}` : ''}
          </Text>
        </View>
        {height > 48 && job.property_address ? (
          <Text numberOfLines={1} style={{ color: done ? '#A8B0BA' : 'rgba(255,255,255,0.85)' }} className="mt-0.5 text-xs">
            {job.property_address}
          </Text>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

export default function Schedule() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { orgId, teamId, scope, permissions, role } = usePermissions();
  const { session } = useAuth();
  const { current } = useMembership();
  const me = session?.user.id ?? '';
  const access = { teamId, scope, permissions, role };
  const isManager = role === 'owner' || role === 'admin';

  const [view, setView] = useState<ViewMode>('day');
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Reschedule (drag-and-drop) confirmation popup.
  const lang = deviceLanguage();
  const reschedKey = `lume_resched_tmpl_${me}`;
  const [reschedJob, setReschedJob] = useState<{ job: Job; when: string } | null>(null);
  const [showResched, setShowResched] = useState(false);
  const [reschedNice, setReschedNice] = useState('');
  const [sendingResched, setSendingResched] = useState(false);

  const openJob = (j: Job) => router.push(`/(app)/jobs/${j.id}` as any);
  const today = useMemo(() => new Date(), []);

  // Persist the new time after a drag, then offer to text the client.
  const rescheduleMut = useMutation({
    mutationFn: (v: { job: Job; scheduledAt: string; endAt: string }) =>
      updateJob(v.job.id, { scheduled_at: v.scheduledAt, end_at: v.endAt }),
    onSuccess: async (_d, v) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      setReschedJob({ job: v.job, when: v.scheduledAt });
      const saved = await AsyncStorage.getItem(reschedKey).catch(() => null);
      setReschedNice(
        unpackTemplate(saved, current?.companyName, lang) ??
          rescheduleNiceMessage(current?.companyName, v.job.client_name, lang),
      );
      setShowResched(true);
    },
    onError: (e: Error) => Alert.alert(t.mobileField.reschedule, e.message),
  });

  // Drop handler: pixel position → snapped new time (keeps the job's duration).
  const onDrop = (job: Job, newTopPx: number) => {
    if (!job.scheduled_at) return;
    const minFromStart = Math.round(((newTopPx / HOUR_H) * 60) / SNAP_MIN) * SNAP_MIN;
    const absMin = DAY_START * 60 + minFromStart;
    const oldStart = new Date(job.scheduled_at);
    const newStart = new Date(oldStart);
    newStart.setHours(Math.floor(absMin / 60), absMin % 60, 0, 0);
    if (newStart.getTime() === oldStart.getTime()) return; // no real move
    const durMs = job.end_at ? new Date(job.end_at).getTime() - oldStart.getTime() : 90 * 60000;
    const newEnd = new Date(newStart.getTime() + Math.max(30 * 60000, durMs));
    rescheduleMut.mutate({ job, scheduledAt: newStart.toISOString(), endAt: newEnd.toISOString() });
  };

  // Text the client the new time via Twilio, then open the thread.
  const sendReschedule = async () => {
    const j = reschedJob?.job;
    if (!reschedJob || !j) return;
    if (!orgId || !j.client_id) {
      Alert.alert(t.mobileField.confirmation, t.mobileField.apptNoClient);
      return;
    }
    setSendingResched(true);
    try {
      const full = await getClient(j.client_id);
      const phone = full?.phone ?? null;
      if (!phone) {
        Alert.alert(t.mobileField.confirmation, t.mobileField.clientNoPhone);
        setSendingResched(false);
        return;
      }
      const body = `${reschedNice.trim()}${newTimeLine(formatDateTime(reschedJob.when), lang)}`;
      // Preferred path: real SMS from the org's Twilio number via the server.
      // If the server can't send (number not provisioned, unreachable, token…),
      // fall back to the device's native composer and log it ourselves — exactly
      // like the conversation screen — so the message always goes out. Only a
      // real opt-out (a legal block) is surfaced instead of falling back.
      try {
        await sendSmsViaServer({ phone, text: body, clientId: j.client_id, clientName: j.client_name });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e;
        await textNumber(phone, body);
        if (me) {
          await logOutboundMessage({
            orgId,
            phone,
            text: body,
            userId: me,
            clientId: j.client_id,
            clientName: j.client_name,
          });
        }
      }
      AsyncStorage.setItem(reschedKey, packTemplate(reschedNice.trim(), current?.companyName)).catch(() => {});
      const cid = await findOrCreateConversation({ orgId, phone, clientId: j.client_id, clientName: j.client_name });
      setShowResched(false);
      router.push(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(j.client_name ?? '')}&clientId=${encodeURIComponent(j.client_id)}` as any,
      );
    } catch (e) {
      Alert.alert(t.mobileField.confirmation, (e as Error).message);
    } finally {
      setSendingResched(false);
    }
  };

  const range = useMemo(() => {
    if (view === 'month') {
      const gridStart = startOfWeek(startOfMonth(cursor));
      return { start: gridStart, end: addDays(gridStart, 42) };
    }
    const ws = startOfWeek(cursor);
    return { start: ws, end: addDays(ws, 7) };
  }, [view, cursor]);

  const { data: jobs } = useQuery({
    queryKey: ['jobs', 'range', orgId, role, teamId, range.start.toISOString(), range.end.toISOString()],
    queryFn: () => listJobsInRange(range.start.toISOString(), range.end.toISOString(), access),
    enabled: !!orgId,
  });
  const { data: teams } = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(orgId ?? ''),
    enabled: !!orgId && isManager,
  });
  const { data: meMember } = useQuery({
    queryKey: ['member', orgId, me],
    queryFn: () => getMember(me, String(orgId)),
    enabled: !!orgId && !!me,
  });

  const allJobs = jobs ?? [];
  const rangeJobs = isManager && selectedTeam ? allJobs.filter((j) => j.team_id === selectedTeam) : allJobs;

  const teamChips: { id: string | null; name: string }[] = [
    { id: null, name: t.mobileField.allTeams },
    ...(teams ?? []).map((tm) => ({ id: tm.id, name: tm.name })),
  ];

  const jobsOn = (d: Date): Job[] =>
    rangeJobs
      .filter((j) => j.scheduled_at && sameDay(new Date(j.scheduled_at), d))
      .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  const countOn = (d: Date) => jobsOn(d).length;

  const nav = (dir: -1 | 1) => {
    setCursor((c) => {
      if (view === 'month') {
        const x = new Date(c);
        x.setMonth(x.getMonth() + dir);
        return x;
      }
      return addDays(c, view === 'day' ? dir : dir * 7);
    });
  };

  const navLabel =
    view === 'month'
      ? cursor.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })
      : view === 'list'
        ? `Semaine du ${startOfWeek(cursor).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}`
        : cursor.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

  const weekDays = useMemo(() => {
    const ws = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [cursor]);
  const monthDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor));
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);

  const renderJobRow = (j: Job) => (
    <Pressable
      key={j.id}
      onPress={() => openJob(j)}
      className="flex-row items-center gap-3 rounded-3xl bg-white p-4"
      style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
    >
      <Text className="text-sm font-bold text-ink">{formatTime(j.scheduled_at)}</Text>
      <View className="h-10 w-[2px] rounded-full bg-surface-border" />
      <View className="flex-1">
        <Text className="text-base font-bold text-ink" numberOfLines={1}>{j.client_name ?? j.title}</Text>
        <Text className="text-sm text-ink-muted" numberOfLines={1}>{j.title}</Text>
      </View>
      <StatusPill status={j.status} />
      <CircleButton
        icon="location.north.fill"
        size={36}
        onPress={() => openDirections({ latitude: j.latitude, longitude: j.longitude, address: j.property_address ?? j.title })}
      />
    </Pressable>
  );

  const dayJobs = jobsOn(cursor);
  const doneCount = dayJobs.filter((j) => DONE.has(j.status)).length;
  const meName = meMember?.full_name ?? t.mobileField.myJobs;

  // Hour labels for the day timeline.
  const hours = useMemo(() => Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i), []);
  const blockFor = (j: Job) => {
    const start = j.scheduled_at ? new Date(j.scheduled_at) : null;
    if (!start) return null;
    const startMin = start.getHours() * 60 + start.getMinutes() - DAY_START * 60;
    const end = j.end_at ? new Date(j.end_at) : new Date(start.getTime() + 90 * 60000);
    const durMin = Math.max(30, (end.getTime() - start.getTime()) / 60000);
    const top = (startMin / 60) * HOUR_H;
    const height = Math.max(34, (durMin / 60) * HOUR_H);
    return { top: Math.max(0, top), height };
  };

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 pb-2 pt-3">
        <Text className="text-2xl font-bold text-ink">{t.mobileField.scheduleTitle}</Text>
        {isManager && teamChips.length > 1 ? (
          <Pressable
            onPress={() => setFilterOpen(true)}
            className={`flex-row items-center gap-1.5 rounded-full px-3.5 py-2 ${selectedTeam ? 'bg-ink' : 'bg-white'}`}
            style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
          >
            <SymbolView name="line.3.horizontal.decrease.circle" tintColor={selectedTeam ? '#FFFFFF' : '#171717'} size={15} resizeMode="scaleAspectFit" />
            <Text className={`text-sm font-medium ${selectedTeam ? 'text-white' : 'text-ink'}`} numberOfLines={1}>
              {selectedTeam ? teamChips.find((tc) => tc.id === selectedTeam)?.name ?? t.mobileField.filter : t.mobileField.filter}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Liste / Jour / Mois */}
      <View className="mx-5 mb-2 flex-row rounded-2xl bg-surface-sunken p-1">
        {(['list', 'day', 'month'] as ViewMode[]).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} className={`flex-1 items-center rounded-xl py-2 ${view === v ? 'bg-white' : ''}`}>
            <Text className={`text-sm font-semibold ${view === v ? 'text-ink' : 'text-ink-muted'}`}>
              {v === 'list' ? t.mobileField.viewList : v === 'day' ? t.mobileField.viewDay : t.mobileField.viewMonth}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Navigator */}
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Pressable onPress={() => nav(-1)} className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <SymbolView name="chevron.left" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
        </Pressable>
        <Text className="text-sm font-semibold capitalize text-ink">{navLabel}</Text>
        <Pressable onPress={() => nav(1)} className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <SymbolView name="chevron.right" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
        </Pressable>
      </View>

      {/* Week strip (day view) */}
      {view === 'day' ? (
        <View className="flex-row justify-between px-4 pb-1">
          {weekDays.map((d, i) => {
            const isSel = sameDay(d, cursor);
            const isToday = sameDay(d, today);
            const n = countOn(d);
            return (
              <Pressable key={d.toISOString()} onPress={() => setCursor(d)} className={`w-11 items-center rounded-2xl py-2 ${isSel ? 'bg-ink' : 'bg-white'}`}>
                <Text className={`text-[11px] font-medium ${isSel ? 'text-white' : 'text-ink-subtle'}`}>{DAY_ABBR[i]}</Text>
                <Text className={`mt-0.5 text-base font-bold ${isSel ? 'text-white' : 'text-ink'}`}>{d.getDate()}</Text>
                <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 3 }} className={n > 0 ? (isSel ? 'bg-white' : 'bg-ink') : 'bg-transparent'} />
                {isToday && !isSel ? <View className="absolute bottom-1 h-0.5 w-4 rounded-full bg-ink" /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* DAY VIEW — timeline */}
      {view === 'day' ? (
        <>
          <View className="mx-4 mb-1 flex-row items-center justify-between rounded-2xl bg-white px-4 py-2.5" style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
            <Text className="text-base font-bold text-ink" numberOfLines={1}>{meName}</Text>
            <View className="rounded-lg bg-surface-sunken px-2.5 py-1">
              <Text className="text-sm font-semibold text-ink-muted">{doneCount}/{dayJobs.length}</Text>
            </View>
          </View>
          <ScrollView scrollEnabled={!dragging} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 110 }}>
            <View style={{ height: (DAY_END - DAY_START) * HOUR_H + 16, marginTop: 4 }}>
              {/* Hour gridlines + labels */}
              {hours.map((h, i) => (
                <View key={h} style={{ position: 'absolute', top: i * HOUR_H, left: 0, right: 0 }}>
                  <View className="flex-row items-start">
                    <Text style={{ width: GUTTER }} className="pr-2 text-right text-xs text-ink-subtle">
                      {h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`}
                    </Text>
                    <View className="flex-1 border-t border-surface-border" style={{ marginTop: 7 }} />
                  </View>
                </View>
              ))}
              {/* Job blocks — tap to open, long-press + drag to reschedule */}
              {dayJobs.map((j) => {
                const b = blockFor(j);
                if (!b) return null;
                const done = DONE.has(j.status);
                const st = statusStyle(j.status);
                // Done/paid jobs fade to a muted block with a check; pending jobs keep their colour so they pop.
                const bg = done ? '#EDEFF2' : st.solid;
                const fg = done ? '#94A3B8' : '#FFFFFF';
                return (
                  <DayJobBlock
                    key={j.id}
                    job={j}
                    top={b.top}
                    height={b.height}
                    bg={bg}
                    fg={fg}
                    done={done}
                    onOpen={openJob}
                    onDrop={onDrop}
                    onDragChange={setDragging}
                  />
                );
              })}
            </View>
          </ScrollView>
        </>
      ) : null}

      {/* LIST VIEW — week agenda grouped by day */}
      {view === 'list' ? (
        <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110, gap: 16 }}>
          {weekDays.map((d, i) => {
            const list = jobsOn(d);
            const isToday = sameDay(d, today);
            return (
              <View key={d.toISOString()} className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Text className={`text-sm font-bold ${isToday ? 'text-brand' : 'text-ink'}`}>{DAY_ABBR[i]} {d.getDate()}</Text>
                  {list.length > 0 ? <Text className="text-xs text-ink-muted">· {list.length}</Text> : null}
                </View>
                {list.length === 0 ? <Text className="text-xs text-ink-subtle">—</Text> : list.map(renderJobRow)}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* MONTH VIEW — grid */}
      {view === 'month' ? (
        <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}>
          <View className="flex-row pb-1">
            {DAY_ABBR.map((d) => (
              <Text key={d} className="flex-1 text-center text-[10px] font-semibold uppercase text-ink-subtle">{d}</Text>
            ))}
          </View>
          <View className="flex-row flex-wrap">
            {monthDays.map((d) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = sameDay(d, today);
              const n = countOn(d);
              return (
                <Pressable
                  key={d.toISOString()}
                  onPress={() => { setCursor(d); setView('day'); }}
                  style={{ width: `${100 / 7}%` }}
                  className="aspect-square items-center justify-center p-0.5"
                >
                  <View className={`h-9 w-9 items-center justify-center rounded-full ${isToday ? 'bg-ink' : ''}`}>
                    <Text className={`text-sm ${isToday ? 'font-bold text-white' : inMonth ? 'text-ink' : 'text-ink-subtle/40'}`}>{d.getDate()}</Text>
                  </View>
                  {n > 0 ? <View style={{ width: 5, height: 5, borderRadius: 3 }} className={isToday ? 'bg-ink' : 'bg-brand'} /> : <View style={{ height: 5 }} />}
                </Pressable>
              );
            })}
          </View>
          <Text className="mt-3 px-1 text-xs text-ink-subtle">{t.mobileField.tapDayForTimeline}</Text>
        </ScrollView>
      ) : null}

      {/* Team filter sheet */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setFilterOpen(false)}>
          <Pressable className="rounded-t-3xl bg-white pb-8 pt-3" onPress={() => {}}>
            <View className="items-center pb-2"><View className="h-1 w-10 rounded-full bg-surface-border" /></View>
            <Text className="px-5 pb-2 text-lg font-bold text-ink">{t.mobileField.filterByTeam}</Text>
            {teamChips.map((tc) => {
              const sel = selectedTeam === tc.id;
              return (
                <Pressable
                  key={tc.id ?? 'all'}
                  onPress={() => { setSelectedTeam(tc.id); setFilterOpen(false); }}
                  className="flex-row items-center justify-between px-5 py-3.5 active:bg-surface-sunken"
                >
                  <Text className={`text-base ${sel ? 'font-bold text-ink' : 'text-ink'}`}>{tc.name}</Text>
                  {sel ? <SymbolView name="checkmark" tintColor="#171717" size={16} resizeMode="scaleAspectFit" /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reschedule confirmation — after a drag, offer to text the client the new time. */}
      <Modal visible={showResched} transparent animationType="fade" onRequestClose={() => setShowResched(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} />
          <View className="rounded-t-3xl bg-white p-5 gap-4" style={{ paddingBottom: 28 }}>
            <View className="gap-0.5">
              <Text className="text-lg font-bold text-ink">{t.mobileField.apptMoved}</Text>
              <Text className="text-xs text-ink-muted">
                {reschedJob ? t.mobileField.newTimeLabel.replace('{time}', formatDateTime(reschedJob.when)) : ''}
              </Text>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs uppercase text-ink-muted">{t.mobileField.messageToClient}</Text>
              <TextInput
                value={reschedNice}
                onChangeText={setReschedNice}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholderTextColor="#A3A3A3"
                style={{
                  height: 110,
                  borderWidth: 1,
                  borderColor: '#E5E5E5',
                  borderRadius: 12,
                  backgroundColor: '#F5F5F5',
                  paddingHorizontal: 14,
                  paddingTop: 12,
                  paddingBottom: 12,
                  fontSize: 16,
                  lineHeight: 22,
                  color: '#171717',
                }}
              />
              <Text className="text-xs italic text-ink-subtle">{t.mobileField.newTimeAutoAdded}</Text>
            </View>

            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button title={t.mobileField.skip} variant="secondary" onPress={() => setShowResched(false)} disabled={sendingResched} />
              </View>
              <View className="flex-1">
                <Button title={t.mobileField.send} onPress={sendReschedule} loading={sendingResched} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CreateMenuFab />
    </View>
  );
}
