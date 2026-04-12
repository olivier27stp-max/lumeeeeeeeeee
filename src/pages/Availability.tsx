import React, { useMemo, useState } from 'react';
import {
  Plus, Trash2, Clock, RefreshCw, Pencil, Users, Calendar,
  ChevronLeft, ChevronRight, Check, X, Ban,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { cn } from '../lib/utils';
import { PageHeader, EmptyState } from '../components/ui';
import { useTranslation } from '../i18n';

/* ── Helpers ─────────────────────────────────────────────────── */

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
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
  return date.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(time: string): string {
  return time.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'
}

/* ── Constants ───────────────────────────────────────────────── */

const TEAM_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
];

/* ── Main Component ──────────────────────────────────────────── */

export default function Availability() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── State ──
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  // Team modal
  const [teamModal, setTeamModal] = useState<{ open: boolean; editing?: TeamRecord }>({ open: false });
  const [teamForm, setTeamForm] = useState<TeamInput>({ name: '', color_hex: TEAM_COLORS[0] });

  // Slot modal
  const [slotModal, setSlotModal] = useState<{ open: boolean; editing?: DateSlotRecord }>({ open: false });
  const [slotForm, setSlotForm] = useState<DateSlotInput>({
    team_id: '', slot_date: toDateStr(new Date()), start_time: '08:00', end_time: '17:00',
  });
  const [slotStatus, setSlotStatus] = useState<'available' | 'blocked'>('available');
  const [slotNotes, setSlotNotes] = useState('');

  // Delete confirmation
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState<string | null>(null);

  // Weekly schedule
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [weeklyDay, setWeeklyDay] = useState(1); // Monday
  const [weeklyStart, setWeeklyStart] = useState('08:00');
  const [weeklyEnd, setWeeklyEnd] = useState('17:00');

  // ── Queries ──
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams });
  const teams = teamsQuery.data || [];

  // Auto-select first team
  if (!selectedTeamId && teams.length > 0) {
    setSelectedTeamId(teams[0].id);
  }

  // Weekly recurring availability
  const weeklyQuery = useQuery({
    queryKey: ['weeklyAvailability', selectedTeamId],
    queryFn: () => listAvailability(selectedTeamId),
    enabled: !!selectedTeamId,
  });
  const weeklySlots = weeklyQuery.data || [];

  const weekEnd = addDays(weekStart, 6);
  const slotsQuery = useQuery({
    queryKey: ['dateSlots', selectedTeamId, toDateStr(weekStart)],
    queryFn: () => listDateSlots(selectedTeamId, toDateStr(weekStart), toDateStr(weekEnd)),
    enabled: !!selectedTeamId,
  });
  const slots = slotsQuery.data || [];

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const map = new Map<string, DateSlotRecord[]>();
    for (let i = 0; i < 7; i++) {
      const d = toDateStr(addDays(weekStart, i));
      map.set(d, []);
    }
    for (const s of slots) {
      const bucket = map.get(s.slot_date) || [];
      bucket.push(s);
      map.set(s.slot_date, bucket);
    }
    return map;
  }, [slots, weekStart]);

  // ── Team mutations ──
  const createTeamMut = useMutation({
    mutationFn: createTeam,
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success(t.availability.teamCreated);
      setTeamModal({ open: false });
      setSelectedTeamId(team.id);
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedCreateTeam),
  });

  const updateTeamMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TeamInput }) => updateTeam(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success(t.availability.teamUpdated);
      setTeamModal({ open: false });
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedUpdateTeam),
  });

  const deleteTeamMut = useMutation({
    mutationFn: softDeleteTeam,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success(t.availability.teamDeleted);
      setConfirmDeleteTeam(null);
      if (selectedTeamId === confirmDeleteTeam) setSelectedTeamId('');
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedDeleteTeam),
  });

  // ── Slot mutations ──
  const createSlotMut = useMutation({
    mutationFn: createDateSlot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dateSlots'] });
      toast.success(t.availability.availabilityAdded);
      setSlotModal({ open: false });
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedAdd),
  });

  const updateSlotMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<DateSlotInput, 'team_id'>> }) =>
      updateDateSlot(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dateSlots'] });
      toast.success(t.availability.availabilityUpdated);
      setSlotModal({ open: false });
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedUpdate),
  });

  const deleteSlotMut = useMutation({
    mutationFn: deleteDateSlot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dateSlots'] });
      toast.success(t.availability.availabilityRemoved);
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedRemove),
  });

  const bulkMut = useMutation({
    mutationFn: () => {
      const dates: string[] = [];
      for (let i = 0; i < 5; i++) dates.push(toDateStr(addDays(weekStart, i))); // Mon-Fri
      return bulkCreateDateSlots(selectedTeamId, dates, '08:00', '17:00');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dateSlots'] });
      toast.success(t.availability.bulkAdded);
    },
    onError: (e: any) => toast.error(e?.message || t.availability.failedBulk),
  });

  // ── Weekly mutations ──
  const addWeeklyMut = useMutation({
    mutationFn: (input: { team_id: string; weekday: number; start_minute: number; end_minute: number }) =>
      createAvailability(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeklyAvailability'] });
      toast.success('Default schedule updated');
      setWeeklyModalOpen(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to add schedule'),
  });

  const deleteWeeklyMut = useMutation({
    mutationFn: deleteAvailability,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeklyAvailability'] });
      toast.success('Schedule removed');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to remove'),
  });

  const setDefaultMut = useMutation({
    mutationFn: () => setDefaultAvailability(selectedTeamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeklyAvailability'] });
      toast.success('Default Mon-Fri 8:00-17:00 set');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to set defaults'),
  });

  // Group weekly by day
  const weeklyByDay = useMemo(() => {
    const map = new Map<number, AvailabilityRecord[]>();
    for (let d = 0; d < 7; d++) map.set(d, []);
    for (const s of weeklySlots) {
      const arr = map.get(s.weekday) || [];
      arr.push(s);
      map.set(s.weekday, arr);
    }
    return map;
  }, [weeklySlots]);

  // ── Handlers ──
  function openCreateTeam() {
    setTeamForm({ name: '', color_hex: TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)] });
    setTeamModal({ open: true });
  }

  function openEditTeam(team: TeamRecord) {
    setTeamForm({ name: team.name, color_hex: team.color_hex, description: team.description || '', is_active: team.is_active });
    setTeamModal({ open: true, editing: team });
  }

  function handleTeamSubmit() {
    if (teamModal.editing) {
      updateTeamMut.mutate({ id: teamModal.editing.id, input: teamForm });
    } else {
      createTeamMut.mutate(teamForm);
    }
  }

  function openCreateSlot(dateStr?: string) {
    setSlotForm({
      team_id: selectedTeamId,
      slot_date: dateStr || toDateStr(new Date()),
      start_time: '08:00',
      end_time: '17:00',
    });
    setSlotStatus('available');
    setSlotNotes('');
    setSlotModal({ open: true });
  }

  function openEditSlot(slot: DateSlotRecord) {
    setSlotForm({
      team_id: slot.team_id,
      slot_date: slot.slot_date,
      start_time: formatTime(slot.start_time),
      end_time: formatTime(slot.end_time),
    });
    setSlotStatus(slot.status);
    setSlotNotes(slot.notes || '');
    setSlotModal({ open: true, editing: slot });
  }

  function handleSlotSubmit() {
    if (slotModal.editing) {
      updateSlotMut.mutate({
        id: slotModal.editing.id,
        input: {
          slot_date: slotForm.slot_date,
          start_time: slotForm.start_time,
          end_time: slotForm.end_time,
          status: slotStatus,
          notes: slotNotes,
        },
      });
    } else {
      createSlotMut.mutate({ ...slotForm, status: slotStatus, notes: slotNotes });
    }
  }

  const selectedTeam = teams.find((tm) => tm.id === selectedTeamId);

  // ── Render ──
  return (
    <div className="space-y-8">
      <PageHeader title={t.availability.title} subtitle={t.availability.subtitle}>
        <button type="button" onClick={() => { teamsQuery.refetch(); slotsQuery.refetch(); }} className="glass-button inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> {t.common.refresh}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        {/* ═══ LEFT: Team List ═══ */}
        <div className="section-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
              <Users size={15} /> {t.availability.teams}
            </h2>
            <button type="button" onClick={openCreateTeam} className="glass-button-primary text-[12px] inline-flex items-center gap-1 px-2.5 py-1">
              <Plus size={13} /> {t.availability.addTeam}
            </button>
          </div>

          {teams.length === 0 && (
            <EmptyState icon={Users} title={t.availability.noTeamsYet} description={t.availability.createTeamsFirst} />
          )}

          <div className="space-y-1.5">
            {teams.map((team) => (
              <div
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer transition-colors group',
                  selectedTeamId === team.id
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-surface-secondary border border-transparent',
                )}
              >
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: team.color_hex }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-text-primary truncate">{team.name}</span>
                    {!team.is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-tertiary">{t.availability.teamInactive}</span>
                    )}
                  </div>
                  {team.description && (
                    <p className="text-[11px] text-text-tertiary truncate">{team.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEditTeam(team); }}
                    className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-secondary"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteTeam(team.id); }}
                    className="p-1 rounded text-text-tertiary hover:text-danger hover:bg-danger-light"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ RIGHT: Date Availability ═══ */}
        <div className="section-card p-4 space-y-4">
          {!selectedTeamId ? (
            <EmptyState icon={Calendar} title={t.availability.selectTeamFirst} description="" />
          ) : (
            <>
              {/* Week nav + actions */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="glass-button p-1.5">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-[13px] font-medium text-text-primary min-w-[180px] text-center">
                    {formatDate(toDateStr(weekStart))} — {formatDate(toDateStr(weekEnd))}
                  </span>
                  <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="glass-button p-1.5">
                    <ChevronRight size={14} />
                  </button>
                </div>
                <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="glass-button-ghost text-[12px]">
                  {t.availability.thisWeek}
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bulkMut.mutate()}
                    disabled={bulkMut.isPending}
                    className="glass-button-ghost text-[12px]"
                  >
                    {t.availability.bulkAdd}
                  </button>
                  <button type="button" onClick={() => openCreateSlot()} className="glass-button-primary inline-flex items-center gap-1.5 text-[12px]">
                    <Plus size={13} /> {t.availability.addSlot}
                  </button>
                </div>
              </div>

              {/* Team header */}
              {selectedTeam && (
                <div className="flex items-center gap-2 px-1">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedTeam.color_hex }} />
                  <span className="text-[14px] font-semibold text-text-primary">{selectedTeam.name}</span>
                  {selectedTeam.description && (
                    <span className="text-[12px] text-text-tertiary">— {selectedTeam.description}</span>
                  )}
                </div>
              )}

              {/* ═══ Default Weekly Schedule ═══ */}
              <div className="border border-outline rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                    <RefreshCw size={14} /> Default Weekly Schedule
                  </h3>
                  <div className="flex items-center gap-2">
                    {weeklySlots.length === 0 && (
                      <button
                        type="button"
                        onClick={() => setDefaultMut.mutate()}
                        disabled={setDefaultMut.isPending}
                        className="glass-button-ghost text-[11px]"
                      >
                        Set Mon-Fri 8-17
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setWeeklyDay(1);
                        setWeeklyStart('08:00');
                        setWeeklyEnd('17:00');
                        setWeeklyModalOpen(true);
                      }}
                      className="glass-button-primary text-[11px] inline-flex items-center gap-1 px-2 py-1"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>

                {weeklySlots.length === 0 ? (
                  <p className="text-[11px] text-text-tertiary italic">No default schedule set. Team will only be available on specifically added dates below.</p>
                ) : (
                  <div className="grid grid-cols-7 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const daySlots = weeklyByDay.get(day) || [];
                      return (
                        <div key={day} className="text-center">
                          <p className="text-[10px] font-semibold text-text-tertiary uppercase mb-1">
                            {weekdayLabel(day).slice(0, 3)}
                          </p>
                          {daySlots.length === 0 ? (
                            <p className="text-[10px] text-text-tertiary italic">Off</p>
                          ) : (
                            daySlots.map((s) => (
                              <div key={s.id} className="group relative bg-green-500/10 rounded px-1 py-0.5 mb-0.5">
                                <span className="text-[10px] font-medium text-green-700">
                                  {minutesToTime(s.start_minute)}-{minutesToTime(s.end_minute)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => deleteWeeklyMut.mutate(s.id)}
                                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-surface-card border border-outline text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X size={8} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ═══ Date-Specific Overrides (Exceptions) ═══ */}
              <div className="flex items-center gap-2 px-1">
                <Calendar size={14} className="text-text-tertiary" />
                <span className="text-[13px] font-semibold text-text-primary">Date Overrides & Exceptions</span>
                <span className="text-[11px] text-text-tertiary">— Override default schedule for specific days</span>
              </div>

              {/* Week grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                {Array.from(slotsByDate.entries()).map(([dateStr, daySlots]) => (
                  <div key={dateStr} className="border border-outline rounded-lg p-3 min-h-[120px]">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[12px] font-semibold text-text-primary">{formatDate(dateStr)}</h4>
                      <button
                        type="button"
                        onClick={() => openCreateSlot(dateStr)}
                        className="p-0.5 rounded text-text-tertiary hover:text-primary hover:bg-primary/10"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    {daySlots.length === 0 ? (
                      <p className="text-[11px] text-text-tertiary italic">{t.availability.noAvailability}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {daySlots.map((slot) => (
                          <div
                            key={slot.id}
                            className={cn(
                              'rounded-md px-2 py-1.5 group/slot flex items-start justify-between gap-1',
                              slot.status === 'available'
                                ? 'bg-green-500/10 border border-green-500/20'
                                : 'bg-red-500/10 border border-red-500/20',
                            )}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {slot.status === 'available' ? (
                                  <Check size={11} className="text-green-600 shrink-0" />
                                ) : (
                                  <Ban size={11} className="text-red-500 shrink-0" />
                                )}
                                <span className="text-[12px] font-medium text-text-primary tabular-nums">
                                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                                </span>
                              </div>
                              {slot.notes && (
                                <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{slot.notes}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover/slot:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={() => openEditSlot(slot)}
                                className="p-0.5 rounded text-text-tertiary hover:text-text-primary"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteSlotMut.mutate(slot.id)}
                                className="p-0.5 rounded text-text-tertiary hover:text-danger"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Team Modal ═══ */}
      {teamModal.open && (
        <div className="modal-overlay" onClick={() => setTeamModal({ open: false })}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5">
              <h3 className="text-[15px] font-semibold text-text-primary">
                {teamModal.editing ? t.availability.editTeam : t.availability.addTeam}
              </h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.teamName}</label>
                <input
                  value={teamForm.name}
                  onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))}
                  className="glass-input mt-1 w-full"
                  placeholder="e.g. Installation Team"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.teamDescription}</label>
                <input
                  value={teamForm.description || ''}
                  onChange={(e) => setTeamForm((f) => ({ ...f, description: e.target.value }))}
                  className="glass-input mt-1 w-full"
                  placeholder="Optional description..."
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.teamColor}</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {TEAM_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setTeamForm((f) => ({ ...f, color_hex: c }))}
                      className={cn(
                        'h-7 w-7 rounded-full transition-all',
                        teamForm.color_hex === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {teamModal.editing && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.status}</label>
                  <button
                    type="button"
                    onClick={() => setTeamForm((f) => ({ ...f, is_active: !f.is_active }))}
                    className={cn(
                      'text-[12px] px-2.5 py-1 rounded-md font-medium',
                      teamForm.is_active
                        ? 'bg-green-500/10 text-green-600 border border-green-500/30'
                        : 'bg-surface-secondary text-text-tertiary border border-outline',
                    )}
                  >
                    {teamForm.is_active ? t.availability.teamActive : t.availability.teamInactive}
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" className="glass-button" onClick={() => setTeamModal({ open: false })}>{t.common.cancel}</button>
              <button
                type="button"
                className="glass-button-primary"
                onClick={handleTeamSubmit}
                disabled={!teamForm.name.trim() || createTeamMut.isPending || updateTeamMut.isPending}
              >
                {createTeamMut.isPending || updateTeamMut.isPending
                  ? t.common.saving
                  : teamModal.editing ? t.common.save : t.common.create}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Slot Modal ═══ */}
      {slotModal.open && (
        <div className="modal-overlay" onClick={() => setSlotModal({ open: false })}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5">
              <h3 className="text-[15px] font-semibold text-text-primary">
                {slotModal.editing ? t.availability.editSlot : t.availability.addAvailabilitySlot}
              </h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.date}</label>
                <input
                  type="date"
                  value={slotForm.slot_date}
                  onChange={(e) => setSlotForm((f) => ({ ...f, slot_date: e.target.value }))}
                  className="glass-input mt-1 w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.start}</label>
                  <input
                    type="time"
                    value={slotForm.start_time}
                    onChange={(e) => setSlotForm((f) => ({ ...f, start_time: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.end}</label>
                  <input
                    type="time"
                    value={slotForm.end_time}
                    onChange={(e) => setSlotForm((f) => ({ ...f, end_time: e.target.value }))}
                    className="glass-input mt-1 w-full"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.status}</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setSlotStatus('available')}
                    className={cn(
                      'flex-1 text-[12px] py-1.5 rounded-md font-medium border transition-colors',
                      slotStatus === 'available'
                        ? 'bg-green-500/10 text-green-600 border-green-500/30'
                        : 'bg-surface text-text-tertiary border-outline hover:bg-surface-secondary',
                    )}
                  >
                    {t.availability.statusAvailable}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlotStatus('blocked')}
                    className={cn(
                      'flex-1 text-[12px] py-1.5 rounded-md font-medium border transition-colors',
                      slotStatus === 'blocked'
                        ? 'bg-red-500/10 text-red-500 border-red-500/30'
                        : 'bg-surface text-text-tertiary border-outline hover:bg-surface-secondary',
                    )}
                  >
                    {t.availability.statusBlocked}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.availability.notes}</label>
                <input
                  value={slotNotes}
                  onChange={(e) => setSlotNotes(e.target.value)}
                  className="glass-input mt-1 w-full"
                  placeholder="Optional..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" className="glass-button" onClick={() => setSlotModal({ open: false })}>{t.common.cancel}</button>
              <button
                type="button"
                className="glass-button-primary"
                onClick={handleSlotSubmit}
                disabled={createSlotMut.isPending || updateSlotMut.isPending}
              >
                {createSlotMut.isPending || updateSlotMut.isPending
                  ? t.availability.saving
                  : slotModal.editing ? t.common.save : t.availability.add}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Delete Team Confirmation ═══ */}
      {confirmDeleteTeam && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteTeam(null)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-5 space-y-3">
              <h3 className="text-[15px] font-semibold text-text-primary">{t.availability.deleteTeam}</h3>
              <p className="text-[13px] text-text-secondary">{t.availability.confirmDeleteTeam}</p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" className="glass-button" onClick={() => setConfirmDeleteTeam(null)}>{t.common.cancel}</button>
              <button
                type="button"
                className="glass-button-danger"
                onClick={() => deleteTeamMut.mutate(confirmDeleteTeam)}
                disabled={deleteTeamMut.isPending}
              >
                {deleteTeamMut.isPending ? t.common.deleting : t.common.delete}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ═══ Weekly Schedule Modal ═══ */}
      {weeklyModalOpen && (
        <div className="modal-overlay" onClick={() => setWeeklyModalOpen(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5">
              <h3 className="text-[15px] font-semibold text-text-primary">Add Default Schedule</h3>
              <p className="text-[12px] text-text-tertiary mt-1">This will repeat every week automatically.</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Day</label>
                <select
                  value={weeklyDay}
                  onChange={(e) => setWeeklyDay(Number(e.target.value))}
                  className="glass-input mt-1 w-full"
                >
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <option key={d} value={d}>{weekdayLabel(d)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Start</label>
                  <input type="time" value={weeklyStart} onChange={(e) => setWeeklyStart(e.target.value)} className="glass-input mt-1 w-full" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">End</label>
                  <input type="time" value={weeklyEnd} onChange={(e) => setWeeklyEnd(e.target.value)} className="glass-input mt-1 w-full" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" className="glass-button" onClick={() => setWeeklyModalOpen(false)}>Cancel</button>
              <button
                type="button"
                className="glass-button-primary"
                disabled={addWeeklyMut.isPending}
                onClick={() => addWeeklyMut.mutate({
                  team_id: selectedTeamId,
                  weekday: weeklyDay,
                  start_minute: timeToMinutes(weeklyStart),
                  end_minute: timeToMinutes(weeklyEnd),
                })}
              >
                {addWeeklyMut.isPending ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
