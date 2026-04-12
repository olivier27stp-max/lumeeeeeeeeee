import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface AvailabilityRecord {
  id: string;
  org_id: string;
  team_id: string;
  weekday: number; // 0=Sunday, 6=Saturday
  start_minute: number;
  end_minute: number;
  timezone: string;
  created_at: string;
}

export interface AvailabilityInput {
  team_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  timezone?: string;
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] || `Day ${weekday}`;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export async function listAvailability(teamId?: string): Promise<AvailabilityRecord[]> {
  let query = supabase
    .from('team_availability_active')
    .select('*')
    .order('weekday', { ascending: true })
    .order('start_minute', { ascending: true });

  if (teamId) query = query.eq('team_id', teamId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AvailabilityRecord[];
}

export async function createAvailability(input: AvailabilityInput): Promise<AvailabilityRecord> {
  const orgId = await getCurrentOrgIdOrThrow();

  // Remove existing entry for same team+weekday+start_minute (soft delete)
  await supabase
    .from('team_availability')
    .update({ deleted_at: new Date().toISOString() })
    .eq('team_id', input.team_id)
    .eq('weekday', input.weekday)
    .eq('start_minute', input.start_minute)
    .is('deleted_at', null);

  const { data, error } = await supabase
    .from('team_availability')
    .insert({
      org_id: orgId,
      team_id: input.team_id,
      weekday: input.weekday,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      timezone: input.timezone || 'America/Toronto',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as AvailabilityRecord;
}

export async function deleteAvailability(id: string): Promise<void> {
  const { error } = await supabase
    .from('team_availability')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function setDefaultAvailability(teamId: string): Promise<AvailabilityRecord[]> {
  const orgId = await getCurrentOrgIdOrThrow();

  // Clear existing weekly availability for this team first
  await supabase
    .from('team_availability')
    .update({ deleted_at: new Date().toISOString() })
    .eq('team_id', teamId)
    .is('deleted_at', null);

  // Default: Mon-Fri 8:00 - 17:00
  const rows = [1, 2, 3, 4, 5].map((weekday) => ({
    org_id: orgId,
    team_id: teamId,
    weekday,
    start_minute: 480, // 8:00
    end_minute: 1020, // 17:00
    timezone: 'America/Toronto',
  }));

  const { data, error } = await supabase
    .from('team_availability')
    .insert(rows)
    .select('*');

  if (error) throw error;
  return (data || []) as AvailabilityRecord[];
}

export interface FreeSlot {
  date: string;
  day_label: string;
  team_id: string;
  team_name: string;
  team_color: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

export async function findFreeSlots(params: {
  teamId?: string | null;
  days?: number;
  slotDuration?: number;
}): Promise<FreeSlot[]> {
  const days = params.days || 14;
  const slotDuration = params.slotDuration || 60;

  // Get availability rules
  const availability = await listAvailability(params.teamId || undefined);
  if (availability.length === 0) return [];

  // Get team info
  const teamIds = [...new Set(availability.map((a) => a.team_id))];
  const { data: teams } = await supabase
    .from('teams')
    .select('id,name,color_hex')
    .in('id', teamIds);
  const teamMap = new Map((teams || []).map((t: any) => [t.id, t]));

  // Get existing events for the date range
  const now = new Date();
  const endDate = new Date(now.getTime() + days * 86400000);
  const { data: events } = await supabase
    .from('schedule_events')
    .select('team_id,start_at,end_at')
    .is('deleted_at', null)
    .gte('start_at', now.toISOString())
    .lte('end_at', endDate.toISOString());

  const busySlots = (events || []).map((e: any) => ({
    team_id: e.team_id,
    start: new Date(e.start_at).getTime(),
    end: new Date(e.end_at).getTime(),
  }));

  const slots: FreeSlot[] = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(now.getTime() + d * 86400000);
    const weekday = date.getDay();
    const dateStr = date.toISOString().slice(0, 10);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const dayAvailability = availability.filter((a) => a.weekday === weekday);

    for (const avail of dayAvailability) {
      const team = teamMap.get(avail.team_id);
      if (!team) continue;

      // Generate slots within availability window
      for (let minute = avail.start_minute; minute + slotDuration <= avail.end_minute; minute += 30) {
        const slotStart = new Date(`${dateStr}T${minutesToTime(minute)}:00`);
        const slotEnd = new Date(slotStart.getTime() + slotDuration * 60000);

        // Skip past slots
        if (slotStart.getTime() < now.getTime()) continue;

        // Check for conflicts
        const hasConflict = busySlots.some(
          (busy) =>
            busy.team_id === avail.team_id &&
            slotStart.getTime() < busy.end &&
            slotEnd.getTime() > busy.start
        );

        if (!hasConflict) {
          slots.push({
            date: dateStr,
            day_label: dayLabel,
            team_id: avail.team_id,
            team_name: team.name,
            team_color: team.color_hex || '#3B82F6',
            start_time: slotStart.toISOString(),
            end_time: slotEnd.toISOString(),
            duration_minutes: slotDuration,
          });
        }
      }
    }
  }

  return slots;
}
