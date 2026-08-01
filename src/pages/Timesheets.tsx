import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Timer, ChevronLeft, ChevronRight, Clock, Coffee, Download,
  Calendar, User, Loader2, Check, Pencil, StickyNote, Power, AlertTriangle,
  Users, Activity, MapPin, Phone, Eye, X,
  MoreHorizontal, ArrowUpDown, Search, CirclePlus, Plus, Trash2, RefreshCw, Ban,
  Play, Square, Pause as PauseIcon,
} from 'lucide-react';
import TimesheetLiveMap from '../components/timesheets/TimesheetLiveMap';
import { motion, AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { exportToCsv } from '../lib/exportCsv';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useCompany } from '../contexts/CompanyContext';
import PermissionGate from '../components/PermissionGate';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import { listTeams, listTeamAssignments } from '../lib/teamsApi';
import { punchIn as apiPunchIn, punchOut as apiPunchOut, startBreak as apiStartBreak, endBreak as apiEndBreak } from '../lib/timesheetsApi';
import { fetchTeamList } from '../lib/invitationsApi';
import { useGpsTracker } from '../hooks/useGpsTracker';
import TechnicianTimesheetTable from '../components/timesheets/TechnicianTimesheetTable';
import TeamScheduleGrid from '../components/timesheets/TeamScheduleGrid';
import { usePermissions } from '../hooks/usePermissions';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type ViewMode = 'day' | 'week' | 'month';
type HubTab = 'feuilles' | 'carte' | 'horaire';

interface TimeEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  punch_in: string;
  punch_out: string | null;
  breaks: Array<{ start: string; end: string }>;
  notes: string | null;
  approved?: boolean;
}

interface EmployeeRow {
  id: string;
  employee_id: string;
  employee_name: string;
  status: string;
  statusKey: string;
  punch_in: string;
  punch_out: string | null;
  liveWorked: string;
  liveWorkedMin: number;
  breakCount: number;
  breakMinutes: number;
  disciplineScore: number;
  issue: string;
  entry: TimeEntry;
}

