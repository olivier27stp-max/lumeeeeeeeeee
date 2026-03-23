import React, { useState, useMemo, useEffect } from 'react';
import {
  Timer,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Download,
  LogIn,
  LogOut,
  Calendar,
  User,
  Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { exportToCsv } from '../lib/exportCsv';
import { toast } from 'sonner';
import { PageHeader, EmptyState } from '../components/ui';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import PermissionGate from '../components/PermissionGate';

type ViewMode = 'day' | 'week' | 'month';

interface TimeEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string; // YYYY-MM-DD
  punch_in: string; // HH:mm
  punch_out: string | null;
  breaks: Array<{ start: string; end: string }>;
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function formatTimeDisplay(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function calcWorkMinutes(entry: TimeEntry): number {
  if (!entry.punch_out) return 0;
  const total = parseTime(entry.punch_out) - parseTime(entry.punch_in);
  const breakMins = entry.breaks.reduce((acc, b) => acc + (parseTime(b.end) - parseTime(b.start)), 0);
  return Math.max(0, total - breakMins);
}

function calcBreakMinutes(entry: TimeEntry): number {
  return entry.breaks.reduce((acc, b) => acc + (parseTime(b.end) - parseTime(b.start)), 0);
}

function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const next = new Date(monday);
    next.setDate(monday.getDate() + i);
    dates.push(next);
  }
  return dates;
}

