/**
 * Horaire quotidien des équipes — les équipes sont des unités permanentes
 * (nom, couleur, ordre) dont la composition change selon la journée.
 *
 * Trois sources, résolues côté client par ordre de priorité :
 *   1. time_off_requests (congé APPROUVÉ — remplace ou rogne l'horaire)
 *   2. team_schedule_assignments (assignation/exception posée pour UNE date;
 *      une ligne `removed` masque l'occurrence récurrente du jour)
 *   3. recurring_team_schedules (modèle hebdo, jamais matérialisé)
 *
 * L'historique ne bouge jamais : modifier une récurrence « à partir du X »
 * scinde la série (effective_end_date sur l'ancienne ligne), donc les dates
 * passées se résolvent toujours avec les lignes qui étaient en vigueur.
 *
 * Tant que la migration 20260749000000 n'est pas appliquée, toutes les
 * lectures retournent `missing: true` et l'UI affiche un état dégradé —
 * même pattern de repli silencieux que team_assignments.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AssignmentStatus = 'available' | 'unavailable' | 'removed';
export type AssignmentSource = 'manual' | 'exception' | 'copy';
export type TimeOffKind = 'time_off' | 'vacation' | 'sick' | 'absence' | 'unavailable' | 'other';
export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ScheduleAssignmentRecord {
  id: string;
  org_id: string;
  team_id: string;
  user_id: string;
  work_date: string;   // YYYY-MM-DD
  start_time: string;  // HH:MM(:SS)
  end_time: string;
  availability_status: AssignmentStatus;
  note: string | null;
  source: AssignmentSource;
  recurring_schedule_id: string | null;
  created_by: string | null;
}

export interface RecurringScheduleRecord {
  id: string;
  org_id: string;
  team_id: string;
  user_id: string;
  day_of_week: number; // 0=dimanche … 6=samedi (Date.getDay)
  start_time: string;
  end_time: string;
  effective_start_date: string;
  effective_end_date: string | null;
  recurrence_rule: string;
  is_active: boolean;
}

export interface TimeOffRecord {
  id: string;
  org_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  kind: TimeOffKind;
  status: TimeOffStatus;
  reason: string | null;
  note: string | null;
  approved_by: string | null;
}

export interface ScheduleRangeData {
  assignments: ScheduleAssignmentRecord[];
  recurrings: RecurringScheduleRecord[];
  timeOffs: TimeOffRecord[];
  /** true quand la migration 20260749000000 n'est pas encore appliquée. */
  missing: boolean;
}

