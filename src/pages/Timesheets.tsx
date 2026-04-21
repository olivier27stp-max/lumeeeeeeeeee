import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Timer, ChevronLeft, ChevronRight, Clock, Coffee, Download,
  Calendar, User, Loader2, Check, Pencil, StickyNote, Power, AlertTriangle,
  Users, Activity, MapPin, Phone, Eye, X,
  MoreHorizontal, ArrowUpDown, Search, CirclePlus, Plus, Trash2, RefreshCw, Ban,
  Play, Square, Pause as PauseIcon,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { exportToCsv } from '../lib/exportCsv';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import PermissionGate from '../components/PermissionGate';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import {
  listTeams, createTeam, updateTeam, softDeleteTeam,
  type TeamRecord, type TeamInput,
} from '../lib/teamsApi';
import {
  listDateSlots, createDateSlot, updateDateSlot, deleteDateSlot, bulkCreateDateSlots,
  type DateSlotRecord, type DateSlotInput,
} from '../lib/dateAvailabilityApi';
import {
  listAvailability, createAvailability, deleteAvailability, setDefaultAvailability,
  minutesToTime, timeToMinutes, weekdayLabel,
  type AvailabilityRecord,
} from '../lib/availabilityApi';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type ViewMode = 'day' | 'week' | 'month';
type HubTab = 'feuilles' | 'carte' | 'disponibilites';

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
// AVAILABILITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TEAM_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6'];

function avStartOfWeek(date: Date): Date {
  const d = new Date(date); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff); d.setHours(0, 0, 0, 0); return d;
}
function avAddDays(date: Date, n: number): Date { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function avToDateStr(date: Date): string { return date.toISOString().slice(0, 10); }
function avFormatDate(dateStr: string, fr: boolean): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}
function avFormatTime(time: string): string { return time.slice(0, 5); }

// ═══════════════════════════════════════════════════════════════════════════════
// MAP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

