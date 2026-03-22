import React, { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import type { DateSelectArg, EventContentArg } from '@fullcalendar/core';
import {
  addDays,
  addHours,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Plus,
  RefreshCw,
  Users,
  UserPlus,
  UserCheck,
  Clock,
  X as XIcon,
  AlertCircle,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CRMMap } from '../components/map';
import type { MapJobPin } from '../lib/mapApi';
import { CalendarControllerProvider, CalendarUiView, useCalendarController } from '../contexts/CalendarController';
import { useJobModalController } from '../contexts/JobModalController';
import { getCurrentOrgId } from '../lib/orgApi';
import { getJobModalDraftById } from '../lib/jobsApi';
import {
  DEFAULT_TIMEZONE,
  ScheduleEventRecord,
  UnscheduledJobRecord,
  assignJobToTeam,
  invalidateScheduleCache,
  listScheduleEventsRange,
  listUnassignedScheduledEvents,
  listUnassignedUnscheduledJobs,
  listUnscheduledJobs,
  rescheduleEvent,
  scheduleUnscheduledJob,
} from '../lib/scheduleApi';
import { findFreeSlots, type FreeSlot } from '../lib/availabilityApi';
import { listTeams, TeamRecord } from '../lib/teamsApi';
import { supabase } from '../lib/supabase';
import { cn, formatCurrency } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

type FullCalendarView = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

const FALLBACK_TEAM_COLOR = '#111827';

function mapUiViewToCalendarView(view: CalendarUiView): FullCalendarView {
  if (view === 'day') return 'timeGridDay';
  if (view === 'month') return 'dayGridMonth';
  return 'timeGridWeek';
}

function toRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return `rgba(17,24,39,${alpha})`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function buildMiniCalendarDays(anchorDate: Date) {
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days: Date[] = [];
  for (let date = gridStart; date <= gridEnd; date = addDays(date, 1)) {
    days.push(date);
  }

  return days;
}

function buildRange(date: Date, view: CalendarUiView) {
  if (view === 'day') {
    const start = startOfDay(date);
    const end = addDays(start, 1);
    return { start, end };
  }

  if (view === 'month') {
    const start = startOfMonth(date);
    const end = addMonths(start, 1);
    return { start, end };
  }

  if (view === 'map') {
    const start = startOfDay(date);
    const end = addDays(start, 1);
    return { start, end };
  }

  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = addDays(start, 7);
  return { start, end };
}

function buildHeaderLabel(date: Date, view: CalendarUiView) {
  if (view === 'month') return format(date, 'MMMM yyyy');
  if (view === 'day') return format(date, 'EEEE, MMMM d, yyyy');
  if (view === 'map') {
    return `Map - ${format(date, 'EEEE, MMMM d, yyyy')}`;
  }

  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = addDays(start, 6);
  return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
}

function computeOverlaps(events: ScheduleEventRecord[]) {
  const overlaps: Record<string, number> = {};

  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const a = events[i];
      const b = events[j];
      const teamA = a.team_id || a.job?.team_id || 'none';
      const teamB = b.team_id || b.job?.team_id || 'none';
      if (teamA !== teamB) continue;

      const aStart = new Date(a.start_at).getTime();
      const aEnd = new Date(a.end_at).getTime();
      const bStart = new Date(b.start_at).getTime();
      const bEnd = new Date(b.end_at).getTime();

      if (aStart < bEnd && bStart < aEnd) {
        overlaps[a.id] = (overlaps[a.id] || 0) + 1;
        overlaps[b.id] = (overlaps[b.id] || 0) + 1;
      }
    }
  }

  return overlaps;
}

type ScheduleQuickFilter = 'all' | 'ending_30' | 'requires_invoicing' | 'needs_attention';