const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function Timesheets() {
  const { language } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());

  const dayNames = language === 'fr' ? DAY_NAMES_FR : DAY_NAMES_EN;
  const monthNames = language === 'fr' ? MONTH_NAMES_FR : MONTH_NAMES_EN;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    // Load time entries
    const { data: entriesData } = await supabase
      .from('time_entries')
      .select('*')
      .order('date', { ascending: false });

    if (entriesData) {
      const mapped: TimeEntry[] = entriesData.map((e: any) => ({
        id: e.id,
        employee_id: e.employee_id || e.id,
        employee_name: e.employee_name || 'Unknown',
        date: e.date,
        punch_in: e.punch_in?.slice(0, 5) || '09:00',
        punch_out: e.punch_out ? e.punch_out.slice(0, 5) : null,
        breaks: Array.isArray(e.breaks) ? e.breaks : [],
      }));
      setEntries(mapped);

      // Build employee list from entries
      const empMap = new Map<string, string>();
      mapped.forEach((e) => empMap.set(e.employee_id, e.employee_name));
      setEmployees(Array.from(empMap.entries()).map(([id, name]) => ({ id, name })));
    }

    setLoading(false);
  }

  const filteredEntries = useMemo(() => {
    if (selectedEmployee === 'all') return entries;
    return entries.filter((e) => e.employee_id === selectedEmployee);
  }, [entries, selectedEmployee]);

  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (viewMode === 'day') d.setDate(d.getDate() + dir);
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  };

  const dateLabel = useMemo(() => {
    if (viewMode === 'day') {
      return `${dayNames[currentDate.getDay()]}, ${monthNames[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
    }
    if (viewMode === 'week') {
      const week = getWeekDates(currentDate);
      const start = week[0];
      const end = week[6];
      return `${monthNames[start.getMonth()]} ${start.getDate()} – ${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }, [currentDate, viewMode, monthNames, dayNames]);

  const viewEntries = useMemo(() => {
    if (viewMode === 'day') {
      const dateStr = currentDate.toISOString().slice(0, 10);
      return filteredEntries.filter((e) => e.date === dateStr);
    }
    if (viewMode === 'week') {
      const week = getWeekDates(currentDate);
      const weekDates = new Set(week.map((d) => d.toISOString().slice(0, 10)));
      return filteredEntries.filter((e) => weekDates.has(e.date));
    }
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    return filteredEntries.filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [filteredEntries, currentDate, viewMode]);

  const totalMinutes = useMemo(() => viewEntries.reduce((acc, e) => acc + calcWorkMinutes(e), 0), [viewEntries]);
  const totalBreakMinutes = useMemo(() => viewEntries.reduce((acc, e) => acc + calcBreakMinutes(e), 0), [viewEntries]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, TimeEntry[]> = {};
    for (const e of viewEntries) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [viewEntries]);

  const sortedDates = useMemo(() => Object.keys(entriesByDate).sort(), [entriesByDate]);

  const handleExportCsv = async () => {
    try {
      const { data, error: fetchErr } = await supabase
        .from('time_entries')
        .select('*')
        .order('date', { ascending: false });
      if (fetchErr) throw fetchErr;
      const rows = (data || []).map((e: any) => [
        e.employee_name || 'Unknown',
        e.date || '',
        e.punch_in ? e.punch_in.slice(0, 5) : '',
        e.punch_out ? e.punch_out.slice(0, 5) : '',
        (() => {
          const breaks: Array<{ start: string; end: string }> = Array.isArray(e.breaks) ? e.breaks : [];
          const breakMins = breaks.reduce((acc: number, b: any) => acc + (parseTime(b.end) - parseTime(b.start)), 0);
          return formatHours(breakMins);
        })(),
        (() => {
          if (!e.punch_out) return '0h 00m';
          const pIn = e.punch_in ? e.punch_in.slice(0, 5) : '00:00';
          const pOut = e.punch_out.slice(0, 5);
          const breaks: Array<{ start: string; end: string }> = Array.isArray(e.breaks) ? e.breaks : [];
          const breakMins = breaks.reduce((acc: number, b: any) => acc + (parseTime(b.end) - parseTime(b.start)), 0);
          const total = Math.max(0, parseTime(pOut) - parseTime(pIn) - breakMins);
          return formatHours(total);
        })(),
      ]);
      exportToCsv(
        `timesheets-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Employee', 'Date', 'Punch In', 'Punch Out', 'Breaks', 'Work Duration'],
        rows,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Export failed');
    }
  };

  const timesheetsContent = (
    <div className="space-y-5">
      <PageHeader
        title={t.timesheets.timesheets}
        subtitle={t.timesheets.employeeTimeTracking}
        icon={Timer}
        iconColor="rose"
      >
        <button
          onClick={() => void handleExportCsv()}
          className="glass-button inline-flex items-center gap-1.5"
        >
          <Download size={14} />
          {t.timesheets.exportCsv}
        </button>
      </PageHeader>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <User size={14} className="text-text-tertiary" />
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className="glass-input !py-1.5 text-[13px]"
          >
            <option value="all">{t.timesheets.allEmployees}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        </div>

        <div className="flex rounded-lg border border-outline overflow-hidden">
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-semibold transition-all',
                viewMode === mode ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {mode === 'day' ? (t.timesheets.day) :
               mode === 'week' ? (t.timesheets.week) :
               (t.timesheets.month)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => navigate(-1)} className="glass-button !px-2 !py-1.5">
            <ChevronLeft size={14} />
          </button>
          <span className="text-[13px] font-semibold text-text-primary min-w-[200px] text-center">
            {dateLabel}
          </span>
          <button onClick={() => navigate(1)} className="glass-button !px-2 !py-1.5">
            <ChevronRight size={14} />
          </button>
          <button onClick={() => setCurrentDate(new Date())} className="glass-button text-[12px] !py-1.5">
            {language === 'fr' ? "Aujourd'hui" : 'Today'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="section-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
              {t.timesheets.hoursWorked}
            </span>
          </div>
          <p className="text-xl font-bold text-text-primary tabular-nums">{formatHours(totalMinutes)}</p>
        </div>
        <div className="section-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Coffee size={14} className="text-text-secondary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
              {t.timesheets.totalBreaks}
            </span>
          </div>
          <p className="text-xl font-bold text-text-primary tabular-nums">{formatHours(totalBreakMinutes)}</p>
        </div>
        <div className="section-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar size={14} className="text-text-secondary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
              {t.timesheets.entries}
            </span>
          </div>
          <p className="text-xl font-bold text-text-primary tabular-nums">{viewEntries.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-text-tertiary" /></div>
      ) : viewEntries.length === 0 ? (
        <EmptyState
          icon={Timer}
          title={t.timesheets.noTimeEntries}
          description={t.timesheets.noTimesheetsFoundForThisPeriod}
        />
      ) : viewMode === 'day' ? (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="section-card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.timesheets.employee}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <div className="flex items-center gap-1.5"><LogIn size={12} /> {t.timesheets.punchIn}</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <div className="flex items-center gap-1.5"><LogOut size={12} /> {t.timesheets.punchOut}</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <div className="flex items-center gap-1.5"><Coffee size={12} /> {t.timesheets.breaks}</div>
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.timesheets.workDuration}
                </th>
              </tr>
            </thead>
            <tbody>
              {viewEntries.map((entry) => (
                <tr key={entry.id} className="table-row-hover">
                  <td className="px-4 py-3 text-[13px] font-medium text-text-primary">{entry.employee_name}</td>
                  <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">{formatTimeDisplay(entry.punch_in)}</td>
                  <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">{entry.punch_out ? formatTimeDisplay(entry.punch_out) : '—'}</td>
                  <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">{formatHours(calcBreakMinutes(entry))}</td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold text-text-primary tabular-nums">{formatHours(calcWorkMinutes(entry))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-secondary">
                <td colSpan={4} className="px-4 py-3 text-[13px] font-bold text-text-primary">
                  {t.timesheets.dayTotal}
                </td>
                <td className="px-4 py-3 text-right text-[13px] font-bold text-primary tabular-nums">{formatHours(totalMinutes)}</td>
              </tr>
            </tfoot>
          </table>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {sortedDates.map((dateStr) => {
            const dayEntries = entriesByDate[dateStr];
            const dayDate = new Date(dateStr + 'T12:00:00');
            const dayTotal = dayEntries.reduce((acc, e) => acc + calcWorkMinutes(e), 0);
            const dayLabel = `${dayNames[dayDate.getDay()]}, ${monthNames[dayDate.getMonth()]} ${dayDate.getDate()}`;
            return (
              <div key={dateStr} className="section-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface-secondary border-b border-border">
                  <span className="text-[12px] font-bold text-text-primary">{dayLabel}</span>
                  <span className="text-[12px] font-bold text-primary tabular-nums">{formatHours(dayTotal)}</span>
                </div>
                <table className="w-full text-left">
                  <tbody>
                    {dayEntries.map((entry) => (
                      <tr key={entry.id} className="table-row-hover">
                        <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary w-1/4">{entry.employee_name}</td>
                        <td className="px-4 py-2.5 text-[13px] text-text-secondary tabular-nums">
                          <span className="inline-flex items-center gap-1"><LogIn size={11} className="text-text-secondary" /> {formatTimeDisplay(entry.punch_in)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-text-secondary tabular-nums">
                          <span className="inline-flex items-center gap-1"><LogOut size={11} className="text-text-secondary" /> {entry.punch_out ? formatTimeDisplay(entry.punch_out) : '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-text-secondary tabular-nums">
                          <span className="inline-flex items-center gap-1"><Coffee size={11} className="text-text-secondary" /> {formatHours(calcBreakMinutes(entry))}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[13px] font-semibold text-text-primary tabular-nums">{formatHours(calcWorkMinutes(entry))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <div className="section-card p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-text-primary">
                {viewMode === 'week'
                  ? (t.timesheets.weekTotal)
                  : (t.timesheets.monthTotal)}
              </span>
              <span className="text-lg font-bold text-primary tabular-nums">{formatHours(totalMinutes)}</span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );

  return (
    <PermissionGate
      permission="timesheets.view_all"
      fallback={
        <PermissionGate permission="timesheets.view_own">
          {timesheetsContent}
        </PermissionGate>
      }
    >
      {timesheetsContent}
    </PermissionGate>
  );
}
