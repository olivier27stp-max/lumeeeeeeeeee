/**
 * Onglet « Horaire » des Feuilles de temps — grille hebdomadaire équipes × jours.
 *
 * Les équipes sont des unités permanentes (nom, couleur, ordre) : chaque
 * cellule affiche QUI travaille dans cette équipe CETTE journée-là, résolu par
 * teamScheduleApi (congé approuvé > assignation du jour > horaire récurrent).
 *
 * Owner/admin éditent tout (ajout, heures, déplacement, congés, récurrences,
 * copies, sélection multiple); les autres rôles voient la grille en lecture
 * seule avec leurs propres plages mises en évidence.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, Check, Trash2, Clock, Users,
  AlertTriangle, RefreshCw, Copy, StickyNote, Loader2, Ban, CheckSquare, Pencil,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useCompany } from '../../contexts/CompanyContext';
import UnifiedAvatar from '../ui/UnifiedAvatar';
import TeamColorSwatches from '../TeamColorSwatches';
import { PRESET_GRADIENTS } from '../../lib/presetPalette';
import { createTeam, updateTeam, softDeleteTeam, type TeamRecord } from '../../lib/teamsApi';
import {
  fetchScheduleRange, resolveRange, resolveDay, cellKey, scheduledMinutes, hhmm, timeToMin,
  resolveTeamHours, setTeamHoursForDate, DEFAULT_TEAM_HOURS,
  createAssignment, updateAssignment, deleteAssignment,
  createRecurring, endRecurringFrom, splitRecurringFrom, updateRecurring,
  removeOccurrence, overrideOccurrence,
  createTimeOff, deleteTimeOff,
  copyEntries, scheduleErrorMessage,
  type ResolvedMemberDay, type ScheduleRangeData, type RecurringScheduleRecord,
  type TimeOffKind, type TeamDayHours,
} from '../../lib/teamScheduleApi';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export interface ScheduleMember {
  user_id: string;
  name: string;
  role: string;
}

interface Props {
  fr: boolean;
  teams: TeamRecord[];
  members: ScheduleMember[];
  canManage: boolean;
  currentUserId: string | null;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // lundi
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDaysStr(dateStr: string, n: number): string {
  return toDateStr(addDays(new Date(dateStr + 'T00:00:00'), n));
}
function fmtDay(dateStr: string, fr: boolean): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const KIND_LABELS: Record<TimeOffKind, { fr: string; en: string }> = {
  time_off:    { fr: 'Congé',         en: 'Time off' },
  vacation:    { fr: 'Vacances',      en: 'Vacation' },
  sick:        { fr: 'Maladie',       en: 'Sick' },
  absence:     { fr: 'Absence',       en: 'Absence' },
  unavailable: { fr: 'Indisponible',  en: 'Unavailable' },
  other:       { fr: 'Autre',         en: 'Other' },
};

type EditScope = 'one' | 'future' | 'all';

/** Palette partagée (même nuancier que les presets de devis). */
const TEAM_COLORS = PRESET_GRADIENTS.map(([primary]) => primary);

/** Nombre maximal de membres assignables à une même équipe pour une journée. */
const MAX_MEMBERS_PER_TEAM_DAY = 5;