function normalizeJobStatus(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function isEndingWithin30(event: ScheduleEventRecord, now: Date) {
  const status = normalizeJobStatus(event.job?.status || event.status);
  if (status === 'completed' || status === 'cancelled' || status === 'canceled') return false;
  const endAt = new Date(event.end_at);
  if (Number.isNaN(endAt.getTime())) return false;
  const horizon = addDays(now, 30);
  return endAt >= now && endAt <= horizon;
}

function requiresInvoicing(event: ScheduleEventRecord) {
  const status = normalizeJobStatus(event.job?.status || event.status);
  return status === 'completed';
}

function needsAttention(event: ScheduleEventRecord) {
  const status = normalizeJobStatus(event.job?.status || event.status);
  if (status === 'blocked' || status === 'late' || status === 'action_required') return true;
  if (!event.team_id && !event.job?.team_id) return true;
  if (!event.start_at || !event.end_at) return true;
  return false;
}

function ScheduleContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const calendarRef = useRef<FullCalendar | null>(null);
  const unscheduledRef = useRef<HTMLDivElement | null>(null);
  const initialTeamsHydrated = useRef(false);

  const {
    selectedDate,
    view,
    selectedTeamIds,
    hasTeamsParam,
    setDate,
    setView,
    setSelectedTeamIds,
    toggleTeam,
    goToday,
    goPrev,
    goNext,
  } = useCalendarController();

  const { openJobModal } = useJobModalController();

  const [isOpeningJob, setIsOpeningJob] = useState(false);
  const [unassignedMode, setUnassignedMode] = useState(false);
  const [assignModalJob, setAssignModalJob] = useState<UnscheduledJobRecord | ScheduleEventRecord | null>(null);
  const [activeFilter, setActiveFilter] = useState<ScheduleQuickFilter>('all');
  const [teamPickerDrop, setTeamPickerDrop] = useState<{
    jobId: string;
    startAt: string;
    endAt: string;
    revert: () => void;
    removeEvent: () => void;
  } | null>(null);
  const [teamSlots, setTeamSlots] = useState<Map<string, FreeSlot[]>>(new Map());
  const [loadingSlots, setLoadingSlots] = useState(false);

  const currentDateKey = format(selectedDate, 'yyyy-MM-dd');
  const fullCalendarView = mapUiViewToCalendarView(view);
  const headerLabel = buildHeaderLabel(selectedDate, view);

  const { data: orgId } = useQuery({
    queryKey: ['currentOrgId'],
    queryFn: getCurrentOrgId,
  });

  const teamsQuery = useQuery({
    queryKey: ['teams', orgId || 'none'],
    queryFn: listTeams,
    enabled: !!orgId,
  });

  const teams = teamsQuery.data || [];

  useEffect(() => {
    if (!teams.length) return;
    if (initialTeamsHydrated.current) return;
    initialTeamsHydrated.current = true;

    if (!hasTeamsParam && selectedTeamIds.length === 0) {
      setSelectedTeamIds(teams.map((team) => team.id));
    }
  }, [hasTeamsParam, selectedTeamIds.length, setSelectedTeamIds, teams]);

  const allTeamIds = useMemo(() => teams.map((team) => team.id), [teams]);
  const allTeamsSelected = teams.length > 0 && selectedTeamIds.length === teams.length;
  const noTeamsSelected = teams.length > 0 && selectedTeamIds.length === 0;

  const effectiveTeamIds = useMemo(
    () => (allTeamsSelected ? [] : selectedTeamIds),
    [allTeamsSelected, selectedTeamIds]
  );

  const teamsKey = useMemo(() => {
    if (allTeamsSelected) return 'all';
    if (selectedTeamIds.length === 0) return 'none';
    return [...selectedTeamIds].sort().join(',');
  }, [allTeamsSelected, selectedTeamIds]);

  const range = useMemo(() => buildRange(selectedDate, view), [selectedDate, view]);
  const miniCalendarDays = useMemo(() => buildMiniCalendarDays(selectedDate), [selectedDate]);

  const eventsQuery = useQuery({
    queryKey: ['calendarEvents', orgId || 'none', view, currentDateKey, teamsKey, unassignedMode ? 'unassigned' : 'teams'],
    enabled: !!orgId && (!noTeamsSelected || unassignedMode),
    queryFn: () =>
      unassignedMode
        ? listUnassignedScheduledEvents({
            startAt: range.start.toISOString(),
            endAt: range.end.toISOString(),
          })
        : listScheduleEventsRange({
            startAt: range.start.toISOString(),
            endAt: range.end.toISOString(),
            teamIds: effectiveTeamIds,
            bypassCache: true,
          }),
  });

  const unscheduledQuery = useQuery({
    queryKey: ['calendarUnscheduledJobs', orgId || 'none', teamsKey, unassignedMode ? 'unassigned' : 'teams'],
    enabled: !!orgId,
    queryFn: () =>
      unassignedMode
        ? listUnassignedUnscheduledJobs()
        : listUnscheduledJobs(noTeamsSelected ? [] : effectiveTeamIds),
  });

  const events = eventsQuery.data || [];
  const unscheduledJobs = unscheduledQuery.data || [];

  // Count of all unassigned unscheduled jobs (for badge)
  const unassignedCount = unassignedMode ? unscheduledJobs.length : unscheduledJobs.filter((j) => !j.team_id).length;

  // Assignment mutation
  const assignMutation = useMutation({
    mutationFn: ({ jobId, teamId }: { jobId: string; teamId: string }) => assignJobToTeam(jobId, teamId),
    onSuccess: async () => {
      invalidateScheduleCache();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }),
      ]);
      setAssignModalJob(null);
      toast.success(t.schedule.jobAssigned);
    },
    onError: (error: any) => {
      toast.error(error?.message || t.schedule.couldNotAssign);
    },
  });


  const endingWithin30Count = useMemo(() => {
    const anchor = new Date();
    return events.filter((event) => isEndingWithin30(event, anchor)).length;
  }, [events]);
  const requiresInvoicingCount = useMemo(() => events.filter((event) => requiresInvoicing(event)).length, [events]);
  const needsAttentionCount = useMemo(() => events.filter((event) => needsAttention(event)).length, [events]);
  const filterChips: Array<{ id: ScheduleQuickFilter; label: string; count: number }> = useMemo(
    () => [
      { id: 'all', label: t.schedule.all, count: events.length },
      { id: 'ending_30', label: t.schedule.endingWithin30, count: endingWithin30Count },
      { id: 'requires_invoicing', label: t.schedule.requiresInvoicing, count: requiresInvoicingCount },
      { id: 'needs_attention', label: t.schedule.needsAttention, count: needsAttentionCount },
    ],
    [endingWithin30Count, events.length, needsAttentionCount, requiresInvoicingCount, t]
  );

  const filteredEvents = useMemo(() => {
    const anchor = new Date();
    if (activeFilter === 'all') return events;
    if (activeFilter === 'ending_30') return events.filter((event) => isEndingWithin30(event, anchor));
    if (activeFilter === 'requires_invoicing') return events.filter((event) => requiresInvoicing(event));
    return events.filter((event) => needsAttention(event));
  }, [activeFilter, events]);

  const overlapMap = useMemo(() => computeOverlaps(filteredEvents), [filteredEvents]);

  const teamColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const team of teams) {
      map[team.id] = isHexColor(team.color_hex) ? team.color_hex : FALLBACK_TEAM_COLOR;
    }
    return map;
  }, [teams]);

  const calendarEvents = useMemo(() => {
    return filteredEvents.map((event) => {
      const teamId = event.team_id || event.job?.team_id || null;
      const teamColor = teamId ? teamColorMap[teamId] || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;
      const overlapCount = overlapMap[event.id] || 0;

      // Convert UTC ISO strings to local Date objects so FullCalendar renders them
      // (FullCalendar without moment-timezone plugin can't handle named timezones)
      const startDate = new Date(event.start_at);
      const endDate = new Date(event.end_at);

      return {
        id: event.id,
        title: event.job?.title || t.pipeline.untitledJob,
        start: startDate,
        end: endDate,
        backgroundColor: toRgba(teamColor, 0.16),
        borderColor: teamColor,
        textColor: '#0f172a',
        extendedProps: {
          jobId: event.job_id,
          teamId,
          clientName: event.job?.client_name || null,
          address: event.job?.property_address || null,
          totalCents: event.job?.total_cents || 0,
          overlaps: overlapCount,
        },
      };
    });
  }, [filteredEvents, overlapMap, teamColorMap]);

  const mapMarkers = useMemo<MapJobPin[]>(() => {
    return filteredEvents
      .map((event) => {
        const latitude = event.job?.latitude == null ? null : Number(event.job.latitude);
        const longitude = event.job?.longitude == null ? null : Number(event.job.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

        const teamId = event.team_id || event.job?.team_id || null;
        const teamColor = teamId ? teamColorMap[teamId] || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;

        return {
          id: event.id,
          jobId: event.job_id,
          jobNumber: event.job?.job_number || '',
          latitude: latitude as number,
          longitude: longitude as number,
          title: event.job?.title || t.pipeline.untitledJob,
          clientName: event.job?.client_name || null,
          address: event.job?.property_address || null,
          scheduledAt: event.start_at,
          endAt: event.end_at,
          status: event.job?.status || event.status || 'Scheduled',
          teamColor,
          teamName: null,
          totalCents: event.job?.total_cents || 0,
        } satisfies MapJobPin;
      })
      .filter(Boolean) as MapJobPin[];
  }, [filteredEvents, teamColorMap]);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    if (api.view.type !== fullCalendarView) {
      api.changeView(fullCalendarView);
    }

    const apiDate = api.getDate();
    if (format(apiDate, 'yyyy-MM-dd') !== format(selectedDate, 'yyyy-MM-dd')) {
      api.gotoDate(selectedDate);
    }
  }, [fullCalendarView, selectedDate]);

  useEffect(() => {
    if (!unscheduledRef.current) return;

    const draggable = new Draggable(unscheduledRef.current, {
      itemSelector: '[data-job-id]',
      eventData: (eventEl) => {
        const jobId = eventEl.getAttribute('data-job-id') || '';
        const title = eventEl.getAttribute('data-title') || 'Unscheduled job';
        const teamId = eventEl.getAttribute('data-team-id') || null;

        return {
          title,
          duration: '02:00',
          extendedProps: {
            externalJobId: jobId,
            externalTeamId: teamId,
          },
        };
      },
    });

    return () => draggable.destroy();
  }, [unscheduledJobs]);

  useEffect(() => {
    const channel = supabase
      .channel('calendar-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events' }, () => {
        invalidateScheduleCache();
        void queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        invalidateScheduleCache();
        void queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
        void queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['teams'] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const rescheduleMutation = useMutation({
    mutationFn: rescheduleEvent,
    onSuccess: async () => {
      invalidateScheduleCache();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }),
      ]);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: scheduleUnscheduledJob,
    onSuccess: async () => {
      invalidateScheduleCache();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }),
      ]);
    },
  });

  function refreshCalendarData() {
    invalidateScheduleCache();
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }),
      queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }),
      queryClient.invalidateQueries({ queryKey: ['teams'] }),
    ]);
  }

  function openCreateJobModalWithDefaults(startAt?: Date, endAt?: Date) {
    const baseStart = startAt || new Date(`${currentDateKey}T09:00:00`);
    const baseEnd = endAt || addHours(baseStart, 2);
    const preselectedTeamId = selectedTeamIds.length === 1 ? selectedTeamIds[0] : undefined;

    openJobModal({
      sourceContext: { type: 'jobs' },
      initialValues: {
        team_id: preselectedTeamId,
        scheduled_at: baseStart.toISOString(),
        end_at: baseEnd.toISOString(),
        status: 'Scheduled',
      },
      onCreated: async () => {
        refreshCalendarData();
      },
    });
  }

  async function openExistingJob(jobId: string) {
    setIsOpeningJob(true);
    try {
      const draft = await getJobModalDraftById(jobId);
      if (!draft) {
        toast.error(t.schedule.jobNotFound);
        return;
      }

      openJobModal({
        sourceContext: { type: 'calendar' },
        initialValues: draft,
        onCreated: async () => {
          refreshCalendarData();
        },
      });
    } catch (error: any) {
      toast.error(error?.message || t.schedule.couldNotOpenJob);
    } finally {
      setIsOpeningJob(false);
    }
  }

  async function handleExternalDrop(info: any) {
    const jobId =
      (info.event.extendedProps.externalJobId as string | undefined) || info.draggedEl.getAttribute('data-job-id') || '';

    if (!jobId) {
      info.revert();
      return;
    }

    const startAt = info.event.start || new Date();
    const endAt = info.event.end || addHours(startAt, 2);
    const draggedTeamId = (info.event.extendedProps.externalTeamId as string | null) || null;
    const inferredTeamId = selectedTeamIds.length === 1 ? selectedTeamIds[0] : null;
    const resolvedTeamId = draggedTeamId || inferredTeamId;

    // If no team can be resolved and multiple teams exist, show team picker
    if (!resolvedTeamId && teams.length > 1) {
      setTeamPickerDrop({
        jobId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        revert: () => info.revert(),
        removeEvent: () => info.event.remove(),
      });
      return;
    }

    try {
      await scheduleMutation.mutateAsync({
        jobId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        teamId: resolvedTeamId,
        timezone: DEFAULT_TIMEZONE,
      });

      info.event.remove();
      toast.success(t.schedule.jobScheduled);
    } catch (error: any) {
      info.revert();
      toast.error(error?.message || t.schedule.couldNotSchedule);
    }
  }

  // Fetch free slots per team when the team picker opens
  useEffect(() => {
    if (!teamPickerDrop) {
      setTeamSlots(new Map());
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    findFreeSlots({ days: 1, slotDuration: 60 })
      .then((slots) => {
        if (cancelled) return;
        const grouped = new Map<string, FreeSlot[]>();
        for (const slot of slots) {
          const existing = grouped.get(slot.team_id) || [];
          if (existing.length < 3) existing.push(slot); // Show max 3 per team
          grouped.set(slot.team_id, existing);
        }
        setTeamSlots(grouped);
      })
      .catch(() => { /* availability data optional */ })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [teamPickerDrop]);

  async function handleTeamPickerAssign(teamId: string) {
    if (!teamPickerDrop) return;
    try {
      await scheduleMutation.mutateAsync({
        jobId: teamPickerDrop.jobId,
        startAt: teamPickerDrop.startAt,
        endAt: teamPickerDrop.endAt,
        teamId: teamId || null,
        timezone: DEFAULT_TIMEZONE,
      });
      teamPickerDrop.removeEvent();
      toast.success(t.schedule.jobScheduled);
    } catch (error: any) {
      teamPickerDrop.revert();
      toast.error(error?.message || t.schedule.couldNotSchedule);
    } finally {
      setTeamPickerDrop(null);
    }
  }

  function renderEventContent(arg: EventContentArg) {
    const overlapCount = Number(arg.event.extendedProps.overlaps || 0);
    const subtitle = (arg.event.extendedProps.clientName as string | null) || (arg.event.extendedProps.address as string | null);
    const totalCents = Number(arg.event.extendedProps.totalCents || 0);

    return (
      <div className="lune-event-card">
        <div className="lune-event-title">{arg.event.title}</div>
        <div className="lune-event-time">{arg.timeText}</div>
        {subtitle ? <div className="lune-event-subtitle">{subtitle}</div> : null}
        {totalCents > 0 ? <div className="lune-event-subtitle">{formatCurrency(totalCents / 100)}</div> : null}
        {overlapCount > 0 ? (
          <div className="lune-event-warning">
            <CircleAlert size={10} />
            {t.schedule.overlapping}
          </div>
        ) : null}
      </div>
    );
  }

  const isLoading = teamsQuery.isLoading || eventsQuery.isLoading || unscheduledQuery.isLoading;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-text-primary">{t.schedule.title}</h1>
          <p className="text-sm text-text-secondary">{t.schedule.subtitle}</p>
        </div>
        <button type="button" onClick={refreshCalendarData} className="glass-button inline-flex items-center gap-2">
          <RefreshCw size={14} />
          {t.schedule.refresh}
        </button>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="glass rounded-2xl border border-outline-subtle p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">{format(selectedDate, 'MMMM yyyy')}</h2>
              <div className="flex items-center gap-1">
                <button type="button" className="glass-button !p-1.5" onClick={() => setDate(addMonths(selectedDate, -1))}>
                  <ChevronLeft size={14} />
                </button>
                <button type="button" className="glass-button !p-1.5" onClick={() => setDate(addMonths(selectedDate, 1))}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-text-secondary">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {miniCalendarDays.map((day) => {
                const active = isSameDay(day, selectedDate);
                const outsideMonth = !isSameMonth(day, selectedDate);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setDate(day)}
                    className={cn(
                      'h-8 rounded-lg text-xs font-medium transition-colors',
                      active
                        ? 'bg-black text-white'
                        : outsideMonth
                          ? 'text-text-tertiary hover:bg-black/5'
                          : 'text-text-primary hover:bg-black/5'
                    )}
                  >
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass rounded-2xl border border-outline-subtle p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">{t.schedule.teams}</h2>
              <span className="text-xs text-text-secondary">{selectedTeamIds.length}/{teams.length}</span>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="glass-button !px-2 !py-1 text-xs"
                onClick={() => { setUnassignedMode(false); setSelectedTeamIds(allTeamIds); }}
                disabled={teams.length === 0}
              >
                {t.schedule.allTeams}
              </button>
              <button
                type="button"
                className="glass-button !px-2 !py-1 text-xs"
                onClick={() => { setUnassignedMode(false); setSelectedTeamIds([]); }}
                disabled={teams.length === 0}
              >
                {t.schedule.clear}
              </button>
              <button
                type="button"
                className={cn(
                  '!px-2 !py-1 text-xs font-medium rounded-lg border transition-colors inline-flex items-center gap-1',
                  unassignedMode
                    ? 'border-amber-400 bg-amber-100 text-amber-800'
                    : 'glass-button'
                )}
                onClick={() => {
                  if (unassignedMode) {
                    setUnassignedMode(false);
                    setSelectedTeamIds(allTeamIds);
                  } else {
                    setUnassignedMode(true);
                    setSelectedTeamIds([]);
                  }
                }}
              >
                <AlertCircle size={11} />
                {t.schedule.unassigned}
                {unassignedCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
                    {unassignedCount}
                  </span>
                )}
              </button>
            </div>

            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
              {teams.map((team) => {
                const checked = selectedTeamIds.includes(team.id);
                const color = isHexColor(team.color_hex) ? team.color_hex : FALLBACK_TEAM_COLOR;

                return (
                  <label key={team.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-black/5">
                    <input type="checkbox" checked={checked} onChange={() => toggleTeam(team.id)} />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate">{team.name}</span>
                  </label>
                );
              })}

              {teams.length === 0 ? <p className="px-2 text-xs text-text-secondary">{t.schedule.noTeamsAvailable}</p> : null}
            </div>

            {unassignedMode ? (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                {t.schedule.unassignedJobsMsg}
              </p>
            ) : noTeamsSelected ? (
              <p className="mt-2 rounded-lg border border-warning-light bg-warning-light px-2 py-1 text-xs text-warning">
                {t.schedule.noTeamsSelected}
              </p>
            ) : null}
          </div>

          <div className="glass rounded-2xl border border-outline-subtle p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">{t.schedule.unscheduledJobs}</h2>
              <span className="text-xs text-text-secondary">{unscheduledJobs.length}</span>
            </div>

            <div ref={unscheduledRef} className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {unscheduledJobs.map((job: UnscheduledJobRecord) => {
                const isUnassigned = !job.team_id;
                const teamColor = job.team_id ? teamColorMap[job.team_id] || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;
                const teamName = job.team_id ? teams.find((t) => t.id === job.team_id)?.name : null;
                return (
                  <div
                    key={job.id}
                    data-job-id={job.id}
                    data-title={job.title}
                    data-team-id={job.team_id || ''}
                    className="w-full cursor-grab rounded-xl border border-outline-subtle bg-white px-3 py-2 text-left transition-colors hover:bg-black/5 active:cursor-grabbing"
                  >
                    <button
                      type="button"
                      onClick={() => void openExistingJob(job.id)}
                      className="w-full text-left"
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-bold text-text-primary">{job.title}</p>
                        {isUnassigned ? (
                          <span className="mt-0.5 shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                            Unassigned
                          </span>
                        ) : (
                          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: teamColor }} title={teamName || undefined} />
                        )}
                      </div>
                      <p className="truncate text-xs text-text-secondary">{job.client_name || job.property_address || t.schedule.noDetails}</p>
                      {job.property_address && job.client_name && (
                        <p className="truncate text-[10px] text-text-tertiary flex items-center gap-1 mt-0.5">
                          <MapPin size={9} />
                          {job.property_address}
                        </p>
                      )}
                      <p className="mt-1 text-xs font-semibold text-text-primary">
                        {formatCurrency((job.total_cents || 0) / 100)}
                      </p>
                    </button>
                    {isUnassigned && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAssignModalJob(job); }}
                        className="mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                      >
                        <UserPlus size={11} />
                        {t.schedule.assignToTeam}
                      </button>
                    )}
                  </div>
                );
              })}

              {unscheduledJobs.length === 0 ? <p className="text-xs text-text-secondary">{t.schedule.noUnscheduledJobs}</p> : null}
            </div>
          </div>
        </aside>

        <main className="glass rounded-2xl border border-outline-subtle p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-subtle bg-white/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={goPrev} className="glass-button !p-2">
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={goNext} className="glass-button !p-2">
                <ChevronRight size={14} />
              </button>
              <button type="button" onClick={goToday} className="glass-button">
                {t.schedule.today}
              </button>
              <h2 className="ml-2 text-xl font-bold text-text-primary">{headerLabel}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-outline-subtle bg-white p-1">
                {[
                  { id: 'month' as const, label: t.schedule.month },
                  { id: 'week' as const, label: t.schedule.week },
                  { id: 'day' as const, label: t.schedule.day },
                  { id: 'map' as const, label: t.schedule.map },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      view === item.id ? 'bg-black text-white' : 'text-text-primary hover:bg-black/5'
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const dateParam = format(selectedDate, 'yyyy-MM-dd');
                  const mapView = view === 'day' ? 'today' : view === 'week' ? 'this_week' : view === 'month' ? 'all' : 'today';
                  navigate(`/dispatch-map?view=${mapView}&date=${dateParam}`);
                }}
                className="glass-button inline-flex items-center gap-2"
              >
                <MapPin size={14} />
                {t.schedule.map}
              </button>
              <button
                type="button"
                onClick={() => openCreateJobModalWithDefaults()}
                className="glass-button-primary inline-flex items-center gap-2"
              >
                <Plus size={14} />
                {t.schedule.scheduleJob}
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {filterChips.map((chip) => {
              const active = chip.id === activeFilter;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setActiveFilter((prev) => (prev === chip.id ? 'all' : chip.id))}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-black bg-black text-white'
                      : 'border-white/30 bg-white/70 text-text-primary hover:bg-black/5'
                  )}
                >
                  <span>{chip.label}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px]', active ? 'bg-white/20 text-white' : 'bg-black/5 text-text-primary')}>
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>

          {isOpeningJob ? (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
              <RefreshCw size={12} className="animate-spin" />
              {t.schedule.openingJob}
            </div>
          ) : null}

          {isLoading ? (
            <div className="h-[760px] rounded-xl bg-black/5" />
          ) : noTeamsSelected && !unassignedMode ? (
            <div className="grid h-[760px] place-items-center rounded-xl border border-dashed border-border text-center">
              <div>
                <CalendarDays className="mx-auto mb-2 text-text-secondary" size={26} />
                <p className="text-sm font-medium text-text-primary">{t.schedule.noTeamsSelected}</p>
                <p className="mt-1 text-xs text-text-secondary">{t.schedule.noTeamsSelectedMsg}</p>
              </div>
            </div>
          ) : view === 'map' ? (
            <CRMMap
              pins={mapMarkers}
              heightClassName="h-[760px]"
              missingLocationCount={Math.max(0, filteredEvents.length - mapMarkers.length)}
              onOpenJob={(jobId) => void openExistingJob(jobId)}
            />
          ) : (
            <div className="lune-calendar rounded-xl border border-outline-subtle bg-white/70 p-2">
              <FullCalendar
                key={`${currentDateKey}-${fullCalendarView}`}
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView={fullCalendarView}
                initialDate={selectedDate}
                headerToolbar={false}
                firstDay={1}
                height={760}
                editable
                droppable
                selectable
                selectMirror
                eventOverlap
                dayMaxEvents={3}
                navLinks={false}
                nowIndicator
                timeZone="local"
                slotMinTime="06:00:00"
                slotMaxTime="22:00:00"
                events={calendarEvents}
                eventContent={renderEventContent}
                select={(arg: DateSelectArg) => {
                  openCreateJobModalWithDefaults(arg.start, arg.end || addHours(arg.start, 2));
                }}
                eventClick={(info) => {
                  const jobId = (info.event.extendedProps.jobId as string | undefined) || '';
                  if (!jobId) return;
                  void openExistingJob(jobId);
                }}
                eventDrop={async (info) => {
                  const nextStart = info.event.start;
                  const nextEnd = info.event.end || addHours(info.event.start || new Date(), 2);
                  const teamId = (info.event.extendedProps.teamId as string | null) || null;

                  if (!nextStart || !nextEnd) {
                    info.revert();
                    return;
                  }

                  try {
                    const result = await rescheduleMutation.mutateAsync({
                      eventId: info.event.id,
                      startAt: nextStart.toISOString(),
                      endAt: nextEnd.toISOString(),
                      teamId,
                      timezone: DEFAULT_TIMEZONE,
                    });

                    if (result.overlaps > 0) {
                      toast.warning(t.schedule.rescheduledWithOverlaps.replace('{count}', String(result.overlaps)));
                    } else {
                      toast.success(t.schedule.eventRescheduled);
                    }
                  } catch (error: any) {
                    info.revert();
                    toast.error(error?.message || t.schedule.couldNotReschedule);
                  }
                }}
                eventResize={async (info) => {
                  const nextStart = info.event.start;
                  const nextEnd = info.event.end || addHours(info.event.start || new Date(), 2);
                  const teamId = (info.event.extendedProps.teamId as string | null) || null;

                  if (!nextStart || !nextEnd) {
                    info.revert();
                    return;
                  }

                  try {
                    const result = await rescheduleMutation.mutateAsync({
                      eventId: info.event.id,
                      startAt: nextStart.toISOString(),
                      endAt: nextEnd.toISOString(),
                      teamId,
                      timezone: DEFAULT_TIMEZONE,
                    });

                    if (result.overlaps > 0) {
                      toast.warning(t.schedule.resizedWithOverlaps.replace('{count}', String(result.overlaps)));
                    } else {
                      toast.success(t.schedule.eventUpdated);
                    }
                  } catch (error: any) {
                    info.revert();
                    toast.error(error?.message || t.schedule.couldNotResize);
                  }
                }}
                eventReceive={(info) => {
                  void handleExternalDrop(info);
                }}
              />
            </div>
          )}
        </main>
      </section>

      {/* Team picker overlay — shown when dropping an unassigned job with multiple teams */}
      {teamPickerDrop && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { teamPickerDrop.revert(); setTeamPickerDrop(null); }}>
          <div className="w-full max-w-sm rounded-2xl border border-outline-subtle bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus size={16} className="text-text-secondary" />
                <h3 className="text-sm font-bold text-text-primary">Assign to team</h3>
              </div>
              <button type="button" onClick={() => { teamPickerDrop.revert(); setTeamPickerDrop(null); }} className="p-1 rounded-lg hover:bg-black/5">
                <XIcon size={14} />
              </button>
            </div>
            <p className="mb-3 text-xs text-text-secondary">
              Select a team for this job. The job will be scheduled at the dropped time slot.
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {teams.map((team) => {
                const color = isHexColor(team.color_hex) ? team.color_hex : FALLBACK_TEAM_COLOR;
                const slots = teamSlots.get(team.id) || [];
                return (
                  <div key={team.id} className="rounded-xl border border-outline-subtle overflow-hidden">
                    <button
                      type="button"
                      onClick={() => void handleTeamPickerAssign(team.id)}
                      disabled={scheduleMutation.isPending}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/5 disabled:opacity-50"
                    >
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      <span className="flex-1 text-sm font-medium text-text-primary">{team.name}</span>
                      {slots.length > 0 && (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                          {slots.length}+ free
                        </span>
                      )}
                      {!loadingSlots && slots.length === 0 && teamSlots.size > 0 && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                          No slots today
                        </span>
                      )}
                    </button>
                    {slots.length > 0 && (
                      <div className="border-t border-outline-subtle/50 bg-surface-secondary/30 px-3 py-1.5 flex flex-wrap gap-1">
                        {slots.map((slot, i) => {
                          const startTime = new Date(slot.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          const endTime = new Date(slot.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          return (
                            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-text-secondary border border-outline-subtle/50">
                              <Clock size={9} className="text-emerald-500" />
                              {startTime}–{endTime}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => void handleTeamPickerAssign('')}
              disabled={scheduleMutation.isPending}
              className="mt-3 w-full rounded-xl border border-dashed border-outline-subtle px-3 py-2 text-center text-xs text-text-secondary hover:bg-black/5 disabled:opacity-50"
            >
              Schedule without team (unassigned)
            </button>
          </div>
        </div>
      )}

      {/* Assignment modal — assign an unassigned job to a team */}
      {assignModalJob && (
        <AssignJobModal
          job={assignModalJob}
          teams={teams}
          onAssign={(teamId) => {
            const jobId = 'job_id' in assignModalJob ? assignModalJob.job_id : assignModalJob.id;
            void assignMutation.mutateAsync({ jobId, teamId });
          }}
          onClose={() => setAssignModalJob(null)}
          isPending={assignMutation.isPending}
        />
      )}
    </div>
  );
}

function AssignJobModal({
  job,
  teams,
  onAssign,
  onClose,
  isPending,
}: {
  job: UnscheduledJobRecord | ScheduleEventRecord;
  teams: TeamRecord[];
  onAssign: (teamId: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [assignSlots, setAssignSlots] = useState<Map<string, FreeSlot[]>>(new Map());
  const [loadingAssignSlots, setLoadingAssignSlots] = useState(false);
  const [teamEventCounts, setTeamEventCounts] = useState<Map<string, number>>(new Map());

  const jobTitle = 'title' in job ? (job as UnscheduledJobRecord).title : (job as ScheduleEventRecord).job?.title || '';
  const clientName = 'client_name' in job ? (job as UnscheduledJobRecord).client_name : (job as ScheduleEventRecord).job?.client_name || null;
  const address = 'property_address' in job ? (job as UnscheduledJobRecord).property_address : (job as ScheduleEventRecord).job?.property_address || null;
  const totalCents = 'total_cents' in job ? (job as UnscheduledJobRecord).total_cents : (job as ScheduleEventRecord).job?.total_cents || 0;

  // Fetch free slots and workload per team
  useEffect(() => {
    let cancelled = false;
    setLoadingAssignSlots(true);

    Promise.all([
      findFreeSlots({ days: 1, slotDuration: 60 }),
      // Count today's events per team
      (async () => {
        const todayStart = startOfDay(new Date()).toISOString();
        const todayEnd = addDays(startOfDay(new Date()), 1).toISOString();
        const { data } = await supabase
          .from('schedule_events')
          .select('team_id')
          .is('deleted_at', null)
          .gte('start_at', todayStart)
          .lt('end_at', todayEnd);
        const counts = new Map<string, number>();
        for (const row of data || []) {
          if (row.team_id) counts.set(row.team_id, (counts.get(row.team_id) || 0) + 1);
        }
        return counts;
      })(),
    ])
      .then(([slots, counts]) => {
        if (cancelled) return;
        const grouped = new Map<string, FreeSlot[]>();
        for (const slot of slots) {
          const existing = grouped.get(slot.team_id) || [];
          if (existing.length < 3) existing.push(slot);
          grouped.set(slot.team_id, existing);
        }
        setAssignSlots(grouped);
        setTeamEventCounts(counts);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingAssignSlots(false); });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-outline-subtle bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-amber-600" />
            <h3 className="text-sm font-bold text-text-primary">{t.schedule.assignJob}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-black/5">
            <XIcon size={14} />
          </button>
        </div>

        {/* Job info */}
        <div className="mb-4 rounded-xl border border-outline-subtle bg-surface-secondary/30 p-3">
          <p className="text-sm font-bold text-text-primary">{jobTitle}</p>
          {clientName && <p className="text-xs text-text-secondary mt-0.5">{clientName}</p>}
          {address && (
            <p className="text-[10px] text-text-tertiary mt-0.5 flex items-center gap-1">
              <MapPin size={9} />
              {address}
            </p>
          )}
          {(totalCents || 0) > 0 && (
            <p className="text-xs font-semibold text-text-primary mt-1">{formatCurrency((totalCents || 0) / 100)}</p>
          )}
        </div>

        <p className="mb-3 text-xs text-text-secondary">{t.schedule.selectTeamToAssign}</p>

        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {teams.map((team) => {
            const color = isHexColor(team.color_hex) ? team.color_hex : FALLBACK_TEAM_COLOR;
            const slots = assignSlots.get(team.id) || [];
            const eventCount = teamEventCounts.get(team.id) || 0;
            return (
              <div key={team.id} className="rounded-xl border border-outline-subtle overflow-hidden">
                <button
                  type="button"
                  onClick={() => onAssign(team.id)}
                  disabled={isPending}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/5 disabled:opacity-50"
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-text-primary">{team.name}</span>
                    {eventCount > 0 && (
                      <span className="ml-2 text-[10px] text-text-tertiary">
                        {eventCount} {t.schedule.teamWorkload}
                      </span>
                    )}
                  </div>
                  {slots.length > 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                      {slots.length}+ {t.schedule.freeSlots}
                    </span>
                  )}
                  {!loadingAssignSlots && slots.length === 0 && assignSlots.size > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                      {t.schedule.noSlotsToday}
                    </span>
                  )}
                </button>
                {slots.length > 0 && (
                  <div className="border-t border-outline-subtle/50 bg-surface-secondary/30 px-3 py-1.5 flex flex-wrap gap-1">
                    {slots.map((slot, i) => {
                      const startTime = new Date(slot.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const endTime = new Date(slot.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-text-secondary border border-outline-subtle/50">
                          <Clock size={9} className="text-emerald-500" />
                          {startTime}–{endTime}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Schedule() {
  return (
    <CalendarControllerProvider>
      <ScheduleContent />
    </CalendarControllerProvider>
  );
}
