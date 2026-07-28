// Web-parity Schedule — mirrors the DEPLOYED web page (src/pages/Schedule.tsx on
// main), adapted to mobile: schedule_events model (multiple visits per job),
// team-coloured events, month / week / day views, multi-team filter with
// unassigned mode, quick filters (ending <30d / to invoice / needs attention),
// mini-calendar, unscheduled-jobs drawer with team assignment.
// Mobile adaptations: the web's 7-column Week time grid becomes the web
// Agenda's grouped-by-day list (unreadable otherwise on a phone); the Day view
// keeps mobile's long-press drag-to-reschedule + "text the client" flow, now
// driving the same rpc_reschedule_event as the web.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateMenuFab } from '@/components/CreateMenuFab';
import { RouteJob, ScheduleRouteView } from '@/components/ScheduleRouteView';
import { Button } from '@/components/ui/Button';
import { getClient } from '@/lib/api/clients';
import { findOrCreateConversation, logOutboundMessage } from '@/lib/api/messaging';
import { listTeams } from '@/lib/api/org';
import {
  assignJobToTeam,
  FALLBACK_TEAM_COLOR,
  isHexColor,
  listScheduleEventsRange,
  listUnassignedScheduledEvents,
  listUnassignedUnscheduledJobs,
  listUnscheduledJobs,
  rescheduleEvent,
  ScheduleEventRecord,
  toRgba,
  UnscheduledJobRecord,
} from '@/lib/api/schedule';
import { isSmsUnavailable, sendSmsViaServer } from '@/lib/api/server';
import { deviceLanguage, newTimeLine, packTemplate, rescheduleNiceMessage, textNumber, unpackTemplate } from '@/lib/contact';
import { formatCurrencyCents, formatDateTime, formatTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';

type ViewMode = 'month' | 'week' | 'day';
type QF = 'all' | 'ending_30' | 'requires_invoicing' | 'needs_attention';

const HOUR_H = 64;
const GUTTER = 52; // hour-label column width
const SNAP_MIN = 15;
const GRID_PX = 24 * HOUR_H;

/* ── date helpers (native Date, no date-fns on mobile) ── */
function startOfWeekMon(d: Date): Date {
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
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function localDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Fetch window per view — same as the web's buildRange. */
function buildRange(date: Date, view: ViewMode) {
  if (view === 'month') {
    const s = startOfMonth(date);
    return { start: s, end: addMonths(s, 1) };
  }
  // Day view also fetches the whole week so the week strip shows per-day counts.
  const s = startOfWeekMon(date);
  return { start: s, end: addDays(s, 7) };
}

/** Compare on the event's LOCAL date — start_at is UTC, so a 9 PM local job
 * (= next day 1 AM UTC) must land in the right cell. Same fix as the web. */
function eventsForDay(events: ScheduleEventRecord[], day: Date) {
  const dStr = localDateStr(day);
  return events.filter((e) => localDateStr(new Date(e.start_at)) === dStr);
}

/** Side-by-side columns for events overlapping in time (port of the web's). */
function layoutDayEvents(dayEvs: ScheduleEventRecord[]): Record<string, { col: number; cols: number }> {
  const out: Record<string, { col: number; cols: number }> = {};
  const items = dayEvs
    .map((e) => ({ id: e.id, start: new Date(e.start_at).getTime(), end: new Date(e.end_at).getTime() }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let cluster: typeof items = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const assign: Record<string, number> = {};
    for (const it of cluster) {
      let placed = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (it.start >= colEnds[c]) {
          colEnds[c] = it.end;
          placed = c;
          break;
        }
      }
      if (placed < 0) {
        colEnds.push(it.end);
        placed = colEnds.length - 1;
      }
      assign[it.id] = placed;
    }
    for (const it of cluster) out[it.id] = { col: assign[it.id], cols: colEnds.length };
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

function computeOverlaps(events: ScheduleEventRecord[]) {
  const o: Record<string, number> = {};
  for (let i = 0; i < events.length; i++)
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i],
        b = events[j];
      if ((a.team_id || a.job?.team_id || '-') !== (b.team_id || b.job?.team_id || '-')) continue;
      if (
        new Date(a.start_at).getTime() < new Date(b.end_at).getTime() &&
        new Date(b.start_at).getTime() < new Date(a.end_at).getTime()
      ) {
        o[a.id] = (o[a.id] || 0) + 1;
        o[b.id] = (o[b.id] || 0) + 1;
      }
    }
  return o;
}

/* ── quick filters — same predicates as the web ── */
const ns = (v: string | null | undefined) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
const isEnd30 = (e: ScheduleEventRecord, now: Date) => {
  const s = ns(e.job?.status || e.status);
  if (s === 'completed' || s === 'cancelled' || s === 'canceled') return false;
  const d = new Date(e.end_at);
  return !isNaN(d.getTime()) && d >= now && d <= addDays(now, 30);
};
const reqInv = (e: ScheduleEventRecord) => ns(e.job?.status || e.status) === 'completed';
const needsAtt = (e: ScheduleEventRecord) => {
  const s = ns(e.job?.status || e.status);
  return s === 'blocked' || s === 'late' || s === 'action_required' || (!e.team_id && !e.job?.team_id) || !e.start_at || !e.end_at;
};

const hourLabel = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);

/* ── Draggable day-view event block ── */
function DayEventBlock({
  ev,
  color,
  top,
  height,
  left,
  width,
  onOpen,
  onDrop,
  onDragChange,
}: {
  ev: ScheduleEventRecord;
  color: string;
  top: number;
  height: number;
  left: number;
  width: number;
  onOpen: (ev: ScheduleEventRecord) => void;
  onDrop: (ev: ScheduleEventRecord, newTopPx: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const ty = useSharedValue(0);
  const active = useSharedValue(false);
  const maxTop = Math.max(0, GRID_PX - height);

  const pan = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart(() => {
      active.value = true;
      runOnJS(onDragChange)(true);
    })
    .onUpdate((e) => {
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const newTop = Math.max(0, Math.min(top + e.translationY, maxTop));
      ty.value = 0;
      active.value = false;
      runOnJS(onDrop)(ev, newTop);
    })
    .onFinalize(() => {
      ty.value = 0;
      active.value = false;
      runOnJS(onDragChange)(false);
    });
  const tap = Gesture.Tap().maxDuration(250).onEnd(() => {
    runOnJS(onOpen)(ev);
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

  const e = new Date(ev.end_at);
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top,
            height,
            left,
            width,
            backgroundColor: toRgba(color, 0.15),
            borderLeftWidth: 3,
            borderLeftColor: color,
            borderRadius: 8,
            paddingHorizontal: 6,
            paddingVertical: 4,
            overflow: 'hidden',
          },
          aStyle,
        ]}
      >
        <Text numberOfLines={1} style={{ color }} className="text-[11px] font-semibold">
          {ev.job?.title || 'Job'}
        </Text>
        <Text numberOfLines={1} className="text-[10px] text-ink-muted">
          {formatTime(ev.start_at)}
          {height > 30 ? ` – ${formatTime(e.toISOString())}` : ''}
        </Text>
        {ev.job?.client_name && height > 44 ? (
          <Text numberOfLines={1} className="mt-0.5 text-[10px] text-ink-subtle">
            {ev.job.client_name}
          </Text>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

export default function Schedule() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const qc = useQueryClient();
  const { orgId, role, teamId: myTeamId } = usePermissions();
  // Un tech/rep ne voit que sa propre équipe ; owner/admin voient tout et filtrent.
  const isManager = role === 'owner' || role === 'admin';
  const { session } = useAuth();
  const { current } = useMembership();
  const me = session?.user.id ?? '';

  const [view, setView] = useState<ViewMode>('day');
  // Vue Jour : « Grille » (24 h, défaut) ou « Trajet » (tournées optimisées, secondaire).
  const [dayMode, setDayMode] = useState<'grid' | 'route'>('grid');
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [unassignedMode, setUnassignedMode] = useState(false);
  const [activeFilter, setActiveFilter] = useState<QF>('all');
  const [teamSheet, setTeamSheet] = useState(false);
  const [miniCalOpen, setMiniCalOpen] = useState(false);
  const [miniCalAnchor, setMiniCalAnchor] = useState(() => new Date());
  const [unschedOpen, setUnschedOpen] = useState(false);
  const [assignJob, setAssignJob] = useState<UnscheduledJobRecord | null>(null);
  const [dragging, setDragging] = useState(false);
  const hydratedRef = useRef(false);

  // Reschedule (drag-and-drop) → "text the client" confirmation, same flow as before.
  const lang = deviceLanguage();
  const reschedKey = `lume_resched_tmpl_${me}`;
  const [reschedEv, setReschedEv] = useState<{ ev: ScheduleEventRecord; when: string } | null>(null);
  const [showResched, setShowResched] = useState(false);
  const [reschedNice, setReschedNice] = useState('');
  const [sendingResched, setSendingResched] = useState(false);

  const today = useMemo(() => new Date(), []);
  const openJob = (jobId: string | null) => {
    if (jobId) router.push(`/(app)/jobs/${jobId}` as any);
  };

  /* ── data ── */
  const teamsQ = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(String(orgId)),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const teams = useMemo(() => teamsQ.data ?? [], [teamsQ.data]);

  // First teams load → select all (same hydration as the web).
  useEffect(() => {
    if (!teams.length || hydratedRef.current) return;
    hydratedRef.current = true;
    setSelectedTeamIds(teams.map((tm) => tm.id));
  }, [teams]);

  const allSel = teams.length > 0 && selectedTeamIds.length === teams.length;
  const noneSel = teams.length > 0 && selectedTeamIds.length === 0;
  const effTeams = useMemo(() => {
    // Tech/rep : scope forcé à sa propre équipe, pas de sélecteur.
    if (!isManager && myTeamId) return [myTeamId];
    return allSel || noneSel ? [] : selectedTeamIds;
  }, [isManager, myTeamId, allSel, noneSel, selectedTeamIds]);
  const tKey = !isManager && myTeamId ? `mine:${myTeamId}` : allSel || noneSel ? 'all' : [...selectedTeamIds].sort().join(',');
  const range = useMemo(() => buildRange(cursor, view), [cursor, view]);

  const evQ = useQuery({
    queryKey: ['calendarEvents', orgId, view === 'month' ? 'month' : 'week', localDateStr(range.start), tKey, unassignedMode ? 'u' : 't'],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: () =>
      unassignedMode
        ? listUnassignedScheduledEvents({ orgId: String(orgId), startAt: range.start.toISOString(), endAt: range.end.toISOString() })
        : listScheduleEventsRange({ orgId: String(orgId), startAt: range.start.toISOString(), endAt: range.end.toISOString(), teamIds: effTeams }),
  });
  const unschedQ = useQuery({
    queryKey: ['calendarUnscheduledJobs', orgId, tKey, unassignedMode ? 'u' : 't'],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: () => (unassignedMode ? listUnassignedUnscheduledJobs(String(orgId)) : listUnscheduledJobs(String(orgId), effTeams)),
  });

  const events = useMemo(() => (Array.isArray(evQ.data) ? evQ.data : []), [evQ.data]);
  const unscheduledJobs = Array.isArray(unschedQ.data) ? unschedQ.data : [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['calendarEvents'] });
    qc.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] });
  };

  /* ── quick filters ── */
  const now = useMemo(() => new Date(), [evQ.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const c30 = useMemo(() => events.filter((e) => isEnd30(e, now)).length, [events, now]);
  const cInv = useMemo(() => events.filter(reqInv).length, [events]);
  const cAtt = useMemo(() => events.filter(needsAtt).length, [events]);
  const filtered = useMemo(() => {
    if (activeFilter === 'all') return events;
    if (activeFilter === 'ending_30') return events.filter((e) => isEnd30(e, now));
    if (activeFilter === 'requires_invoicing') return events.filter(reqInv);
    return events.filter(needsAtt);
  }, [events, activeFilter, now]);
  const overlaps = useMemo(() => computeOverlaps(filtered), [filtered]);
  const tcMap = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((tm) => m.set(tm.id, isHexColor(tm.color_hex) ? (tm.color_hex as string) : FALLBACK_TEAM_COLOR));
    return m;
  }, [teams]);
  const colorOf = (ev: ScheduleEventRecord) => tcMap.get(ev.team_id || ev.job?.team_id || '') || FALLBACK_TEAM_COLOR;

  /* ── mutations ── */
  const rescheduleMut = useMutation({
    mutationFn: (v: { ev: ScheduleEventRecord; startAt: string; endAt: string }) =>
      rescheduleEvent({ eventId: v.ev.id, startAt: v.startAt, endAt: v.endAt }),
    onSuccess: async (res, v) => {
      refresh();
      if (res.overlaps > 0) {
        Alert.alert(fr ? 'Conflit' : 'Overlap', fr ? 'Cette visite chevauche une autre visite de la même équipe.' : 'This visit overlaps another visit for the same team.');
      }
      setReschedEv({ ev: v.ev, when: v.startAt });
      const saved = await AsyncStorage.getItem(reschedKey).catch(() => null);
      setReschedNice(
        unpackTemplate(saved, current?.companyName, lang, v.ev.job?.client_name ?? '') ??
          rescheduleNiceMessage(current?.companyName, v.ev.job?.client_name ?? null, lang),
      );
      setShowResched(true);
    },
    onError: (e: Error) => Alert.alert(t.mobileField.reschedule, e.message),
  });

  const assignMut = useMutation({
    mutationFn: (v: { jobId: string; teamId: string }) => assignJobToTeam(v.jobId, v.teamId),
    onSuccess: () => {
      refresh();
      setAssignJob(null);
    },
    onError: (e: Error) => Alert.alert(fr ? 'Assigner à une équipe' : 'Assign to team', e.message),
  });

  // Drop: pixel → snapped new time, keep the visit's duration.
  const onDrop = (ev: ScheduleEventRecord, newTopPx: number) => {
    const minFromMidnight = Math.round(((newTopPx / HOUR_H) * 60) / SNAP_MIN) * SNAP_MIN;
    const oldStart = new Date(ev.start_at);
    const newStart = new Date(oldStart);
    newStart.setHours(Math.floor(minFromMidnight / 60), minFromMidnight % 60, 0, 0);
    if (newStart.getTime() === oldStart.getTime()) return;
    const durMs = new Date(ev.end_at).getTime() - oldStart.getTime();
    const newEnd = new Date(newStart.getTime() + Math.max(30 * 60000, durMs));
    rescheduleMut.mutate({ ev, startAt: newStart.toISOString(), endAt: newEnd.toISOString() });
  };

  // Text the client the new time, then open the thread (unchanged flow).
  const sendReschedule = async () => {
    const job = reschedEv?.ev.job;
    if (!reschedEv || !job) return;
    if (!orgId || !job.client_id) {
      Alert.alert(t.mobileField.confirmation, t.mobileField.apptNoClient);
      return;
    }
    setSendingResched(true);
    try {
      const full = await getClient(job.client_id);
      const phone = full?.phone ?? null;
      if (!phone) {
        Alert.alert(t.mobileField.confirmation, t.mobileField.clientNoPhone);
        setSendingResched(false);
        return;
      }
      const body = `${reschedNice.trim()}${newTimeLine(formatDateTime(reschedEv.when), lang)}`;
      try {
        await sendSmsViaServer({ phone, text: body, clientId: job.client_id, clientName: job.client_name });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e;
        await textNumber(phone, body);
        if (me) {
          await logOutboundMessage({ orgId, phone, text: body, userId: me, clientId: job.client_id, clientName: job.client_name });
        }
      }
      AsyncStorage.setItem(reschedKey, packTemplate(reschedNice.trim(), current?.companyName, job.client_name ?? '')).catch(() => {});
      const cid = await findOrCreateConversation({ orgId, phone, clientId: job.client_id, clientName: job.client_name });
      setShowResched(false);
      router.push(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(job.client_name ?? '')}&clientId=${encodeURIComponent(job.client_id)}` as any,
      );
    } catch (e) {
      Alert.alert(t.mobileField.confirmation, (e as Error).message);
    } finally {
      setSendingResched(false);
    }
  };

  /* ── nav ── */
  const nav = (dir: -1 | 1) =>
    setCursor((c) => (view === 'month' ? addMonths(c, dir) : addDays(c, view === 'day' ? dir : dir * 7)));

  const locale = fr ? 'fr-CA' : 'en-CA';
  const navLabel =
    view === 'month'
      ? cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? (() => {
            const s = startOfWeekMon(cursor);
            const e = addDays(s, 6);
            const so: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
            return `${s.toLocaleDateString(locale, so)} – ${e.toLocaleDateString(locale, { ...so, year: 'numeric' })}`;
          })()
        : cursor.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const weekDays = useMemo(() => {
    const ws = startOfWeekMon(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [cursor]);
  const monthDays = useMemo(() => {
    const mStart = startOfMonth(cursor);
    const gStart = addDays(mStart, -mStart.getDay()); // Sunday-start grid, like the web
    return Array.from({ length: 42 }, (_, i) => addDays(gStart, i));
  }, [cursor]);
  const miniDays = useMemo(() => {
    const mStart = startOfMonth(miniCalAnchor);
    const gStart = addDays(mStart, -mStart.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(gStart, i));
  }, [miniCalAnchor]);

  const DAY_ABBR = fr ? ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEK_ABBR = fr ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const dayEvs = useMemo(() => eventsForDay(filtered, cursor), [filtered, cursor]);
  const dayLayout = useMemo(() => layoutDayEvents(dayEvs), [dayEvs]);

  // Vue Trajet — mêmes données que le web (RouteJob[] du AgendaRoutePanel).
  const routeJobs: RouteJob[] = useMemo(
    () =>
      dayEvs.map((ev) => {
        const tid = ev.team_id || ev.job?.team_id || '';
        const team = tid ? teams.find((tm) => tm.id === tid) : null;
        return {
          id: ev.id,
          jobId: ev.job_id || null,
          title: ev.job?.title || 'Job',
          address: ev.job?.property_address ?? null,
          lat: ev.job?.latitude ?? null,
          lng: ev.job?.longitude ?? null,
          startAt: ev.start_at,
          teamId: tid,
          teamName: team?.name || (fr ? 'Sans équipe' : 'No team'),
          teamColor: (tid ? tcMap.get(tid) : null) || FALLBACK_TEAM_COLOR,
          clientId: ev.job?.client_id ?? null,
          clientName: ev.job?.client_name || '',
          revenueCents: ev.job?.total_cents ?? 0,
          status: ns(ev.job?.status || ev.status || ''),
        };
      }),
    [dayEvs, teams, tcMap, fr],
  );
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const filterChips: { id: QF; label: string; count: number }[] = [
    { id: 'ending_30', label: fr ? 'Se termine < 30 j' : 'Ending in 30d', count: c30 },
    { id: 'requires_invoicing', label: fr ? 'À facturer' : 'To invoice', count: cInv },
    { id: 'needs_attention', label: fr ? 'Attention requise' : 'Needs attention', count: cAtt },
  ];

  const statusBadges = (ev: ScheduleEventRecord) => {
    const st = ns(ev.job?.status || ev.status || '');
    const blocked = st === 'blocked' || st === 'late' || st === 'action_required';
    const noTeam = !ev.team_id && !ev.job?.team_id;
    const ov = overlaps[ev.id] || 0;
    return { blocked, noTeam, ov };
  };

  /* ── week (agenda-style) grouping ── */
  const weekGroups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    const m = new Map<string, ScheduleEventRecord[]>();
    sorted.forEach((ev) => {
      const k = localDateStr(new Date(ev.start_at));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(ev);
    });
    return m;
  }, [filtered]);

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      {/* Header: title + teams + unscheduled drawer */}
      <View className="flex-row items-center justify-between px-5 pb-2 pt-3">
        <Text className="text-2xl font-bold text-ink">{t.mobileField.scheduleTitle}</Text>
        <View className="flex-row items-center gap-2">
          {isManager ? (
            <Pressable
              onPress={() => setTeamSheet(true)}
              className={`flex-row items-center gap-1.5 rounded-full px-3.5 py-2 ${unassignedMode || effTeams.length > 0 ? 'bg-ink' : 'bg-white'}`}
              style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
            >
              <SymbolView
                name="person.2.fill"
                tintColor={unassignedMode || effTeams.length > 0 ? '#FFFFFF' : '#171717'}
                size={14}
                resizeMode="scaleAspectFit"
              />
              <Text className={`text-sm font-medium ${unassignedMode || effTeams.length > 0 ? 'text-white' : 'text-ink'}`}>
                {unassignedMode ? (fr ? 'Non assignées' : 'Unassigned') : fr ? 'Équipes' : 'Teams'}
                {!unassignedMode && effTeams.length > 0 ? ` · ${effTeams.length}` : ''}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setUnschedOpen(true)}
            className="relative h-9 w-9 items-center justify-center rounded-full bg-white"
            style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
          >
            <SymbolView name="tray.full" tintColor="#171717" size={15} resizeMode="scaleAspectFit" />
            {unscheduledJobs.length > 0 ? (
              <View className="absolute -right-1 -top-1 h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1">
                <Text className="text-[9px] font-bold text-white">{unscheduledJobs.length}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {/* Mois / Semaine / Jour */}
      <View className="mx-5 mb-2 flex-row rounded-2xl bg-surface-sunken p-1">
        {(['month', 'week', 'day'] as ViewMode[]).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} className={`flex-1 items-center rounded-xl py-2 ${view === v ? 'bg-white' : ''}`}>
            <Text className={`text-sm font-semibold ${view === v ? 'text-ink' : 'text-ink-muted'}`}>
              {v === 'month' ? t.mobileField.viewMonth : v === 'week' ? (fr ? 'Semaine' : 'Week') : t.mobileField.viewDay}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Navigator: chevrons + label (tap → mini-cal) + Today */}
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Pressable onPress={() => nav(-1)} className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <SymbolView name="chevron.left" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
        </Pressable>
        <Pressable
          onPress={() => {
            setMiniCalAnchor(cursor);
            setMiniCalOpen(true);
          }}
          className="flex-row items-center gap-1.5"
        >
          <Text className="text-sm font-semibold capitalize text-ink">{navLabel}</Text>
          <SymbolView name="chevron.down" tintColor="#A3A3A3" size={11} resizeMode="scaleAspectFit" />
        </Pressable>
        <View className="flex-row items-center gap-2">
          {!sameDay(cursor, today) ? (
            <Pressable onPress={() => setCursor(new Date())} className="rounded-full border border-surface-border bg-white px-2.5 py-1.5">
              <Text className="text-xs font-medium text-ink-muted">{fr ? "Aujourd'hui" : 'Today'}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => nav(1)} className="h-9 w-9 items-center justify-center rounded-full bg-white">
            <SymbolView name="chevron.right" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
          </Pressable>
        </View>
      </View>

      {/* Quick filters — hauteur fixe + flexShrink:0, sinon le ScrollView du
          contenu (Trajet/Grille) compresse cette rangée à zéro dès qu'il y a
          des jobs dans la journée. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-1"
        style={{ flexGrow: 0, flexShrink: 0, height: 38 }}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center' }}
      >
        {filterChips.map((f) => {
          const on = activeFilter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setActiveFilter(on ? 'all' : f.id)}
              className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${on ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
            >
              <Text className={`text-xs font-medium ${on ? 'text-white' : 'text-ink-muted'}`}>{f.label}</Text>
              <Text className={`text-xs font-bold ${on ? 'text-white' : 'text-ink'}`}>{f.count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Week strip (day view) */}
      {view === 'day' ? (
        <View className="flex-row justify-between px-4 pb-1 pt-1">
          {weekDays.map((d, i) => {
            const isSel = sameDay(d, cursor);
            const isToday = sameDay(d, today);
            const n = eventsForDay(filtered, d).length;
            return (
              <Pressable key={d.toISOString()} onPress={() => setCursor(d)} className={`w-11 items-center rounded-2xl py-2 ${isSel ? 'bg-ink' : 'bg-white'}`}>
                <Text className={`text-[11px] font-medium ${isSel ? 'text-white' : 'text-ink-subtle'}`}>{WEEK_ABBR[i]}</Text>
                <Text className={`mt-0.5 text-base font-bold ${isSel ? 'text-white' : 'text-ink'}`}>{d.getDate()}</Text>
                <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 3 }} className={n > 0 ? (isSel ? 'bg-white' : 'bg-ink') : 'bg-transparent'} />
                {isToday && !isSel ? <View className="absolute bottom-1 h-0.5 w-4 rounded-full bg-ink" /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Day mode toggle: Trajet (web's day routes) / Grille (24h time grid) */}
      {view === 'day' ? (
        <View className="mx-5 mb-1.5 flex-row self-start overflow-hidden rounded-lg border border-surface-border">
          {(['route', 'grid'] as const).map((m) => (
            <Pressable key={m} onPress={() => setDayMode(m)} className={`px-3 py-1.5 ${dayMode === m ? 'bg-ink' : 'bg-white'}`}>
              <Text className={`text-xs font-semibold ${dayMode === m ? 'text-white' : 'text-ink-muted'}`}>
                {m === 'route' ? (fr ? 'Trajet' : 'Route') : fr ? 'Grille' : 'Grid'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* DAY VIEW — Trajet: optimized per-team trips on a map (web parity) */}
      {view === 'day' && dayMode === 'route' ? <ScheduleRouteView jobs={routeJobs} onJobOpen={(id) => openJob(id)} /> : null}

      {/* DAY VIEW — 24h time grid with team-coloured, draggable visit blocks */}
      {view === 'day' && dayMode === 'grid' ? (
        <ScrollView
          className="flex-1"
          scrollEnabled={!dragging}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentOffset={{ x: 0, y: 7 * HOUR_H }}
          contentContainerStyle={{ paddingBottom: 110 }}
        >
          <View style={{ height: GRID_PX + 16, marginTop: 4 }}>
            {hours.map((h) => (
              <View key={h} style={{ position: 'absolute', top: h * HOUR_H, left: 0, right: 0 }}>
                <View className="flex-row items-start">
                  <Text style={{ width: GUTTER }} className="pr-2 text-right text-xs text-ink-subtle">
                    {hourLabel(h)}
                  </Text>
                  <View className="flex-1 border-t border-surface-border" style={{ marginTop: 7 }} />
                </View>
              </View>
            ))}
            {dayEvs.map((ev) => {
              const s = new Date(ev.start_at);
              const e = new Date(ev.end_at);
              const startMin = s.getHours() * 60 + s.getMinutes();
              const durMin = Math.max(15, (e.getTime() - s.getTime()) / 60000);
              const { col, cols } = dayLayout[ev.id] || { col: 0, cols: 1 };
              const avail = screenW - GUTTER - 14;
              const w = (avail - (cols - 1) * 2) / cols;
              return (
                <DayEventBlock
                  key={ev.id}
                  ev={ev}
                  color={colorOf(ev)}
                  top={(startMin / 60) * HOUR_H}
                  height={Math.max(34, (durMin / 60) * HOUR_H)}
                  left={GUTTER + 4 + col * (w + 2)}
                  width={w}
                  onOpen={(x) => openJob(x.job_id)}
                  onDrop={onDrop}
                  onDragChange={setDragging}
                />
              );
            })}
          </View>
        </ScrollView>
      ) : null}

      {/* WEEK VIEW — the web Agenda's grouped-by-day cards, scoped to the week */}
      {view === 'week' ? (
        <ScrollView className="flex-1" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 110 }}>
          {weekGroups.size === 0 ? (
            <View className="items-center py-24">
              <SymbolView name="calendar" tintColor="#D4D4D4" size={40} resizeMode="scaleAspectFit" />
              <Text className="mt-3 text-sm font-medium text-ink-muted">
                {fr ? 'Aucun événement planifié cette période' : 'No scheduled events this period'}
              </Text>
            </View>
          ) : (
            Array.from(weekGroups.entries()).map(([dk, list]) => {
              const d = new Date(`${dk}T12:00:00`);
              const isToday = sameDay(d, today);
              return (
                <View key={dk} className="mb-2">
                  <View className="flex-row items-center gap-3 px-5 pb-2 pt-4">
                    <Text className={`text-[11px] font-bold uppercase tracking-widest ${isToday ? 'text-ink' : 'text-ink-subtle'}`}>
                      {d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).toUpperCase()},{' '}
                      {d.toLocaleDateString(locale, { weekday: 'long' }).toUpperCase()}
                    </Text>
                    <View className="h-px flex-1 bg-surface-border" />
                    {isToday ? (
                      <View className="rounded-md bg-ink px-2 py-0.5">
                        <Text className="text-[9px] font-bold uppercase tracking-wider text-white">{fr ? "Aujourd'hui" : 'Today'}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View className="gap-2 px-5">
                    {list.map((ev) => {
                      const c = colorOf(ev);
                      const team = teams.find((tm) => tm.id === (ev.team_id || ev.job?.team_id));
                      const { blocked, noTeam, ov } = statusBadges(ev);
                      return (
                        <Pressable
                          key={ev.id}
                          onPress={() => openJob(ev.job_id)}
                          className="flex-row overflow-hidden rounded-xl"
                          style={{ backgroundColor: toRgba(c, 0.08), minHeight: 68 }}
                        >
                          <View style={{ width: 6, backgroundColor: c }} />
                          <View className="min-w-0 flex-1 flex-row items-start gap-3 px-4 py-3">
                            <View className="min-w-0 flex-1">
                              <Text numberOfLines={1} style={{ color: c }} className="text-sm font-bold">
                                {ev.job?.title || 'Job'}
                              </Text>
                              <Text className="mt-1 text-xs font-medium text-ink-muted">
                                {formatTime(ev.start_at)} – {formatTime(ev.end_at)}
                                {ev.job?.client_name ? `  ·  ${ev.job.client_name}` : ''}
                              </Text>
                              {ev.job?.property_address ? (
                                <Text numberOfLines={1} className="mt-0.5 text-xs text-ink-subtle">
                                  {ev.job.property_address}
                                </Text>
                              ) : null}
                            </View>
                            <View className="items-end gap-1.5 pt-0.5">
                              {team ? (
                                <View className="flex-row items-center gap-1.5 rounded-md px-2 py-0.5" style={{ backgroundColor: toRgba(c, 0.12) }}>
                                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
                                  <Text style={{ color: c }} className="text-[10px] font-semibold">
                                    {team.name}
                                  </Text>
                                </View>
                              ) : null}
                              {ev.job?.total_cents ? (
                                <Text className="text-xs font-bold text-ink">{formatCurrencyCents(ev.job.total_cents)}</Text>
                              ) : null}
                              {ov > 0 ? (
                                <View className="rounded-md bg-amber-50 px-1.5 py-0.5" style={{ backgroundColor: '#FFFBEB' }}>
                                  <Text className="text-[10px] font-semibold" style={{ color: '#B45309' }}>
                                    {fr ? 'Conflit' : 'Overlap'}
                                  </Text>
                                </View>
                              ) : null}
                              {noTeam ? (
                                <View className="rounded-md px-1.5 py-0.5" style={{ backgroundColor: '#FFF7ED' }}>
                                  <Text className="text-[10px] font-semibold" style={{ color: '#EA580C' }}>
                                    {fr ? 'Non assignée' : 'Unassigned'}
                                  </Text>
                                </View>
                              ) : null}
                              {blocked ? (
                                <View className="rounded-md px-1.5 py-0.5" style={{ backgroundColor: '#FEF2F2' }}>
                                  <Text className="text-[10px] font-semibold" style={{ color: '#DC2626' }}>
                                    {fr ? 'Attention' : 'Attention'}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : null}

      {/* MONTH VIEW — web-parity grid with coloured event chips */}
      {view === 'month' ? (
        <ScrollView className="flex-1" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 110 }}>
          <View className="flex-row pb-1">
            {DAY_ABBR.map((d) => (
              <Text key={d} className="flex-1 text-center text-[10px] font-semibold uppercase text-ink-subtle">
                {d}
              </Text>
            ))}
          </View>
          <View className="flex-row flex-wrap overflow-hidden rounded-xl border border-surface-border bg-white">
            {monthDays.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = sameDay(d, today);
              const list = eventsForDay(filtered, d);
              return (
                <Pressable
                  key={d.toISOString()}
                  onPress={() => {
                    setCursor(d);
                    setView('day');
                  }}
                  style={{ width: `${100 / 7}%`, minHeight: 86 }}
                  className={`border-b border-r border-surface-border p-1 ${i % 7 === 6 ? 'border-r-0' : ''} ${!inMonth ? 'bg-surface-alt' : ''}`}
                >
                  <View className={`h-6 w-6 items-center justify-center rounded-full ${isToday ? 'bg-ink' : ''}`}>
                    <Text className={`text-xs ${isToday ? 'font-bold text-white' : inMonth ? 'font-medium text-ink' : 'text-ink-subtle/50'}`}>
                      {d.getDate()}
                    </Text>
                  </View>
                  <View className="mt-0.5 gap-0.5">
                    {list.slice(0, 2).map((ev) => {
                      const c = colorOf(ev);
                      return (
                        <View key={ev.id} className="rounded px-1 py-0.5" style={{ backgroundColor: toRgba(c, 0.15) }}>
                          <Text numberOfLines={1} style={{ color: c, fontSize: 8.5 }} className="font-medium">
                            {ev.job?.title || 'Job'}
                          </Text>
                        </View>
                      );
                    })}
                    {list.length > 2 ? (
                      <Text className="px-1 text-[9px] font-semibold text-ink-muted">+ {list.length - 2} {fr ? 'de plus' : 'more'}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : null}

      {/* MINI-CAL sheet */}
      <Modal visible={miniCalOpen} transparent animationType="fade" onRequestClose={() => setMiniCalOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setMiniCalOpen(false)}>
          <Pressable className="rounded-t-3xl bg-white px-5 pb-8 pt-3" onPress={() => {}}>
            <View className="items-center pb-2">
              <View className="h-1 w-10 rounded-full bg-surface-border" />
            </View>
            <View className="mb-1.5 flex-row items-center justify-between px-1">
              <Text className="text-base font-semibold capitalize text-ink">
                {miniCalAnchor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
              </Text>
              <View className="flex-row gap-2">
                <Pressable onPress={() => setMiniCalAnchor((a) => addMonths(a, -1))} className="h-8 w-8 items-center justify-center rounded-full bg-surface-sunken">
                  <SymbolView name="chevron.left" tintColor="#525252" size={13} resizeMode="scaleAspectFit" />
                </Pressable>
                <Pressable onPress={() => setMiniCalAnchor((a) => addMonths(a, 1))} className="h-8 w-8 items-center justify-center rounded-full bg-surface-sunken">
                  <SymbolView name="chevron.right" tintColor="#525252" size={13} resizeMode="scaleAspectFit" />
                </Pressable>
              </View>
            </View>
            <View className="flex-row">
              {DAY_ABBR.map((d) => (
                <Text key={d} className="flex-1 py-1 text-center text-[10px] font-semibold uppercase text-ink-subtle">
                  {d.slice(0, 2)}
                </Text>
              ))}
            </View>
            <View className="flex-row flex-wrap">
              {miniDays.map((day) => {
                const isToday = sameDay(day, today);
                const cur = day.getMonth() === miniCalAnchor.getMonth();
                const sel = sameDay(day, cursor);
                return (
                  <Pressable
                    key={day.toISOString()}
                    onPress={() => {
                      setCursor(day);
                      setMiniCalOpen(false);
                    }}
                    style={{ width: `${100 / 7}%` }}
                    className="items-center py-1"
                  >
                    <View className={`h-8 w-8 items-center justify-center rounded-full ${sel ? 'bg-ink' : ''}`}>
                      <Text
                        className={`text-sm ${
                          sel ? 'font-semibold text-white' : isToday ? 'font-bold text-ink' : cur ? 'text-ink' : 'text-ink-subtle/50'
                        }`}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* TEAMS sheet — multi-select + unassigned mode (web parity) */}
      <Modal visible={teamSheet} transparent animationType="fade" onRequestClose={() => setTeamSheet(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setTeamSheet(false)}>
          <Pressable className="rounded-t-3xl bg-white pb-8 pt-3" onPress={() => {}}>
            <View className="items-center pb-2">
              <View className="h-1 w-10 rounded-full bg-surface-border" />
            </View>
            <View className="flex-row items-center justify-between px-5 pb-2">
              <Text className="text-lg font-bold text-ink">{fr ? 'Équipes' : 'Teams'}</Text>
              <Pressable onPress={() => setSelectedTeamIds([])} hitSlop={8}>
                <Text className="text-sm font-medium text-ink-subtle">{fr ? 'Effacer' : 'Clear'}</Text>
              </Pressable>
            </View>

            {/* All teams */}
            <Pressable
              onPress={() => (allSel ? setSelectedTeamIds([]) : setSelectedTeamIds(teams.map((tm) => tm.id)))}
              className="flex-row items-center justify-between px-5 py-3 active:bg-surface-sunken"
            >
              <Text className="text-base font-semibold text-ink">{t.mobileField.allTeams}</Text>
              {allSel ? <SymbolView name="checkmark" tintColor="#171717" size={15} resizeMode="scaleAspectFit" /> : null}
            </Pressable>

            {/* Unassigned mode */}
            <Pressable
              onPress={() => {
                setUnassignedMode((u) => !u);
                setTeamSheet(false);
              }}
              className="flex-row items-center justify-between px-5 py-3 active:bg-surface-sunken"
            >
              <Text className={`text-base ${unassignedMode ? 'font-semibold' : ''} text-ink`}>{fr ? 'Non assignées seulement' : 'Unassigned only'}</Text>
              {unassignedMode ? <SymbolView name="checkmark" tintColor="#171717" size={15} resizeMode="scaleAspectFit" /> : null}
            </Pressable>

            <View className="mx-5 my-1 h-px bg-surface-border" />

            {teams.map((tm) => {
              const c = isHexColor(tm.color_hex) ? (tm.color_hex as string) : FALLBACK_TEAM_COLOR;
              const on = selectedTeamIds.includes(tm.id);
              return (
                <Pressable
                  key={tm.id}
                  onPress={() =>
                    setSelectedTeamIds((cur) => (cur.includes(tm.id) ? cur.filter((x) => x !== tm.id) : [...cur, tm.id]))
                  }
                  className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-sunken"
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} />
                  <Text className={`flex-1 text-base ${on ? 'font-semibold' : ''} text-ink`}>{tm.name}</Text>
                  {on ? <SymbolView name="checkmark" tintColor="#171717" size={15} resizeMode="scaleAspectFit" /> : null}
                </Pressable>
              );
            })}
            {teams.length === 0 ? (
              <Text className="px-5 py-4 text-center text-sm text-ink-subtle">{fr ? 'Aucune équipe' : 'No teams'}</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* UNSCHEDULED JOBS sheet — the web's right drawer */}
      <Modal visible={unschedOpen} transparent animationType="slide" onRequestClose={() => setUnschedOpen(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <Pressable className="flex-1" onPress={() => setUnschedOpen(false)} />
          <View className="rounded-t-3xl bg-white pt-3" style={{ maxHeight: '75%', paddingBottom: Math.max(insets.bottom, 16) }}>
            <View className="items-center pb-2">
              <View className="h-1 w-10 rounded-full bg-surface-border" />
            </View>
            <View className="flex-row items-center justify-between px-5 pb-3">
              <Text className="text-lg font-bold text-ink">{fr ? 'Jobs non planifiées' : 'Unscheduled jobs'}</Text>
              <View className="rounded-md bg-surface-sunken px-2 py-0.5">
                <Text className="text-xs font-bold text-ink-muted">{unscheduledJobs.length}</Text>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
              {unscheduledJobs.length === 0 ? (
                <Text className="py-8 text-center text-sm text-ink-subtle">
                  {fr ? 'Aucune job non planifiée' : 'No unscheduled jobs'}
                </Text>
              ) : (
                unscheduledJobs.map((job) => {
                  const c = job.team_id ? tcMap.get(job.team_id) || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;
                  return (
                    <Pressable
                      key={job.id}
                      onPress={() => {
                        setUnschedOpen(false);
                        openJob(job.id);
                      }}
                      className="rounded-xl border border-surface-border bg-white p-3"
                    >
                      <View className="flex-row items-center gap-1.5">
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} />
                        <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-ink">
                          {job.title}
                        </Text>
                      </View>
                      {job.client_name ? (
                        <Text numberOfLines={1} className="mt-0.5 text-xs text-ink-muted">
                          {job.client_name}
                        </Text>
                      ) : null}
                      {job.property_address ? (
                        <Text numberOfLines={1} className="mt-0.5 text-xs text-ink-subtle">
                          {job.property_address}
                        </Text>
                      ) : null}
                      <View className="mt-1.5 flex-row items-center justify-between">
                        {job.total_cents ? (
                          <Text className="text-xs font-semibold text-ink">{formatCurrencyCents(job.total_cents)}</Text>
                        ) : (
                          <View />
                        )}
                        {!job.team_id ? (
                          <Pressable
                            onPress={() => setAssignJob(job)}
                            className="rounded-md bg-surface-sunken px-2 py-1"
                            hitSlop={4}
                          >
                            <Text className="text-[10px] font-semibold text-ink">{fr ? 'Assigner à une équipe' : 'Assign to team'}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            {/* Inline team picker for the "assign" action */}
            {assignJob ? (
              <View className="border-t border-surface-border px-5 pb-2 pt-3">
                <Text className="pb-2 text-sm font-semibold text-ink">
                  {(fr ? 'Assigner « {job} »' : 'Assign “{job}”').replace('{job}', assignJob.title)}
                </Text>
                {teams.map((tm) => {
                  const c = isHexColor(tm.color_hex) ? (tm.color_hex as string) : FALLBACK_TEAM_COLOR;
                  return (
                    <Pressable
                      key={tm.id}
                      disabled={assignMut.isPending}
                      onPress={() => assignMut.mutate({ jobId: assignJob.id, teamId: tm.id })}
                      className="flex-row items-center gap-3 rounded-xl px-2 py-2.5 active:bg-surface-sunken"
                    >
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} />
                      <Text className="text-base text-ink">{tm.name}</Text>
                    </Pressable>
                  );
                })}
                <Pressable onPress={() => setAssignJob(null)} className="items-center py-2">
                  <Text className="text-sm text-ink-subtle">{t.mobileSales.cancel}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Reschedule confirmation — after a drag, offer to text the client the new time. */}
      <Modal visible={showResched} transparent animationType="fade" onRequestClose={() => setShowResched(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-end bg-black/40">
          <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} />
          <View className="gap-4 rounded-t-3xl bg-white p-5" style={{ paddingBottom: 28 }}>
            <View className="gap-0.5">
              <Text className="text-lg font-bold text-ink">{t.mobileField.apptMoved}</Text>
              <Text className="text-xs text-ink-muted">
                {reschedEv ? t.mobileField.newTimeLabel.replace('{time}', formatDateTime(reschedEv.when)) : ''}
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
