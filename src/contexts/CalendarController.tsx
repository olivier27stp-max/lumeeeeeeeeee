import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

function sameDay(a: Date, b: Date) { return format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd'); }
function sameArr(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function CalendarControllerProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => ({ date: parseDate(searchParams.get('date')), view: parseView(searchParams.get('view')), teams: parseTeams(searchParams.get('teams')), hasTeamsParam: searchParams.has('teams') }), []);

  const [selectedDate, setSelectedDate] = useState<Date>(initial.date);
  const [view, setViewState] = useState<CalendarUiView>(initial.view);
  const [selectedTeamIds, setSelectedTeamIdsState] = useState<string[]>(initial.teams);
  const [hasTeamsParam, setHasTeamsParam] = useState(initial.hasTeamsParam);
  const skipRef = useRef(false);

  useEffect(() => {
    skipRef.current = true;
    setSelectedDate((p) => { const n = parseDate(searchParams.get('date')); return sameDay(p, n) ? p : n; });
    setViewState((p) => { const n = parseView(searchParams.get('view')); return p === n ? p : n; });
    setSelectedTeamIdsState((p) => { const n = parseTeams(searchParams.get('teams')); return sameArr(p, n) ? p : n; });
    setHasTeamsParam(searchParams.has('teams'));
  }, [searchParams]);

  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    const next = new URLSearchParams(searchParams);
    next.set('date', format(selectedDate, 'yyyy-MM-dd'));
    next.set('view', view);
    if (!hasTeamsParam && selectedTeamIds.length === 0) next.delete('teams');
    else if (selectedTeamIds.length === 0) next.set('teams', 'none');
    else next.set('teams', selectedTeamIds.join(','));
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [hasTeamsParam, searchParams, selectedDate, selectedTeamIds, setSearchParams, view]);

  const setDate = (d: Date) => { if (isValid(d)) setSelectedDate(d); };
  const setView = (v: CalendarUiView) => setViewState(v);
  const setSelectedTeamIds = (ids: string[]) => { setHasTeamsParam(true); setSelectedTeamIdsState(Array.from(new Set(ids))); };
  const toggleTeam = (id: string) => { setHasTeamsParam(true); setSelectedTeamIdsState((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); };
  const goToday = () => setDate(new Date());
  const goPrev = () => setSelectedDate((p) => {
    if (view === 'day') return addDays(p, -1);
    if (view === 'week' || view === 'agenda') return addWeeks(p, -1);
    return addMonths(p, -1);
  });
  const goNext = () => setSelectedDate((p) => {
    if (view === 'day') return addDays(p, 1);
    if (view === 'week' || view === 'agenda') return addWeeks(p, 1);
    return addMonths(p, 1);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo<CalendarControllerValue>(() => ({ selectedDate, view, selectedTeamIds, hasTeamsParam, setDate, setView, setSelectedTeamIds, toggleTeam, goToday, goPrev, goNext }), [hasTeamsParam, selectedDate, selectedTeamIds, view]);
  return <CalendarControllerContext.Provider value={value}>{children}</CalendarControllerContext.Provider>;
}

export function useCalendarController() {
  const ctx = useContext(CalendarControllerContext);
  if (!ctx) throw new Error('useCalendarController must be used within CalendarControllerProvider');
  return ctx;
}