interface LiveLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  tracking_status: string;
  speed_mps: number | null;
  is_moving: boolean;
  recorded_at: string;
  user_name?: string;
  team_name?: string;
  team_color?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMESHEET HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseTime(t: string): number {
  if (!t) return 0;
  // Handle ISO timestamps (from timer breaks)
  if (t.includes('T')) {
    const d = new Date(t);
    return d.getHours() * 60 + d.getMinutes();
  }
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function formatH(minutes: number): string {
  if (!minutes || isNaN(minutes) || minutes <= 0) return '0h 00m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}
function fmt12(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}
function calcWork(entry: TimeEntry): number {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const end = entry.punch_out ? parseTime(entry.punch_out) : nowMin;
  const total = end - parseTime(entry.punch_in);
  const brk = entry.breaks.reduce((a, b) => a + (parseTime(b.end) - parseTime(b.start)), 0);
  return Math.max(0, total - brk);
}
function calcBreak(entry: TimeEntry): number {
  return entry.breaks.reduce((a, b) => {
    if (!b.start || !b.end) return a;
    const diff = parseTime(b.end) - parseTime(b.start);
    return a + (isNaN(diff) ? 0 : Math.max(0, diff));
  }, 0);
}
function getWeekDates(date: Date): string[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return Array.from({ length: 7 }, (_, i) => {
    const next = new Date(monday);
    next.setDate(monday.getDate() + i);
    return next.toISOString().slice(0, 10);
  });
}

const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAY_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FR = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

function scoreDiscipline(entry: TimeEntry, allEntries: TimeEntry[]): number {
  let score = 100;
  // No hardcoded start time — discipline score only based on objective factors
  if (!entry.punch_out) score -= 20;
  if (calcBreak(entry) > 60) score -= 10;
  if (entry.punch_out && calcWork(entry) < 240) score -= 10;
  return Math.max(0, Math.min(100, score));
}
function detectIssue(entry: TimeEntry, fr: boolean): string {
  const issues: string[] = [];
  // No hardcoded "late" detection — removed 09:00/09:15 threshold
  if (!entry.punch_out) {
    const punchInMin = parseTime(entry.punch_in);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (entry.date < todayStr || (entry.date === todayStr && nowMin - punchInMin > 1200)) {
      issues.push(fr ? 'Punch manquant' : 'Missing punch');
    }
  }
  if (calcBreak(entry) > 90) issues.push(fr ? 'Longue pause' : 'Long break');
  return issues.join(', ');
}
function getStatus(entry: TimeEntry, fr: boolean): { label: string; key: string } {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (entry.date !== todayStr) return entry.punch_out ? { label: fr ? 'Terminé' : 'Finished', key: 'finished' } : { label: fr ? 'Inactif' : 'Inactive', key: 'inactive' };
  if (!entry.punch_out) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const b of entry.breaks) { if (parseTime(b.start) <= nowMin && nowMin <= parseTime(b.end)) return { label: fr ? 'En pause' : 'On break', key: 'pause' }; }
    return { label: fr ? 'Actif' : 'Active', key: 'active' };
  }
  return { label: fr ? 'Terminé' : 'Finished', key: 'finished' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SMALL SHARED UI
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadgePill({ statusKey, label }: { statusKey: string; label: string }) {
  const s: Record<string, string> = {
    active: 'badge-success', pause: 'badge-warning',
    late: 'badge-danger', inactive: 'badge-neutral', finished: 'badge-neutral',
  };
  return <span className={cn('inline-block rounded-full border px-2.5 py-[2px] text-[12px] font-medium leading-[18px]', s[statusKey] || s.inactive)}>{label}</span>;
}

function IssueBadge({ issue }: { issue: string }) {
  if (!issue) return <span className="text-[14px] text-text-tertiary">—</span>;
  const color = (issue.toLowerCase().includes('retard') || issue.toLowerCase().includes('late') || issue.toLowerCase().includes('punch') || issue.toLowerCase().includes('manquant')) ? 'text-[#dc2626]' : 'text-[#c2410c]';
  return <span className={cn('text-[13px] font-medium', color)}>{issue}</span>;
}

function KpiCard({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string | number; accent?: 'green' | 'orange' | 'red' | 'default' }) {
  const c = accent === 'green' ? 'text-emerald-600' : accent === 'orange' ? 'text-amber-600' : accent === 'red' ? 'text-red-600' : 'text-text-primary';
  return (
    <div className="rounded-2xl bg-surface-card border border-border shadow-card p-5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2"><Icon size={14} className="text-text-tertiary" /><span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</span></div>
      <p className={cn('text-[22px] font-semibold tabular-nums tracking-tight leading-none mt-1', c)}>{value}</p>
    </div>
  );
}

function RowActionMenu({ children, items }: { children: React.ReactNode; items: Array<{ label: string; icon: React.ElementType; onClick: () => void; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const c = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={e => { e.stopPropagation(); setOpen(!open); }} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors">{children}</button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.1 }}
            className="absolute right-0 top-full mt-1 w-48 bg-surface-card border border-outline rounded-lg shadow-xl z-50 py-1 overflow-hidden">
            {items.map((it, i) => (
              <React.Fragment key={i}>
                {it.danger && i > 0 && <div className="border-t border-outline my-1" />}
                <button onClick={() => { it.onClick(); setOpen(false); }}
                  className={cn('w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors', it.danger ? 'text-red-600 hover:bg-red-50' : 'text-text-primary hover:bg-surface-secondary')}>
                  <it.icon size={13} className={it.danger ? '' : 'text-text-tertiary'} /> {it.label}
                </button>
              </React.Fragment>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL SHELL
// ═══════════════════════════════════════════════════════════════════════════════

function ModalShell({ open, onClose, width, children }: { open: boolean; onClose: () => void; width?: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className={cn('bg-surface-card border border-outline rounded-xl shadow-2xl', width || 'w-[420px]')} onClick={e => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HUB COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Timesheets() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const months = fr ? MONTH_FR : MONTH_EN;
  const days = fr ? DAY_FR : DAY_EN;
  const qc = useQueryClient();
  const { currentOrgId } = useCompany();
  // Horaire (onglet Schedule) : owner/admin gèrent, les autres rôles lisent.
  const { role: myRole, userId: myUserId } = usePermissions();
  const canManageSchedule = myRole === 'owner' || myRole === 'admin';

  // ── Hub tab (check URL params for redirect from /availability) ──
  const [hubTab, setHubTab] = useState<HubTab>(() => {
    const params = new URLSearchParams(window.location.search);
    // L'onglet Disponibilités n'existe plus : les anciens liens tombent sur Horaire.
    if (params.get('view') === 'disponibilites') return 'horaire';
    if (params.get('view') === 'horaire') return 'horaire';
    return 'feuilles';
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FEUILLES STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPunchIn, setEditPunchIn] = useState('');
  const [editPunchOut, setEditPunchOut] = useState('');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const tickRef = useRef<any>(null);
  const PAGE_SIZE = 15;
  const [tick, setTick] = useState(0);
  const [timeFormat, setTimeFormat] = useState<'decimal' | 'hm'>('hm');

  // ── Map state ──
  const [liveReps, setLiveReps] = useState<LiveLocation[]>([]);
  const [selectedRep, setSelectedRep] = useState<LiveLocation | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // FEUILLES DATA
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => { tickRef.current = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(tickRef.current); }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const orgId = await getCurrentOrgIdOrThrow();
    const { data } = await supabase.from('time_entries').select('*').eq('org_id', orgId).order('date', { ascending: false });
    if (data) {
      const mapped: TimeEntry[] = data.map((e: any) => ({
        id: e.id, employee_id: e.employee_id || e.id, employee_name: e.employee_name || (fr ? 'Inconnu' : 'Unknown'),
        date: e.date, punch_in: e.punch_in?.slice(0, 5) || '09:00',
        punch_out: e.punch_out ? e.punch_out.slice(0, 5) : null,
        breaks: Array.isArray(e.breaks) ? e.breaks : [], notes: e.notes || null,
      }));
      setEntries(mapped);
    }
    setLoading(false);
  }, [fr]);

  // Liste d'employés = membres réels de l'org (memberships + profiles), pas les
  // noms dédupliqués des pointages : ceux-ci font apparaître des employés
  // fantômes issus de vieilles saisies. `team_id` vient du même rattachement
  // que celui affiché dans l'onglet Horaire — source unique.
  const membersQuery = useQuery({
    queryKey: ['org-members', currentOrgId],
    queryFn: fetchTeamList,
    enabled: !!currentOrgId,
  });

  // Appartenances multiples : un employé peut être dans plusieurs équipes
  // (ex. Pelouse l'été, Déneigement l'hiver). `memberships.team_id` ne porte
  // que l'équipe d'attache — celle qui gouverne le RBAC — donc les filtres
  // lisent team_assignments. Repli silencieux sur team_id tant que la
  // migration 20260726130000 n'est pas appliquée.
  const assignmentsQuery = useQuery({
    queryKey: ['team-assignments', currentOrgId],
    queryFn: listTeamAssignments,
    enabled: !!currentOrgId,
    retry: false,
  });

  const employees = useMemo(() => {
    const members = membersQuery.data?.members ?? [];
    const assignments = assignmentsQuery.data;
    const byUser = new Map<string, string[]>();
    for (const a of assignments ?? []) {
      const list = byUser.get(a.user_id);
      if (list) list.push(a.team_id); else byUser.set(a.user_id, [a.team_id]);
    }
    // Les équipes sont un découpage TERRAIN : elles concernent les techniciens,
    // pas les sales_rep qui vendent. On garde malgré tout quiconque a déjà
    // pointé — sinon un owner qui dépanne sur le terrain aurait des heures
    // enregistrées mais deviendrait introuvable dans le filtre.
    const hasPunched = new Set(entries.map(e => e.employee_id));
    return members
      .filter(m => m.role === 'technician' || hasPunched.has(m.user_id))
      .map(m => ({
        id: m.user_id,
        name: m.full_name?.trim() || m.email || (fr ? 'Sans nom' : 'Unnamed'),
        // Sans table d'assignations, on retombe sur l'équipe d'attache seule.
        team_ids: byUser.get(m.user_id) ?? (m.team_id ? [m.team_id] : []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [membersQuery.data, assignmentsQuery.data, entries, fr]);

  // ── Punch timer state (must be declared before real-time channel) ──
  const [myActiveEntry, setMyActiveEntry] = useState<{ id: string; punch_in_at: string; status: string; breaks: Array<{ start: string; end: string }> } | null>(null);
  const [timerElapsed, setTimerElapsed] = useState('0h 00m 00s');
  const [timerLoading, setTimerLoading] = useState(false);

  const loadMySession = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('time_entries')
      .select('id, punch_in_at, status, breaks')
      .eq('employee_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    setMyActiveEntry(data ? { id: data.id, punch_in_at: data.punch_in_at, status: data.status, breaks: Array.isArray(data.breaks) ? data.breaks : [] } : null);
  }, []);

  useEffect(() => { loadData(); loadMySession(); }, [loadData, loadMySession]);
  useEffect(() => {
    if (!currentOrgId) return;
    const ch = supabase.channel(`ts-entries-${currentOrgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `org_id=eq.${currentOrgId}` }, () => { loadData(); loadMySession(); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadData, loadMySession, currentOrgId]);

  // ── Map data ──
  useEffect(() => {
    if (hubTab !== 'carte') return;
    const load = () => { import('../lib/trackingApi').then(({ getActiveLiveLocations }) => getActiveLiveLocations().then(setLiveReps).catch(() => {})); };
    load();
    if (!currentOrgId) return;
    const ch = supabase.channel(`ts-live-reps-${currentOrgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tracking_live_locations', filter: `org_id=eq.${currentOrgId}` }, load).subscribe();
    const poll = setInterval(load, 30000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [hubTab, currentOrgId]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Cmd/Ctrl/Alt : on laisse les raccourcis navigateur (Cmd+R, Cmd+Shift+R, Cmd+T…) intacts.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if (hubTab === 'feuilles' && !e.altKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); }
        return;
      }
      if (hubTab === 'feuilles') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
        if (e.key === 't' || e.key === 'T') { e.preventDefault(); setCurrentDate(new Date()); }
        if (e.key === '1') { e.preventDefault(); setViewMode('day'); }
        if (e.key === '2') { e.preventDefault(); setViewMode('week'); }
        if (e.key === '3') { e.preventDefault(); setViewMode('month'); }
        if (e.key === 'e' || e.key === 'E') { e.preventDefault(); handleExport(); }
        if ((e.key === 'a' || e.key === 'A') && selected.size > 0) { e.preventDefault(); approveEntries([...selected]); }
        if (e.key === 'Escape') { setEditingId(null); setNoteId(null); setSelected(new Set()); }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); loadData(); toast.success(fr ? 'Rafraîchi' : 'Refreshed'); }
      }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); setHubTab(prev => prev === 'carte' ? 'feuilles' : 'carte'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, fr, hubTab]);

  // ── Date nav ──
  const nav = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (viewMode === 'day') d.setDate(d.getDate() + dir);
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  };
  const dateLabel = useMemo(() => {
    if (viewMode === 'day') return `${days[currentDate.getDay()]}, ${months[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
    if (viewMode === 'week') { const w = getWeekDates(currentDate); const s = new Date(w[0] + 'T12:00:00'); const e = new Date(w[6] + 'T12:00:00'); return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`; }
    return `${months[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }, [currentDate, viewMode, months, days]);

  // Employés visibles dans le sélecteur : restreints à l'équipe choisie.
  const employeesInTeam = useMemo(() => (
    selectedTeamId === 'all' ? employees : employees.filter(e => e.team_ids.includes(selectedTeamId))
  ), [employees, selectedTeamId]);

  // Si l'employé sélectionné n'appartient pas à la nouvelle équipe, on retombe
  // sur « tous » plutôt que d'afficher un tableau vide sans explication.
  useEffect(() => {
    if (selectedEmployee === 'all') return;
    if (!employeesInTeam.some(e => e.id === selectedEmployee)) setSelectedEmployee('all');
  }, [employeesInTeam, selectedEmployee]);

  // ── Filtered entries ──
  const viewEntries = useMemo(() => {
    let pool = entries;
    if (selectedTeamId !== 'all') {
      const ids = new Set(employeesInTeam.map(e => e.id));
      pool = pool.filter(e => ids.has(e.employee_id));
    }
    if (selectedEmployee !== 'all') pool = pool.filter(e => e.employee_id === selectedEmployee);
    if (viewMode === 'day') { const ds = currentDate.toISOString().slice(0, 10); return pool.filter(e => e.date === ds); }
    if (viewMode === 'week') { const wk = new Set(getWeekDates(currentDate)); return pool.filter(e => wk.has(e.date)); }
    const y = currentDate.getFullYear(), mo = currentDate.getMonth();
    return pool.filter(e => { const d = new Date(e.date); return d.getFullYear() === y && d.getMonth() === mo; });
  }, [entries, selectedEmployee, selectedTeamId, employeesInTeam, currentDate, viewMode]);

  const rows: EmployeeRow[] = useMemo(() => {
    return viewEntries.map(entry => {
      const issue = detectIssue(entry, fr);
      const worked = calcWork(entry);
      const status = getStatus(entry, fr);
      return { id: entry.id, employee_id: entry.employee_id, employee_name: entry.employee_name, status: status.label, statusKey: status.key, punch_in: entry.punch_in, punch_out: entry.punch_out, liveWorked: formatH(worked), liveWorkedMin: worked, breakCount: entry.breaks.length, breakMinutes: calcBreak(entry), disciplineScore: scoreDiscipline(entry, entries), issue, entry };
    }).sort((a, b) => { if (a.issue && !b.issue) return -1; if (!a.issue && b.issue) return 1; return 0; });
  }, [viewEntries, entries, fr, tick]);

  const filteredRows = useMemo(() => {
    let r = rows;
    if (tableSearch) { const q = tableSearch.toLowerCase(); r = r.filter(row => row.employee_name.toLowerCase().includes(q)); }
    if (statusFilter !== 'all') r = r.filter(row => row.statusKey === statusFilter);
    return r;
  }, [rows, tableSearch, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = useMemo(() => { const s = (page - 1) * PAGE_SIZE; return filteredRows.slice(s, s + PAGE_SIZE); }, [filteredRows, page]);
  useEffect(() => { setPage(1); }, [tableSearch, statusFilter, viewMode, currentDate, selectedEmployee, selectedTeamId]);

  const alerts = useMemo(() => {
    const a: Array<{ text: string; type: string }> = [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayEntries = entries.filter(e => e.date === todayStr);
    const missingPunch = todayEntries.filter(e => !e.punch_out && calcWork(e) > 600).length;
    const inactive = entries.filter(e => { if (e.punch_out) return false; const pd = new Date(`${e.date}T${e.punch_in}`); return Date.now() - pd.getTime() > 20 * 3600000; }).length;
    if (missingPunch > 0) a.push({ text: fr ? `${missingPunch} punch-out manquant(s)` : `${missingPunch} missing punch-out(s)`, type: 'error' });
    if (inactive > 0) a.push({ text: fr ? `${inactive} inactif(s) > 20h` : `${inactive} inactive > 20h`, type: 'error' });
    return a;
  }, [entries, fr]);

  const analytics = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayEntries = entries.filter(e => e.date === todayStr);
    const working = todayEntries.filter(e => !e.punch_out).length;
    const onBreak = todayEntries.filter(e => { if (e.punch_out) return false; const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes(); return e.breaks.some(b => parseTime(b.start) <= nowMin && nowMin <= parseTime(b.end)); }).length;
    const totalMin = todayEntries.reduce((a, e) => a + calcWork(e), 0);
    const totalBreak = todayEntries.reduce((a, e) => a + calcBreak(e), 0);
    return { totalHours: formatH(totalMin), activeEmployees: todayEntries.length, currentlyWorking: working, onBreak, totalBreaks: formatH(totalBreak) };
  }, [entries, tick]);

  // Statut carte basé sur le PUNCH, pas seulement le GPS: un technicien n'est
  // "actif" que s'il a une entrée de temps aujourd'hui sans punch de sortie
  // (réellement au travail). En pause (dans un break) → idle. Non punché →
  // offline, même si son app envoie encore sa position GPS.
  const mapReps = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    // employee_id → statut punch
    const punchStatus = new Map<string, 'active' | 'idle'>();
    for (const e of entries) {
      if (e.date !== todayStr || e.punch_out) continue; // pas punché en ce moment
      const onBreak = e.breaks.some(b => parseTime(b.start) <= nowMin && nowMin <= parseTime(b.end));
      punchStatus.set(e.employee_id, onBreak ? 'idle' : 'active');
    }
    return liveReps.map(r => ({ ...r, tracking_status: punchStatus.get(r.user_id) || 'offline' }));
  }, [liveReps, entries, tick]);

  const toReview = useMemo(() => {
    const items: Array<{ id: string; employee_id: string; name: string; reason: string; entry: TimeEntry }> = [];
    for (const e of entries) {
      if (!e.punch_out) {
        const pd = new Date(`${e.date}T${e.punch_in}`);
        if (Date.now() - pd.getTime() > 20 * 3600000) items.push({ id: e.id, employee_id: e.employee_id, name: e.employee_name, reason: fr ? 'Inactif > 20h' : 'Inactive > 20h', entry: e });
        else if (calcWork(e) > 600) items.push({ id: e.id, employee_id: e.employee_id, name: e.employee_name, reason: fr ? 'Punch-out manquant' : 'Missing punch-out', entry: e });
      }
      if (detectIssue(e, fr)) { const ex = items.find(i => i.id === e.id); if (!ex) items.push({ id: e.id, employee_id: e.employee_id, name: e.employee_name, reason: detectIssue(e, fr), entry: e }); }
    }
    return items.slice(0, 10);
  }, [entries, fr]);

  // ── Feuilles actions ──
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(rows.map(r => r.id)));
  const selectNone = () => setSelected(new Set());
  const approveEntries = async (ids: string[]) => { const orgId = await getCurrentOrgIdOrThrow(); for (const id of ids) { await supabase.from('time_entries').update({ notes: '[APPROVED] ' + (entries.find(e => e.id === id)?.notes || '') }).eq('id', id).eq('org_id', orgId); } toast.success(fr ? `${ids.length} approuvé(s)` : `${ids.length} approved`); loadData(); setSelected(new Set()); };
  const forceClockOut = async (id: string) => { const orgId = await getCurrentOrgIdOrThrow(); const now = new Date(); const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`; await supabase.from('time_entries').update({ punch_out: ts, punch_out_at: now.toISOString(), status: 'completed' }).eq('id', id).eq('org_id', orgId); toast.success(fr ? 'Punch-out forcé' : 'Forced clock-out'); loadData(); loadMySession(); };
  const deleteEntry = async (id: string) => { const orgId = await getCurrentOrgIdOrThrow(); const { error } = await supabase.from('time_entries').delete().eq('id', id).eq('org_id', orgId); if (error) { toast.error(error.message); return; } toast.success(fr ? 'Entrée supprimée' : 'Entry deleted'); loadData(); loadMySession(); };
  const saveEdit = async () => { if (!editingId) return; const orgId = await getCurrentOrgIdOrThrow(); await supabase.from('time_entries').update({ punch_in: editPunchIn, punch_out: editPunchOut || null }).eq('id', editingId).eq('org_id', orgId); toast.success(fr ? 'Modifié' : 'Updated'); setEditingId(null); loadData(); };
  const saveNote = async () => { if (!noteId) return; const orgId = await getCurrentOrgIdOrThrow(); await supabase.from('time_entries').update({ notes: noteText }).eq('id', noteId).eq('org_id', orgId); toast.success(fr ? 'Note sauvegardée' : 'Note saved'); setNoteId(null); loadData(); };
  const handleExport = async (ids?: string[]) => { const pool = ids ? entries.filter(e => ids.includes(e.id)) : viewEntries; exportToCsv(`timesheet-${new Date().toISOString().slice(0, 10)}.csv`, ['Employee', 'Date', 'Punch In', 'Punch Out', 'Breaks', 'Work Duration', 'Issue'], pool.map(e => [e.employee_name, e.date, e.punch_in, e.punch_out || '', formatH(calcBreak(e)), formatH(calcWork(e)), detectIssue(e, false)])); };

  // ═══════════════════════════════════════════════════════════════════════════
  // PUNCH TIMER (continued — state + loadMySession declared above)
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!myActiveEntry) { setTimerElapsed('0h 00m 00s'); return; }
    const iv = setInterval(() => {
      const start = new Date(myActiveEntry.punch_in_at).getTime();
      const now = Date.now();
      let breakMs = 0;
      for (const b of myActiveEntry.breaks) {
        const bs = new Date(b.start).getTime();
        const be = b.end ? new Date(b.end).getTime() : now;
        breakMs += be - bs;
      }
      const diff = Math.max(0, now - start - breakMs);
      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setTimerElapsed(`${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`);
    }, 1000);
    return () => clearInterval(iv);
  }, [myActiveEntry]);

  const handlePunchIn = async () => {
    setTimerLoading(true);
    try {
      await apiPunchIn();
      toast.success(fr ? 'Punch In !' : 'Punched In!');
      loadMySession();
      loadData();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('already punched')) {
        toast.error(fr ? 'Session déjà active' : 'Already have an active session');
      } else {
        toast.error(msg || (fr ? 'Erreur' : 'Error'));
      }
    } finally { setTimerLoading(false); }
  };

  const handlePunchOut = async () => {
    if (!myActiveEntry) return;
    setTimerLoading(true);
    try {
      await apiPunchOut({ entry_id: myActiveEntry.id });
      toast.success(fr ? 'Punch Out !' : 'Punched Out!');
      setMyActiveEntry(null);
      loadData();
    } catch (err: any) { toast.error(err?.message || (fr ? 'Erreur' : 'Error')); }
    finally { setTimerLoading(false); }
  };

  const handlePauseToggle = async () => {
    if (!myActiveEntry) return;
    setTimerLoading(true);
    try {
      const lastBreak = myActiveEntry.breaks[myActiveEntry.breaks.length - 1];
      const onBrk = lastBreak && !lastBreak.end;
      if (onBrk) await apiEndBreak(myActiveEntry.id);
      else await apiStartBreak(myActiveEntry.id);
      toast.success(onBrk ? (fr ? 'Reprise !' : 'Resumed!') : (fr ? 'En pause' : 'Paused'));
      loadMySession();
    } catch (err: any) { toast.error(err?.message || (fr ? 'Erreur' : 'Error')); }
    finally { setTimerLoading(false); }
  };

  const isOnBreak = myActiveEntry ? myActiveEntry.breaks.some((b: any) => b.start && !b.end) : false;

  // GPS auto-tracking: active whenever user is punched in and not on break.
  // Streams browser geolocation into tracking_points / tracking_live_locations
  // every 15s so the user appears live on the Dispatch map.
  const gps = useGpsTracker({ enabled: !!myActiveEntry && !isOnBreak });

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉQUIPES (filtres Feuilles/Carte + grille Horaire)
  // ═══════════════════════════════════════════════════════════════════════════

  // Clé scopée sur l'org : listTeams filtre désormais par org_id, sans ça le
  // cache resservirait les équipes de l'office précédent après un changement.
  const teamsQuery = useQuery({ queryKey: ['teams', currentOrgId], queryFn: listTeams });

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  const content = (
    <div className="space-y-6 pb-8">
      {/* ════════════════════════════════════════════════════════════════════
          MASTER HEADER
          ════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Feuilles de temps' : 'Timesheets'}</h1>
          <p className="text-[13px] text-text-tertiary mt-1">{fr ? 'Suivi des équipes, pointages, horaire et répartition terrain' : 'Team tracking, punches, schedule and field distribution'}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Date controls for feuilles/carte */}
          {(hubTab === 'feuilles' || hubTab === 'carte') && (
            <>
              <div className="flex rounded-md border border-outline overflow-hidden">
                {((hubTab === 'feuilles' ? ['day', 'week'] : ['day', 'week', 'month']) as ViewMode[]).map(m => (
                  <button key={m} onClick={() => setViewMode(m)} className={cn('px-3.5 py-2 text-[13px] font-medium transition-all', viewMode === m ? 'bg-text-primary text-white' : 'bg-surface-card text-text-secondary hover:bg-surface-secondary')}>
                    {m === 'day' ? (fr ? 'Jour' : 'Day') : m === 'week' ? (fr ? 'Semaine' : 'Week') : (fr ? 'Mois' : 'Month')}
                  </button>
                ))}
              </div>
              {hubTab === 'feuilles' && (
                <div className="flex rounded-md border border-outline overflow-hidden">
                  {(['hm', 'decimal'] as const).map(f => (
                    <button key={f} onClick={() => setTimeFormat(f)} className={cn('px-3.5 py-2 text-[13px] font-medium transition-all', timeFormat === f ? 'bg-text-primary text-white' : 'bg-surface-card text-text-secondary hover:bg-surface-secondary')}>
                      {f === 'hm' ? (fr ? 'Heures & min' : 'Hours & minutes') : (fr ? 'Décimal' : 'Decimal')}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => handleExport()} className="inline-flex items-center gap-2 h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">
                <Download size={14} /> {fr ? 'Exporter' : 'Export'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Sub-tabs — same underline pattern as Finances/Jobs ── */}
      <div className="tab-nav">
        {([['feuilles', fr ? 'Feuilles de temps' : 'Timesheets'], ['carte', fr ? 'Carte' : 'Map'], ['horaire', fr ? 'Horaire' : 'Schedule']] as [HubTab, string][]).map(([key, label]) => (
          <button key={key} className={hubTab === key ? 'tab-item-active' : 'tab-item'} onClick={() => setHubTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Secondary bar: date nav (feuilles/carte) or nothing (dispo/horaire) ── */}
      {(hubTab === 'feuilles' || hubTab === 'carte') && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-outline bg-surface px-3 py-[7px]">
              <Users size={14} className="text-text-tertiary" />
              <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} className="bg-transparent text-[13px] font-medium text-text-primary focus:outline-none cursor-pointer">
                <option value="all">{fr ? 'Toutes les équipes' : 'All teams'}</option>
                {(teamsQuery.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-md border border-outline bg-surface px-3 py-[7px]">
              <User size={14} className="text-text-tertiary" />
              <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} className="bg-transparent text-[13px] font-medium text-text-primary focus:outline-none cursor-pointer">
                <option value="all">{fr ? 'Tous les employés' : 'All employees'}</option>
                {employeesInTeam.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>
            {alerts.map((a, i) => (
              <div key={i} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12px] font-medium', a.type === 'error' ? 'text-[#dc2626] border-red-200 bg-red-50' : 'text-[#c2410c] border-orange-200 bg-orange-50')}>
                <AlertTriangle size={12} /> {a.text}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => nav(-1)} className="h-9 w-9 flex items-center justify-center bg-surface-card border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronLeft size={16} /></button>
            <span className="text-[14px] font-semibold text-text-primary min-w-[220px] text-center tabular-nums">{dateLabel}</span>
            <button onClick={() => nav(1)} className="h-9 w-9 flex items-center justify-center bg-surface-card border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronRight size={16} /></button>
            <button onClick={() => setCurrentDate(new Date())} className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">{fr ? "Aujourd'hui" : 'Today'}</button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB CONTENT
          ════════════════════════════════════════════════════════════════════ */}

      {hubTab === 'feuilles' && (
        <>
          {/* To review */}
          {toReview.length > 0 && (
            <div className="rounded-2xl bg-surface-card border border-border shadow-card">
              <div className="flex items-center gap-2.5 px-5 pt-5 pb-3">
                <h2 className="text-[15px] font-semibold text-text-primary">{fr ? 'À réviser' : 'To Review'}</h2>
                <span className="text-[11px] min-w-[22px] h-[22px] flex items-center justify-center rounded-full px-1.5 font-bold bg-red-100 text-red-700">{toReview.length}</span>
              </div>
              <div className="px-5 pb-4 space-y-2">
                {toReview.map(item => (
                  <div key={item.id} className="flex items-center justify-between py-2.5 px-4 rounded-lg bg-surface hover:bg-surface-secondary transition-colors border border-border/60 group">
                    <div className="flex items-center gap-3 min-w-0">
                      <UnifiedAvatar id={item.employee_id} name={item.name} size={32} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-text-primary truncate">{item.name}</p>
                        <span className={cn('inline-block mt-0.5 rounded-full border px-2 py-[1px] text-[10px] font-medium leading-[16px]',
                          (item.reason.includes('retard') || item.reason.includes('Late') || item.reason.includes('Punch') || item.reason.includes('punch')) ? 'text-[#dc2626] bg-red-50 border-red-200' : 'text-[#c2410c] bg-orange-50 border-orange-200'
                        )}>{item.reason}</span>
                      </div>
                    </div>
                    <button onClick={() => forceClockOut(item.id)} className="h-7 px-2.5 text-[11px] font-medium rounded-md bg-surface-card border border-outline text-text-primary hover:bg-surface-secondary transition-colors opacity-0 group-hover:opacity-100">
                      {fr ? 'Forcer punch-out' : 'Force clock-out'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bulk actions */}
          <AnimatePresence>
            {selected.size > 0 && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-3 px-5 py-3 rounded-xl bg-surface-card border border-border shadow-card">
                <span className="text-[13px] font-semibold text-text-primary">{selected.size} {fr ? 'sélectionné(s)' : 'selected'}</span>
                <div className="h-4 w-px bg-border" />
                <button onClick={() => approveEntries([...selected])} className="text-[13px] font-medium text-emerald-700 flex items-center gap-1.5"><Check size={14} /> {fr ? 'Approuver' : 'Approve'}</button>
                <button onClick={() => handleExport([...selected])} className="text-[13px] font-medium text-text-secondary flex items-center gap-1.5"><Download size={14} /> {fr ? 'Exporter' : 'Export'}</button>
                <button onClick={selectNone} className="text-[13px] text-text-tertiary ml-auto">{fr ? 'Désélectionner' : 'Deselect'}</button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Technician timesheet table — one row per technician, expandable */}
          <TechnicianTimesheetTable
            currentDate={currentDate}
            view={viewMode === 'week' ? 'week' : 'day'}
            timeFormat={timeFormat}
          />
        </>
      )}

      {hubTab === 'carte' && (
        /* ════ CARTE VIEW ════ */
        <>
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { color: 'bg-emerald-500', label: fr ? 'Actifs' : 'Active', count: mapReps.filter(r => r.tracking_status === 'active').length },
              { color: 'bg-amber-500', label: fr ? 'En pause' : 'Idle', count: mapReps.filter(r => r.tracking_status === 'idle').length },
              { color: 'bg-gray-400', label: fr ? 'Hors ligne' : 'Offline', count: mapReps.filter(r => r.tracking_status !== 'active' && r.tracking_status !== 'idle').length },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl bg-surface-card border border-border shadow-card px-5 py-3 flex items-center gap-3">
                <div className={cn('w-2.5 h-2.5 rounded-full', s.color)} />
                <div>
                  <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">{s.label}</p>
                  <p className="text-[18px] font-bold text-text-primary tabular-nums">{s.count}</p>
                </div>
              </div>
            ))}
            <div className="rounded-2xl bg-surface-card border border-border shadow-card px-5 py-3 flex items-center gap-3">
              <MapPin size={16} className="text-text-tertiary" />
              <div><p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">Total</p><p className="text-[18px] font-bold text-text-primary tabular-nums">{liveReps.length}</p></div>
            </div>
          </div>
          <div className="relative rounded-2xl border border-border overflow-hidden shadow-card" style={{ height: 'calc(100vh - 340px)', minHeight: 400 }}>
            {liveReps.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-card z-10">
                <MapPin size={32} className="text-text-tertiary opacity-30 mb-3" />
                <p className="text-[15px] font-semibold text-text-primary">{fr ? 'Aucun technicien en ligne' : 'No technicians online'}</p>
                <p className="text-[13px] text-text-tertiary mt-1">{fr ? 'Les positions apparaîtront ici lorsque les employés seront actifs' : 'Positions will appear when employees are active'}</p>
              </div>
            )}
            <TimesheetLiveMap
              reps={mapReps}
              flyTo={flyTarget}
              fr={fr}
              onSelect={(rep) => { setSelectedRep(rep); setFlyTarget({ lat: rep.latitude, lng: rep.longitude }); }}
            />
            <AnimatePresence>
              {selectedRep && (
                <motion.div initial={{ x: 400, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 400, opacity: 0 }}
                  className="absolute right-0 top-0 bottom-0 w-[340px] bg-surface-card border-l border-outline shadow-2xl z-[500] flex flex-col">
                  <div className="p-5 border-b border-outline">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3"><UnifiedAvatar id={selectedRep.user_id} name={selectedRep.user_name || (fr ? 'Inconnu' : 'Unknown')} size={36} /><div><h3 className="text-[14px] font-bold text-text-primary">{selectedRep.user_name || (fr ? 'Inconnu' : 'Unknown')}</h3><p className="text-[11px] text-text-tertiary">{selectedRep.team_name || ''}</p></div></div>
                      <button onClick={() => setSelectedRep(null)} className="p-1.5 rounded-md hover:bg-surface-secondary text-text-tertiary"><X size={14} /></button>
                    </div>
                  </div>
                  <div className="p-5 space-y-4 flex-1">
                    <div><p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{fr ? 'Statut' : 'Status'}</p><div className="mt-1.5"><StatusBadgePill statusKey={selectedRep.tracking_status === 'active' ? 'active' : selectedRep.tracking_status === 'idle' ? 'pause' : 'inactive'} label={selectedRep.tracking_status === 'active' ? (fr ? 'En service' : 'Working') : selectedRep.tracking_status === 'idle' ? (fr ? 'En pause' : 'On break') : (fr ? 'Hors ligne' : 'Offline')} /></div></div>
                    {selectedRep.speed_mps != null && <div><p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{fr ? 'Vitesse' : 'Speed'}</p><p className="text-[14px] font-medium text-text-primary mt-1">{(selectedRep.speed_mps * 3.6).toFixed(0)} km/h</p></div>}
                    <div><p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{fr ? 'Dernière activité' : 'Last activity'}</p><p className="text-[14px] font-medium text-text-primary mt-1">{new Date(selectedRep.recorded_at).toLocaleTimeString(fr ? 'fr-CA' : 'en-CA')}</p></div>
                  </div>
                  <div className="p-4 border-t border-outline space-y-2">
                    <a href={`tel:${selectedRep.user_name}`} className="md:hidden w-full flex items-center justify-center gap-2 h-9 rounded-md bg-surface-card border border-outline text-text-primary text-[13px] font-medium hover:bg-surface-secondary transition-colors"><Phone size={13} /> {fr ? 'Contacter' : 'Contact'}</a>
                    <button onClick={() => setHubTab('feuilles')} className="w-full flex items-center justify-center gap-2 h-9 rounded-md bg-surface-card border border-outline text-text-primary text-[13px] font-medium hover:bg-surface-secondary transition-colors"><Eye size={13} /> {fr ? 'Voir feuille de temps' : 'View timesheet'}</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {hubTab === 'horaire' && (
        /* ════ HORAIRE VIEW — qui travaille dans quelle équipe, par jour ════ */
        <TeamScheduleGrid
          fr={fr}
          teams={teamsQuery.data ?? []}
          members={(membersQuery.data?.members ?? [])
            .filter(m => m.status === 'active')
            .map(m => ({ user_id: m.user_id, name: m.full_name?.trim() || m.email || (fr ? 'Sans nom' : 'Unnamed'), role: m.role }))
            .sort((a, b) => a.name.localeCompare(b.name))}
          canManage={canManageSchedule}
          currentUserId={myUserId}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          MODALS
          ═══════════════════════════════════════════════════════════════════ */}

      {/* Edit timesheet */}
      <AnimatePresence>
        {editingId && (
          <ModalShell open={!!editingId} onClose={() => setEditingId(null)} width="w-[380px]">
            <div className="p-6">
              <h3 className="text-[16px] font-bold text-text-primary mb-5">{fr ? 'Modifier les heures' : 'Edit hours'}</h3>
              <div className="space-y-4">
                <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Arrivée' : 'Clock-in'}</label><input type="time" value={editPunchIn} onChange={e => setEditPunchIn(e.target.value)} className="glass-input w-full mt-1.5" /></div>
                <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Départ' : 'Clock-out'}</label><input type="time" value={editPunchOut} onChange={e => setEditPunchOut(e.target.value)} className="glass-input w-full mt-1.5" /></div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setEditingId(null)} className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
                <button onClick={saveEdit} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90">{fr ? 'Sauvegarder' : 'Save'}</button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Note modal */}
      <AnimatePresence>
        {noteId && (
          <ModalShell open={!!noteId} onClose={() => setNoteId(null)}>
            <div className="p-6">
              <h3 className="text-[16px] font-bold text-text-primary mb-4">Note</h3>
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={4} placeholder={fr ? 'Ajouter une note...' : 'Add a note...'} className="glass-input w-full resize-none" />
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setNoteId(null)} className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
                <button onClick={saveNote} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90">{fr ? 'Sauvegarder' : 'Save'}</button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

    </div>
  );

  return (
    <PermissionGate permission="timesheets.read" fallback={<PermissionGate permission="timesheets.read">{content}</PermissionGate>}>
      {content}
    </PermissionGate>
  );
}
