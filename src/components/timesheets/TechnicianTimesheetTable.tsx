import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useCompany } from '../../contexts/CompanyContext';
import { useTranslation } from '../../i18n';
import { fetchTeamList } from '../../lib/invitationsApi';
import UnifiedAvatar from '../ui/UnifiedAvatar';
import { toast } from 'sonner';

// ── Types ───────────────────────────────────────────────────────────────────
type View = 'day' | 'week';
type TimeFormat = 'decimal' | 'hm';

interface RawEntry {
  id: string;
  employee_id: string;
  employee_name: string | null;
  date: string;                 // YYYY-MM-DD
  punch_in: string | null;      // HH:MM[:SS]
  punch_out: string | null;
  punch_in_at: string | null;   // ISO
  punch_out_at: string | null;  // ISO
  breaks: Array<{ start?: string; end?: string }>;
  notes: string | null;
  job_id: string | null;
  status: string | null;
}

interface Props {
  /** Reference date controlling the day / week window. */
  currentDate: Date;
  view: View;
  timeFormat: TimeFormat;
}

// ── Date helpers (local, date-only) ──────────────────────────────────────────
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday-start
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const n = new Date(monday);
    n.setDate(monday.getDate() + i);
    return n;
  });
}

// ── Duration helpers — everything in minutes, formatted on render ────────────
function parseHM(t: string | null): number {
  if (!t) return 0;
  if (t.includes('T')) { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); }
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Net worked minutes for one entry (gross minus closed breaks). Live if running. */
function entryMinutes(e: RawEntry): { minutes: number; running: boolean } {
  // Prefer precise ISO timestamps; fall back to HH:MM columns.
  const startMs = e.punch_in_at ? Date.parse(e.punch_in_at) : null;
  const running = !e.punch_out && !e.punch_out_at;
  let gross: number;
  if (startMs != null) {
    const endMs = e.punch_out_at ? Date.parse(e.punch_out_at) : (running ? Date.now() : startMs);
    gross = Math.max(0, (endMs - startMs) / 60000);
  } else {
    const now = new Date();
    const end = (e.punch_out) ? parseHM(e.punch_out) : (now.getHours() * 60 + now.getMinutes());
    gross = Math.max(0, end - parseHM(e.punch_in));
  }
  let brk = 0;
  for (const b of e.breaks || []) {
    if (!b?.start) continue;
    const bs = b.start.includes('T') ? Date.parse(b.start) / 60000 : parseHM(b.start);
    const be = b.end ? (b.end.includes('T') ? Date.parse(b.end) / 60000 : parseHM(b.end)) : null;
    if (be != null && be > bs) brk += be - bs;
  }
  return { minutes: Math.max(0, gross - brk), running };
}