function repMarkerIcon(name: string, color: string, status: string): L.DivIcon {
  const dot = status === 'active' ? '#22c55e' : status === 'idle' ? '#f59e0b' : '#6b7280';
  return L.divIcon({
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${color || '#3b82f6'};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;position:relative">${(name || '?')[0]}<div style="position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:${dot};border:2px solid white"></div></div>`,
    className: 'ts-rep-marker', iconSize: [34, 34], iconAnchor: [17, 17],
  });
}
function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lng], 14, { duration: 0.8 }); }, [lat, lng, map]);
  return null;
}

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
            className="absolute right-0 top-full mt-1 w-48 bg-surface border border-outline rounded-lg shadow-xl z-50 py-1 overflow-hidden">
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
        className={cn('bg-surface border border-outline rounded-xl shadow-2xl', width || 'w-[420px]')} onClick={e => e.stopPropagation()}>
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

  // ── Hub tab (check URL params for redirect from /availability) ──
  const [hubTab, setHubTab] = useState<HubTab>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'disponibilites') return 'disponibilites';
    return 'feuilles';
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FEUILLES STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState('all');
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

  // ── Map state ──
  const [liveReps, setLiveReps] = useState<LiveLocation[]>([]);
  const [selectedRep, setSelectedRep] = useState<LiveLocation | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPONIBILITÉS STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const [avSelectedTeamId, setAvSelectedTeamId] = useState('');
  const [avWeekStart, setAvWeekStart] = useState(() => avStartOfWeek(new Date()));
  const [teamModal, setTeamModal] = useState<{ open: boolean; editing?: TeamRecord }>({ open: false });
  const [teamForm, setTeamForm] = useState<TeamInput>({ name: '', color_hex: TEAM_COLORS[0] });
  const [slotModal, setSlotModal] = useState<{ open: boolean; editing?: DateSlotRecord }>({ open: false });
  const [slotForm, setSlotForm] = useState<DateSlotInput>({ team_id: '', slot_date: avToDateStr(new Date()), start_time: '08:00', end_time: '17:00' });
  const [slotStatus, setSlotStatus] = useState<'available' | 'blocked'>('available');
  const [slotNotes, setSlotNotes] = useState('');
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState<string | null>(null);
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [weeklyStart, setWeeklyStart] = useState('08:00');
  const [weeklyEnd, setWeeklyEnd] = useState('17:00');
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkDays, setBulkDays] = useState([true, true, true, true, true, false, false]);
  const [bulkStart, setBulkStart] = useState('08:00');
  const [bulkEnd, setBulkEnd] = useState('17:00');
  const [avTeamSearch, setAvTeamSearch] = useState('');

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
        id: e.id, employee_id: e.employee_id || e.id, employee_name: e.employee_name || 'Unknown',
        date: e.date, punch_in: e.punch_in?.slice(0, 5) || '09:00',
        punch_out: e.punch_out ? e.punch_out.slice(0, 5) : null,
        breaks: Array.isArray(e.breaks) ? e.breaks : [], notes: e.notes || null,
      }));
      setEntries(mapped);
      const empMap = new Map<string, string>();
      mapped.forEach(e => empMap.set(e.employee_id, e.employee_name));
      setEmployees(Array.from(empMap.entries()).map(([id, name]) => ({ id, name })));
    }
    setLoading(false);
  }, []);

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
    const ch = supabase.channel('ts-entries').on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => { loadData(); loadMySession(); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadData, loadMySession]);

  // ── Map data ──
  useEffect(() => {
    if (hubTab !== 'carte') return;
    const load = () => { import('../lib/trackingApi').then(({ getActiveLiveLocations }) => getActiveLiveLocations().then(setLiveReps).catch(() => {})); };
    load();
    const ch = supabase.channel('ts-live-reps').on('postgres_changes', { event: '*', schema: 'public', table: 'tracking_live_locations' }, load).subscribe();
    const poll = setInterval(load, 30000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [hubTab]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
        if (e.ctrlKey && e.key === 'a') { e.preventDefault(); selectAll(); }
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

  // ── Filtered entries ──
  const viewEntries = useMemo(() => {
    let pool = entries;
    if (selectedEmployee !== 'all') pool = pool.filter(e => e.employee_id === selectedEmployee);
    if (viewMode === 'day') { const ds = currentDate.toISOString().slice(0, 10); return pool.filter(e => e.date === ds); }
    if (viewMode === 'week') { const wk = new Set(getWeekDates(currentDate)); return pool.filter(e => wk.has(e.date)); }
    const y = currentDate.getFullYear(), mo = currentDate.getMonth();
    return pool.filter(e => { const d = new Date(e.date); return d.getFullYear() === y && d.getMonth() === mo; });
  }, [entries, selectedEmployee, currentDate, viewMode]);

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
  useEffect(() => { setPage(1); }, [tableSearch, statusFilter, viewMode, currentDate, selectedEmployee]);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const { data: membership } = await supabase.from('memberships').select('org_id, full_name').eq('user_id', user.id).limit(1).maybeSingle();
      const orgId = membership?.org_id;
      if (!orgId) throw new Error('No org found');
      const name = profile?.full_name || membership?.full_name || user.email || 'Unknown';
      const now = new Date();
      const { error } = await supabase.from('time_entries').insert({
        org_id: orgId,
        employee_id: user.id,
        employee_name: name,
        date: now.toISOString().slice(0, 10),
        punch_in: now.toTimeString().slice(0, 5),
        punch_in_at: now.toISOString(),
        status: 'active',
        breaks: [],
      });
      if (error) {
        if (error.message?.includes('one_active') || error.code === '23505') {
          toast.error(fr ? 'Session déjà active' : 'Already have an active session');
        } else throw error;
      } else {
        toast.success(fr ? 'Punch In !' : 'Punched In!');
        loadMySession();
        loadData();
      }
    } catch (err: any) { toast.error(err?.message || 'Error'); }
    finally { setTimerLoading(false); }
  };

  const handlePunchOut = async () => {
    if (!myActiveEntry) return;
    setTimerLoading(true);
    try {
      const now = new Date();
      const orgId = await getCurrentOrgIdOrThrow();
      const { error } = await supabase.from('time_entries').update({
        punch_out: now.toTimeString().slice(0, 5),
        punch_out_at: now.toISOString(),
        status: 'completed',
      }).eq('id', myActiveEntry.id).eq('org_id', orgId);
      if (error) throw error;
      toast.success(fr ? 'Punch Out !' : 'Punched Out!');
      setMyActiveEntry(null);
      loadData();
    } catch (err: any) { toast.error(err?.message || 'Error'); }
    finally { setTimerLoading(false); }
  };

  const handlePauseToggle = async () => {
    if (!myActiveEntry) return;
    setTimerLoading(true);
    try {
      const now = new Date().toISOString();
      const breaks = [...myActiveEntry.breaks];
      const lastBreak = breaks[breaks.length - 1];
      const onBrk = lastBreak && !lastBreak.end;
      if (onBrk) {
        breaks[breaks.length - 1] = { ...lastBreak, end: now };
      } else {
        breaks.push({ start: now, end: '' });
      }
      const orgId = await getCurrentOrgIdOrThrow();
      const { error } = await supabase.from('time_entries').update({ breaks }).eq('id', myActiveEntry.id).eq('org_id', orgId);
      if (error) throw error;
      toast.success(onBrk ? (fr ? 'Reprise !' : 'Resumed!') : (fr ? 'En pause' : 'Paused'));
      loadMySession();
    } catch (err: any) { toast.error(err?.message || 'Error'); }
    finally { setTimerLoading(false); }
  };

  const isOnBreak = myActiveEntry ? myActiveEntry.breaks.some((b: any) => b.start && !b.end) : false;

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPONIBILITÉS DATA
  // ═══════════════════════════════════════════════════════════════════════════

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams });
  const teams = teamsQuery.data || [];
  if (!avSelectedTeamId && teams.length > 0) setAvSelectedTeamId(teams[0].id);

  const weeklyQuery = useQuery({ queryKey: ['weeklyAvailability', avSelectedTeamId], queryFn: () => listAvailability(avSelectedTeamId), enabled: !!avSelectedTeamId });
  const weeklySlots = weeklyQuery.data || [];
  const avWeekEnd = avAddDays(avWeekStart, 6);
  const slotsQuery = useQuery({ queryKey: ['dateSlots', avSelectedTeamId, avToDateStr(avWeekStart)], queryFn: () => listDateSlots(avSelectedTeamId, avToDateStr(avWeekStart), avToDateStr(avWeekEnd)), enabled: !!avSelectedTeamId });
  const slots = slotsQuery.data || [];

  const slotsByDate = useMemo(() => {
    const map = new Map<string, DateSlotRecord[]>();
    for (let i = 0; i < 7; i++) map.set(avToDateStr(avAddDays(avWeekStart, i)), []);
    for (const s of slots) { const bucket = map.get(s.slot_date) || []; bucket.push(s); map.set(s.slot_date, bucket); }
    return map;
  }, [slots, avWeekStart]);

  const weeklyByDay = useMemo(() => {
    const map = new Map<number, AvailabilityRecord[]>();
    for (let d = 0; d < 7; d++) map.set(d, []);
    for (const s of weeklySlots) { const arr = map.get(s.weekday) || []; arr.push(s); map.set(s.weekday, arr); }
    return map;
  }, [weeklySlots]);

  const selectedTeam = teams.find(tm => tm.id === avSelectedTeamId);
  const filteredTeams = avTeamSearch ? teams.filter(tm => tm.name.toLowerCase().includes(avTeamSearch.toLowerCase())) : teams;

  // ── Availability mutations ──
  const createTeamMut = useMutation({ mutationFn: createTeam, onSuccess: (team) => { qc.invalidateQueries({ queryKey: ['teams'] }); toast.success(t.availability.teamCreated); setTeamModal({ open: false }); setAvSelectedTeamId(team.id); }, onError: (e: any) => toast.error(e?.message || t.availability.failedCreateTeam) });
  const updateTeamMut = useMutation({ mutationFn: ({ id, input }: { id: string; input: TeamInput }) => updateTeam(id, input), onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); toast.success(t.availability.teamUpdated); setTeamModal({ open: false }); }, onError: (e: any) => toast.error(e?.message || t.availability.failedUpdateTeam) });
  const deleteTeamMut = useMutation({ mutationFn: softDeleteTeam, onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); toast.success(t.availability.teamDeleted); setConfirmDeleteTeam(null); if (avSelectedTeamId === confirmDeleteTeam) setAvSelectedTeamId(''); }, onError: (e: any) => toast.error(e?.message || t.availability.failedDeleteTeam) });
  const createSlotMut = useMutation({ mutationFn: createDateSlot, onSuccess: () => { qc.invalidateQueries({ queryKey: ['dateSlots'] }); toast.success(t.availability.availabilityAdded); setSlotModal({ open: false }); }, onError: (e: any) => toast.error(e?.message || t.availability.failedAdd) });
  const updateSlotMut = useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<Omit<DateSlotInput, 'team_id'>> }) => updateDateSlot(id, input), onSuccess: () => { qc.invalidateQueries({ queryKey: ['dateSlots'] }); toast.success(t.availability.availabilityUpdated); setSlotModal({ open: false }); }, onError: (e: any) => toast.error(e?.message || t.availability.failedUpdate) });
  const deleteSlotMut = useMutation({ mutationFn: deleteDateSlot, onSuccess: () => { qc.invalidateQueries({ queryKey: ['dateSlots'] }); toast.success(t.availability.availabilityRemoved); }, onError: (e: any) => toast.error(e?.message || t.availability.failedRemove) });
  const bulkMut = useMutation({ mutationFn: ({ dates, start, end }: { dates: string[]; start: string; end: string }) => bulkCreateDateSlots(avSelectedTeamId, dates, start, end), onSuccess: () => { qc.invalidateQueries({ queryKey: ['dateSlots'] }); toast.success(t.availability.bulkAdded); setBulkModalOpen(false); }, onError: (e: any) => toast.error(e?.message || t.availability.failedBulk) });
  const addWeeklyMut = useMutation({ mutationFn: (input: { team_id: string; weekday: number; start_minute: number; end_minute: number }) => createAvailability(input), onSuccess: () => { qc.invalidateQueries({ queryKey: ['weeklyAvailability'] }); toast.success(fr ? 'Horaire mis à jour' : 'Schedule updated'); setWeeklyModalOpen(false); }, onError: (e: any) => toast.error(e?.message || 'Failed') });
  const deleteWeeklyMut = useMutation({ mutationFn: deleteAvailability, onSuccess: () => { qc.invalidateQueries({ queryKey: ['weeklyAvailability'] }); toast.success(fr ? 'Horaire supprimé' : 'Schedule removed'); }, onError: (e: any) => toast.error(e?.message || 'Failed') });
  const setDefaultMut = useMutation({ mutationFn: () => setDefaultAvailability(avSelectedTeamId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['weeklyAvailability'] }); toast.success(fr ? 'Lun-Ven 8-17 défini' : 'Mon-Fri 8-17 set'); }, onError: (e: any) => toast.error(e?.message || 'Failed') });

  // ── Availability handlers ──
  function openCreateTeam() { setTeamForm({ name: '', color_hex: TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)] }); setTeamModal({ open: true }); }
  function openEditTeam(team: TeamRecord) { setTeamForm({ name: team.name, color_hex: team.color_hex, description: team.description || '', is_active: team.is_active }); setTeamModal({ open: true, editing: team }); }
  function handleTeamSubmit() { if (teamModal.editing) updateTeamMut.mutate({ id: teamModal.editing.id, input: teamForm }); else createTeamMut.mutate(teamForm); }
  function openCreateSlot(dateStr?: string) { setSlotForm({ team_id: avSelectedTeamId, slot_date: dateStr || avToDateStr(new Date()), start_time: '08:00', end_time: '17:00' }); setSlotStatus('available'); setSlotNotes(''); setSlotModal({ open: true }); }
  function openEditSlot(slot: DateSlotRecord) { setSlotForm({ team_id: slot.team_id, slot_date: slot.slot_date, start_time: avFormatTime(slot.start_time), end_time: avFormatTime(slot.end_time) }); setSlotStatus(slot.status); setSlotNotes(slot.notes || ''); setSlotModal({ open: true, editing: slot }); }
  function handleSlotSubmit() { if (slotModal.editing) updateSlotMut.mutate({ id: slotModal.editing.id, input: { slot_date: slotForm.slot_date, start_time: slotForm.start_time, end_time: slotForm.end_time, status: slotStatus, notes: slotNotes } }); else createSlotMut.mutate({ ...slotForm, status: slotStatus, notes: slotNotes }); }
  function handleBulkSubmit() {
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) { if (bulkDays[i]) dates.push(avToDateStr(avAddDays(avWeekStart, i))); }
    if (dates.length === 0) return;
    bulkMut.mutate({ dates, start: bulkStart, end: bulkEnd });
  }

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
          <p className="text-[13px] text-text-tertiary mt-1">{fr ? 'Suivi des équipes, pointages, disponibilité et répartition terrain' : 'Team tracking, punches, availability and field distribution'}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Hub tabs */}
          <div className="flex rounded-md border border-outline overflow-hidden">
            {([['feuilles', fr ? 'Feuilles' : 'Timesheets'], ['carte', fr ? 'Carte' : 'Map'], ['disponibilites', fr ? 'Disponibilités' : 'Availability']] as [HubTab, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setHubTab(key)}
                className={cn('px-4 py-2 text-[13px] font-medium transition-all', hubTab === key ? 'bg-text-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-secondary')}>
                {label}
              </button>
            ))}
          </div>
          {/* Date controls for feuilles/carte */}
          {hubTab !== 'disponibilites' && (
            <>
              <div className="flex rounded-md border border-outline overflow-hidden">
                {(['day', 'week', 'month'] as ViewMode[]).map(m => (
                  <button key={m} onClick={() => setViewMode(m)} className={cn('px-3.5 py-2 text-[13px] font-medium transition-all', viewMode === m ? 'bg-text-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-secondary')}>
                    {m === 'day' ? (fr ? 'Jour' : 'Day') : m === 'week' ? (fr ? 'Semaine' : 'Week') : (fr ? 'Mois' : 'Month')}
                  </button>
                ))}
              </div>
              <button onClick={() => handleExport()} className="inline-flex items-center gap-2 h-9 px-4 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">
                <Download size={14} /> {fr ? 'Exporter' : 'Export'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Secondary bar: date nav (feuilles/carte) or nothing (dispo) ── */}
      {hubTab !== 'disponibilites' && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-outline bg-surface px-3 py-[7px]">
              <User size={14} className="text-text-tertiary" />
              <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} className="bg-transparent text-[13px] font-medium text-text-primary focus:outline-none cursor-pointer">
                <option value="all">{fr ? 'Tous les employés' : 'All employees'}</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>
            {alerts.map((a, i) => (
              <div key={i} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12px] font-medium', a.type === 'error' ? 'text-[#dc2626] border-red-200 bg-red-50' : 'text-[#c2410c] border-orange-200 bg-orange-50')}>
                <AlertTriangle size={12} /> {a.text}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => nav(-1)} className="h-9 w-9 flex items-center justify-center bg-surface border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronLeft size={16} /></button>
            <span className="text-[14px] font-semibold text-text-primary min-w-[220px] text-center tabular-nums">{dateLabel}</span>
            <button onClick={() => nav(1)} className="h-9 w-9 flex items-center justify-center bg-surface border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronRight size={16} /></button>
            <button onClick={() => setCurrentDate(new Date())} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">{fr ? "Aujourd'hui" : 'Today'}</button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB CONTENT
          ════════════════════════════════════════════════════════════════════ */}

      {hubTab === 'feuilles' && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard icon={Clock} label={fr ? "Heures aujourd'hui" : 'Hours today'} value={analytics.totalHours} />
            <KpiCard icon={Users} label={fr ? 'Employés actifs' : 'Active employees'} value={analytics.activeEmployees} accent={analytics.activeEmployees > 0 ? 'green' : undefined} />
            <KpiCard icon={Activity} label={fr ? 'En service' : 'Currently working'} value={analytics.currentlyWorking} accent={analytics.currentlyWorking > 0 ? 'green' : undefined} />
            <KpiCard icon={Coffee} label={fr ? 'Pauses totales' : 'Total breaks'} value={analytics.totalBreaks} accent={analytics.onBreak > 0 ? 'orange' : undefined} />
          </div>

          {/* ── Punch Timer Card ── */}
          <div className="rounded-2xl bg-surface-card border border-border shadow-card p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={cn('w-12 h-12 rounded-full flex items-center justify-center', myActiveEntry ? (isOnBreak ? 'bg-amber-100' : 'bg-emerald-100') : 'bg-surface-tertiary')}>
                  {myActiveEntry ? (isOnBreak ? <PauseIcon size={22} className="text-amber-600" /> : <Timer size={22} className="text-emerald-600 animate-pulse" />) : <Timer size={22} className="text-text-tertiary" />}
                </div>
                <div>
                  <p className="text-[13px] font-medium text-text-tertiary uppercase tracking-wider">
                    {myActiveEntry ? (isOnBreak ? (fr ? 'En pause' : 'On Break') : (fr ? 'En service' : 'Working')) : (fr ? 'Hors service' : 'Not Clocked In')}
                  </p>
                  <p className={cn('text-[28px] font-bold tabular-nums tracking-tight leading-none mt-1', myActiveEntry ? (isOnBreak ? 'text-amber-600' : 'text-emerald-600') : 'text-text-tertiary')}>
                    {timerElapsed}
                  </p>
                  {myActiveEntry && (
                    <p className="text-[11px] text-text-tertiary mt-1">
                      {fr ? 'Début' : 'Started'}: {new Date(myActiveEntry.punch_in_at).toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' })}
                      {myActiveEntry.breaks.length > 0 && ` · ${myActiveEntry.breaks.length} ${fr ? 'pause(s)' : 'break(s)'}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!myActiveEntry ? (
                  <button onClick={handlePunchIn} disabled={timerLoading}
                    className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-emerald-600 text-white font-semibold text-[14px] hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm">
                    {timerLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    {fr ? 'Punch In' : 'Punch In'}
                  </button>
                ) : (
                  <>
                    <button onClick={handlePauseToggle} disabled={timerLoading}
                      className={cn('inline-flex items-center gap-2 h-11 px-5 rounded-xl font-semibold text-[14px] transition-colors shadow-sm disabled:opacity-50',
                        isOnBreak ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-surface border border-outline text-text-primary hover:bg-surface-secondary')}>
                      {timerLoading ? <Loader2 size={16} className="animate-spin" /> : isOnBreak ? <Play size={16} /> : <PauseIcon size={16} />}
                      {isOnBreak ? (fr ? 'Reprendre' : 'Resume') : (fr ? 'Pause' : 'Pause')}
                    </button>
                    <button onClick={handlePunchOut} disabled={timerLoading}
                      className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-red-600 text-white font-semibold text-[14px] hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm">
                      {timerLoading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                      {fr ? 'Punch Out' : 'Punch Out'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

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
                    <button onClick={() => forceClockOut(item.id)} className="h-7 px-2.5 text-[11px] font-medium rounded-md bg-surface border border-outline text-text-primary hover:bg-surface-secondary transition-colors opacity-0 group-hover:opacity-100">
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

          {/* Filters */}
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              <input value={tableSearch} onChange={e => setTableSearch(e.target.value)} placeholder={fr ? 'Rechercher un employé...' : 'Search employees...'}
                className="h-9 w-[220px] pl-9 pr-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-text-tertiary transition-all" />
            </div>
            <button onClick={() => setStatusFilter(statusFilter === 'all' ? 'active' : statusFilter === 'active' ? 'pause' : statusFilter === 'pause' ? 'inactive' : 'all')}
              className={cn('inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors', statusFilter !== 'all' ? 'bg-text-primary text-white border-text-primary' : 'bg-surface text-text-primary border-outline hover:bg-surface-secondary')}>
              <CirclePlus size={15} className={statusFilter !== 'all' ? 'text-white' : 'text-[#64748b]'} />
              {fr ? 'Statut' : 'Status'}
              {statusFilter !== 'all' && <span className="text-[11px] opacity-80">({statusFilter === 'active' ? (fr ? 'Actif' : 'Active') : statusFilter === 'pause' ? 'Pause' : (fr ? 'Inactif' : 'Inactive')})</span>}
            </button>
          </div>

          {/* Table */}
          <div className="border border-outline rounded-md overflow-hidden bg-surface">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline">
                  <th className="w-[48px] pl-4 pr-1 py-3"><input type="checkbox" checked={selected.size === pagedRows.length && pagedRows.length > 0} onChange={() => selected.size === pagedRows.length ? selectNone() : setSelected(new Set(pagedRows.map(r => r.id)))} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" /></th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary">{fr ? 'Employé' : 'Employee'}</th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Statut' : 'Status'} <ArrowUpDown size={14} className="text-text-tertiary" /></span></th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Arrivée' : 'Clock-in'} <ArrowUpDown size={14} className="text-text-tertiary" /></span></th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary">{fr ? 'Départ' : 'Clock-out'}</th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Travaillé' : 'Worked'} <ArrowUpDown size={14} className="text-text-tertiary" /></span></th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary">{fr ? 'Pauses' : 'Breaks'}</th>
                  <th className="px-4 py-3 text-[14px] font-medium text-text-primary">{fr ? 'Problème' : 'Issue'}</th>
                  <th className="w-[100px]" />
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-outline/30"><td className="pl-4 pr-1 py-[13px]"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></td>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-[13px]"><div className="h-[18px] w-24 bg-surface-tertiary rounded animate-pulse" /></td>)}<td /><td /></tr>
                ))}
                {!loading && pagedRows.length === 0 && (
                  <tr><td colSpan={10} className="py-20 text-center"><Timer size={32} className="mx-auto text-text-tertiary opacity-20 mb-3" /><p className="text-[15px] font-semibold text-text-primary">{fr ? 'Aucune feuille de temps' : 'No timesheets'}</p><p className="text-[13px] text-text-tertiary mt-1">{fr ? 'Aucune entrée trouvée pour cette période.' : 'No entries found for this period.'}</p></td></tr>
                )}
                {!loading && pagedRows.map(row => (
                  <tr key={row.id} className={cn('border-b border-[#f1f5f9] transition-colors', selected.has(row.id) ? 'bg-[#f0f4ff]' : 'hover:bg-surface-secondary', row.issue && !selected.has(row.id) && 'bg-red-500/[0.02]')}>
                    <td className="pl-4 pr-1 py-[13px]" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" /></td>
                    <td className="px-4 py-[13px]"><div className="flex items-center gap-3"><UnifiedAvatar id={row.employee_id} name={row.employee_name} size={34} /><span className="text-[14px] font-medium text-text-primary">{row.employee_name}</span></div></td>
                    <td className="px-4 py-[13px]"><StatusBadgePill statusKey={row.statusKey} label={row.status} /></td>
                    <td className="px-4 py-[13px] text-[14px] text-text-secondary tabular-nums">{fmt12(row.punch_in)}</td>
                    <td className="px-4 py-[13px] text-[14px] text-text-secondary tabular-nums">{row.punch_out ? fmt12(row.punch_out) : <span className="text-text-tertiary">—</span>}</td>
                    <td className="px-4 py-[13px] text-[14px] font-medium text-text-primary tabular-nums">{row.liveWorked}</td>
                    <td className="px-4 py-[13px] text-[14px] text-text-secondary tabular-nums">{row.breakCount > 0 ? `${row.breakCount} (${formatH(row.breakMinutes)})` : <span className="text-text-tertiary">—</span>}</td>
                    <td className="px-4 py-[13px]"><IssueBadge issue={row.issue} /></td>
                    <td className="pr-4 py-[13px]" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setEditingId(row.id); setEditPunchIn(row.punch_in); setEditPunchOut(row.punch_out || ''); }}
                          className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
                          title={fr ? 'Modifier' : 'Edit'}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => { if (window.confirm(fr ? 'Supprimer cette entrée ?' : 'Delete this entry?')) deleteEntry(row.id); }}
                          className="p-1.5 rounded text-text-tertiary hover:text-red-600 hover:bg-red-50 transition-colors"
                          title={fr ? 'Supprimer' : 'Delete'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#64748b]">{selected.size} {fr ? 'sur' : 'of'} {filteredRows.length} {fr ? 'ligne(s) sélectionnée(s).' : 'row(s) selected.'}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary disabled:opacity-40 hover:bg-surface-secondary transition-colors cursor-pointer">{fr ? 'Précédent' : 'Previous'}</button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary disabled:opacity-40 hover:bg-surface-secondary transition-colors cursor-pointer">{fr ? 'Suivant' : 'Next'}</button>
            </div>
          </div>
        </>
      )}

      {hubTab === 'carte' && (
        /* ════ CARTE VIEW ════ */
        <>
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { color: 'bg-emerald-500', label: fr ? 'Actifs' : 'Active', count: liveReps.filter(r => r.tracking_status === 'active').length },
              { color: 'bg-amber-500', label: fr ? 'En pause' : 'Idle', count: liveReps.filter(r => r.tracking_status === 'idle').length },
              { color: 'bg-gray-400', label: fr ? 'Hors ligne' : 'Offline', count: liveReps.filter(r => r.tracking_status !== 'active' && r.tracking_status !== 'idle').length },
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
            <MapContainer center={[45.5017, -73.5673]} zoom={11} className="h-full w-full" style={{ background: '#f0f0f0' }} zoomControl={false}>
              <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap &copy; CARTO" />
              {flyTarget && <FlyTo lat={flyTarget.lat} lng={flyTarget.lng} />}
              {liveReps.map(rep => (
                <Marker key={rep.user_id} position={[rep.latitude, rep.longitude]} icon={repMarkerIcon(rep.user_name || '?', rep.team_color || '#3b82f6', rep.tracking_status)}
                  eventHandlers={{ click: () => { setSelectedRep(rep); setFlyTarget({ lat: rep.latitude, lng: rep.longitude }); } }}>
                  <Tooltip direction="top" offset={[0, -20]}><div style={{ fontSize: 11 }}><div style={{ fontWeight: 700 }}>{rep.user_name || 'Unknown'}</div><div style={{ fontSize: 9, color: '#9ca3af' }}>{rep.tracking_status === 'active' ? (fr ? 'En service' : 'Working') : rep.tracking_status === 'idle' ? (fr ? 'En pause' : 'Idle') : (fr ? 'Hors ligne' : 'Offline')}</div></div></Tooltip>
                </Marker>
              ))}
            </MapContainer>
            <AnimatePresence>
              {selectedRep && (
                <motion.div initial={{ x: 400, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 400, opacity: 0 }}
                  className="absolute right-0 top-0 bottom-0 w-[340px] bg-surface border-l border-outline shadow-2xl z-[500] flex flex-col">
                  <div className="p-5 border-b border-outline">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3"><UnifiedAvatar id={selectedRep.user_id} name={selectedRep.user_name || 'Unknown'} size={36} /><div><h3 className="text-[14px] font-bold text-text-primary">{selectedRep.user_name || 'Unknown'}</h3><p className="text-[11px] text-text-tertiary">{selectedRep.team_name || ''}</p></div></div>
                      <button onClick={() => setSelectedRep(null)} className="p-1.5 rounded-md hover:bg-surface-secondary text-text-tertiary"><X size={14} /></button>
                    </div>
                  </div>
                  <div className="p-5 space-y-4 flex-1">
                    <div><p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{fr ? 'Statut' : 'Status'}</p><div className="mt-1.5"><StatusBadgePill statusKey={selectedRep.tracking_status === 'active' ? 'active' : selectedRep.tracking_status === 'idle' ? 'pause' : 'inactive'} label={selectedRep.tracking_status === 'active' ? (fr ? 'En service' : 'Working') : selectedRep.tracking_status === 'idle' ? (fr ? 'En pause' : 'On break') : (fr ? 'Hors ligne' : 'Offline')} /></div></div>
                    {selectedRep.speed_mps != null && <div><p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{fr ? 'Vitesse' : 'Speed'}</p><p className="text-[14px] font-medium text-text-primary mt-1">{(selectedRep.speed_mps * 3.6).toFixed(0)} km/h</p></div>}
                    <div><p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{fr ? 'Dernière activité' : 'Last activity'}</p><p className="text-[14px] font-medium text-text-primary mt-1">{new Date(selectedRep.recorded_at).toLocaleTimeString()}</p></div>
                  </div>
                  <div className="p-4 border-t border-outline space-y-2">
                    <a href={`tel:${selectedRep.user_name}`} className="w-full flex items-center justify-center gap-2 h-9 rounded-md bg-surface border border-outline text-text-primary text-[13px] font-medium hover:bg-surface-secondary transition-colors"><Phone size={13} /> {fr ? 'Contacter' : 'Contact'}</a>
                    <button onClick={() => setHubTab('feuilles')} className="w-full flex items-center justify-center gap-2 h-9 rounded-md bg-surface border border-outline text-text-primary text-[13px] font-medium hover:bg-surface-secondary transition-colors"><Eye size={13} /> {fr ? 'Voir feuille de temps' : 'View timesheet'}</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {hubTab === 'disponibilites' && (
        /* ════ DISPONIBILITÉS VIEW ════ */
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
          {/* ── LEFT: Teams Panel ── */}
          <div className="rounded-2xl bg-surface-card border border-border shadow-card flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-text-primary flex items-center gap-2"><Users size={16} /> {fr ? 'Équipes' : 'Teams'}</h2>
              <button onClick={openCreateTeam} className="inline-flex items-center gap-1.5 h-8 px-3 bg-text-primary text-white rounded-md text-[12px] font-medium hover:opacity-90 transition-all">
                <Plus size={13} /> {fr ? 'Ajouter' : 'Add'}
              </button>
            </div>
            <div className="px-5 pb-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                <input value={avTeamSearch} onChange={e => setAvTeamSearch(e.target.value)} placeholder={fr ? 'Rechercher une équipe...' : 'Search teams...'}
                  className="h-8 w-full pl-8 pr-3 text-[13px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-text-tertiary transition-all" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
              {filteredTeams.length === 0 && (
                <div className="py-10 text-center">
                  <Users size={28} className="mx-auto text-text-tertiary opacity-20 mb-2" />
                  <p className="text-[13px] font-medium text-text-primary">{fr ? 'Aucune équipe' : 'No teams'}</p>
                  <p className="text-[12px] text-text-tertiary mt-0.5">{fr ? 'Créez votre première équipe' : 'Create your first team'}</p>
                </div>
              )}
              {filteredTeams.map(team => (
                <div key={team.id} onClick={() => setAvSelectedTeamId(team.id)}
                  className={cn('flex items-center gap-3 rounded-lg px-3.5 py-3 cursor-pointer transition-all group',
                    avSelectedTeamId === team.id ? 'bg-surface-secondary border border-outline shadow-sm' : 'hover:bg-surface-secondary border border-transparent')}>
                  <span className="h-3.5 w-3.5 rounded-full shrink-0 ring-2 ring-white shadow-sm" style={{ backgroundColor: team.color_hex }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text-primary truncate">{team.name}</span>
                      {!team.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 font-medium">{fr ? 'Inactive' : 'Inactive'}</span>}
                    </div>
                    {team.description && <p className="text-[11px] text-text-tertiary truncate mt-0.5">{team.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={e => { e.stopPropagation(); openEditTeam(team); }} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary"><Pencil size={12} /></button>
                    <button onClick={e => { e.stopPropagation(); setConfirmDeleteTeam(team.id); }} className="p-1.5 rounded-md text-text-tertiary hover:text-red-600 hover:bg-red-50"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Workspace ── */}
          <div className="space-y-5">
            {!avSelectedTeamId ? (
              <div className="rounded-2xl bg-surface-card border border-border shadow-card py-20 text-center">
                <Calendar size={32} className="mx-auto text-text-tertiary opacity-20 mb-3" />
                <p className="text-[15px] font-semibold text-text-primary">{fr ? 'Sélectionnez une équipe' : 'Select a team'}</p>
                <p className="text-[13px] text-text-tertiary mt-1">{fr ? 'Choisissez une équipe pour gérer sa disponibilité' : 'Choose a team to manage its availability'}</p>
              </div>
            ) : (
              <>
                {/* Workspace header */}
                <div className="rounded-2xl bg-surface-card border border-border shadow-card px-5 py-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      {selectedTeam && <span className="h-4 w-4 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: selectedTeam.color_hex }} />}
                      <span className="text-[16px] font-semibold text-text-primary">{selectedTeam?.name}</span>
                      {selectedTeam && !selectedTeam.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 font-medium">{fr ? 'Inactive' : 'Inactive'}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setAvWeekStart(avAddDays(avWeekStart, -7))} className="h-9 w-9 flex items-center justify-center bg-surface border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronLeft size={16} /></button>
                      <span className="text-[13px] font-semibold text-text-primary min-w-[200px] text-center tabular-nums">{avFormatDate(avToDateStr(avWeekStart), fr)} — {avFormatDate(avToDateStr(avWeekEnd), fr)}</span>
                      <button onClick={() => setAvWeekStart(avAddDays(avWeekStart, 7))} className="h-9 w-9 flex items-center justify-center bg-surface border border-outline rounded-md hover:bg-surface-secondary transition-colors"><ChevronRight size={16} /></button>
                      <button onClick={() => setAvWeekStart(avStartOfWeek(new Date()))} className="h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">{fr ? 'Cette semaine' : 'This week'}</button>
                      <button onClick={() => { setBulkDays([true,true,true,true,true,false,false]); setBulkStart('08:00'); setBulkEnd('17:00'); setBulkModalOpen(true); }}
                        className="h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">{fr ? 'Ajout en lot' : 'Bulk add'}</button>
                      <button onClick={() => openCreateSlot()} className="inline-flex items-center gap-1.5 h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90 transition-all">
                        <Plus size={14} /> {fr ? 'Ajouter un créneau' : 'Add slot'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Weekly default schedule */}
                <div className="rounded-2xl bg-surface-card border border-border shadow-card">
                  <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <div>
                      <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2"><RefreshCw size={14} className="text-text-tertiary" /> {fr ? 'Horaire hebdomadaire par défaut' : 'Default Weekly Schedule'}</h3>
                      <p className="text-[12px] text-text-tertiary mt-0.5">{fr ? 'Disponibilité récurrente normale de cette équipe' : 'Recurring default availability for this team'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {weeklySlots.length === 0 && (
                        <button onClick={() => setDefaultMut.mutate()} disabled={setDefaultMut.isPending}
                          className="h-8 px-3 bg-surface border border-outline rounded-md text-[12px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">
                          {fr ? 'Définir lun-ven 8–17' : 'Set Mon-Fri 8-17'}
                        </button>
                      )}
                      <button onClick={() => { setWeeklyDay(1); setWeeklyStart('08:00'); setWeeklyEnd('17:00'); setWeeklyModalOpen(true); }}
                        className="inline-flex items-center gap-1 h-8 px-3 bg-text-primary text-white rounded-md text-[12px] font-medium hover:opacity-90 transition-all">
                        <Plus size={12} /> {fr ? 'Ajouter' : 'Add'}
                      </button>
                    </div>
                  </div>
                  <div className="px-5 pb-5">
                    {weeklySlots.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-outline bg-surface-secondary/50 py-6 text-center">
                        <Clock size={24} className="mx-auto text-text-tertiary opacity-30 mb-2" />
                        <p className="text-[13px] font-medium text-text-primary">{fr ? 'Aucun horaire hebdomadaire défini' : 'No default schedule set'}</p>
                        <p className="text-[12px] text-text-tertiary mt-0.5">{fr ? "L'équipe sera disponible uniquement lors des créneaux ajoutés manuellement" : 'Team will only be available on specifically added dates'}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-7 gap-2">
                        {[1, 2, 3, 4, 5, 6, 0].map(day => {
                          const daySlots = weeklyByDay.get(day) || [];
                          const dayNames = fr ? ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                          const dayLabel = dayNames[day];
                          return (
                            <div key={day} className={cn('rounded-lg border p-2.5 text-center', daySlots.length > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-outline bg-surface-secondary/30')}>
                              <p className="text-[11px] font-semibold text-text-tertiary uppercase mb-1.5">{dayLabel}</p>
                              {daySlots.length === 0 ? (
                                <p className="text-[11px] text-text-tertiary">{fr ? 'Fermé' : 'Off'}</p>
                              ) : daySlots.map(s => (
                                <div key={s.id} className="group relative bg-emerald-100/60 rounded px-1.5 py-1 mb-1">
                                  <span className="text-[11px] font-medium text-emerald-700 tabular-nums">{minutesToTime(s.start_minute)}–{minutesToTime(s.end_minute)}</span>
                                  <button onClick={() => deleteWeeklyMut.mutate(s.id)} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-surface border border-outline text-text-tertiary hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><X size={8} /></button>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Date overrides */}
                <div className="rounded-2xl bg-surface-card border border-border shadow-card">
                  <div className="flex items-center gap-2 px-5 pt-5 pb-3">
                    <Calendar size={14} className="text-text-tertiary" />
                    <h3 className="text-[14px] font-semibold text-text-primary">{fr ? 'Overrides & exceptions de dates' : 'Date Overrides & Exceptions'}</h3>
                    <span className="text-[12px] text-text-tertiary">— {fr ? "Remplace l'horaire hebdomadaire pour des journées précises" : 'Override default schedule for specific days'}</span>
                  </div>
                  <div className="px-5 pb-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                      {Array.from(slotsByDate.entries()).map(([dateStr, daySlots]) => {
                        const hasSlots = daySlots.length > 0;
                        const hasBlocked = daySlots.some(s => s.status === 'blocked');
                        const tagLabel = !hasSlots ? (fr ? 'Par défaut' : 'Default') : hasBlocked ? (fr ? 'Exception' : 'Exception') : (fr ? 'Personnalisé' : 'Custom');
                        const tagColor = !hasSlots ? 'text-text-tertiary bg-surface-secondary border-outline' : hasBlocked ? 'text-red-600 bg-red-50 border-red-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200';
                        return (
                          <div key={dateStr} className={cn('rounded-xl border p-3.5 min-h-[130px] flex flex-col', hasSlots ? 'border-outline bg-surface' : 'border-dashed border-outline bg-surface-secondary/30')}>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-[12px] font-semibold text-text-primary">{avFormatDate(dateStr, fr)}</h4>
                              <button onClick={() => openCreateSlot(dateStr)} className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary"><Plus size={13} /></button>
                            </div>
                            <span className={cn('self-start inline-block rounded-full border px-2 py-[1px] text-[9px] font-semibold uppercase tracking-wider leading-[14px] mb-2', tagColor)}>{tagLabel}</span>
                            <div className="flex-1 space-y-1.5">
                              {daySlots.length === 0 ? (
                                <p className="text-[11px] text-text-tertiary italic">{fr ? 'Horaire par défaut appliqué' : 'Default schedule applied'}</p>
                              ) : daySlots.map(slot => (
                                <div key={slot.id} className={cn('rounded-md px-2 py-1.5 group/slot flex items-start justify-between gap-1', slot.status === 'available' ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200')}>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      {slot.status === 'available' ? <Check size={11} className="text-emerald-600 shrink-0" /> : <Ban size={11} className="text-red-500 shrink-0" />}
                                      <span className="text-[11px] font-medium text-text-primary tabular-nums">{avFormatTime(slot.start_time)} – {avFormatTime(slot.end_time)}</span>
                                    </div>
                                    {slot.notes && <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{slot.notes}</p>}
                                  </div>
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover/slot:opacity-100 transition-opacity shrink-0">
                                    <button onClick={() => openEditSlot(slot)} className="p-0.5 rounded text-text-tertiary hover:text-text-primary"><Pencil size={10} /></button>
                                    <button onClick={() => deleteSlotMut.mutate(slot.id)} className="p-0.5 rounded text-text-tertiary hover:text-red-600"><Trash2 size={10} /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
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
                <button onClick={() => setEditingId(null)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
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
                <button onClick={() => setNoteId(null)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
                <button onClick={saveNote} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90">{fr ? 'Sauvegarder' : 'Save'}</button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Team modal */}
      {teamModal.open && (
        <ModalShell open onClose={() => setTeamModal({ open: false })}>
          <div className="p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-text-primary">{teamModal.editing ? (fr ? 'Modifier l\'équipe' : 'Edit Team') : (fr ? 'Ajouter une équipe' : 'Add Team')}</h3>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Nom' : 'Name'}</label><input value={teamForm.name} onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} className="glass-input mt-1.5 w-full" placeholder={fr ? 'Ex: Équipe Installation' : 'e.g. Installation Team'} autoFocus /></div>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">Description</label><input value={teamForm.description || ''} onChange={e => setTeamForm(f => ({ ...f, description: e.target.value }))} className="glass-input mt-1.5 w-full" placeholder={fr ? 'Optionnel...' : 'Optional...'} /></div>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Couleur' : 'Color'}</label><div className="flex flex-wrap gap-2 mt-2">{TEAM_COLORS.map(c => (<button key={c} onClick={() => setTeamForm(f => ({ ...f, color_hex: c }))} className={cn('h-7 w-7 rounded-full transition-all', teamForm.color_hex === c ? 'ring-2 ring-offset-2 ring-text-primary scale-110' : 'hover:scale-105')} style={{ backgroundColor: c }} />))}</div></div>
            {teamModal.editing && (
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Statut' : 'Status'}</label>
                <button onClick={() => setTeamForm(f => ({ ...f, is_active: !f.is_active }))} className={cn('text-[12px] px-2.5 py-1 rounded-full font-medium border', teamForm.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface-secondary text-text-tertiary border-outline')}>{teamForm.is_active ? (fr ? 'Active' : 'Active') : (fr ? 'Inactive' : 'Inactive')}</button>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setTeamModal({ open: false })} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
              <button onClick={handleTeamSubmit} disabled={!teamForm.name.trim() || createTeamMut.isPending || updateTeamMut.isPending} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-50">{createTeamMut.isPending || updateTeamMut.isPending ? '...' : teamModal.editing ? (fr ? 'Sauvegarder' : 'Save') : (fr ? 'Créer' : 'Create')}</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Slot modal */}
      {slotModal.open && (
        <ModalShell open onClose={() => setSlotModal({ open: false })}>
          <div className="p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-text-primary">{slotModal.editing ? (fr ? 'Modifier le créneau' : 'Edit Slot') : (fr ? 'Ajouter un créneau' : 'Add Slot')}</h3>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Date' : 'Date'}</label><input type="date" value={slotForm.slot_date} onChange={e => setSlotForm(f => ({ ...f, slot_date: e.target.value }))} className="glass-input mt-1.5 w-full" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Début' : 'Start'}</label><input type="time" value={slotForm.start_time} onChange={e => setSlotForm(f => ({ ...f, start_time: e.target.value }))} className="glass-input mt-1.5 w-full" /></div>
              <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Fin' : 'End'}</label><input type="time" value={slotForm.end_time} onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))} className="glass-input mt-1.5 w-full" /></div>
            </div>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Statut' : 'Status'}</label>
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => setSlotStatus('available')} className={cn('flex-1 text-[13px] py-2 rounded-md font-medium border transition-colors', slotStatus === 'available' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface text-text-tertiary border-outline hover:bg-surface-secondary')}>{fr ? 'Disponible' : 'Available'}</button>
                <button onClick={() => setSlotStatus('blocked')} className={cn('flex-1 text-[13px] py-2 rounded-md font-medium border transition-colors', slotStatus === 'blocked' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-surface text-text-tertiary border-outline hover:bg-surface-secondary')}>{fr ? 'Bloqué' : 'Blocked'}</button>
              </div>
            </div>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Notes' : 'Notes'}</label><input value={slotNotes} onChange={e => setSlotNotes(e.target.value)} className="glass-input mt-1.5 w-full" placeholder={fr ? 'Optionnel...' : 'Optional...'} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSlotModal({ open: false })} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
              <button onClick={handleSlotSubmit} disabled={createSlotMut.isPending || updateSlotMut.isPending} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-50">{createSlotMut.isPending || updateSlotMut.isPending ? '...' : slotModal.editing ? (fr ? 'Sauvegarder' : 'Save') : (fr ? 'Ajouter' : 'Add')}</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Delete team confirmation */}
      {confirmDeleteTeam && (
        <ModalShell open onClose={() => setConfirmDeleteTeam(null)} width="w-[380px]">
          <div className="p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-text-primary">{fr ? 'Supprimer l\'équipe' : 'Delete Team'}</h3>
            <p className="text-[13px] text-text-secondary">{fr ? 'Cette action est irréversible. Continuer ?' : 'This action cannot be undone. Continue?'}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteTeam(null)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
              <button onClick={() => deleteTeamMut.mutate(confirmDeleteTeam)} disabled={deleteTeamMut.isPending} className="h-9 px-4 bg-red-600 text-white rounded-md text-[13px] font-medium hover:bg-red-700 disabled:opacity-50">{deleteTeamMut.isPending ? '...' : (fr ? 'Supprimer' : 'Delete')}</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Weekly schedule modal */}
      {weeklyModalOpen && (
        <ModalShell open onClose={() => setWeeklyModalOpen(false)} width="w-[380px]">
          <div className="p-6 space-y-4">
            <div><h3 className="text-[16px] font-bold text-text-primary">{fr ? 'Ajouter un horaire récurrent' : 'Add Default Schedule'}</h3><p className="text-[12px] text-text-tertiary mt-1">{fr ? 'Sera répété chaque semaine automatiquement' : 'Will repeat every week automatically'}</p></div>
            <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Jour' : 'Day'}</label><select value={weeklyDay} onChange={e => setWeeklyDay(Number(e.target.value))} className="glass-input mt-1.5 w-full">{[1,2,3,4,5,6,0].map(d => <option key={d} value={d}>{weekdayLabel(d)}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Début' : 'Start'}</label><input type="time" value={weeklyStart} onChange={e => setWeeklyStart(e.target.value)} className="glass-input mt-1.5 w-full" /></div>
              <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Fin' : 'End'}</label><input type="time" value={weeklyEnd} onChange={e => setWeeklyEnd(e.target.value)} className="glass-input mt-1.5 w-full" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setWeeklyModalOpen(false)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
              <button disabled={addWeeklyMut.isPending} onClick={() => addWeeklyMut.mutate({ team_id: avSelectedTeamId, weekday: weeklyDay, start_minute: timeToMinutes(weeklyStart), end_minute: timeToMinutes(weeklyEnd) })} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-50">{addWeeklyMut.isPending ? '...' : (fr ? 'Ajouter' : 'Add')}</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Bulk add modal */}
      {bulkModalOpen && (
        <ModalShell open onClose={() => setBulkModalOpen(false)}>
          <div className="p-6 space-y-4">
            <div><h3 className="text-[16px] font-bold text-text-primary">{fr ? 'Ajout en lot' : 'Bulk Add Slots'}</h3><p className="text-[12px] text-text-tertiary mt-1">{fr ? 'Ajouter des créneaux sur plusieurs jours' : 'Add slots across multiple days'}</p></div>
            <div>
              <label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Jours' : 'Days'}</label>
              <div className="flex gap-2 mt-2">
                {(fr ? ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map((d, i) => (
                  <button key={i} onClick={() => { const n = [...bulkDays]; n[i] = !n[i]; setBulkDays(n); }}
                    className={cn('h-9 w-11 rounded-md text-[12px] font-medium border transition-colors', bulkDays[i] ? 'bg-text-primary text-white border-text-primary' : 'bg-surface text-text-secondary border-outline hover:bg-surface-secondary')}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Début' : 'Start'}</label><input type="time" value={bulkStart} onChange={e => setBulkStart(e.target.value)} className="glass-input mt-1.5 w-full" /></div>
              <div><label className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">{fr ? 'Fin' : 'End'}</label><input type="time" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)} className="glass-input mt-1.5 w-full" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setBulkModalOpen(false)} className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] font-medium text-text-primary hover:bg-surface-secondary">{fr ? 'Annuler' : 'Cancel'}</button>
              <button onClick={handleBulkSubmit} disabled={bulkMut.isPending} className="h-9 px-4 bg-text-primary text-white rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-50">{bulkMut.isPending ? '...' : (fr ? 'Appliquer' : 'Apply')}</button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );

  return (
    <PermissionGate permission="timesheets.read" fallback={<PermissionGate permission="timesheets.read">{content}</PermissionGate>}>
      {content}
    </PermissionGate>
  );
}
