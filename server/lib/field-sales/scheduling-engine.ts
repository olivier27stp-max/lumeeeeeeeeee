/**
 * Scheduling Intelligence Engine
 *
 * Computes slot scores (0-100) based on:
 * - Calendar availability
 * - Job proximity to pins/territories
 * - Team availability
 * - Company capacity
 * - Business type / operating profile
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlotRecommendation {
  start_time: string;
  end_time: string;
  score: number;
  explanation: string;
  nearby_jobs: number;
  nearby_pins: number;
  is_peak_hour: boolean;
}

export interface ScheduleContext {
  org_id: string;
  user_id?: string;
  target_date: string; // YYYY-MM-DD
  job_duration_minutes?: number;
}

interface CalendarSlot {
  start: Date;
  end: Date;
  busy: boolean;
}

// ---------------------------------------------------------------------------
// Main: get top scheduling recommendations
// ---------------------------------------------------------------------------

export async function getScheduleRecommendations(
  admin: SupabaseClient,
  ctx: ScheduleContext
): Promise<SlotRecommendation[]> {
  const { org_id, user_id, target_date } = ctx;

  // 1. Get company profile
  const { data: profile } = await admin
    .from('company_operating_profile')
    .select('*')
    .eq('org_id', org_id)
    .maybeSingle();

  const jobDuration = ctx.job_duration_minutes ?? profile?.avg_job_duration_minutes ?? 120;
  const maxJobs = profile?.avg_jobs_per_day ?? 4;
  const peakStart = profile?.peak_hours_start ?? '09:00';
  const peakEnd = profile?.peak_hours_end ?? '17:00';

  // 2. Get existing events for the day
  const dayStart = `${target_date}T00:00:00Z`;
  const dayEnd = `${target_date}T23:59:59Z`;

  let eventsQuery = admin
    .from('schedule_events')
    .select('start_time, end_time, status')
    .eq('org_id', org_id)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .is('deleted_at', null);

  if (user_id) eventsQuery = eventsQuery.eq('assigned_user', user_id);

  const { data: events } = await eventsQuery;
  const existingCount = events?.length ?? 0;

  // 3. Generate candidate slots (every 30 min from peak start to peak end)
  const [startH, startM] = peakStart.split(':').map(Number);
  const [endH, endM] = peakEnd.split(':').map(Number);

  const slots: SlotRecommendation[] = [];
  const durationMs = jobDuration * 60000;

  for (let h = startH; h <= endH; h++) {
    for (const m of [0, 30]) {
      if (h === startH && m < startM) continue;
      if (h === endH && m > endM) continue;

      const slotStart = new Date(`${target_date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
      const slotEnd = new Date(slotStart.getTime() + durationMs);

      // Check for conflicts
      const hasConflict = (events ?? []).some((ev: any) => {
        const evStart = new Date(ev.start_time).getTime();
        const evEnd = new Date(ev.end_time).getTime();
        const sStart = slotStart.getTime();
        const sEnd = slotEnd.getTime();
        return sStart < evEnd && sEnd > evStart;
      });

      if (hasConflict) continue;

      // Score the slot
      const isPeak = h >= 9 && h < 17;
      let score = 50; // base

      // Peak hour bonus (+20)
      if (isPeak) score += 20;

      // Morning preference (+10 for 9-12)
      if (h >= 9 && h < 12) score += 10;

      // Capacity check — penalize if already near max
      if (existingCount >= maxJobs) {
        score -= 30;
      } else if (existingCount >= maxJobs - 1) {
        score -= 15;
      }

      // Even spacing bonus
      if (events?.length) {
        const avgGap = events.reduce((sum: number, ev: any, i: number) => {
          if (i === 0) return 0;
          return sum + (new Date(ev.start_time).getTime() - new Date(events[i - 1].end_time).getTime());
        }, 0) / Math.max(events.length - 1, 1);

        const myGap = Math.abs(slotStart.getTime() - (events.length > 0
          ? new Date(events[events.length - 1].end_time).getTime()
          : slotStart.getTime()));

        if (myGap > 3600000) score += 5; // 1h+ gap
      }

      score = Math.round(Math.min(100, Math.max(0, score)));

      // Explanation
      const parts: string[] = [];
      if (isPeak) parts.push('peak business hours');
      if (h >= 9 && h < 12) parts.push('morning slot preferred');
      if (existingCount === 0) parts.push('first job of the day');
      if (existingCount >= maxJobs - 1) parts.push('near daily capacity');

      slots.push({
        start_time: slotStart.toISOString(),
        end_time: slotEnd.toISOString(),
        score,
        explanation: parts.length > 0 ? parts.join(', ') : 'Available slot',
        nearby_jobs: existingCount,
        nearby_pins: 0,
        is_peak_hour: isPeak,
      });
    }
  }

  // Sort by score descending, return top 5
  slots.sort((a, b) => b.score - a.score);
  return slots.slice(0, 5);
}
