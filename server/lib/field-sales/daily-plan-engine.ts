/**
 * Daily Planning Engine
 *
 * Generates a personalized daily plan for each rep:
 * - Zones to target
 * - Houses to prioritize
 * - Recommended action order
 * - Follow-ups to execute
 * - Scheduling opportunities
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getFollowUpRecommendations, FollowUpAction } from './followup-engine';
import { getScheduleRecommendations, SlotRecommendation } from './scheduling-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyPlan {
  date: string;
  user_id: string;
  generated_at: string;
  summary: string;
  target_zones: ZoneTarget[];
  priority_houses: HouseTarget[];
  follow_ups: FollowUpAction[];
  schedule_slots: SlotRecommendation[];
  estimated_knocks: number;
  estimated_leads: number;
}

export interface ZoneTarget {
  territory_id: string;
  territory_name: string;
  territory_score: number;
  fatigue_score: number;
  pin_count: number;
  recommended_time: string;
  reason: string;
}

export interface HouseTarget {
  house_id: string;
  address: string;
  current_status: string;
  reknock_score: number;
  recommended_action: string;
  order: number;
}

// ---------------------------------------------------------------------------
// Main: Generate Daily Plan
// ---------------------------------------------------------------------------

export async function generateDailyPlan(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  targetDate?: string
): Promise<DailyPlan> {
  const date = targetDate ?? new Date().toISOString().slice(0, 10);
  const now = new Date();

  // 1. Get top territories (sorted by score, filtered by assignment or unassigned)
  const { data: territories } = await admin
    .from('field_territories')
    .select('id, name, territory_score, fatigue_score, total_pins, assigned_user_id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('territory_score', { ascending: false })
    .limit(10);

  // Filter: prefer territories assigned to this rep, then unassigned
  const myTerritories = (territories ?? []).filter(
    (t: any) => t.assigned_user_id === userId || !t.assigned_user_id
  );

  // Pick top 3 non-fatigued zones
  const targetZones: ZoneTarget[] = myTerritories
    .filter((t: any) => (t.fatigue_score ?? 0) < 70) // skip fatigued
    .slice(0, 3)
    .map((t: any, i: number) => ({
      territory_id: t.id,
      territory_name: t.name,
      territory_score: t.territory_score ?? 0,
      fatigue_score: t.fatigue_score ?? 0,
      pin_count: t.total_pins ?? 0,
      recommended_time: i === 0 ? 'Morning (9-12)' : i === 1 ? 'Afternoon (13-16)' : 'Late afternoon (16-18)',
      reason: t.territory_score > 70
        ? 'High opportunity zone — many open leads'
        : t.territory_score > 40
          ? 'Moderate activity — good reknock potential'
          : 'Low traffic zone — fresh territory to explore',
    }));

  // 2. Get priority houses (top reknock scores in target zones)
  const zoneIds = targetZones.map(z => z.territory_id);
  let housesQuery = admin
    .from('field_house_profiles')
    .select('id, address, current_status, reknock_priority_score, ai_next_action, territory_id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('current_status', 'in', '("sold","cancelled","do_not_knock","not_interested")')
    .order('reknock_priority_score', { ascending: false })
    .limit(30);

  if (zoneIds.length > 0) {
    housesQuery = housesQuery.in('territory_id', zoneIds);
  }

  const { data: houses } = await housesQuery;

  const priorityHouses: HouseTarget[] = (houses ?? []).slice(0, 15).map((h: any, i: number) => ({
    house_id: h.id,
    address: h.address,
    current_status: h.current_status,
    reknock_score: h.reknock_priority_score ?? 0,
    recommended_action: h.ai_next_action ?? 'Visit',
    order: i + 1,
  }));

  // 3. Get follow-up actions
  const followUps = await getFollowUpRecommendations(admin, orgId, userId, 10);

  // 4. Get scheduling opportunities
  const scheduleSlots = await getScheduleRecommendations(admin, {
    org_id: orgId,
    user_id: userId,
    target_date: date,
  });

  // 5. Estimate daily output
  const estimatedKnocks = Math.min(priorityHouses.length + 5, 30);
  const avgConversion = 0.12; // 12% baseline
  const estimatedLeads = Math.round(estimatedKnocks * avgConversion);

  // 6. Generate summary
  const summaryParts: string[] = [];
  if (targetZones.length > 0) {
    summaryParts.push(`Focus on ${targetZones.length} zone${targetZones.length > 1 ? 's' : ''}: ${targetZones.map(z => z.territory_name).join(', ')}`);
  }
  if (priorityHouses.length > 0) {
    summaryParts.push(`${priorityHouses.length} priority houses to visit`);
  }
  if (followUps.length > 0) {
    summaryParts.push(`${followUps.length} follow-ups pending`);
  }
  if (scheduleSlots.length > 0) {
    summaryParts.push(`${scheduleSlots.length} optimal scheduling slots available`);
  }

  return {
    date,
    user_id: userId,
    generated_at: now.toISOString(),
    summary: summaryParts.join('. ') + '.',
    target_zones: targetZones,
    priority_houses: priorityHouses,
    follow_ups: followUps,
    schedule_slots: scheduleSlots,
    estimated_knocks: estimatedKnocks,
    estimated_leads: estimatedLeads,
  };
}