/** Une personne dans une équipe pour une journée, une fois tout résolu. */
export interface ResolvedMemberDay {
  user_id: string;
  team_id: string;
  date: string;
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  status: 'available' | 'partial' | 'unavailable' | 'time_off';
  source: 'manual' | 'recurring' | 'exception' | 'copy';
  note: string | null;
  assignment_id: string | null;
  recurring_id: string | null;
  /** Congé approuvé qui remplace/rogne cette plage. */
  timeOff: TimeOffRecord | null;
  /** Demande de congé en attente qui chevauche (l'horaire reste actif). */
  pendingTimeOff: TimeOffRecord | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function hhmm(t: string | null | undefined): string {
  return (t || '').slice(0, 5);
}
export function timeToMin(t: string | null | undefined): number {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Les tables d'horaire n'existent pas encore (migration non appliquée). */
export function isMissingScheduleTables(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const msg = String(err?.message || '');
  return err?.code === '42P01' || err?.code === 'PGRST205' || /schema cache|does not exist/i.test(msg);
}

/** Message d'erreur lisible pour les gardes-fous DB (trigger). */
export function scheduleErrorMessage(e: unknown, fr: boolean): string {
  const msg = String((e as { message?: string })?.message || '');
  if (msg.includes('SCHEDULE_OVERLAP')) {
    return fr
      ? 'Ce membre est déjà assigné à une équipe durant ces heures.'
      : 'This member is already assigned to a team during these hours.';
  }
  if (msg.includes('TEAM_ARCHIVED')) {
    return fr ? 'Cette équipe est archivée.' : 'This team is archived.';
  }
  if (msg.includes('tsa_no_exact_duplicate') || msg.includes('duplicate key')) {
    return fr ? 'Cette assignation existe déjà.' : 'This assignment already exists.';
  }
  if (msg.includes('tsa_end_after_start') || msg.includes('rts_end_after_start') || msg.includes('tor_partial_times')) {
    return fr ? "L'heure de fin doit être après l'heure de début." : 'End time must be after start time.';
  }
  return msg || (fr ? 'Erreur inconnue.' : 'Unknown error.');
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// ═══════════════════════════════════════════════════════════════════════════
// LECTURE
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchScheduleRange(startDate: string, endDate: string): Promise<ScheduleRangeData> {
  const orgId = await getCurrentOrgIdOrThrow();
  try {
    const [a, r, t] = await Promise.all([
      supabase
        .from('team_schedule_assignments')
        .select('id,org_id,team_id,user_id,work_date,start_time,end_time,availability_status,note,source,recurring_schedule_id,created_by')
        .eq('org_id', orgId)
        .gte('work_date', startDate)
        .lte('work_date', endDate),
      supabase
        .from('recurring_team_schedules')
        .select('id,org_id,team_id,user_id,day_of_week,start_time,end_time,effective_start_date,effective_end_date,recurrence_rule,is_active')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .lte('effective_start_date', endDate)
        .or(`effective_end_date.is.null,effective_end_date.gte.${startDate}`),
      supabase
        .from('time_off_requests')
        .select('id,org_id,user_id,start_date,end_date,all_day,start_time,end_time,kind,status,reason,note,approved_by')
        .eq('org_id', orgId)
        .in('status', ['pending', 'approved'])
        .lte('start_date', endDate)
        .gte('end_date', startDate),
    ]);
    if (a.error) throw a.error;
    if (r.error) throw r.error;
    if (t.error) throw t.error;
    return {
      assignments: (a.data || []) as ScheduleAssignmentRecord[],
      recurrings: (r.data || []) as RecurringScheduleRecord[],
      timeOffs: (t.data || []) as TimeOffRecord[],
      missing: false,
    };
  } catch (e) {
    if (isMissingScheduleTables(e)) return { assignments: [], recurrings: [], timeOffs: [], missing: true };
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉSOLUTION (priorité : congé approuvé > assignation du jour > récurrence)
// ═══════════════════════════════════════════════════════════════════════════

function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}

function timeOffCoversDate(to: TimeOffRecord, dateStr: string): boolean {
  return to.start_date <= dateStr && to.end_date >= dateStr;
}

/** Fenêtre (minutes) d'un congé pour une date donnée; null = journée entière. */
function timeOffWindow(to: TimeOffRecord): { start: number; end: number } | null {
  if (to.all_day || !to.start_time || !to.end_time) return null;
  return { start: timeToMin(to.start_time), end: timeToMin(to.end_time) };
}

/**
 * Résout la composition de chaque équipe pour une date.
 * Retourne toutes les entrées de la journée (toutes équipes confondues).
 */
export function resolveDay(dateStr: string, data: ScheduleRangeData): ResolvedMemberDay[] {
  const dow = dayOfWeek(dateStr);

  const dayAssignments = data.assignments.filter((a) => a.work_date === dateStr);
  const manualRows = dayAssignments.filter((a) => a.availability_status !== 'removed');
  const removedRows = dayAssignments.filter((a) => a.availability_status === 'removed');

  const removedRecurringIds = new Set(removedRows.map((r) => r.recurring_schedule_id).filter(Boolean));
  const removedUserTeam = new Set(
    removedRows.filter((r) => !r.recurring_schedule_id).map((r) => `${r.user_id}|${r.team_id}`)
  );

  const entries: ResolvedMemberDay[] = manualRows.map((a) => ({
    user_id: a.user_id,
    team_id: a.team_id,
    date: dateStr,
    start_time: hhmm(a.start_time),
    end_time: hhmm(a.end_time),
    status: a.availability_status === 'unavailable' ? 'unavailable' : 'available',
    source: a.source === 'exception' ? 'exception' : a.source === 'copy' ? 'copy' : 'manual',
    note: a.note,
    assignment_id: a.id,
    recurring_id: a.recurring_schedule_id,
    timeOff: null,
    pendingTimeOff: null,
  }));

  // Récurrences applicables ce jour-là, sauf si masquées ou recouvertes par
  // une ligne manuelle du même user :
  //  - même équipe → la ligne manuelle remplace l'occurrence, peu importe l'heure;
  //  - autre équipe → seulement si les plages se chevauchent (deux équipes le
  //    même jour restent permises sur des plages disjointes).
  for (const r of data.recurrings) {
    if (r.day_of_week !== dow) continue;
    if (r.effective_start_date > dateStr) continue;
    if (r.effective_end_date && r.effective_end_date < dateStr) continue;
    if (removedRecurringIds.has(r.id)) continue;
    if (removedUserTeam.has(`${r.user_id}|${r.team_id}`)) continue;

    const rStart = timeToMin(r.start_time);
    const rEnd = timeToMin(r.end_time);
    const shadowed = manualRows.some((m) => {
      if (m.user_id !== r.user_id) return false;
      if (m.team_id === r.team_id) return true;
      return overlaps(timeToMin(m.start_time), timeToMin(m.end_time), rStart, rEnd);
    });
    if (shadowed) continue;

    entries.push({
      user_id: r.user_id,
      team_id: r.team_id,
      date: dateStr,
      start_time: hhmm(r.start_time),
      end_time: hhmm(r.end_time),
      status: 'available',
      source: 'recurring',
      note: null,
      assignment_id: null,
      recurring_id: r.id,
      timeOff: null,
      pendingTimeOff: null,
    });
  }

  // Congés : approuvé = remplace (journée) ou rogne (plage partielle);
  // en attente = l'horaire reste actif mais la puce est marquée.
  const dayTimeOffs = data.timeOffs.filter((to) => timeOffCoversDate(to, dateStr));
  if (dayTimeOffs.length) {
    for (const entry of entries) {
      const mine = dayTimeOffs.filter((to) => to.user_id === entry.user_id);
      if (!mine.length) continue;

      for (const to of mine) {
        if (to.status === 'pending') {
          entry.pendingTimeOff = entry.pendingTimeOff || to;
          continue;
        }
        // Approuvé
        const win = timeOffWindow(to);
        const eStart = timeToMin(entry.start_time);
        const eEnd = timeToMin(entry.end_time);
        if (!win || (win.start <= eStart && win.end >= eEnd)) {
          entry.status = 'time_off';
          entry.timeOff = to;
        } else if (overlaps(win.start, win.end, eStart, eEnd)) {
          // Rognage : on garde le plus grand segment restant.
          const beforeLen = Math.max(0, win.start - eStart);
          const afterLen = Math.max(0, eEnd - win.end);
          if (afterLen >= beforeLen) entry.start_time = minToTime(Math.max(eStart, win.end));
          else entry.end_time = minToTime(Math.min(eEnd, win.start));
          entry.status = 'partial';
          entry.timeOff = to;
        }
      }
    }
  }

  return entries;
}

/** Clé de cellule de la grille. */
export function cellKey(teamId: string, dateStr: string): string {
  return `${teamId}|${dateStr}`;
}

/** Résout toute une plage de dates → Map cellKey → entrées triées. */
export function resolveRange(dates: string[], data: ScheduleRangeData): Map<string, ResolvedMemberDay[]> {
  const map = new Map<string, ResolvedMemberDay[]>();
  for (const date of dates) {
    for (const entry of resolveDay(date, data)) {
      const key = cellKey(entry.team_id, date);
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.user_id.localeCompare(b.user_id));
  }
  return map;
}

/** Minutes planifiées (available + partial) d'un ensemble d'entrées. */
export function scheduledMinutes(entries: ResolvedMemberDay[]): number {
  let total = 0;
  for (const e of entries) {
    if (e.status === 'available' || e.status === 'partial') {
      total += Math.max(0, timeToMin(e.end_time) - timeToMin(e.start_time));
    }
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT
// ═══════════════════════════════════════════════════════════════════════════

async function audit(
  action: string,
  payload: {
    team_id?: string | null;
    target_user_id?: string | null;
    work_date?: string | null;
    old_value?: unknown;
    new_value?: unknown;
  }
): Promise<void> {
  // Best-effort : le journal ne doit jamais bloquer une modification.
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('team_schedule_audit').insert({
      org_id: orgId,
      actor_id: user?.id ?? null,
      action,
      team_id: payload.team_id ?? null,
      target_user_id: payload.target_user_id ?? null,
      work_date: payload.work_date ?? null,
      old_value: payload.old_value ?? null,
      new_value: payload.new_value ?? null,
    });
  } catch {
    /* silencieux */
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS — assignations d'une date
// ═══════════════════════════════════════════════════════════════════════════

export interface AssignmentInput {
  team_id: string;
  user_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  note?: string | null;
  availability_status?: AssignmentStatus;
  source?: AssignmentSource;
  recurring_schedule_id?: string | null;
}

export async function createAssignment(input: AssignmentInput): Promise<ScheduleAssignmentRecord> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  // Ré-assigner quelqu'un qu'on avait retiré ce jour-là : la ligne `removed`
  // occupe le créneau (contrainte d'unicité) — on la lève d'abord.
  if ((input.availability_status || 'available') === 'available') {
    await supabase
      .from('team_schedule_assignments')
      .delete()
      .eq('team_id', input.team_id)
      .eq('user_id', input.user_id)
      .eq('work_date', input.work_date)
      .eq('availability_status', 'removed');
  }
  const { data, error } = await supabase
    .from('team_schedule_assignments')
    .insert({
      org_id: orgId,
      team_id: input.team_id,
      user_id: input.user_id,
      work_date: input.work_date,
      start_time: input.start_time,
      end_time: input.end_time,
      note: input.note?.trim() || null,
      availability_status: input.availability_status || 'available',
      source: input.source || 'manual',
      recurring_schedule_id: input.recurring_schedule_id || null,
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  void audit('assignment_created', {
    team_id: input.team_id, target_user_id: input.user_id, work_date: input.work_date, new_value: data,
  });
  return data as ScheduleAssignmentRecord;
}

export async function updateAssignment(
  id: string,
  patch: Partial<Pick<ScheduleAssignmentRecord, 'team_id' | 'start_time' | 'end_time' | 'note' | 'availability_status' | 'work_date'>>,
  old?: Partial<ScheduleAssignmentRecord>
): Promise<ScheduleAssignmentRecord> {
  const { data, error } = await supabase
    .from('team_schedule_assignments')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  const rec = data as ScheduleAssignmentRecord;
  void audit('assignment_updated', {
    team_id: rec.team_id, target_user_id: rec.user_id, work_date: rec.work_date, old_value: old ?? null, new_value: patch,
  });
  return rec;
}

export async function deleteAssignment(entry: { id: string; team_id?: string; user_id?: string; work_date?: string }): Promise<void> {
  const { error } = await supabase.from('team_schedule_assignments').delete().eq('id', entry.id);
  if (error) throw error;
  void audit('assignment_deleted', {
    team_id: entry.team_id ?? null, target_user_id: entry.user_id ?? null, work_date: entry.work_date ?? null,
    old_value: entry,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS — récurrences hebdomadaires
// ═══════════════════════════════════════════════════════════════════════════

export interface RecurringInput {
  team_id: string;
  user_id: string;
  days: number[]; // 0=dimanche … 6=samedi
  start_time: string;
  end_time: string;
  effective_start_date: string;
  effective_end_date?: string | null;
}

export async function createRecurring(input: RecurringInput): Promise<RecurringScheduleRecord[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  const rows = input.days.map((day) => ({
    org_id: orgId,
    team_id: input.team_id,
    user_id: input.user_id,
    day_of_week: day,
    start_time: input.start_time,
    end_time: input.end_time,
    effective_start_date: input.effective_start_date,
    effective_end_date: input.effective_end_date || null,
    created_by: user?.id ?? null,
  }));
  const { data, error } = await supabase.from('recurring_team_schedules').insert(rows).select();
  if (error) throw error;
  void audit('recurring_created', {
    team_id: input.team_id, target_user_id: input.user_id, new_value: input,
  });
  return (data || []) as RecurringScheduleRecord[];
}

function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Termine une série la veille de `fromDate` (supprime si jamais entrée en vigueur). */
export async function endRecurringFrom(rec: RecurringScheduleRecord, fromDate: string): Promise<void> {
  const lastDay = addDaysStr(fromDate, -1);
  if (lastDay < rec.effective_start_date) {
    const { error } = await supabase.from('recurring_team_schedules').delete().eq('id', rec.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('recurring_team_schedules')
      .update({ effective_end_date: lastDay })
      .eq('id', rec.id);
    if (error) throw error;
  }
  void audit('recurring_ended', {
    team_id: rec.team_id, target_user_id: rec.user_id, work_date: fromDate, old_value: rec,
  });
}

/**
 * Modifie une série « à partir de cette date » : l'ancienne ligne est fermée
 * la veille, une nouvelle ligne porte les changements — les semaines passées
 * restent résolues par l'ancienne ligne (l'historique ne bouge pas).
 */
export async function splitRecurringFrom(
  rec: RecurringScheduleRecord,
  fromDate: string,
  patch: Partial<Pick<RecurringScheduleRecord, 'team_id' | 'start_time' | 'end_time' | 'day_of_week'>>
): Promise<void> {
  await endRecurringFrom(rec, fromDate);
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('recurring_team_schedules').insert({
    org_id: orgId,
    team_id: patch.team_id ?? rec.team_id,
    user_id: rec.user_id,
    day_of_week: patch.day_of_week ?? rec.day_of_week,
    start_time: patch.start_time ?? rec.start_time,
    end_time: patch.end_time ?? rec.end_time,
    effective_start_date: fromDate,
    effective_end_date: rec.effective_end_date,
    created_by: user?.id ?? null,
  });
  if (error) throw error;
  void audit('recurring_split', {
    team_id: rec.team_id, target_user_id: rec.user_id, work_date: fromDate, old_value: rec, new_value: patch,
  });
}

/** Modifie TOUTES les occurrences de la série (passées incluses). */
export async function updateRecurring(
  rec: RecurringScheduleRecord,
  patch: Partial<Pick<RecurringScheduleRecord, 'team_id' | 'start_time' | 'end_time' | 'day_of_week' | 'effective_end_date' | 'is_active'>>
): Promise<void> {
  const { error } = await supabase.from('recurring_team_schedules').update(patch).eq('id', rec.id);
  if (error) throw error;
  void audit('recurring_updated', {
    team_id: rec.team_id, target_user_id: rec.user_id, old_value: rec, new_value: patch,
  });
}

/** Masque l'occurrence d'une récurrence pour UNE date (exception négative). */
export async function removeOccurrence(entry: ResolvedMemberDay): Promise<void> {
  if (!entry.recurring_id) return;
  await createAssignment({
    team_id: entry.team_id,
    user_id: entry.user_id,
    work_date: entry.date,
    start_time: entry.start_time,
    end_time: entry.end_time,
    availability_status: 'removed',
    source: 'exception',
    recurring_schedule_id: entry.recurring_id,
  });
}

/** Déroge à une occurrence récurrente pour UNE date (nouvelles heures/équipe). */
export async function overrideOccurrence(
  entry: ResolvedMemberDay,
  patch: { team_id?: string; start_time?: string; end_time?: string; note?: string | null; availability_status?: AssignmentStatus }
): Promise<void> {
  if (!entry.recurring_id) return;
  await createAssignment({
    team_id: patch.team_id ?? entry.team_id,
    user_id: entry.user_id,
    work_date: entry.date,
    start_time: patch.start_time ?? entry.start_time,
    end_time: patch.end_time ?? entry.end_time,
    note: patch.note,
    availability_status: patch.availability_status ?? 'available',
    source: 'exception',
    recurring_schedule_id: entry.recurring_id,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS — congés / indisponibilités
// ═══════════════════════════════════════════════════════════════════════════

export interface TimeOffInput {
  user_id: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time?: string | null;
  end_time?: string | null;
  kind: TimeOffKind;
  status?: TimeOffStatus;
  reason?: string | null;
  note?: string | null;
}

export async function createTimeOff(input: TimeOffInput): Promise<TimeOffRecord> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  const status = input.status || 'approved';
  const { data, error } = await supabase
    .from('time_off_requests')
    .insert({
      org_id: orgId,
      user_id: input.user_id,
      start_date: input.start_date,
      end_date: input.end_date,
      all_day: input.all_day,
      start_time: input.all_day ? null : input.start_time || null,
      end_time: input.all_day ? null : input.end_time || null,
      kind: input.kind,
      status,
      reason: input.reason?.trim() || null,
      note: input.note?.trim() || null,
      approved_by: status === 'approved' ? user?.id ?? null : null,
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  void audit('time_off_created', {
    target_user_id: input.user_id, work_date: input.start_date, new_value: data,
  });
  return data as TimeOffRecord;
}

export async function updateTimeOff(
  rec: TimeOffRecord,
  patch: Partial<Pick<TimeOffRecord, 'start_date' | 'end_date' | 'all_day' | 'start_time' | 'end_time' | 'kind' | 'status' | 'reason' | 'note'>>
): Promise<void> {
  const payload: Record<string, unknown> = { ...patch };
  if (patch.status === 'approved') {
    const { data: { user } } = await supabase.auth.getUser();
    payload.approved_by = user?.id ?? null;
  }
  const { error } = await supabase.from('time_off_requests').update(payload).eq('id', rec.id);
  if (error) throw error;
  void audit('time_off_updated', {
    target_user_id: rec.user_id, work_date: rec.start_date, old_value: rec, new_value: patch,
  });
}

export async function deleteTimeOff(rec: TimeOffRecord): Promise<void> {
  const { error } = await supabase.from('time_off_requests').delete().eq('id', rec.id);
  if (error) throw error;
  void audit('time_off_deleted', {
    target_user_id: rec.user_id, work_date: rec.start_date, old_value: rec,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COPIE (jour → jour, semaine → semaine)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recrée des entrées résolues comme assignations manuelles sur d'autres dates.
 * Les congés/indisponibilités ne sont pas copiés. Les doublons et conflits
 * (garde-fous DB) sont comptés comme ignorés, jamais bloquants.
 */
export async function copyEntries(
  entries: ResolvedMemberDay[],
  dateMapper: (entryDate: string) => string
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.status === 'time_off' || entry.status === 'unavailable') { skipped++; continue; }
    const target = dateMapper(entry.date);
    if (!target || target === entry.date) { skipped++; continue; }
    try {
      await createAssignment({
        team_id: entry.team_id,
        user_id: entry.user_id,
        work_date: target,
        start_time: entry.start_time,
        end_time: entry.end_time,
        note: entry.note,
        source: 'copy',
      });
      created++;
    } catch {
      skipped++;
    }
  }
  return { created, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTÉGRATION CALENDRIER / DISPATCH
// ═══════════════════════════════════════════════════════════════════════════

export type VisitRosterCheck = 'ok' | 'no_members' | 'outside_hours' | 'unknown';

/** Roster résolu d'une seule date, groupé par équipe. */
export async function getRosterForDate(dateStr: string): Promise<{ byTeam: Map<string, ResolvedMemberDay[]>; missing: boolean }> {
  const data = await fetchScheduleRange(dateStr, dateStr);
  const byTeam = new Map<string, ResolvedMemberDay[]>();
  if (data.missing) return { byTeam, missing: true };
  for (const entry of resolveDay(dateStr, data)) {
    const list = byTeam.get(entry.team_id);
    if (list) list.push(entry);
    else byTeam.set(entry.team_id, [entry]);
  }
  for (const list of byTeam.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return { byTeam, missing: false };
}

/**
 * Vérifie une visite planifiée contre le roster du jour de son équipe :
 *  - no_members : personne d'assigné à l'équipe cette journée-là;
 *  - outside_hours : aucun membre dont la plage couvre entièrement la visite;
 *  - unknown : tables absentes (migration pas appliquée) — pas d'avertissement.
 */
export async function checkVisitAgainstRoster(teamId: string, startIso: string, endIso: string): Promise<VisitRosterCheck> {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const { byTeam, missing } = await getRosterForDate(dateStr);
    if (missing) return 'unknown';
    const members = (byTeam.get(teamId) || []).filter((e) => e.status === 'available' || e.status === 'partial');
    if (!members.length) return 'no_members';

    const sameDay = start.toDateString() === end.toDateString();
    const visitStart = start.getHours() * 60 + start.getMinutes();
    const visitEnd = sameDay ? end.getHours() * 60 + end.getMinutes() : 24 * 60;
    const covered = members.some((e) => timeToMin(e.start_time) <= visitStart && timeToMin(e.end_time) >= visitEnd);
    return covered ? 'ok' : 'outside_hours';
  } catch {
    return 'unknown';
  }
}
