import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, addWeeks, format, isValid, parseISO } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { resolveCalendarDateParam } from '../lib/searchParsing';

export type CalendarUiView = 'day' | 'week' | 'month' | 'map';

interface CalendarControllerValue {
  selectedDate: Date;
  view: CalendarUiView;
  selectedTeamIds: string[];
  hasTeamsParam: boolean;
  setDate: (date: Date) => void;
  setView: (view: CalendarUiView) => void;
  setSelectedTeamIds: (teamIds: string[]) => void;
  toggleTeam: (teamId: string) => void;
  goToday: () => void;
  goPrev: () => void;
  goNext: () => void;
}

const CalendarControllerContext = createContext<CalendarControllerValue | null>(null);

function parseView(raw: string | null): CalendarUiView {
  const value = (raw || '').toLowerCase();
  if (value === 'day' || value === 'week' || value === 'month' || value === 'map') return value;
  return 'week';
}

function parseDate(raw: string | null): Date {
  const resolved = resolveCalendarDateParam(raw);
  if (resolved) {
    const parsed = parseISO(`${resolved}T12:00:00`);
    if (isValid(parsed)) return parsed;
  }

  if (raw) {
    const parsed = parseISO(raw);
    if (isValid(parsed)) return parsed;
  }

  return new Date();
}

function parseTeams(raw: string | null): string[] {
  if (!raw) return [];
  if (raw === 'none') return [];
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function sameDay(a: Date, b: Date) {
  return format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd');
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function CalendarControllerProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const initial = useMemo(() => {
    return {
      date: parseDate(searchParams.get('date')),
      view: parseView(searchParams.get('view')),
      teams: parseTeams(searchParams.get('teams')),
      hasTeamsParam: searchParams.has('teams'),
    };
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date>(initial.date);
  const [view, setViewState] = useState<CalendarUiView>(initial.view);
  const [selectedTeamIds, setSelectedTeamIdsState] = useState<string[]>(initial.teams);
  const [hasTeamsParam, setHasTeamsParam] = useState<boolean>(initial.hasTeamsParam);

  const skipUrlSyncRef = useRef(false);

  useEffect(() => {
    const nextDate = parseDate(searchParams.get('date'));
    const nextView = parseView(searchParams.get('view'));
    const nextTeams = parseTeams(searchParams.get('teams'));
    const nextHasTeamsParam = searchParams.has('teams');

    skipUrlSyncRef.current = true;

    setSelectedDate((prev) => (sameDay(prev, nextDate) ? prev : nextDate));
    setViewState((prev) => (prev === nextView ? prev : nextView));
    setSelectedTeamIdsState((prev) => (sameStringArray(prev, nextTeams) ? prev : nextTeams));
    setHasTeamsParam(nextHasTeamsParam);
  }, [searchParams]);

  useEffect(() => {
    if (skipUrlSyncRef.current) {
      skipUrlSyncRef.current = false;
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.set('date', format(selectedDate, 'yyyy-MM-dd'));
    next.set('view', view);

    if (!hasTeamsParam && selectedTeamIds.length === 0) {
      next.delete('teams');
    } else if (selectedTeamIds.length === 0) {
      next.set('teams', 'none');
    } else {
      next.set('teams', selectedTeamIds.join(','));
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [hasTeamsParam, searchParams, selectedDate, selectedTeamIds, setSearchParams, view]);

  const setDate = (date: Date) => {
    if (!isValid(date)) return;
    setSelectedDate(date);
  };

  const setView = (nextView: CalendarUiView) => {
    setViewState(nextView);
  };

  const setSelectedTeamIds = (teamIds: string[]) => {
    const unique = Array.from(new Set(teamIds));
    setHasTeamsParam(true);
    setSelectedTeamIdsState(unique);
  };

  const toggleTeam = (teamId: string) => {
    setHasTeamsParam(true);
    setSelectedTeamIdsState((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]
    );
  };

  const goToday = () => {
    setDate(new Date());
  };

  const goPrev = () => {
    setSelectedDate((prev) => {
      if (view === 'day') return addDays(prev, -1);
      if (view === 'week') return addWeeks(prev, -1);
      if (view === 'map') return addWeeks(prev, -1);
      return addMonths(prev, -1);
    });
  };

  const goNext = () => {
    setSelectedDate((prev) => {
      if (view === 'day') return addDays(prev, 1);
      if (view === 'week') return addWeeks(prev, 1);
      if (view === 'map') return addWeeks(prev, 1);
      return addMonths(prev, 1);
    });
  };

  const value = useMemo<CalendarControllerValue>(
    () => ({
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
    }),
    [hasTeamsParam, selectedDate, selectedTeamIds, view]
  );

  return <CalendarControllerContext.Provider value={value}>{children}</CalendarControllerContext.Provider>;
}

export function useCalendarController() {
  const context = useContext(CalendarControllerContext);
  if (!context) {
    throw new Error('useCalendarController must be used within CalendarControllerProvider');
  }
  return context;
}