interface AddModalState {
  cells: Array<{ teamId: string; date: string }>;
}
interface EditModalState {
  entry: ResolvedMemberDay;
  recurring: RecurringScheduleRecord | null;
}
interface TimeOffModalState {
  userId: string;
  date: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL SHELL (même pattern que Timesheets)
// ═══════════════════════════════════════════════════════════════════════════

function ModalShell({ onClose, width, children }: { onClose: () => void; width?: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className={cn('bg-surface-card border border-outline rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto', width || 'w-[420px]')}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  );
}

const labelCls = 'text-[12px] font-semibold text-text-tertiary uppercase tracking-wider';
const btnGhost = 'h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary transition-colors';
const btnPrimary = 'h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90 transition-all disabled:opacity-50';

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default function TeamScheduleGrid({ fr, teams, members, canManage, currentUserId }: Props) {
  const qc = useQueryClient();
  const { currentOrgId } = useCompany();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateStr(addDays(weekStart, i))), [weekStart]);
  const todayStr = toDateStr(new Date());

  // Filtres
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterMember, setFilterMember] = useState('all');
  const [timeOffOnly, setTimeOffOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Sélection multiple
  const [selecting, setSelecting] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());

  // Modals
  const [addModal, setAddModal] = useState<AddModalState | null>(null);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [timeOffModal, setTimeOffModal] = useState<TimeOffModalState | null>(null);
  const [hoursModal, setHoursModal] = useState<{ teamId: string; date: string; hours: TeamDayHours } | null>(null);
  const [teamModal, setTeamModal] = useState<{ editing: TeamRecord | null } | null>(null);
  const [copyMenuDate, setCopyMenuDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Données de la semaine ──
  const scheduleQuery = useQuery({
    queryKey: ['team-schedule', currentOrgId, dates[0]],
    queryFn: () => fetchScheduleRange(dates[0], dates[6]),
    enabled: !!currentOrgId,
  });
  const data = scheduleQuery.data;
  const missing = data?.missing === true;

  // Ordre d'affichage permanent (colonne ajoutée par la migration; repli
  // silencieux sur l'ordre alphabétique tant qu'elle n'existe pas).
  const orderQuery = useQuery({
    queryKey: ['team-display-order', currentOrgId],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from('teams').select('id,display_order');
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (rows || []) as Array<{ id: string; display_order: number | null }>) {
        map.set(r.id, r.display_order ?? 0);
      }
      return map;
    },
    enabled: !!currentOrgId,
    retry: false,
  });

  // Heures réellement travaillées de la semaine (comparaison prévu/travaillé).
  const workedQuery = useQuery({
    queryKey: ['team-schedule-worked', currentOrgId, dates[0]],
    queryFn: async () => {
      const orgId = await getCurrentOrgIdOrThrow();
      const { data: rows, error } = await supabase
        .from('time_entries')
        .select('employee_id,date,punch_in,punch_out,breaks')
        .eq('org_id', orgId)
        .gte('date', dates[0])
        .lte('date', dates[6]);
      if (error) throw error;
      const byUser = new Map<string, number>();
      for (const e of (rows || []) as Array<{ employee_id: string | null; punch_in: string | null; punch_out: string | null; breaks: unknown }>) {
        if (!e.employee_id || !e.punch_in || !e.punch_out) continue;
        let mins = timeToMin(e.punch_out) - timeToMin(e.punch_in);
        if (Array.isArray(e.breaks)) {
          for (const b of e.breaks as Array<{ start?: string; end?: string }>) {
            if (b?.start && b?.end) mins -= Math.max(0, parseClock(b.end) - parseClock(b.start));
          }
        }
        if (mins > 0) byUser.set(e.employee_id, (byUser.get(e.employee_id) || 0) + mins);
      }
      return byUser;
    },
    enabled: !!currentOrgId && !missing,
  });

  // Realtime : reflète les modifications des autres admins sans recharger.
  const realtimeReady = !!data && !data.missing;
  useEffect(() => {
    if (!currentOrgId || !realtimeReady) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['team-schedule'] });
    const ch = supabase.channel(`team-schedule-${currentOrgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_schedule_assignments', filter: `org_id=eq.${currentOrgId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_team_schedules', filter: `org_id=eq.${currentOrgId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_off_requests', filter: `org_id=eq.${currentOrgId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [currentOrgId, realtimeReady, qc]);

  // ── Résolution ──
  const resolved = useMemo(
    () => (data && !data.missing ? resolveRange(dates, data) : new Map<string, ResolvedMemberDay[]>()),
    [data, dates]
  );

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.user_id, m.name);
    return map;
  }, [members]);

  const visibleTeams = useMemo(() => {
    const order = orderQuery.data;
    return teams
      .filter((t) => (showArchived ? true : t.is_active !== false))
      .filter((t) => filterTeam === 'all' || t.id === filterTeam)
      .sort((a, b) => {
        const oa = order?.get(a.id) ?? 0;
        const ob = order?.get(b.id) ?? 0;
        return oa - ob || a.name.localeCompare(b.name);
      });
  }, [teams, showArchived, filterTeam, orderQuery.data]);

  const cellEntries = (teamId: string, date: string): ResolvedMemberDay[] => {
    let list = resolved.get(cellKey(teamId, date)) || [];
    if (filterMember !== 'all') list = list.filter((e) => e.user_id === filterMember);
    if (timeOffOnly) list = list.filter((e) => e.status === 'time_off' || !!e.pendingTimeOff);
    return list;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['team-schedule'] });
    qc.invalidateQueries({ queryKey: ['team-schedule-worked'] });
  };

  // ── Actions ──

  function toggleCell(teamId: string, date: string) {
    const key = cellKey(teamId, date);
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openAdd(teamId: string, date: string) {
    if (!canManage) return;
    setAddModal({ cells: [{ teamId, date }] });
  }

  function openAddForSelection() {
    const cells = Array.from(selectedCells).map((key) => {
      const [teamId, date] = key.split('|');
      return { teamId, date };
    });
    if (cells.length) setAddModal({ cells });
  }

  async function clearSelection() {
    const cells = Array.from(selectedCells);
    if (!cells.length) return;
    const confirmMsg = fr
      ? `Retirer toutes les assignations des ${cells.length} cellules sélectionnées ?`
      : `Remove all assignments from the ${cells.length} selected cells?`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    let removed = 0;
    try {
      for (const key of cells) {
        const [teamId, date] = key.split('|');
        for (const entry of resolved.get(cellKey(teamId, date)) || []) {
          if (entry.status === 'time_off') continue;
          try {
            if (entry.assignment_id) await deleteAssignment({ id: entry.assignment_id, team_id: entry.team_id, user_id: entry.user_id, work_date: entry.date });
            else if (entry.recurring_id) await removeOccurrence(entry);
            removed++;
          } catch { /* on continue */ }
        }
      }
      toast.success(fr ? `${removed} assignation(s) retirée(s)` : `${removed} assignment(s) removed`);
      setSelectedCells(new Set());
      setSelecting(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  // Les heures adoptées sont toujours celles de l'équipe pour la date cible.
  const targetHours = (teamId: string, targetDate: string) => {
    if (!data) return { ...DEFAULT_TEAM_HOURS };
    const h = resolveTeamHours(teamId, targetDate, data);
    return { start: h.start, end: h.end };
  };

  async function copyDayTo(fromDate: string, targets: string[]) {
    setBusy(true);
    try {
      const entries = dates.includes(fromDate) && data ? resolveDay(fromDate, data) : [];
      let created = 0, skipped = 0;
      for (const target of targets) {
        const res = await copyEntries(entries, () => target, targetHours);
        created += res.created; skipped += res.skipped;
      }
      toast.success(fr ? `${created} assignation(s) copiée(s)${skipped ? `, ${skipped} ignorée(s)` : ''}` : `${created} assignment(s) copied${skipped ? `, ${skipped} skipped` : ''}`);
      refresh();
    } finally {
      setBusy(false);
      setCopyMenuDate(null);
    }
  }

  async function copyPreviousWeek() {
    setBusy(true);
    try {
      const prevStart = addDaysStr(dates[0], -7);
      const prevEnd = addDaysStr(dates[6], -7);
      const prevData = await fetchScheduleRange(prevStart, prevEnd);
      if (prevData.missing) return;
      const prevDates = Array.from({ length: 7 }, (_, i) => addDaysStr(prevStart, i));
      const entries = prevDates.flatMap((d) => resolveDay(d, prevData));
      const res = await copyEntries(entries, (d) => addDaysStr(d, 7), targetHours);
      toast.success(fr ? `${res.created} assignation(s) copiée(s)${res.skipped ? `, ${res.skipped} ignorée(s)` : ''}` : `${res.created} assignment(s) copied${res.skipped ? `, ${res.skipped} skipped` : ''}`);
      refresh();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setBusy(false);
    }
  }

  // ── Résumé prévu vs travaillé ──
  const weekSummary = useMemo(() => {
    const scheduled = new Map<string, number>();
    for (const list of resolved.values()) {
      for (const e of list) {
        if (e.status === 'available' || e.status === 'partial') {
          scheduled.set(e.user_id, (scheduled.get(e.user_id) || 0) + scheduledMinutes([e]));
        }
      }
    }
    const worked = workedQuery.data || new Map<string, number>();
    const userIds = new Set([...scheduled.keys(), ...worked.keys()]);
    return Array.from(userIds)
      .map((id) => ({
        user_id: id,
        name: memberName.get(id) || (fr ? 'Membre inconnu' : 'Unknown member'),
        scheduled: scheduled.get(id) || 0,
        worked: worked.get(id) || 0,
      }))
      .filter((r) => r.scheduled > 0 || r.worked > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [resolved, workedQuery.data, memberName, fr]);

  const weekLabel = `${fmtDay(dates[0], fr)} — ${fmtDay(dates[6], fr)}`;
  const gridTemplate = { gridTemplateColumns: `200px repeat(7, minmax(150px, 1fr))`, minWidth: 200 + 7 * 150 };

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-5">
      {/* ── Migration manquante ── */}
      {missing && (
        <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#c2410c]" />
          <div>
            <p className="text-[13px] font-semibold text-[#c2410c]">{fr ? 'Migration requise' : 'Migration required'}</p>
            <p className="text-[12px] text-[#c2410c]/90 mt-0.5">
              {fr
                ? 'Applique la migration 20260749000000_team_daily_schedule.sql (éditeur SQL Supabase) pour activer l’horaire par membre.'
                : 'Apply migration 20260749000000_team_daily_schedule.sql (Supabase SQL editor) to enable the per-member schedule.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Barre d'outils ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-outline bg-surface px-3 py-[7px]">
            <Users size={14} className="text-text-tertiary" />
            <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className="bg-transparent text-[13px] font-medium text-text-primary focus:outline-none cursor-pointer">
              <option value="all">{fr ? 'Toutes les équipes' : 'All teams'}</option>
              {teams.filter((t) => showArchived || t.is_active !== false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md border border-outline bg-surface px-3 py-[7px]">
            <Clock size={14} className="text-text-tertiary" />
            <select value={filterMember} onChange={(e) => setFilterMember(e.target.value)} className="bg-transparent text-[13px] font-medium text-text-primary focus:outline-none cursor-pointer">
              <option value="all">{fr ? 'Tous les membres' : 'All members'}</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </div>
          <button onClick={() => setTimeOffOnly((v) => !v)}
            className={cn('h-[34px] px-3 rounded-md border text-[12px] font-medium transition-colors', timeOffOnly ? 'bg-text-primary text-white border-text-primary' : 'bg-surface-card border-outline text-text-secondary hover:bg-surface-secondary')}>
            {fr ? 'Congés seulement' : 'Time off only'}
          </button>
          <button onClick={() => setShowArchived((v) => !v)}
            className={cn('h-[34px] px-3 rounded-md border text-[12px] font-medium transition-colors', showArchived ? 'bg-text-primary text-white border-text-primary' : 'bg-surface-card border-outline text-text-secondary hover:bg-surface-secondary')}>
            {fr ? 'Inclure archivées' : 'Include archived'}
          </button>
          {!canManage && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-outline bg-surface-secondary px-3 py-[5px] text-[12px] font-medium text-text-tertiary">
              {fr ? 'Lecture seule' : 'Read only'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canManage && !missing && (
            <>
              <button onClick={copyPreviousWeek} disabled={busy} className={cn(btnGhost, 'inline-flex items-center gap-1.5 disabled:opacity-50')}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                {fr ? 'Copier la semaine précédente' : 'Copy previous week'}
              </button>
              <button
                onClick={() => { setSelecting((v) => !v); setSelectedCells(new Set()); }}
                className={cn('h-9 px-3 rounded-md border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors',
                  selecting ? 'bg-text-primary text-white border-text-primary' : 'bg-surface-card border-outline text-text-primary hover:bg-surface-secondary')}>
                <CheckSquare size={13} /> {fr ? 'Sélection multiple' : 'Multi-select'}
              </button>
            </>
          )}
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="h-9 w-9 flex items-center justify-center bg-surface-card border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronLeft size={16} /></button>
          <span className="text-[13px] font-semibold text-text-primary min-w-[210px] text-center tabular-nums">{weekLabel}</span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="h-9 w-9 flex items-center justify-center bg-surface-card border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronRight size={16} /></button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className={btnGhost}>{fr ? 'Cette semaine' : 'This week'}</button>
          <input
            type="date"
            value={dates[0]}
            onChange={(e) => { if (e.target.value) setWeekStart(startOfWeek(new Date(e.target.value + 'T00:00:00'))); }}
            className="h-9 px-2.5 bg-surface-card border border-outline rounded-md text-[13px] text-text-primary"
          />
        </div>
      </div>

      {/* ── Barre de sélection multiple ── */}
      <AnimatePresence>
        {selecting && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 px-5 py-3 rounded-xl bg-surface-card border border-border shadow-card flex-wrap">
            <span className="text-[13px] font-semibold text-text-primary">
              {selectedCells.size} {fr ? 'cellule(s) sélectionnée(s)' : 'cell(s) selected'}
            </span>
            <button onClick={openAddForSelection} disabled={!selectedCells.size} className={cn(btnGhost, 'h-8 px-3 text-[12px] disabled:opacity-40')}>
              <Plus size={12} className="inline mr-1" />{fr ? 'Ajouter un membre' : 'Add member'}
            </button>
            <button onClick={clearSelection} disabled={!selectedCells.size || busy} className={cn(btnGhost, 'h-8 px-3 text-[12px] text-red-600 disabled:opacity-40')}>
              <Trash2 size={12} className="inline mr-1" />{fr ? 'Vider les cellules' : 'Clear cells'}
            </button>
            <button onClick={() => { setSelecting(false); setSelectedCells(new Set()); }} className={cn(btnGhost, 'h-8 px-3 text-[12px] ml-auto')}>
              {fr ? 'Terminé' : 'Done'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Grille ── */}
      <div className="rounded-2xl bg-surface-card border border-border shadow-card overflow-hidden">
        <div className="overflow-auto max-h-[68vh]">
          <div style={gridTemplate} className="grid">
            {/* En-tête */}
            <div className="sticky top-0 left-0 z-40 bg-surface border-b border-r border-border px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{fr ? 'Équipe' : 'Team'}</span>
            </div>
            {dates.map((date) => (
              <div key={date} className={cn('sticky top-0 z-30 border-b border-border bg-surface px-3 py-2.5 text-center relative', date === todayStr && 'bg-surface-secondary')}>
                <div className="flex items-center justify-center gap-1.5">
                  <span className={cn('text-[12px] font-semibold capitalize', date === todayStr ? 'text-text-primary' : 'text-text-secondary')}>{fmtDay(date, fr)}</span>
                  {canManage && !missing && (
                    <button onClick={() => setCopyMenuDate(copyMenuDate === date ? null : date)}
                      className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors" title={fr ? 'Copier ce jour' : 'Copy this day'}>
                      <Copy size={11} />
                    </button>
                  )}
                </div>
                {copyMenuDate === date && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 w-[210px] rounded-lg border border-outline bg-surface-card shadow-2xl py-1 text-left">
                    <button onClick={() => copyDayTo(date, [addDaysStr(date, 1)])} className="w-full px-3 py-2 text-[12px] text-text-primary hover:bg-surface-secondary text-left">
                      {fr ? 'Copier vers demain' : 'Copy to next day'}
                    </button>
                    <button onClick={() => copyDayTo(date, dates.filter((d) => d !== date))} className="w-full px-3 py-2 text-[12px] text-text-primary hover:bg-surface-secondary text-left">
                      {fr ? 'Copier vers le reste de la semaine' : 'Copy to rest of week'}
                    </button>
                    <button onClick={() => setCopyMenuDate(null)} className="w-full px-3 py-2 text-[12px] text-text-tertiary hover:bg-surface-secondary text-left">
                      {fr ? 'Annuler' : 'Cancel'}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Corps */}
            {scheduleQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, ri) => (
                <React.Fragment key={ri}>
                  <div className="sticky left-0 z-20 bg-surface border-b border-r border-border/70 px-4 py-4">
                    <div className="h-4 w-24 rounded bg-surface-tertiary animate-pulse" />
                  </div>
                  {dates.map((d) => (
                    <div key={d} className="border-b border-l border-border/40 p-2 min-h-[96px]">
                      <div className="h-[60px] rounded-lg bg-surface-secondary animate-pulse" />
                    </div>
                  ))}
                </React.Fragment>
              ))
            ) : visibleTeams.length === 0 ? (
              <div className="col-span-8 py-16 text-center">
                <Users size={28} className="mx-auto text-text-tertiary opacity-20 mb-2" />
                <p className="text-[13px] font-medium text-text-primary">{fr ? 'Aucune équipe' : 'No teams'}</p>
                <p className="text-[12px] text-text-tertiary mt-0.5">
                  {canManage
                    ? (fr ? 'Créez votre première équipe avec le bouton ci-dessous' : 'Create your first team with the button below')
                    : (fr ? 'Aucune équipe n’a encore été créée' : 'No team has been created yet')}
                </p>
              </div>
            ) : (
              visibleTeams.map((team) => (
                <React.Fragment key={team.id}>
                  {/* Colonne équipe (sticky) — clic sur le crayon = édition
                      nom/couleur directement depuis la grille. */}
                  <div className="group/team sticky left-0 z-20 flex items-center gap-2.5 bg-surface border-b border-r border-border/70 px-4 py-3">
                    <span className="h-3.5 w-3.5 rounded-full shrink-0 ring-2 ring-white shadow-sm" style={{ backgroundColor: team.color_hex }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-text-primary truncate">{team.name}</p>
                      {team.is_active === false && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 font-medium">{fr ? 'Archivée' : 'Archived'}</span>
                      )}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setTeamModal({ editing: team })}
                        title={fr ? 'Modifier l’équipe' : 'Edit team'}
                        className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary opacity-0 group-hover/team:opacity-100 transition-opacity shrink-0"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                  {/* Cellules jour */}
                  {dates.map((date) => {
                    const entries = cellEntries(team.id, date);
                    const key = cellKey(team.id, date);
                    // Capacité calculée sur la liste NON filtrée : les filtres
                    // Membre / Congés ne doivent pas rouvrir une cellule pleine.
                    const cellCount = (resolved.get(key) || []).length;
                    const isSelected = selectedCells.has(key);
                    // Les heures appartiennent à l'ÉQUIPE pour la journée —
                    // affichées une fois en tête de cellule, jamais par membre.
                    const teamHours = data && !data.missing ? resolveTeamHours(team.id, date, data) : null;
                    return (
                      <div
                        key={key}
                        onClick={selecting ? () => toggleCell(team.id, date) : undefined}
                        className={cn(
                          'group border-b border-l border-border/40 p-1.5 min-h-[96px] flex flex-col gap-1 transition-colors',
                          date === todayStr && 'bg-surface-secondary/40',
                          selecting && 'cursor-pointer hover:bg-surface-secondary/70',
                          isSelected && 'ring-2 ring-inset ring-text-primary bg-surface-secondary'
                        )}
                      >
                        {teamHours && (
                          <button
                            type="button"
                            disabled={!canManage || selecting}
                            onClick={canManage && !selecting ? (e) => { e.stopPropagation(); setHoursModal({ teamId: team.id, date, hours: teamHours }); } : undefined}
                            title={fr ? 'Heures de toute l’équipe pour cette journée' : 'Whole-team hours for this day'}
                            className={cn(
                              'flex items-center gap-1 self-start rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums transition-colors',
                              teamHours.blocked ? 'text-red-600' : 'text-text-tertiary',
                              canManage && !selecting ? 'hover:bg-surface-secondary hover:text-text-primary cursor-pointer' : 'cursor-default'
                            )}
                          >
                            <Clock size={9} className="shrink-0" />
                            {teamHours.start}–{teamHours.end}
                            {teamHours.blocked && <span className="ml-0.5">· {fr ? 'Fermé' : 'Closed'}</span>}
                          </button>
                        )}
                        {entries.map((entry) => {
                          const name = memberName.get(entry.user_id) || '?';
                          const isMe = entry.user_id === currentUserId;
                          const rec = entry.recurring_id ? data?.recurrings.find((r) => r.id === entry.recurring_id) || null : null;
                          const clickable = canManage && !selecting;
                          return (
                            <button
                              key={`${entry.user_id}-${entry.start_time}-${entry.assignment_id || entry.recurring_id}`}
                              type="button"
                              disabled={!clickable}
                              onClick={clickable ? (e) => { e.stopPropagation(); setEditModal({ entry, recurring: rec }); } : undefined}
                              className={cn(
                                'w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
                                entry.status === 'time_off' && 'border-red-200 bg-red-50',
                                entry.status === 'unavailable' && 'border-outline bg-surface-secondary opacity-70',
                                entry.status === 'partial' && 'border-orange-200 bg-orange-50',
                                entry.status === 'available' && 'border-outline bg-surface hover:bg-surface-secondary',
                                clickable ? 'cursor-pointer' : 'cursor-default',
                                isMe && 'ring-1 ring-text-primary/40'
                              )}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <UnifiedAvatar id={entry.user_id} name={name} size={18} />
                                <span className="text-[11.5px] font-semibold text-text-primary truncate">{name}</span>
                                {entry.source === 'recurring' && <RefreshCw size={9} className="shrink-0 text-text-tertiary" />}
                                {entry.note && <StickyNote size={9} className="shrink-0 text-text-tertiary" />}
                                {entry.pendingTimeOff && (
                                  <span title={fr ? 'Demande de congé en attente' : 'Pending time-off request'} className="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
                                )}
                              </div>
                              {/* Pas d'heures par membre : les heures sont celles de
                                  l'équipe (tête de cellule). On n'affiche un détail
                                  que pour congé / indispo / présence partielle. */}
                              {entry.status !== 'available' && (
                                <div className="mt-0.5 pl-[24px]">
                                  {entry.status === 'time_off' ? (
                                    <span className="text-[10.5px] font-semibold text-red-600">
                                      {KIND_LABELS[entry.timeOff?.kind || 'time_off'][fr ? 'fr' : 'en']}
                                    </span>
                                  ) : entry.status === 'unavailable' ? (
                                    <span className="text-[10.5px] font-medium text-text-tertiary inline-flex items-center gap-1"><Ban size={9} /> {fr ? 'Indisponible' : 'Unavailable'}</span>
                                  ) : (
                                    <span className="text-[10.5px] tabular-nums font-medium text-[#c2410c]">
                                      {entry.start_time} – {entry.end_time} ({fr ? 'partiel' : 'partial'})
                                    </span>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                        {/* État vide / ajout — bouton TOUJOURS visible tant que
                            l'équipe-journée n'est pas complète (max 5 membres).
                            (Avant : visible seulement au survol dès qu'un membre
                            existait, ce qui donnait l'impression d'une limite.) */}
                        {canManage && !selecting && !missing ? (
                          cellCount < MAX_MEMBERS_PER_TEAM_DAY ? (
                            <button
                              type="button"
                              onClick={() => openAdd(team.id, date)}
                              className={cn(
                                'w-full rounded-lg border border-dashed border-outline text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all flex items-center justify-center gap-1 text-[11px] font-medium py-1.5',
                                entries.length === 0 && 'flex-1 min-h-[52px]'
                              )}
                            >
                              <Plus size={11} /> {entries.length === 0 ? (fr ? 'Assigner' : 'Assign') : (fr ? 'Ajouter' : 'Add')}
                            </button>
                          ) : (
                            <span className="w-full py-1 text-center text-[10px] font-medium text-text-tertiary/70">
                              {fr ? 'Complet (5 max)' : 'Full (max 5)'}
                            </span>
                          )
                        ) : entries.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-[11px] text-text-tertiary/60">—</div>
                        ) : null}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))
            )}
            {/* Rangée d'ajout d'équipe — création directement dans la grille. */}
            {canManage && !scheduleQuery.isLoading && (
              <div style={{ gridColumn: '1 / -1' }} className="p-2">
                <button
                  type="button"
                  onClick={() => setTeamModal({ editing: null })}
                  className="sticky left-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-outline px-3.5 py-2 text-[12px] font-medium text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                >
                  <Plus size={12} /> {fr ? 'Nouvelle équipe' : 'New team'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Prévu vs travaillé ── */}
      {!missing && weekSummary.length > 0 && (
        <div className="rounded-2xl bg-surface-card border border-border shadow-card">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
              <Clock size={14} className="text-text-tertiary" /> {fr ? 'Prévu vs travaillé — cette semaine' : 'Scheduled vs worked — this week'}
            </h3>
            <p className="text-[12px] text-text-tertiary mt-0.5">
              {fr ? 'L’horaire reste prévisionnel : seules les feuilles de temps font foi pour la paie.' : 'The schedule is a plan: timesheets remain the source of truth for payroll.'}
            </p>
          </div>
          <div className="px-5 pb-5 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-text-tertiary border-b border-border">
                  <th className="py-2 pr-4 font-semibold">{fr ? 'Membre' : 'Member'}</th>
                  <th className="py-2 pr-4 font-semibold">{fr ? 'Heures prévues' : 'Scheduled hours'}</th>
                  <th className="py-2 pr-4 font-semibold">{fr ? 'Heures travaillées' : 'Worked hours'}</th>
                  <th className="py-2 font-semibold">{fr ? 'Écart' : 'Difference'}</th>
                </tr>
              </thead>
              <tbody>
                {weekSummary.map((row) => {
                  const diff = row.worked - row.scheduled;
                  return (
                    <tr key={row.user_id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <span className="inline-flex items-center gap-2">
                          <UnifiedAvatar id={row.user_id} name={row.name} size={22} />
                          <span className="font-medium text-text-primary">{row.name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-text-secondary">{fmtMin(row.scheduled)}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-text-secondary">{fmtMin(row.worked)}</td>
                      <td className={cn('py-2.5 tabular-nums font-medium', diff < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {diff >= 0 ? '+' : '−'}{fmtMin(Math.abs(diff))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      <AnimatePresence>
        {addModal && data && (
          <AddMemberModal
            key="add"
            fr={fr}
            cells={addModal.cells}
            teams={teams}
            members={members}
            data={data}
            onClose={() => setAddModal(null)}
            onSaved={() => { setAddModal(null); setSelectedCells(new Set()); setSelecting(false); refresh(); }}
          />
        )}
        {editModal && (
          <EditEntryModal
            key="edit"
            fr={fr}
            state={editModal}
            teams={teams}
            memberName={memberName.get(editModal.entry.user_id) || '?'}
            data={data || null}
            onClose={() => setEditModal(null)}
            onSaved={() => { setEditModal(null); refresh(); }}
            onTimeOff={() => { setTimeOffModal({ userId: editModal.entry.user_id, date: editModal.entry.date }); setEditModal(null); }}
          />
        )}
        {timeOffModal && (
          <TimeOffModal
            key="timeoff"
            fr={fr}
            initial={timeOffModal}
            members={members}
            resolved={resolved}
            onClose={() => setTimeOffModal(null)}
            onSaved={() => { setTimeOffModal(null); refresh(); }}
          />
        )}
        {hoursModal && (
          <TeamHoursModal
            key="hours"
            fr={fr}
            state={hoursModal}
            teams={teams}
            onClose={() => setHoursModal(null)}
            onSaved={() => { setHoursModal(null); refresh(); }}
          />
        )}
        {teamModal && (
          <TeamEditModal
            key="team"
            fr={fr}
            editing={teamModal.editing}
            onClose={() => setTeamModal(null)}
            onSaved={() => { setTeamModal(null); qc.invalidateQueries({ queryKey: ['teams'] }); refresh(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL — Créer / modifier une équipe (nom, couleur, statut) depuis la grille
// ═══════════════════════════════════════════════════════════════════════════

function TeamEditModal({ fr, editing, onClose, onSaved }: {
  fr: boolean;
  editing: TeamRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name || '');
  const [color, setColor] = useState(editing?.color_hex || TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)]);
  const [description, setDescription] = useState(editing?.description || '');
  const [isActive, setIsActive] = useState(editing ? editing.is_active !== false : true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error(fr ? 'Le nom de l’équipe est requis.' : 'Team name is required.'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateTeam(editing.id, { name, color_hex: color, description, is_active: isActive });
        toast.success(fr ? 'Équipe mise à jour' : 'Team updated');
      } else {
        await createTeam({ name, color_hex: color, description });
        toast.success(fr ? 'Équipe créée' : 'Team created');
      }
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    try {
      await softDeleteTeam(editing.id);
      toast.success(fr ? 'Équipe supprimée' : 'Team deleted');
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} width="w-[420px]">
      <div className="p-6">
        <div className="flex items-start justify-between mb-5">
          <h3 className="text-[16px] font-bold text-text-primary">
            {editing ? (fr ? 'Modifier l’équipe' : 'Edit team') : (fr ? 'Nouvelle équipe' : 'New team')}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary"><X size={15} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{fr ? 'Nom' : 'Name'}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="glass-input w-full mt-1.5"
              placeholder={fr ? 'Ex. : Équipe Installation' : 'e.g. Installation Team'} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="glass-input w-full mt-1.5"
              placeholder={fr ? 'Optionnel...' : 'Optional...'} />
          </div>
          <div>
            <label className={labelCls}>{fr ? 'Couleur' : 'Color'}</label>
            <div className="mt-2"><TeamColorSwatches value={color} onChange={setColor} /></div>
          </div>
          {editing && (
            <div className="flex items-center gap-2">
              <label className={labelCls}>{fr ? 'Statut' : 'Status'}</label>
              <button type="button" onClick={() => setIsActive((v) => !v)}
                className={cn('text-[12px] px-2.5 py-1 rounded-full font-medium border transition-colors',
                  isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface-secondary text-text-tertiary border-outline')}>
                {isActive ? (fr ? 'Active' : 'Active') : (fr ? 'Archivée' : 'Archived')}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-6 flex-wrap">
          {editing ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-red-600">{fr ? 'Supprimer ?' : 'Delete?'}</span>
                <button onClick={remove} disabled={saving} className={cn(btnGhost, 'h-8 px-3 text-[12px] text-red-600')}>
                  {fr ? 'Oui, supprimer' : 'Yes, delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className={cn(btnGhost, 'h-8 px-3 text-[12px]')}>{fr ? 'Non' : 'No'}</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={saving} className={cn(btnGhost, 'h-8 px-3 text-[12px] text-red-600')}>
                <Trash2 size={12} className="inline mr-1" /> {fr ? 'Supprimer' : 'Delete'}
              </button>
            )
          ) : <span />}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className={btnGhost}>{fr ? 'Annuler' : 'Cancel'}</button>
            <button onClick={save} disabled={saving || !name.trim()} className={btnPrimary}>
              {saving ? <Loader2 size={14} className="animate-spin inline" /> : editing ? (fr ? 'Sauvegarder' : 'Save') : (fr ? 'Créer' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL — Heures de l'équipe pour une journée (s'applique à tous les membres)
// ═══════════════════════════════════════════════════════════════════════════

function TeamHoursModal({ fr, state, teams, onClose, onSaved }: {
  fr: boolean;
  state: { teamId: string; date: string; hours: TeamDayHours };
  teams: TeamRecord[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const team = teams.find((t) => t.id === state.teamId);
  const [start, setStart] = useState(state.hours.start);
  const [end, setEnd] = useState(state.hours.end);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (timeToMin(end) <= timeToMin(start)) {
      toast.error(fr ? "L'heure de fin doit être après l'heure de début." : 'End time must be after start time.');
      return;
    }
    setSaving(true);
    try {
      await setTeamHoursForDate(state.teamId, state.date, start, end);
      toast.success(fr ? 'Heures de l’équipe mises à jour' : 'Team hours updated');
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} width="w-[380px]">
      <div className="p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-[16px] font-bold text-text-primary">{fr ? 'Heures de l’équipe' : 'Team hours'}</h3>
            <p className="text-[12px] text-text-tertiary mt-0.5">
              {team && <span className="inline-flex items-center gap-1.5 mr-1"><span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: team.color_hex }} />{team.name}</span>}
              · {fmtDay(state.date, fr)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary"><X size={15} /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{fr ? 'Début' : 'Start'}</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="glass-input w-full mt-1.5" />
            </div>
            <div>
              <label className={labelCls}>{fr ? 'Fin' : 'End'}</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="glass-input w-full mt-1.5" />
            </div>
          </div>
          <p className="text-[12px] text-text-tertiary">
            {fr
              ? 'S’applique à TOUTE l’équipe pour cette journée : tous les membres présents suivent ces heures. (Écrit un override de date dans Disponibilités.)'
              : 'Applies to the WHOLE team for this day: every member present follows these hours. (Writes a date override in Availability.)'}
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className={btnGhost}>{fr ? 'Annuler' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className={btnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin inline" /> : (fr ? 'Sauvegarder' : 'Save')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// Parse « HH:MM » ou timestamp ISO → minutes locales (pauses des feuilles).
function parseClock(t: string): number {
  if (t.includes('T')) {
    const d = new Date(t);
    return d.getHours() * 60 + d.getMinutes();
  }
  return timeToMin(t);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL — Ajouter un membre (une ou plusieurs cellules)
// ═══════════════════════════════════════════════════════════════════════════

function AddMemberModal({ fr, cells, teams, members, data, onClose, onSaved }: {
  fr: boolean;
  cells: Array<{ teamId: string; date: string }>;
  teams: TeamRecord[];
  members: ScheduleMember[];
  data: ScheduleRangeData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const single = cells.length === 1;
  const first = cells[0];
  const team = teams.find((t) => t.id === first.teamId);
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>(() => [new Date(first.date + 'T00:00:00').getDay()]);
  const [repeatEnd, setRepeatEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const dayNames = fr ? ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Les heures viennent de l'ÉQUIPE pour la journée — jamais saisies ici.
  const cellHours = (cell: { teamId: string; date: string }) => {
    const h = resolveTeamHours(cell.teamId, cell.date, data);
    return { start: h.start, end: h.end };
  };
  const firstHours = cellHours(first);

  // Heures hebdo de l'équipe par jour (pour une récurrence).
  const weeklyHoursByDay = useMemo(() => {
    const map: Record<number, { start: string; end: string }> = {};
    for (let d = 0; d < 7; d++) {
      const weekly = data.teamWeekly.filter((w) => w.team_id === first.teamId && w.weekday === d);
      map[d] = weekly.length
        ? {
            start: `${String(Math.floor(Math.min(...weekly.map((w) => w.start_minute)) / 60)).padStart(2, '0')}:${String(Math.min(...weekly.map((w) => w.start_minute)) % 60).padStart(2, '0')}`,
            end: `${String(Math.floor(Math.max(...weekly.map((w) => w.end_minute)) / 60)).padStart(2, '0')}:${String(Math.max(...weekly.map((w) => w.end_minute)) % 60).padStart(2, '0')}`,
          }
        : { ...DEFAULT_TEAM_HOURS };
    }
    return map;
  }, [data.teamWeekly, first.teamId]);

  // Membres déjà assignés à cette équipe-journée (mode 1 cellule) — inutile
  // de les proposer une deuxième fois dans le menu.
  const takenIds = useMemo(() => {
    if (!single) return new Set<string>();
    return new Set(resolveDay(first.date, data).filter((e) => e.team_id === first.teamId).map((e) => e.user_id));
  }, [single, first.date, first.teamId, data]);

  const cellFull = (cell: { teamId: string; date: string }) =>
    resolveDay(cell.date, data).filter((e) => e.team_id === cell.teamId).length >= MAX_MEMBERS_PER_TEAM_DAY;

  // Avertissements de conflit (calculés sur les données déjà chargées).
  const warnings = useMemo(() => {
    if (!userId) return [];
    const list: string[] = [];
    for (const cell of cells) {
      if (cellFull(cell)) {
        list.push(fr
          ? `${fmtDay(cell.date, fr)} : équipe déjà complète (${MAX_MEMBERS_PER_TEAM_DAY} membres max) — cette cellule sera ignorée.`
          : `${fmtDay(cell.date, fr)}: team already full (max ${MAX_MEMBERS_PER_TEAM_DAY} members) — this cell will be skipped.`);
      }
      const hours = cellHours(cell);
      const s = timeToMin(hours.start);
      const e = timeToMin(hours.end);
      const others = resolveDay(cell.date, data).filter((en) => en.user_id === userId);
      for (const other of others) {
        if (other.status === 'time_off') {
          list.push(fr ? `${fmtDay(cell.date, fr)} : ce membre est en congé.` : `${fmtDay(cell.date, fr)}: this member is on time off.`);
        } else if (other.team_id !== cell.teamId && timeToMin(other.start_time) < e && timeToMin(other.end_time) > s) {
          list.push(fr
            ? `${fmtDay(cell.date, fr)} : déjà assigné à une autre équipe dont les heures chevauchent (${other.start_time}–${other.end_time}).`
            : `${fmtDay(cell.date, fr)}: already assigned to another team with overlapping hours (${other.start_time}–${other.end_time}).`);
        }
      }
    }
    return [...new Set(list)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, cells, data, fr]);

  async function save() {
    if (!userId) { toast.error(fr ? 'Choisis un membre.' : 'Pick a member.'); return; }
    if (cells.every(cellFull)) {
      toast.error(fr
        ? `Équipe déjà complète (${MAX_MEMBERS_PER_TEAM_DAY} membres max par journée).`
        : `Team already full (max ${MAX_MEMBERS_PER_TEAM_DAY} members per day).`);
      return;
    }
    setSaving(true);
    try {
      if (repeat && single) {
        if (!repeatDays.length) { toast.error(fr ? 'Choisis au moins un jour.' : 'Pick at least one day.'); setSaving(false); return; }
        await createRecurring({
          team_id: first.teamId,
          user_id: userId,
          days: repeatDays,
          hoursByDay: weeklyHoursByDay,
          effective_start_date: first.date,
          effective_end_date: repeatEnd || null,
        });
        toast.success(fr ? 'Horaire récurrent créé' : 'Recurring schedule created');
      } else {
        let created = 0, skipped = 0, full = 0;
        for (const cell of cells) {
          if (cellFull(cell)) { full++; continue; }
          const hours = cellHours(cell);
          try {
            await createAssignment({ team_id: cell.teamId, user_id: userId, work_date: cell.date, start_time: hours.start, end_time: hours.end, note });
            created++;
          } catch (e) {
            skipped++;
            if (single) throw e;
          }
        }
        toast.success(
          single
            ? (fr ? 'Membre assigné' : 'Member assigned')
            : (fr
                ? `${created} assignation(s) créée(s)${skipped ? `, ${skipped} en conflit` : ''}${full ? `, ${full} équipe(s) complète(s)` : ''}`
                : `${created} assignment(s) created${skipped ? `, ${skipped} conflicted` : ''}${full ? `, ${full} team(s) full` : ''}`)
        );
      }
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} width="w-[440px]">
      <div className="p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-[16px] font-bold text-text-primary">{fr ? 'Assigner un membre' : 'Assign a member'}</h3>
            <p className="text-[12px] text-text-tertiary mt-0.5">
              {single
                ? <>{team && <span className="inline-flex items-center gap-1.5 mr-1"><span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: team.color_hex }} />{team.name}</span>}· {fmtDay(first.date, fr)}</>
                : (fr ? `${cells.length} cellules sélectionnées` : `${cells.length} selected cells`)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary"><X size={15} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>{fr ? 'Membre' : 'Member'}</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="glass-input w-full mt-1.5">
              <option value="">{fr ? '— Choisir —' : '— Pick —'}</option>
              {members.filter((m) => !takenIds.has(m.user_id)).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
            {single && takenIds.size > 0 && (
              <p className="mt-1 text-[11px] text-text-tertiary">
                {fr
                  ? `${takenIds.size}/${MAX_MEMBERS_PER_TEAM_DAY} membre(s) déjà assigné(s) à cette équipe ce jour-là.`
                  : `${takenIds.size}/${MAX_MEMBERS_PER_TEAM_DAY} member(s) already assigned to this team that day.`}
              </p>
            )}
          </div>
          {/* Heures : celles de l'équipe pour la journée — pas de saisie par membre. */}
          <div className="rounded-lg border border-outline bg-surface-secondary/40 px-3.5 py-2.5 flex items-center gap-2">
            <Clock size={13} className="text-text-tertiary shrink-0" />
            <p className="text-[12px] text-text-secondary">
              {single
                ? <>{fr ? 'Heures de l’équipe ce jour-là :' : 'Team hours that day:'} <span className="font-semibold tabular-nums text-text-primary">{firstHours.start}–{firstHours.end}</span></>
                : (fr ? 'Chaque cellule adopte les heures de son équipe pour la journée.' : 'Each cell adopts its team’s hours for the day.')}
            </p>
          </div>
          <div>
            <label className={labelCls}>{fr ? 'Note (optionnel)' : 'Note (optional)'}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={fr ? 'Ex. : remplace Samuel' : 'E.g.: covering for Samuel'} className="glass-input w-full mt-1.5" />
          </div>

          {single && (
            <div className="rounded-lg border border-outline bg-surface-secondary/40 p-3.5 space-y-3">
              <label className="flex items-center gap-2 text-[13px] text-text-primary font-medium cursor-pointer select-none">
                <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4 rounded" />
                <RefreshCw size={12} className="text-text-tertiary" /> {fr ? 'Répéter chaque semaine' : 'Repeat every week'}
              </label>
              {repeat && (
                <>
                  <div className="flex gap-1.5 flex-wrap">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <button key={d} type="button"
                        onClick={() => setRepeatDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])}
                        className={cn('h-8 w-11 rounded-md border text-[11px] font-semibold transition-colors',
                          repeatDays.includes(d) ? 'bg-text-primary text-white border-text-primary' : 'bg-surface-card border-outline text-text-secondary hover:bg-surface-secondary')}>
                        {dayNames[d]}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{fr ? 'À partir du' : 'Starting'}</label>
                      <p className="text-[13px] text-text-primary mt-1.5 tabular-nums">{first.date}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{fr ? 'Fin (optionnel)' : 'End (optional)'}</label>
                      <input type="date" value={repeatEnd} min={first.date} onChange={(e) => setRepeatEnd(e.target.value)} className="glass-input w-full mt-1.5" />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3.5 py-2.5 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="text-[12px] text-[#c2410c] flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</p>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className={btnGhost}>{fr ? 'Annuler' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className={btnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin inline" /> : (fr ? 'Assigner' : 'Assign')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL — Modifier une entrée (heures, équipe, statut, retrait, portée)
// ═══════════════════════════════════════════════════════════════════════════

function EditEntryModal({ fr, state, teams, memberName, data, onClose, onSaved, onTimeOff }: {
  fr: boolean;
  state: EditModalState;
  teams: TeamRecord[];
  memberName: string;
  data: ScheduleRangeData | null;
  onClose: () => void;
  onSaved: () => void;
  onTimeOff: () => void;
}) {
  const { entry, recurring } = state;
  const isRecurring = entry.source === 'recurring' && !!recurring;
  const isTimeOff = entry.status === 'time_off';
  const [teamId, setTeamId] = useState(entry.team_id);
  const [note, setNote] = useState(entry.note || '');
  const [unavailable, setUnavailable] = useState(entry.status === 'unavailable');
  const [scope, setScope] = useState<EditScope>('one');
  const [saving, setSaving] = useState(false);

  // Heures = celles de l'équipe SÉLECTIONNÉE pour la journée (jamais saisies
  // par membre). Déplacer quelqu'un vers une autre équipe = adopter les heures
  // de cette équipe-là.
  const dayHours = useMemo(() => {
    if (!data) return { ...DEFAULT_TEAM_HOURS };
    const h = resolveTeamHours(teamId, entry.date, data);
    return { start: h.start, end: h.end };
  }, [teamId, entry.date, data]);

  // Pour une série (future/all) : heures hebdo de l'équipe cible pour le jour
  // de semaine de la récurrence.
  const recurringHours = useMemo(() => {
    if (!recurring) return { ...DEFAULT_TEAM_HOURS };
    const weekly = (data?.teamWeekly || []).filter((w) => w.team_id === teamId && w.weekday === recurring.day_of_week);
    if (!weekly.length) return { ...DEFAULT_TEAM_HOURS };
    const toHH = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { start: toHH(Math.min(...weekly.map((w) => w.start_minute))), end: toHH(Math.max(...weekly.map((w) => w.end_minute))) };
  }, [recurring, teamId, data]);

  async function save() {
    setSaving(true);
    try {
      const status = unavailable ? 'unavailable' as const : 'available' as const;
      if (isRecurring && recurring) {
        if (scope === 'one') {
          await overrideOccurrence(entry, { team_id: teamId, start_time: dayHours.start, end_time: dayHours.end, note: note || null, availability_status: status });
        } else if (scope === 'future') {
          await splitRecurringFrom(recurring, entry.date, { team_id: teamId, start_time: recurringHours.start, end_time: recurringHours.end });
        } else {
          await updateRecurring(recurring, { team_id: teamId, start_time: recurringHours.start, end_time: recurringHours.end });
        }
      } else if (entry.assignment_id) {
        await updateAssignment(
          entry.assignment_id,
          { team_id: teamId, start_time: dayHours.start, end_time: dayHours.end, note: note || null, availability_status: status },
          { team_id: entry.team_id, start_time: entry.start_time, end_time: entry.end_time, note: entry.note, user_id: entry.user_id, work_date: entry.date }
        );
      }
      toast.success(fr ? 'Horaire mis à jour' : 'Schedule updated');
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      if (isRecurring && recurring) {
        if (scope === 'one') await removeOccurrence(entry);
        else if (scope === 'future') await endRecurringFrom(recurring, entry.date);
        else await updateRecurring(recurring, { is_active: false });
      } else if (entry.assignment_id) {
        await deleteAssignment({ id: entry.assignment_id, team_id: entry.team_id, user_id: entry.user_id, work_date: entry.date });
      }
      toast.success(fr ? 'Assignation retirée' : 'Assignment removed');
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  async function removeTimeOffRec() {
    if (!entry.timeOff) return;
    setSaving(true);
    try {
      await deleteTimeOff(entry.timeOff);
      toast.success(fr ? 'Congé supprimé' : 'Time off removed');
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  const team = teams.find((t) => t.id === entry.team_id);

  return (
    <ModalShell onClose={onClose} width="w-[440px]">
      <div className="p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-[16px] font-bold text-text-primary flex items-center gap-2">
              <UnifiedAvatar id={entry.user_id} name={memberName} size={24} /> {memberName}
            </h3>
            <p className="text-[12px] text-text-tertiary mt-1">
              {team && <span className="inline-flex items-center gap-1.5 mr-1"><span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: team.color_hex }} />{team.name}</span>}
              · {fmtDay(entry.date, fr)}
              {entry.source === 'recurring' && <span className="ml-1 inline-flex items-center gap-1"><RefreshCw size={10} /> {fr ? 'récurrent' : 'recurring'}</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary"><X size={15} /></button>
        </div>

        {isTimeOff ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
              <p className="text-[13px] font-semibold text-red-600">
                {KIND_LABELS[entry.timeOff?.kind || 'time_off'][fr ? 'fr' : 'en']}
                {entry.timeOff && !entry.timeOff.all_day && entry.timeOff.start_time && (
                  <span className="ml-1.5 tabular-nums font-medium">{hhmm(entry.timeOff.start_time)} – {hhmm(entry.timeOff.end_time)}</span>
                )}
              </p>
              {entry.timeOff?.reason && <p className="text-[12px] text-red-600/80 mt-0.5">{entry.timeOff.reason}</p>}
              <p className="text-[11px] text-red-600/70 mt-1 tabular-nums">{entry.timeOff?.start_date} → {entry.timeOff?.end_date}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className={btnGhost}>{fr ? 'Fermer' : 'Close'}</button>
              <button onClick={removeTimeOffRec} disabled={saving} className={cn(btnGhost, 'text-red-600')}>
                <Trash2 size={13} className="inline mr-1" /> {fr ? 'Supprimer le congé' : 'Remove time off'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {isRecurring && (
              <div className="rounded-lg border border-outline bg-surface-secondary/40 p-3.5">
                <p className={cn(labelCls, 'mb-2')}>{fr ? 'Appliquer la modification' : 'Apply change to'}</p>
                <div className="space-y-1.5">
                  {([
                    ['one', fr ? 'Uniquement cette date' : 'Only this date'],
                    ['future', fr ? 'Cette date et les suivantes' : 'This date and onward'],
                    ['all', fr ? 'Toutes les occurrences de la série' : 'All occurrences in the series'],
                  ] as [EditScope, string][]).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
                      <input type="radio" name="edit-scope" checked={scope === value} onChange={() => setScope(value)} className="h-3.5 w-3.5" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className={labelCls}>{fr ? 'Équipe' : 'Team'}</label>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="glass-input w-full mt-1.5">
                {teams.filter((t) => t.is_active !== false || t.id === entry.team_id).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_active === false ? (fr ? ' (archivée)' : ' (archived)') : ''}</option>
                ))}
              </select>
            </div>
            {/* Heures de l'équipe pour la journée — informatif, pas de saisie par membre. */}
            <div className="rounded-lg border border-outline bg-surface-secondary/40 px-3.5 py-2.5 flex items-center gap-2">
              <Clock size={13} className="text-text-tertiary shrink-0" />
              <p className="text-[12px] text-text-secondary">
                {isRecurring && scope !== 'one'
                  ? <>{fr ? 'Heures hebdo de cette équipe :' : 'This team’s weekly hours:'} <span className="font-semibold tabular-nums text-text-primary">{recurringHours.start}–{recurringHours.end}</span></>
                  : <>{fr ? 'Heures de l’équipe ce jour-là :' : 'Team hours that day:'} <span className="font-semibold tabular-nums text-text-primary">{dayHours.start}–{dayHours.end}</span></>}
              </p>
            </div>
            {!(isRecurring && scope !== 'one') && (
              <div>
                <label className={labelCls}>Note</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="glass-input w-full mt-1.5" />
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
              <input type="checkbox" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} className="h-4 w-4 rounded" />
              <Ban size={12} className="text-text-tertiary" /> {fr ? 'Marquer indisponible ce jour-là' : 'Mark unavailable that day'}
            </label>

            <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
              <div className="flex items-center gap-2">
                <button onClick={remove} disabled={saving} className={cn(btnGhost, 'h-8 px-3 text-[12px] text-red-600')}>
                  <Trash2 size={12} className="inline mr-1" /> {fr ? 'Retirer' : 'Remove'}
                </button>
                <button onClick={onTimeOff} className={cn(btnGhost, 'h-8 px-3 text-[12px]')}>
                  {fr ? 'Ajouter un congé' : 'Add time off'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className={btnGhost}>{fr ? 'Annuler' : 'Cancel'}</button>
                <button onClick={save} disabled={saving} className={btnPrimary}>
                  {saving ? <Loader2 size={14} className="animate-spin inline" /> : (fr ? 'Sauvegarder' : 'Save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL — Congé / indisponibilité
// ═══════════════════════════════════════════════════════════════════════════

function TimeOffModal({ fr, initial, members, resolved, onClose, onSaved }: {
  fr: boolean;
  initial: TimeOffModalState;
  members: ScheduleMember[];
  resolved: Map<string, ResolvedMemberDay[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState(initial.userId);
  const [startDate, setStartDate] = useState(initial.date);
  const [endDate, setEndDate] = useState(initial.date);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('12:00');
  const [kind, setKind] = useState<TimeOffKind>('time_off');
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Assignations visibles qui seront remplacées/raccourcies par ce congé.
  const impacted = useMemo(() => {
    if (!userId) return [];
    const hits: string[] = [];
    for (const list of resolved.values()) {
      for (const e of list) {
        if (e.user_id !== userId || e.status === 'time_off') continue;
        if (e.date >= startDate && e.date <= endDate) {
          hits.push(`${fmtDay(e.date, fr)} · ${e.start_time}–${e.end_time}`);
        }
      }
    }
    return hits.sort();
  }, [userId, startDate, endDate, resolved, fr]);

  async function save() {
    if (!userId) { toast.error(fr ? 'Choisis un membre.' : 'Pick a member.'); return; }
    if (endDate < startDate) { toast.error(fr ? 'La date de fin précède la date de début.' : 'End date is before start date.'); return; }
    if (!allDay && timeToMin(endTime) <= timeToMin(startTime)) { toast.error(fr ? "L'heure de fin doit être après l'heure de début." : 'End time must be after start time.'); return; }
    setSaving(true);
    try {
      await createTimeOff({
        user_id: userId,
        start_date: startDate,
        end_date: endDate,
        all_day: allDay,
        start_time: startTime,
        end_time: endTime,
        kind,
        status: pending ? 'pending' : 'approved',
        reason,
      });
      toast.success(fr ? 'Congé enregistré' : 'Time off saved');
      onSaved();
    } catch (e) {
      toast.error(scheduleErrorMessage(e, fr));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} width="w-[440px]">
      <div className="p-6">
        <div className="flex items-start justify-between mb-5">
          <h3 className="text-[16px] font-bold text-text-primary">{fr ? 'Congé / indisponibilité' : 'Time off / unavailability'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary"><X size={15} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>{fr ? 'Membre' : 'Member'}</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="glass-input w-full mt-1.5">
              <option value="">{fr ? '— Choisir —' : '— Pick —'}</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{fr ? 'Type' : 'Type'}</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)} className="glass-input w-full mt-1.5">
                {(Object.keys(KIND_LABELS) as TimeOffKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k][fr ? 'fr' : 'en']}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{fr ? 'Statut' : 'Status'}</label>
              <select value={pending ? 'pending' : 'approved'} onChange={(e) => setPending(e.target.value === 'pending')} className="glass-input w-full mt-1.5">
                <option value="approved">{fr ? 'Approuvé' : 'Approved'}</option>
                <option value="pending">{fr ? 'En attente' : 'Pending'}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{fr ? 'Du' : 'From'}</label>
              <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} className="glass-input w-full mt-1.5" />
            </div>
            <div>
              <label className={labelCls}>{fr ? 'Au' : 'To'}</label>
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="glass-input w-full mt-1.5" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 rounded" />
            {fr ? 'Journée complète' : 'All day'}
          </label>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{fr ? 'De' : 'From'}</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="glass-input w-full mt-1.5" />
              </div>
              <div>
                <label className={labelCls}>{fr ? 'À' : 'To'}</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="glass-input w-full mt-1.5" />
              </div>
            </div>
          )}
          <div>
            <label className={labelCls}>{fr ? 'Raison / note (optionnel)' : 'Reason / note (optional)'}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="glass-input w-full mt-1.5" />
          </div>

          {impacted.length > 0 && !pending && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3.5 py-2.5">
              <p className="text-[12px] font-semibold text-[#c2410c] flex items-center gap-1.5 mb-1">
                <AlertTriangle size={12} /> {fr ? 'Assignations touchées cette semaine' : 'Assignments affected this week'}
              </p>
              <p className="text-[12px] text-[#c2410c]/90">
                {fr
                  ? 'Ces plages seront retirées ou raccourcies pour la période du congé (l’horaire récurrent reste intact) :'
                  : 'These slots will be removed or shortened for the time-off period (the recurring template stays intact):'}
              </p>
              <ul className="mt-1 space-y-0.5">
                {impacted.slice(0, 6).map((line, i) => <li key={i} className="text-[12px] text-[#c2410c] tabular-nums">• {line}</li>)}
                {impacted.length > 6 && <li className="text-[12px] text-[#c2410c]/80">… +{impacted.length - 6}</li>}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className={btnGhost}>{fr ? 'Annuler' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className={btnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin inline" /> : <><Check size={13} className="inline mr-1" />{fr ? 'Enregistrer' : 'Save'}</>}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
