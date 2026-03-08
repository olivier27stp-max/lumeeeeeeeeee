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
} from 'lucide-react';
import { toast } from 'sonner';
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
  invalidateScheduleCache,
  listScheduleEventsRange,
  listUnscheduledJobs,
  rescheduleEvent,
  scheduleUnscheduledJob,
} from '../lib/scheduleApi';
import { listTeams, TeamRecord } from '../lib/teamsApi';
import { supabase } from '../lib/supabase';
import { cn, formatCurrency } from '../lib/utils';

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
  const [activeFilter, setActiveFilter] = useState<ScheduleQuickFilter>('all');

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
    queryKey: ['calendarEvents', orgId || 'none', view, currentDateKey, teamsKey],
    enabled: !!orgId && !noTeamsSelected,
    queryFn: () =>
      listScheduleEventsRange({
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString(),
        teamIds: effectiveTeamIds,
        bypassCache: true,
      }),
  });

  const unscheduledQuery = useQuery({
    queryKey: ['calendarUnscheduledJobs', orgId || 'none', teamsKey],
    enabled: !!orgId && !noTeamsSelected,
    queryFn: () => listUnscheduledJobs(effectiveTeamIds),
  });

  const events = eventsQuery.data || [];
  const unscheduledJobs = unscheduledQuery.data || [];

  const endingWithin30Count = useMemo(() => {
    const anchor = new Date();
    return events.filter((event) => isEndingWithin30(event, anchor)).length;
  }, [events]);
  const requiresInvoicingCount = useMemo(() => events.filter((event) => requiresInvoicing(event)).length, [events]);
  const needsAttentionCount = useMemo(() => events.filter((event) => needsAttention(event)).length, [events]);
  const filterChips: Array<{ id: ScheduleQuickFilter; label: string; count: number }> = useMemo(
    () => [
      { id: 'all', label: 'All', count: events.length },
      { id: 'ending_30', label: 'Ending within 30 days', count: endingWithin30Count },
      { id: 'requires_invoicing', label: 'Requires invoicing', count: requiresInvoicingCount },
      { id: 'needs_attention', label: 'Needs attention', count: needsAttentionCount },
    ],
    [endingWithin30Count, events.length, needsAttentionCount, requiresInvoicingCount]
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

      return {
        id: event.id,
        title: event.job?.title || 'Untitled job',
        start: event.start_at,
        end: event.end_at,
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
          title: event.job?.title || 'Untitled job',
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
        void queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
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
        toast.error('Job not found.');
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
      toast.error(error?.message || 'Could not open job');
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

    try {
      const startAt = info.event.start || new Date();
      const endAt = info.event.end || addHours(startAt, 2);
      const draggedTeamId = (info.event.extendedProps.externalTeamId as string | null) || null;
      const inferredTeamId = selectedTeamIds.length === 1 ? selectedTeamIds[0] : null;

      await scheduleMutation.mutateAsync({
        jobId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        teamId: draggedTeamId || inferredTeamId,
        timezone: DEFAULT_TIMEZONE,
      });

      info.event.remove();
      toast.success('Job scheduled');
    } catch (error: any) {
      info.revert();
      toast.error(error?.message || 'Could not schedule this job');
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
            Overlapping
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
          <h1 className="text-4xl font-bold tracking-tight text-text-primary">Schedule</h1>
          <p className="text-sm text-text-secondary">Day / week / month / map planning with synchronized date state and team filters.</p>
        </div>
        <button type="button" onClick={refreshCalendarData} className="glass-button inline-flex items-center gap-2">
          <RefreshCw size={14} />
          Refresh
        </button>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="glass rounded-2xl border-[1.5px] border-outline-subtle p-4">
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

          <div className="glass rounded-2xl border-[1.5px] border-outline-subtle p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">Teams</h2>
              <span className="text-xs text-text-secondary">{selectedTeamIds.length}/{teams.length}</span>
            </div>

            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className="glass-button !px-2 !py-1 text-xs"
                onClick={() => setSelectedTeamIds(allTeamIds)}
                disabled={teams.length === 0}
              >
                All teams
              </button>
              <button
                type="button"
                className="glass-button !px-2 !py-1 text-xs"
                onClick={() => setSelectedTeamIds([])}
                disabled={teams.length === 0}
              >
                Clear
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

              {teams.length === 0 ? <p className="px-2 text-xs text-text-secondary">No teams available.</p> : null}
            </div>

            {noTeamsSelected ? (
              <p className="mt-2 rounded-lg border border-warning-light bg-warning-light px-2 py-1 text-xs text-warning">
                No teams selected.
              </p>
            ) : null}
          </div>

          <div className="glass rounded-2xl border-[1.5px] border-outline-subtle p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">Unscheduled jobs</h2>
              <span className="text-xs text-text-secondary">{unscheduledJobs.length}</span>
            </div>

            <div ref={unscheduledRef} className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {unscheduledJobs.map((job: UnscheduledJobRecord) => {
                const teamColor = job.team_id ? teamColorMap[job.team_id] || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;
                return (
                  <button
                    key={job.id}
                    type="button"
                    data-job-id={job.id}
                    data-title={job.title}
                    data-team-id={job.team_id || ''}
                    onClick={() => void openExistingJob(job.id)}
                    className="w-full cursor-grab rounded-xl border-[1.5px] border-outline-subtle bg-white px-3 py-2 text-left transition-colors hover:bg-black/5 active:cursor-grabbing"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-bold text-text-primary">{job.title}</p>
                      <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: teamColor }} />
                    </div>
                    <p className="truncate text-xs text-text-secondary">{job.client_name || job.property_address || 'No details'}</p>
                    <p className="mt-1 text-xs font-semibold text-text-primary">
                      {formatCurrency((job.total_cents || 0) / 100)}
                    </p>
                  </button>
                );
              })}

              {unscheduledJobs.length === 0 ? <p className="text-xs text-text-secondary">No unscheduled jobs.</p> : null}
            </div>
          </div>
        </aside>

        <main className="glass rounded-2xl border-[1.5px] border-outline-subtle p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-outline-subtle bg-white/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={goPrev} className="glass-button !p-2">
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={goNext} className="glass-button !p-2">
                <ChevronRight size={14} />
              </button>
              <button type="button" onClick={goToday} className="glass-button">
                Today
              </button>
              <h2 className="ml-2 text-xl font-bold text-text-primary">{headerLabel}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border-[1.5px] border-outline-subtle bg-white p-1">
                {[
                  { id: 'month' as const, label: 'Month' },
                  { id: 'week' as const, label: 'Week' },
                  { id: 'day' as const, label: 'Day' },
                  { id: 'map' as const, label: 'Map' },
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
                onClick={() => openCreateJobModalWithDefaults()}
                className="glass-button-primary inline-flex items-center gap-2"
              >
                <Plus size={14} />
                Schedule job
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
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <RefreshCw size={12} className="animate-spin" />
              Opening job details...
            </div>
          ) : null}

          {isLoading ? (
            <div className="h-[760px] rounded-xl bg-black/5" />
          ) : noTeamsSelected ? (
            <div className="grid h-[760px] place-items-center rounded-xl border border-dashed border-border text-center">
              <div>
                <CalendarDays className="mx-auto mb-2 text-text-secondary" size={26} />
                <p className="text-sm font-medium text-text-primary">No teams selected</p>
                <p className="mt-1 text-xs text-text-secondary">Use the sidebar filters to pick at least one team.</p>
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
            <div className="lune-calendar rounded-xl border-[1.5px] border-outline-subtle bg-white/70 p-2">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView={fullCalendarView}
                initialDate={selectedDate}
                headerToolbar={false}
                height={760}
                editable
                droppable
                selectable
                selectMirror
                eventOverlap
                dayMaxEvents={3}
                navLinks={false}
                nowIndicator
                timeZone={DEFAULT_TIMEZONE}
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
                      toast.warning(`Rescheduled with ${result.overlaps} overlap warning(s).`);
                    } else {
                      toast.success('Event rescheduled');
                    }
                  } catch (error: any) {
                    info.revert();
                    toast.error(error?.message || 'Could not reschedule event');
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
                      toast.warning(`Resized with ${result.overlaps} overlap warning(s).`);
                    } else {
                      toast.success('Event updated');
                    }
                  } catch (error: any) {
                    info.revert();
                    toast.error(error?.message || 'Could not resize event');
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
