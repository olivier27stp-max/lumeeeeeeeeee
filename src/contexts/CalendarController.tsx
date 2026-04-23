import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { addDays, addMonths, addWeeks, format, isValid, parseISO } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { resolveCalendarDateParam } from '../lib/searchParsing';

export type CalendarUiView = 'day' | 'week' | 'month' | 'agenda';

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
  const v = (raw || '').toLowerCase();
  if (v === 'day' || v === 'week' || v === 'month' || v === 'agenda') return v;
  return 'month';
}

function parseDate(raw: string | null): Date {
  const resolved = resolveCalendarDateParam(raw);
  if (resolved) { const p = parseISO(`${resolved}T12:00:00`); if (isValid(p)) return p; }
  if (raw) { const p = parseISO(raw); if (isValid(p)) return p; }
  return new Date();
}

function parseTeams(raw: string | null): string[] {
  if (!raw || raw === 'none') return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function writeParams(
  prev: URLSearchParams,
  opts: { date?: Date; view?: CalendarUiView; teamIds?: string[]; hasTeamsParam?: boolean; currentHasTeamsParam: boolean; currentTeamIds: string[] },
): URLSearchParams | null {
  const next = new URLSearchParams(prev);
  if (opts.date) next.set('date', format(opts.date, 'yyyy-MM-dd'));
  if (opts.view) next.set('view', opts.view);
  const nextTeamIds = opts.teamIds ?? opts.currentTeamIds;
  const nextHasTeams = opts.hasTeamsParam ?? opts.currentHasTeamsParam;
  if (!nextHasTeams && nextTeamIds.length === 0) next.delete('teams');
  else if (nextTeamIds.length === 0) next.set('teams', 'none');
  else next.set('teams', nextTeamIds.join(','));
  return next.toString() === prev.toString() ? null : next;
}

export function CalendarControllerProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL is the single source of truth. State is derived — no effects, no loops.
  const dateParam = searchParams.get('date');
  const viewParam = searchParams.get('view');
  const teamsParam = searchParams.get('teams');
  const hasTeamsParam = searchParams.has('teams');

  const selectedDate = useMemo(() => parseDate(dateParam), [dateParam]);
  const view = useMemo(() => parseView(viewParam), [viewParam]);
  const selectedTeamIds = useMemo(() => parseTeams(teamsParam), [teamsParam]);

  const updateParams = useCallback((updates: { date?: Date; view?: CalendarUiView; teamIds?: string[]; hasTeamsParam?: boolean }) => {
    setSearchParams((prev) => {
      const currentTeamIds = parseTeams(prev.get('teams'));
      const currentHasTeamsParam = prev.has('teams');
      const next = writeParams(prev, { ...updates, currentHasTeamsParam, currentTeamIds });
      return next ?? prev;
    }, { replace: true });
  }, [setSearchParams]);

  const setDate = useCallback((d: Date) => { if (isValid(d)) updateParams({ date: d }); }, [updateParams]);
  const setView = useCallback((v: CalendarUiView) => updateParams({ view: v }), [updateParams]);
  const setSelectedTeamIds = useCallback((ids: string[]) => updateParams({ teamIds: Array.from(new Set(ids)), hasTeamsParam: true }), [updateParams]);
  const toggleTeam = useCallback((id: string) => {
    const nextIds = selectedTeamIds.includes(id) ? selectedTeamIds.filter((x) => x !== id) : [...selectedTeamIds, id];
    updateParams({ teamIds: nextIds, hasTeamsParam: true });
  }, [selectedTeamIds, updateParams]);
  const goToday = useCallback(() => updateParams({ date: new Date() }), [updateParams]);
  const goPrev = useCallback(() => {
    const d = view === 'day' ? addDays(selectedDate, -1)
      : view === 'week' || view === 'agenda' ? addWeeks(selectedDate, -1)
      : addMonths(selectedDate, -1);
    updateParams({ date: d });
  }, [selectedDate, updateParams, view]);
  const goNext = useCallback(() => {
    const d = view === 'day' ? addDays(selectedDate, 1)
      : view === 'week' || view === 'agenda' ? addWeeks(selectedDate, 1)
      : addMonths(selectedDate, 1);
    updateParams({ date: d });
  }, [selectedDate, updateParams, view]);

  const value = useMemo<CalendarControllerValue>(
    () => ({ selectedDate, view, selectedTeamIds, hasTeamsParam, setDate, setView, setSelectedTeamIds, toggleTeam, goToday, goPrev, goNext }),
    [selectedDate, view, selectedTeamIds, hasTeamsParam, setDate, setView, setSelectedTeamIds, toggleTeam, goToday, goPrev, goNext],
  );
  return <CalendarControllerContext.Provider value={value}>{children}</CalendarControllerContext.Provider>;
}

export function useCalendarController() {
  const ctx = useContext(CalendarControllerContext);
  if (!ctx) throw new Error('useCalendarController must be used within CalendarControllerProvider');
  return ctx;
}
