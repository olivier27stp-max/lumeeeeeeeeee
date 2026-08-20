// Horaire — une journée, ses tournées, rien d'autre.
//
// La page ouvre sur la vue GRILLE : les tournées empilées verticalement
// (Tournée 1 et ses contrats, puis Tournée 2, etc. — voir ScheduleGridView).
// Le bouton rond « tournée » de l'en-tête (l'icône lucide <Route> du panneau
// desktop, src/components/schedule/AgendaRoutePanel.tsx) bascule vers la vue
// TRAJET : les mêmes tournées, mais tracées sur la carte. Un second appui
// ramène à la grille.
//
// Modèle de données inchangé : schedule_events (plusieurs visites par job),
// couleurs d'équipe, filtre multi-équipes avec mode « non assignées », tiroir
// des jobs non planifiées. La replanification (+ texto au client) se déclenche
// par un appui long sur un contrat, l'ancienne grille 24 h ayant disparu.

import DateTimePicker from '@react-native-community/datetimepicker';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateMenuFab } from '@/components/CreateMenuFab';
import { IconRoute } from '@/components/IconRoute';
import { GridJob, RouteTeamMember, ScheduleGridView } from '@/components/ScheduleGridView';
import { ScheduleRouteView } from '@/components/ScheduleRouteView';
import { Button } from '@/components/ui/Button';
import { getClient } from '@/lib/api/clients';
import { findOrCreateConversation, logOutboundMessage } from '@/lib/api/messaging';
import { listMembers, listTeamAssignments, listTeams } from '@/lib/api/org';
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
  UnscheduledJobRecord,
} from '@/lib/api/schedule';
import { isSmsUnavailable, sendSmsViaServer } from '@/lib/api/server';
import { newTimeLine, packTemplate, rescheduleNiceMessage, textNumber, unpackTemplate } from '@/lib/contact';
import { formatCurrencyCents, formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';

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

/** On affiche UNE journée, mais on charge la semaine : la rangée des jours
 *  proches montre ainsi une pastille sur les journées qui ont des contrats. */
function buildRange(date: Date) {
  const s = startOfWeekMon(date);
  return { start: s, end: addDays(s, 7) };
}

/** Compare on the event's LOCAL date — start_at is UTC, so a 9 PM local job
 * (= next day 1 AM UTC) must land in the right cell. Same fix as the web. */
function eventsForDay(events: ScheduleEventRecord[], day: Date) {
  const dStr = localDateStr(day);
  return events.filter((e) => localDateStr(new Date(e.start_at)) === dStr);
}

const ns = (v: string | null | undefined) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');

export default function Schedule() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { orgId, role, teamId: myTeamId } = usePermissions();
  // Un tech/rep ne voit que sa propre équipe ; owner/admin voient tout et filtrent.
  const isManager = role === 'owner' || role === 'admin';
  const { session } = useAuth();
  const { current } = useMembership();
  const me = session?.user.id ?? '';

  // Grille par défaut ; la carte est le mode secondaire (bouton rond de l'en-tête).
  const [mapMode, setMapMode] = useState(false);
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [unassignedMode, setUnassignedMode] = useState(false);
  const [teamSheet, setTeamSheet] = useState(false);
  const [miniCalOpen, setMiniCalOpen] = useState(false);
  const [miniCalAnchor, setMiniCalAnchor] = useState(() => new Date());
  const [unschedOpen, setUnschedOpen] = useState(false);
  const [assignJob, setAssignJob] = useState<UnscheduledJobRecord | null>(null);
  const hydratedRef = useRef(false);

  // Reschedule (appui long) → "text the client" confirmation, same flow as before.
  const lang = language; // langue des réglages de l'app, pas celle du téléphone
  const reschedKey = `lume_resched_tmpl_${me}`;
  const [pendingResched, setPendingResched] = useState<{ ev: ScheduleEventRecord; when: Date } | null>(null);
  const [reschedEv, setReschedEv] = useState<{ ev: ScheduleEventRecord; when: string } | null>(null);
  const [reschedPhone, setReschedPhone] = useState<string | null>(null);
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

  // Qui roule sur quelle tournée — affiché dans l'en-tête de chaque tournée.
  const assignmentsQ = useQuery({
    queryKey: ['teamAssignments', orgId],
    queryFn: () => listTeamAssignments(String(orgId)),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const membersQ = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(String(orgId)),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

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
  const range = useMemo(() => buildRange(cursor), [cursor]);

  const evQ = useQuery({
    queryKey: ['calendarEvents', orgId, 'week', localDateStr(range.start), tKey, unassignedMode ? 'u' : 't'],
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

  const tcMap = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((tm) => m.set(tm.id, isHexColor(tm.color_hex) ? (tm.color_hex as string) : FALLBACK_TEAM_COLOR));
    return m;
  }, [teams]);

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
      // Le numéro du client, affiché au-dessus de la boîte de message pour
      // vérifier d'un coup d'œil à qui le texto s'en va.
      setReschedPhone(null);
      if (v.ev.job?.client_id) {
        getClient(v.ev.job.client_id)
          .then((c) => setReschedPhone(c?.phone ?? null))
          .catch(() => {});
      }
      const saved = await AsyncStorage.getItem(reschedKey).catch(() => null);
      const base =
        unpackTemplate(saved, current?.companyName, lang, v.ev.job?.client_name ?? '') ??
        rescheduleNiceMessage(current?.companyName, v.ev.job?.client_name ?? null, lang);
      // La nouvelle heure fait partie du message éditable (plus d'ajout caché à l'envoi).
      setReschedNice(`${base}${newTimeLine(formatDateTime(v.startAt, lang === 'fr' ? 'fr-CA' : 'en-CA'), lang)}`);
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
      // Le message part tel qu'affiché — l'heure est déjà dans le texte.
      const body = reschedNice.trim();
      try {
        await sendSmsViaServer({ phone, text: body, clientId: job.client_id, clientName: job.client_name });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e;
        await textNumber(phone, body);
        if (me) {
          await logOutboundMessage({ orgId, phone, text: body, userId: me, clientId: job.client_id, clientName: job.client_name });
        }
      }
      // Gabarit sauvegardé SANS la ligne d'heure (elle change à chaque déplacement).
      // Le 📅 a été retiré des messages : il reste optionnel ici, sinon les
      // gabarits déjà enregistrés garderaient une heure périmée.
      const tmpl = reschedNice.replace(/\n*(?:📅\s*)?(?:Nouvelle heure|New time)\s*:[^\n]*/g, '').trim();
      AsyncStorage.setItem(reschedKey, packTemplate(tmpl, current?.companyName, job.client_name ?? '')).catch(() => {});
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
  const nav = (dir: -1 | 1) => setCursor((c) => addDays(c, dir));

  const locale = fr ? 'fr-CA' : 'en-CA';
  const navLabel = cursor.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const weekDays = useMemo(() => {
    const ws = startOfWeekMon(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [cursor]);
  const miniDays = useMemo(() => {
    const mStart = startOfMonth(miniCalAnchor);
    const gStart = addDays(mStart, -mStart.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(gStart, i));
  }, [miniCalAnchor]);

  const DAY_ABBR = fr ? ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEK_ABBR = fr ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const dayEvs = useMemo(() => eventsForDay(events, cursor), [events, cursor]);

  // Une seule projection pour les DEUX vues : la grille et la carte montrent
  // exactement les mêmes tournées (mêmes RouteJob que le AgendaRoutePanel web).
  const gridJobs: GridJob[] = useMemo(
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
          endAt: ev.end_at,
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

  // team_id → membres, pour les avatars dans l'en-tête de chaque tournée.
  const membersByTeam = useMemo(() => {
    const byUser = new Map((membersQ.data ?? []).map((m) => [m.user_id, m]));
    const out = new Map<string, RouteTeamMember[]>();
    for (const a of assignmentsQ.data ?? []) {
      const m = byUser.get(a.user_id);
      if (!m) continue; // membre parti de l'org : on ne l'affiche pas
      const list = out.get(a.team_id);
      const entry: RouteTeamMember = {
        userId: m.user_id,
        name: m.full_name || (fr ? 'Membre' : 'Member'),
        avatarUrl: m.avatar_url,
      };
      if (list) list.push(entry);
      else out.set(a.team_id, [entry]);
    }
    // Les primaires d'abord, puis par ordre alphabétique — ordre stable.
    const primary = new Set((assignmentsQ.data ?? []).filter((a) => a.is_primary).map((a) => `${a.team_id}:${a.user_id}`));
    for (const [teamId, list] of out) {
      list.sort((x, y) => {
        const px = primary.has(`${teamId}:${x.userId}`) ? 0 : 1;
        const py = primary.has(`${teamId}:${y.userId}`) ? 0 : 1;
        return px - py || x.name.localeCompare(y.name);
      });
    }
    return out;
  }, [assignmentsQ.data, membersQ.data, fr]);

  // L'événement complet derrière un contrat de la grille — la replanification
  // a besoin du job (client, nom) pour le texto de confirmation.
  const evById = useMemo(() => new Map(dayEvs.map((ev) => [ev.id, ev])), [dayEvs]);

  const startReschedule = (job: GridJob) => {
    const ev = evById.get(job.id);
    if (!ev) return;
    setPendingResched({ ev, when: new Date(ev.start_at) });
  };
  const confirmReschedule = () => {
    if (!pendingResched) return;
    const { ev, when } = pendingResched;
    setPendingResched(null);
    const oldStart = new Date(ev.start_at);
    if (when.getTime() === oldStart.getTime()) return;
    const durMs = new Date(ev.end_at).getTime() - oldStart.getTime();
    const newEnd = new Date(when.getTime() + Math.max(30 * 60000, durMs));
    rescheduleMut.mutate({ ev, startAt: when.toISOString(), endAt: newEnd.toISOString() });
  };

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      {/* Header: title + carte + teams + unscheduled drawer */}
      <View className="flex-row items-center justify-between px-5 pb-2 pt-3">
        <Text className="text-2xl font-bold text-ink">{t.mobileField.scheduleTitle}</Text>
        <View className="flex-row items-center gap-2">
          {/* Vue Trajet sur la carte — même icône que le panneau desktop. */}
          <Pressable
            onPress={() => setMapMode((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ selected: mapMode }}
            accessibilityLabel={fr ? 'Voir les tournées sur la carte' : 'View routes on the map'}
            className={`h-9 w-9 items-center justify-center rounded-full ${mapMode ? 'bg-ink' : 'bg-white'}`}
            style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
          >
            <IconRoute color={mapMode ? '#FFFFFF' : '#171717'} size={17} />
          </Pressable>
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

      {/* Navigator: chevrons + date (tap → sélecteur de date) + Aujourd'hui */}
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Pressable
          onPress={() => nav(-1)}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Journée précédente' : 'Previous day'}
          className="h-9 w-9 items-center justify-center rounded-full bg-white"
        >
          <SymbolView name="chevron.left" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
        </Pressable>
        <Pressable
          onPress={() => {
            setMiniCalAnchor(cursor);
            setMiniCalOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Choisir une date' : 'Pick a date'}
          className="min-w-0 flex-1 flex-row items-center justify-center gap-1.5 px-2"
        >
          <Text numberOfLines={1} className="text-sm font-semibold capitalize text-ink">
            {navLabel}
          </Text>
          <SymbolView name="chevron.down" tintColor="#A3A3A3" size={11} resizeMode="scaleAspectFit" />
        </Pressable>
        <View className="flex-row items-center gap-2">
          {!sameDay(cursor, today) ? (
            <Pressable onPress={() => setCursor(new Date())} className="rounded-full border border-surface-border bg-white px-2.5 py-1.5">
              <Text className="text-xs font-medium text-ink-muted">{fr ? "Aujourd'hui" : 'Today'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => nav(1)}
            accessibilityRole="button"
            accessibilityLabel={fr ? 'Journée suivante' : 'Next day'}
            className="h-9 w-9 items-center justify-center rounded-full bg-white"
          >
            <SymbolView name="chevron.right" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
          </Pressable>
        </View>
      </View>

      {/* Rangée des jours proches — pastille = la journée a des contrats. */}
      <View className="flex-row justify-between px-4 pb-2 pt-1">
        {weekDays.map((d, i) => {
          const isSel = sameDay(d, cursor);
          const isToday = sameDay(d, today);
          const n = eventsForDay(events, d).length;
          return (
            <Pressable
              key={d.toISOString()}
              onPress={() => setCursor(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              className={`flex-1 items-center rounded-2xl py-2 ${isSel ? 'bg-ink' : 'bg-white'}`}
              style={{ marginHorizontal: 2 }}
            >
              <Text className={`text-[11px] font-medium ${isSel ? 'text-white' : 'text-ink-subtle'}`}>{WEEK_ABBR[i]}</Text>
              <Text className={`mt-0.5 text-base font-bold ${isSel ? 'text-white' : 'text-ink'}`}>{d.getDate()}</Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 3 }} className={n > 0 ? (isSel ? 'bg-white' : 'bg-ink') : 'bg-transparent'} />
              {isToday && !isSel ? <View className="absolute bottom-1 h-0.5 w-4 rounded-full bg-ink" /> : null}
            </Pressable>
          );
        })}
      </View>

      {/* GRILLE (défaut) : les tournées empilées — ou TRAJET : les mêmes sur la carte. */}
      {mapMode ? (
        <ScheduleRouteView jobs={gridJobs} onJobOpen={(id) => openJob(id)} />
      ) : (
        <ScheduleGridView
          jobs={gridJobs}
          membersByTeam={membersByTeam}
          onJobOpen={openJob}
          onJobLongPress={startReschedule}
        />
      )}

      {/* SÉLECTEUR DE DATE — navigation par mois + retour à aujourd'hui */}
      <Modal visible={miniCalOpen} transparent animationType="fade" onRequestClose={() => setMiniCalOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setMiniCalOpen(false)}>
          <Pressable className="rounded-t-3xl bg-white px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 24) }} onPress={() => {}}>
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
            {/* Retour à aujourd'hui, sans devoir refeuilleter les mois. */}
            <Pressable
              onPress={() => {
                const now = new Date();
                setCursor(now);
                setMiniCalAnchor(now);
                setMiniCalOpen(false);
              }}
              className="mt-2 items-center rounded-xl border border-surface-border bg-white py-2.5 active:bg-surface-sunken"
            >
              <Text className="text-sm font-semibold text-ink">{fr ? "Aujourd'hui" : 'Today'}</Text>
            </Pressable>
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

      {/* REPLANIFIER — appui long sur un contrat, puis choix de l'heure. */}
      <Modal visible={!!pendingResched} transparent animationType="fade" onRequestClose={() => setPendingResched(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPendingResched(null)}>
          <Pressable className="gap-3 rounded-t-3xl bg-white px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 24) }} onPress={() => {}}>
            <View className="items-center pb-1">
              <View className="h-1 w-10 rounded-full bg-surface-border" />
            </View>
            <View className="gap-0.5">
              <Text className="text-lg font-bold text-ink">{t.mobileField.reschedule}</Text>
              <Text numberOfLines={1} className="text-xs text-ink-muted">
                {pendingResched?.ev.job?.client_name
                  ? `${pendingResched.ev.job.client_name} · ${pendingResched.ev.job?.title ?? ''}`
                  : (pendingResched?.ev.job?.title ?? '')}
              </Text>
            </View>
            {pendingResched ? (
              <View className="items-center">
                <DateTimePicker
                  value={pendingResched.when}
                  mode="datetime"
                  display={Platform.OS === 'ios' ? 'compact' : 'default'}
                  onChange={(_, d) => d && setPendingResched((p) => (p ? { ...p, when: d } : p))}
                />
              </View>
            ) : null}
            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button title={t.mobileSales.cancel} variant="secondary" onPress={() => setPendingResched(null)} />
              </View>
              <View className="flex-1">
                <Button title={t.mobileField.reschedule} onPress={confirmReschedule} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reschedule confirmation — after a move, offer to text the client the new time. */}
      <Modal visible={showResched} transparent animationType="fade" onRequestClose={() => setShowResched(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-end bg-black/40">
          <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} />
          <View className="gap-4 rounded-t-3xl bg-white p-5" style={{ paddingBottom: 28 }}>
            <View className="gap-0.5">
              <Text className="text-lg font-bold text-ink">{t.mobileField.apptMoved}</Text>
              <Text className="text-xs text-ink-muted">
                {reschedEv ? t.mobileField.newTimeLabel.replace('{time}', formatDateTime(reschedEv.when, lang === 'fr' ? 'fr-CA' : 'en-CA')) : ''}
              </Text>
            </View>
            <View className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs uppercase text-ink-muted">{t.mobileField.messageToClient}</Text>
                {/* Le destinataire, en petit — nom · numéro — pour vérifier d'un coup d'œil. */}
                <Text numberOfLines={1} className="max-w-[60%] text-[11px] font-medium text-ink-subtle">
                  {reschedEv?.ev.job?.client_name ?? ''}
                  {reschedPhone ? ` · ${reschedPhone}` : ''}
                </Text>
              </View>
              <TextInput
                value={reschedNice}
                onChangeText={setReschedNice}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholderTextColor="#A3A3A3"
                style={{
                  height: 140,
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