function fmtDuration(minutes: number, format: TimeFormat): string {
  if (!minutes || minutes <= 0) return format === 'decimal' ? '0.00' : '0h 00m';
  if (format === 'decimal') return (minutes / 60).toFixed(2);
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function fmtClock(e: RawEntry, which: 'in' | 'out'): string {
  const iso = which === 'in' ? e.punch_in_at : e.punch_out_at;
  const hm = which === 'in' ? e.punch_in : e.punch_out;
  if (iso) return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (hm) { const [h, m] = hm.split(':'); const H = +h; const ap = H >= 12 ? 'PM' : 'AM'; const h12 = H % 12 || 12; return `${h12}:${m} ${ap}`; }
  return '—';
}

// ── Component ────────────────────────────────────────────────────────────────
export default function TechnicianTimesheetTable({ currentDate, view, timeFormat }: Props) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const tt = (t as any).timesheetTable || {};
  const { currentRole, userId } = useCompany();
  const isManager = currentRole === 'owner' || currentRole === 'admin';

  const [entries, setEntries] = useState<RawEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Record<string, string>>({});
  const [jobOptions, setJobOptions] = useState<Array<{ id: string; label: string }>>([]);
  // All technicians in the org, so they show even with zero hours. For a
  // non-manager this is just themselves.
  const [technicians, setTechnicians] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Live ticker so running timers update without a refetch.
  const [, setTick] = useState(0);

  const days = useMemo(() => (view === 'week' ? weekDates(currentDate) : [new Date(currentDate)]), [currentDate, view]);
  const rangeStart = useMemo(() => ymd(days[0]), [days]);
  const rangeEnd = useMemo(() => ymd(days[days.length - 1]), [days]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      let q = supabase
        .from('time_entries')
        .select('id, employee_id, employee_name, date, punch_in, punch_out, punch_in_at, punch_out_at, breaks, notes, job_id, status')
        .eq('org_id', orgId)
        .gte('date', rangeStart)
        .lte('date', rangeEnd);
      // Technicians (and any non-manager) only ever see their own rows.
      if (!isManager && userId) q = q.eq('employee_id', userId);

      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);

      const rows: RawEntry[] = (data || []).map((e: any) => ({
        id: e.id,
        employee_id: e.employee_id || e.id,
        employee_name: e.employee_name || null,
        date: e.date,
        punch_in: e.punch_in ?? null,
        punch_out: e.punch_out ?? null,
        punch_in_at: e.punch_in_at ?? null,
        punch_out_at: e.punch_out_at ?? null,
        breaks: Array.isArray(e.breaks) ? e.breaks : [],
        notes: e.notes || null,
        job_id: e.job_id || null,
        status: e.status || null,
      }));
      setEntries(rows);

      // Resolve technician names (profiles override stored employee_name).
      const ids = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))];
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        const map: Record<string, string> = {};
        for (const p of profs || []) map[p.id] = p.full_name || '';
        setNames(map);
      } else {
        setNames({});
      }

      // Resolve job/contract titles.
      const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))] as string[];
      if (jobIds.length) {
        const { data: jrows } = await supabase.from('jobs').select('id, title, job_number').in('id', jobIds);
        const jmap: Record<string, string> = {};
        for (const j of jrows || []) jmap[j.id] = j.title || (j.job_number ? `#${j.job_number}` : '');
        setJobs(jmap);
      } else {
        setJobs({});
      }
    } catch (err: any) {
      setError(err?.message || (fr ? 'Échec du chargement des feuilles de temps' : 'Failed to load timesheets'));
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, isManager, userId, fr]);

  useEffect(() => { void load(); }, [load]);

  // Job options for the assign-to-job picker (managers only).
  useEffect(() => {
    if (!isManager) { setJobOptions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        const { data } = await supabase
          .from('jobs')
          .select('id, job_number, title, client_name')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(200);
        if (cancelled) return;
        setJobOptions((data || []).map((j: any) => ({
          id: j.id,
          label: `${j.job_number ? `#${j.job_number} ` : ''}${j.title || j.client_name || ''}`.trim() || `#${String(j.id).slice(0, 6)}`,
        })));
      } catch { if (!cancelled) setJobOptions([]); }
    })();
    return () => { cancelled = true; };
  }, [isManager]);

  const assignJob = useCallback(async (entryId: string, jobId: string | null) => {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, job_id: jobId } : e)));
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      const { error: upErr } = await supabase.from('time_entries').update({ job_id: jobId }).eq('id', entryId).eq('org_id', orgId);
      if (upErr) throw upErr;
      toast.success(fr ? 'Job assigné' : 'Job assigned');
      void load();
    } catch (err: any) {
      toast.error(fr ? "Échec de l'assignation" : 'Failed to assign job');
      void load();
    }
  }, [fr, load]);

  // Load the technician roster once (managers: all techs; others: just self).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isManager) {
        if (!userId) { setTechnicians([]); return; }
        const { data: self } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
        if (!cancelled) setTechnicians([{ id: userId, name: self?.full_name || (fr ? 'Moi' : 'Me') }]);
        return;
      }
      try {
        const { members } = await fetchTeamList();
        if (cancelled) return;
        const techs = members
          .filter((m) => m.role === 'technician' && m.status !== 'suspended')
          .map((m) => ({ id: m.user_id, name: m.full_name || (fr ? 'Inconnu' : 'Unknown') }));
        setTechnicians(techs);
      } catch {
        // Roster is best-effort; the table still renders techs that have punches.
        if (!cancelled) setTechnicians([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, userId, fr]);

  // Realtime refresh + 30s ticker for live durations.
  useEffect(() => {
    let ch: any;
    (async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        ch = supabase
          .channel(`tech-ts-${orgId}-${rangeStart}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `org_id=eq.${orgId}` }, () => load())
          .subscribe();
      } catch { /* ignore */ }
    })();
    const iv = setInterval(() => setTick((n) => n + 1), 30000);
    return () => { if (ch) supabase.removeChannel(ch); clearInterval(iv); };
  }, [load, rangeStart]);

  const rosterNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of technicians) m[t.id] = t.name;
    return m;
  }, [technicians]);

  const nameFor = useCallback(
    (id: string, fallback: string | null) => names[id] || rosterNames[id] || fallback || (fr ? 'Inconnu' : 'Unknown'),
    [names, rosterNames, fr],
  );
  const jobLabel = useCallback(
    (jobId: string | null) => (jobId && jobs[jobId]) || (fr ? 'Aucun contrat' : 'No contract'),
    [jobs, fr],
  );

  // ── Aggregate into one row per technician ──
  interface TechAgg {
    techId: string;
    name: string;
    perDayMinutes: number[];      // aligned to `days`
    totalMinutes: number;
    running: boolean;
    entries: RawEntry[];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEMPORARY DEMO DATA — 4 imaginary technicians with fake punches.
  // Display-only (never written to the DB). Delete this whole block + the
  // `...DEMO_ENTRIES` spread below to remove them.
  // ───────────────────────────────────────────────────────────────────────────
  const DEMO_ENTRIES = useMemo<RawEntry[]>(() => {
    if (!isManager) return []; // only managers see the imaginary techs
    const demoTechs = [
      { id: 'demo-tech-1', name: 'Marc Tremblay' },
      { id: 'demo-tech-2', name: 'Sophie Gagnon' },
      { id: 'demo-tech-3', name: 'David Roy' },
      { id: 'demo-tech-4', name: 'Émilie Bouchard' },
    ];
    const rows: RawEntry[] = [];
    // Deterministic pseudo-random so totals stay stable across renders.
    const rand = (seed: number) => {
      const x = Math.sin(seed * 99.13) * 10000;
      return x - Math.floor(x);
    };
    days.forEach((d, di) => {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) return; // weekdays only
      demoTechs.forEach((tech, ti) => {
        const seed = di * 10 + ti;
        if (rand(seed) < 0.15) return; // occasional day off
        const startH = 7 + Math.floor(rand(seed + 1) * 2);          // 7–8h
        const lenH = 6 + Math.floor(rand(seed + 2) * 4);            // 6–9h
        const dateStr = ymd(d);
        const pin = `${String(startH).padStart(2, '0')}:00:00`;
        const poutH = startH + lenH;
        const pout = `${String(poutH).padStart(2, '0')}:00:00`;
        rows.push({
          id: `demo-${tech.id}-${dateStr}`,
          employee_id: tech.id,
          employee_name: tech.name,
          date: dateStr,
          punch_in: pin,
          punch_out: pout,
          punch_in_at: `${dateStr}T${pin}`,
          punch_out_at: `${dateStr}T${pout}`,
          breaks: [{ start: `${dateStr}T12:00:00`, end: `${dateStr}T12:30:00` }],
          notes: rand(seed + 3) < 0.4 ? (fr ? 'Contrat terminé à temps' : 'Job completed on time') : null,
          job_id: null,
          status: 'completed',
        });
      });
    });
    return rows;
  }, [days, fr, isManager]);
  // ─── END TEMPORARY DEMO DATA ───────────────────────────────────────────────

  const techRows: TechAgg[] = useMemo(() => {
    const byTech = new Map<string, RawEntry[]>();
    // Seed with every technician so they appear even with zero hours.
    for (const tech of technicians) {
      if (!byTech.has(tech.id)) byTech.set(tech.id, []);
    }
    for (const e of [...entries, ...DEMO_ENTRIES]) {
      const arr = byTech.get(e.employee_id) || [];
      arr.push(e);
      byTech.set(e.employee_id, arr);
    }
    const dayKeys = days.map(ymd);
    const aggs: TechAgg[] = [];
    for (const [techId, list] of byTech) {
      const perDay = dayKeys.map(() => 0);
      let total = 0;
      let running = false;
      for (const e of list) {
        const idx = dayKeys.indexOf(e.date);
        const { minutes, running: r } = entryMinutes(e);
        if (idx >= 0) perDay[idx] += minutes;
        total += minutes;
        if (r) running = true;
      }
      aggs.push({ techId, name: nameFor(techId, list[0]?.employee_name), perDayMinutes: perDay, totalMinutes: total, running, entries: list });
    }
    return aggs.sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, DEMO_ENTRIES, days, nameFor]);

  const dayColumnTotals = useMemo(() => {
    const totals = days.map(() => 0);
    for (const r of techRows) r.perDayMinutes.forEach((m, i) => { totals[i] += m; });
    return totals;
  }, [techRows, days]);
  const grandTotal = useMemo(() => techRows.reduce((s, r) => s + r.totalMinutes, 0), [techRows]);

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const dowLabels = fr
    ? ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
    : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  // ── States ──
  if (loading) {
    return (
      <div className="border border-outline rounded-xl bg-surface-card p-16 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="border border-outline rounded-xl bg-surface-card p-10 flex flex-col items-center text-center gap-2">
        <AlertTriangle className="h-7 w-7 text-amber-500" />
        <p className="text-[14px] font-semibold text-text-primary">{fr ? 'Erreur de chargement' : 'Failed to load'}</p>
        <p className="text-[13px] text-text-tertiary">{error}</p>
        <button onClick={() => load()} className="mt-2 h-8 px-4 rounded-md bg-surface border border-outline text-[13px] text-text-primary hover:bg-surface-secondary transition-colors">
          {fr ? 'Réessayer' : 'Retry'}
        </button>
      </div>
    );
  }
  if (techRows.length === 0) {
    return (
      <div className="border border-outline rounded-xl bg-surface-card p-16 flex flex-col items-center text-center gap-2">
        <Clock className="h-8 w-8 text-text-tertiary opacity-30" />
        <p className="text-[14px] font-medium text-text-primary">{tt.empty || (fr ? 'Aucun temps suivi pour cette période.' : 'No time tracked for this period.')}</p>
      </div>
    );
  }

  // ── Week view — one thin, wide card per technician ──
  if (view === 'week') {
    // Shared grid template aligns the header strip with every card.
    const gridStyle: React.CSSProperties = {
      gridTemplateColumns: `minmax(200px, 1.4fr) repeat(7, minmax(60px, 1fr)) 110px`,
    };
    return (
      <div className="space-y-2 overflow-x-auto">
        {/* Header strip */}
        <div className="grid items-center px-4 py-2 min-w-[820px]" style={gridStyle}>
          <span className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wide">{tt.technician || (fr ? 'Technicien' : 'Technician')}</span>
          {days.map((d, i) => (
            <span key={i} className="text-center text-[12px] font-semibold text-text-tertiary tabular-nums">{dowLabels[i]} {d.getDate()}</span>
          ))}
          <span className="text-right text-[12px] font-semibold text-text-tertiary uppercase tracking-wide">{tt.weekTotal || (fr ? 'Total sem.' : 'Week total')}</span>
        </div>

        {/* One card per technician */}
        {techRows.map((row) => {
          const open = expanded.has(row.techId);
          return (
            <div key={row.techId} className="border border-outline rounded-xl bg-surface-card shadow-card overflow-hidden min-w-[820px]">
              <div
                onClick={() => toggle(row.techId)}
                className={cn('grid items-center px-4 py-2.5 cursor-pointer transition-colors', open ? 'bg-surface-secondary/50' : 'hover:bg-surface-secondary/30')}
                style={gridStyle}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {open ? <ChevronDown size={15} className="text-text-tertiary shrink-0" /> : <ChevronRight size={15} className="text-text-tertiary shrink-0" />}
                  <UnifiedAvatar id={row.techId} name={row.name} size={28} />
                  <span className="text-[14px] font-medium text-text-primary truncate">{row.name}</span>
                  {row.running && <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 shrink-0">{tt.inProgress || (fr ? 'En cours' : 'In progress')}</span>}
                </div>
                {row.perDayMinutes.map((m, i) => (
                  <span key={i} className="text-center text-[13px] tabular-nums text-text-secondary">
                    {m > 0 ? fmtDuration(m, timeFormat) : <span className="text-text-tertiary">—</span>}
                  </span>
                ))}
                <span className="text-right text-[14px] font-semibold tabular-nums text-text-primary">{fmtDuration(row.totalMinutes, timeFormat)}</span>
              </div>
              {open && <WeekExpanded row={row} days={days} timeFormat={timeFormat} jobLabel={jobLabel} fr={fr} tt={tt} />}
            </div>
          );
        })}

        {/* Totals card */}
        <div className="grid items-center px-4 py-2.5 min-w-[820px] border-t-2 border-outline" style={gridStyle}>
          <span className="text-[13px] font-semibold text-text-primary">{tt.dailyTotals || (fr ? 'Totaux' : 'Totals')}</span>
          {dayColumnTotals.map((m, i) => (
            <span key={i} className="text-center text-[13px] font-semibold tabular-nums text-text-secondary">{m > 0 ? fmtDuration(m, timeFormat) : '—'}</span>
          ))}
          <span className="text-right text-[14px] font-bold tabular-nums text-text-primary">{fmtDuration(grandTotal, timeFormat)}</span>
        </div>
      </div>
    );
  }

  // ── Day view — one thin, wide card per technician ──
  return (
    <div className="space-y-2">
      {techRows.map((row) => {
        const open = expanded.has(row.techId);
        return (
          <div key={row.techId} className="border border-outline rounded-xl bg-surface-card shadow-card overflow-hidden">
            <div
              onClick={() => toggle(row.techId)}
              className={cn('flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors', open ? 'bg-surface-secondary/50' : 'hover:bg-surface-secondary/30')}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {open ? <ChevronDown size={15} className="text-text-tertiary shrink-0" /> : <ChevronRight size={15} className="text-text-tertiary shrink-0" />}
                <UnifiedAvatar id={row.techId} name={row.name} size={28} />
                <span className="text-[14px] font-medium text-text-primary truncate">{row.name}</span>
                {row.running && <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 shrink-0">{tt.inProgress || (fr ? 'En cours' : 'In progress')}</span>}
              </div>
              <span className="text-right text-[14px] font-semibold tabular-nums text-text-primary shrink-0">{fmtDuration(row.totalMinutes, timeFormat)}</span>
            </div>
            {open && <DayExpanded row={row} timeFormat={timeFormat} jobLabel={jobLabel} fr={fr} tt={tt} isManager={isManager} jobOptions={jobOptions} onAssignJob={assignJob} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Week expanded: jobs × days matrix ────────────────────────────────────────
function WeekExpanded({
  row, days, timeFormat, jobLabel, fr, tt,
}: {
  row: { entries: RawEntry[] };
  days: Date[];
  timeFormat: TimeFormat;
  jobLabel: (id: string | null) => string;
  fr: boolean;
  tt: any;
}) {
  const dayKeys = days.map(ymd);
  // Group by job_id → per-day minutes.
  const byJob = new Map<string, number[]>();
  for (const e of row.entries) {
    const key = e.job_id || '__none__';
    const arr = byJob.get(key) || dayKeys.map(() => 0);
    const idx = dayKeys.indexOf(e.date);
    if (idx >= 0) arr[idx] += entryMinutes(e).minutes;
    byJob.set(key, arr);
  }
  const jobEntries = [...byJob.entries()];
  const colTotals = dayKeys.map((_, i) => jobEntries.reduce((s, [, arr]) => s + arr[i], 0));
  const grand = colTotals.reduce((s, m) => s + m, 0);

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `minmax(180px, 1.4fr) repeat(${days.length}, minmax(48px, 1fr)) 90px`,
  };
  return (
    <div className="bg-surface-secondary/20 border-t border-outline/50 px-4 py-3 overflow-x-auto">
      <div className="min-w-[680px]">
        {/* header */}
        <div className="grid items-center py-1.5 border-b border-outline/50" style={gridStyle}>
          <span className="text-[12px] font-semibold text-text-secondary">{tt.jobContract || (fr ? 'Contrat / Job' : 'Job / Contract')}</span>
          {days.map((d, i) => (
            <span key={i} className="text-center text-[11px] font-medium text-text-tertiary tabular-nums">{d.getDate()}</span>
          ))}
          <span className="text-right text-[12px] font-semibold text-text-secondary">{tt.total || (fr ? 'Total' : 'Total')}</span>
        </div>
        {/* job rows */}
        {jobEntries.map(([jobId, arr]) => {
          const rowTotal = arr.reduce((s, m) => s + m, 0);
          return (
            <div key={jobId} className="grid items-center py-1.5 border-b border-outline/30" style={gridStyle}>
              <span className="text-[13px] text-text-primary truncate pr-2">{jobId === '__none__' ? (fr ? 'Aucun contrat' : 'No contract') : jobLabel(jobId)}</span>
              {arr.map((m, i) => (
                <span key={i} className="text-center text-[12px] tabular-nums text-text-secondary">{m > 0 ? fmtDuration(m, timeFormat) : <span className="text-text-tertiary">—</span>}</span>
              ))}
              <span className="text-right text-[13px] font-medium tabular-nums text-text-primary">{fmtDuration(rowTotal, timeFormat)}</span>
            </div>
          );
        })}
        {/* daily totals */}
        <div className="grid items-center py-1.5 border-t border-outline/50" style={gridStyle}>
          <span className="text-[12px] font-semibold text-text-secondary">{tt.dailyTotals || (fr ? 'Totaux quotidiens' : 'Daily totals')}</span>
          {colTotals.map((m, i) => (
            <span key={i} className="text-center text-[12px] font-semibold tabular-nums text-text-secondary">{m > 0 ? fmtDuration(m, timeFormat) : '—'}</span>
          ))}
          <span className="text-right text-[13px] font-bold tabular-nums text-text-primary">{fmtDuration(grand, timeFormat)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Day expanded: per-punch breakdown ────────────────────────────────────────
function DayExpanded({
  row, timeFormat, jobLabel, fr, tt, isManager, jobOptions, onAssignJob,
}: {
  row: { entries: RawEntry[] };
  timeFormat: TimeFormat;
  jobLabel: (id: string | null) => string;
  fr: boolean;
  tt: any;
  isManager: boolean;
  jobOptions: Array<{ id: string; label: string }>;
  onAssignJob: (entryId: string, jobId: string | null) => void;
}) {
  // Only the punches that actually fall on the shown day are in row.entries
  // already (day view loads a single date). Sort by start time.
  const sorted = [...row.entries].sort((a, b) => parseHM(a.punch_in) - parseHM(b.punch_in));
  if (sorted.length === 0) {
    return (
      <div className="bg-surface-secondary/20 border-t border-outline/50 px-4 py-4 text-[13px] text-text-tertiary">
        {tt.empty || (fr ? 'Aucun temps suivi pour cette période.' : 'No time tracked for this period.')}
      </div>
    );
  }
  return (
    <div className="bg-surface-secondary/20 border-t border-outline/50 px-4 py-3 overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[560px]">
        <thead>
          <tr className="border-b border-outline/50">
            <th className="px-3 py-2 text-[12px] font-semibold text-text-secondary">{tt.jobContract || (fr ? 'Contrat / Job' : 'Job / Contract')}</th>
            <th className="px-3 py-2 text-[12px] font-semibold text-text-secondary">{tt.notes || (fr ? 'Notes' : 'Notes')}</th>
            <th className="px-3 py-2 text-[12px] font-semibold text-text-secondary">{tt.start || (fr ? 'Début' : 'Start')}</th>
            <th className="px-3 py-2 text-[12px] font-semibold text-text-secondary">{tt.end || (fr ? 'Fin' : 'End')}</th>
            <th className="px-3 py-2 text-right text-[12px] font-semibold text-text-secondary">{tt.duration || (fr ? 'Durée' : 'Duration')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const { minutes, running } = entryMinutes(e);
            return (
              <tr key={e.id} className="border-b border-outline/30">
                <td className="px-3 py-2 text-[13px] text-text-primary">
                  {isManager && !e.id.startsWith('demo-') ? (
                    <select
                      value={e.job_id || ''}
                      onChange={(ev) => onAssignJob(e.id, ev.target.value || null)}
                      onClick={(ev) => ev.stopPropagation()}
                      className="max-w-[220px] bg-surface-card border border-outline rounded-md px-2 py-1 text-[12.5px] text-text-primary focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="">{fr ? 'Aucun job' : 'No job'}</option>
                      {e.job_id && !jobOptions.some((o) => o.id === e.job_id) && <option value={e.job_id}>{jobLabel(e.job_id)}</option>}
                      {jobOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  ) : jobLabel(e.job_id)}
                </td>
                <td className="px-3 py-2 text-[13px] text-text-secondary max-w-[280px] truncate">{e.notes ? e.notes : <span className="text-text-tertiary">—</span>}</td>
                <td className="px-3 py-2 text-[13px] tabular-nums text-text-secondary">{fmtClock(e, 'in')}</td>
                <td className="px-3 py-2 text-[13px] tabular-nums text-text-secondary">
                  {running ? <span className="text-emerald-600 font-medium">{tt.inProgress || (fr ? 'En cours' : 'In progress')}</span> : fmtClock(e, 'out')}
                </td>
                <td className="px-3 py-2 text-right text-[13px] font-medium tabular-nums text-text-primary">{fmtDuration(minutes, timeFormat)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
