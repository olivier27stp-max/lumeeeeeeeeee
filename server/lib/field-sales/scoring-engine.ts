/**
 * Field Sales AI Scoring Engine
 *
 * Computes:
 * - Territory Score (0-100): opportunity value of a zone
 * - Reknock Priority Score (0-100): per-pin urgency to revisit
 * - Fatigue Score (0-100): over-exposure detection
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerritoryScoreInput {
  coverage_percent: number;
  recent_no_answers: number;
  lead_density: number;
  quote_density: number;
  close_rate: number;
  days_since_last_activity: number;
  nearby_scheduled_jobs: number;
  rep_historical_score: number;
  total_pins: number;
  active_leads: number;
  profile: CompanyProfile;
}

export interface PinScoreInput {
  last_event_type: string;
  days_since_last_knock: number;
  nearby_job_count: number;
  nearby_opportunity_cluster: number;
  team_available: boolean;
  visit_count: number;
  has_quote: boolean;
  has_lead: boolean;
  profile: CompanyProfile;
}

export interface FatigueInput {
  knocks_last_7_days: number;
  knocks_last_30_days: number;
  conversion_trend: number; // -1 to 1 (declining to improving)
  unique_reps_visited: number;
  total_visits: number;
}

export interface CompanyProfile {
  weight_proximity: number;
  weight_team_availability: number;
  weight_value: number;
  weight_recency: number;
  preferred_reknock_delay_days: number;
  avg_jobs_per_day: number;
  max_travel_radius_km: number;
}

const DEFAULT_PROFILE: CompanyProfile = {
  weight_proximity: 0.3,
  weight_team_availability: 0.25,
  weight_value: 0.25,
  weight_recency: 0.2,
  preferred_reknock_delay_days: 7,
  avg_jobs_per_day: 4,
  max_travel_radius_km: 50,
};

// ---------------------------------------------------------------------------
// Territory Score (0-100)
// ---------------------------------------------------------------------------

export function computeTerritoryScore(input: TerritoryScoreInput): number {
  const p = input.profile;

  // Component scores (each 0-1)
  const coverageScore = Math.min(input.coverage_percent / 100, 1);
  const noAnswerOpportunity = Math.min(input.recent_no_answers / 20, 1) * 0.7; // no_answers = reknock opportunity
  const leadDensityScore = Math.min(input.lead_density / 10, 1);
  const quoteDensityScore = Math.min(input.quote_density / 5, 1);
  const closeRateScore = Math.min(input.close_rate / 50, 1); // 50% = perfect
  const recencyScore = input.days_since_last_activity <= 3 ? 1 :
    input.days_since_last_activity <= 7 ? 0.7 :
    input.days_since_last_activity <= 14 ? 0.4 :
    input.days_since_last_activity <= 30 ? 0.2 : 0.05;
  const proximityScore = Math.min(input.nearby_scheduled_jobs / 3, 1);
  const repScore = Math.min(input.rep_historical_score / 100, 1);

  // Weighted combination
  const raw =
    (1 - coverageScore) * 0.10 + // Low coverage = more opportunity
    noAnswerOpportunity * 0.15 +
    leadDensityScore * 0.15 +
    quoteDensityScore * 0.10 +
    closeRateScore * 0.10 +
    recencyScore * p.weight_recency +
    proximityScore * p.weight_proximity +
    repScore * 0.10;

  // Normalize and clamp
  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

// ---------------------------------------------------------------------------
// Reknock Priority Score (0-100)
// ---------------------------------------------------------------------------

export function computeReknockScore(input: PinScoreInput): number {
  const p = input.profile;

  // Time factor: optimal window after preferred delay
  const timeFactor = input.days_since_last_knock >= p.preferred_reknock_delay_days
    ? Math.min(1, (input.days_since_last_knock - p.preferred_reknock_delay_days + 3) / 10)
    : input.days_since_last_knock / p.preferred_reknock_delay_days * 0.3;

  // Status-based urgency
  const STATUS_URGENCY: Record<string, number> = {
    no_answer: 0.8,
    callback: 0.9,
    follow_up: 0.85,
    knocked: 0.5,
    lead: 0.7,
    revisit: 0.75,
    quote_sent: 0.6,
    new: 0.4,
    unknown: 0.3,
    not_interested: 0.05,
    sold: 0.0,
    cancelled: 0.0,
    do_not_knock: 0.0,
  };
  const statusUrgency = STATUS_URGENCY[input.last_event_type] ?? 0.3;

  // Proximity boost
  const proximityBoost = Math.min(input.nearby_job_count / 3, 1);

  // Cluster opportunity
  const clusterBoost = Math.min(input.nearby_opportunity_cluster / 5, 1);

  // Team availability
  const teamBoost = input.team_available ? 1 : 0.3;

  // Quote/lead boost
  const entityBoost = (input.has_quote ? 0.3 : 0) + (input.has_lead ? 0.2 : 0);

  // Diminishing returns on visits
  const visitPenalty = Math.max(0, 1 - (input.visit_count - 1) * 0.1);

  const raw =
    statusUrgency * 0.25 +
    timeFactor * 0.20 +
    proximityBoost * p.weight_proximity +
    clusterBoost * 0.10 +
    teamBoost * p.weight_team_availability * 0.5 +
    entityBoost +
    visitPenalty * 0.05;

  return Math.round(Math.min(100, Math.max(0, raw * 80)));
}

// ---------------------------------------------------------------------------
// Fatigue Score (0-100) — higher = more fatigued
// ---------------------------------------------------------------------------

export function computeFatigueScore(input: FatigueInput): number {
  // Knock frequency factor
  const weeklyRate = input.knocks_last_7_days;
  const monthlyRate = input.knocks_last_30_days;
  const frequencyFatigue = Math.min(weeklyRate / 15, 1) * 0.4; // > 15 knocks/week = fatigued

  // Conversion decline
  const conversionDecline = input.conversion_trend < 0
    ? Math.abs(input.conversion_trend) * 0.3
    : 0;

  // Over-exposure: too many reps + visits
  const exposureFatigue = Math.min(input.unique_reps_visited / 3, 1) * 0.15;
  const visitFatigue = Math.min(input.total_visits / 10, 1) * 0.15;

  const raw = frequencyFatigue + conversionDecline + exposureFatigue + visitFatigue;
  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

// ---------------------------------------------------------------------------
// Batch score computation for territories
// ---------------------------------------------------------------------------

export async function scoreAllTerritories(
  admin: SupabaseClient,
  orgId: string,
  profile?: CompanyProfile
): Promise<void> {
  const p = profile ?? DEFAULT_PROFILE;

  const { data: territories } = await admin
    .from('field_territories')
    .select('id, assigned_user_id')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (!territories?.length) return;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  for (const ter of territories) {
    // Get pins in territory
    const { data: pins } = await admin
      .from('field_house_profiles')
      .select('id, current_status, last_activity_at, reknock_priority_score, visit_count, quote_id, lead_id')
      .eq('org_id', orgId)
      .eq('territory_id', ter.id)
      .is('deleted_at', null);

    const totalPins = pins?.length ?? 0;
    if (totalPins === 0) {
      await admin.from('field_territories').update({
        territory_score: 0, fatigue_score: 0, coverage_percent: 0,
        total_pins: 0, active_leads: 0, close_rate: 0,
        last_scored_at: now.toISOString(),
      }).eq('id', ter.id);
      continue;
    }

    // Count statuses
    const statusCounts: Record<string, number> = {};
    let recentNoAnswers = 0;
    let leads = 0;
    let quotes = 0;
    let sales = 0;
    let totalVisited = 0;
    let latestActivity: Date | null = null;

    for (const pin of pins!) {
      statusCounts[pin.current_status] = (statusCounts[pin.current_status] ?? 0) + 1;
      if (pin.current_status === 'no_answer') recentNoAnswers++;
      if (pin.current_status === 'lead' || pin.lead_id) leads++;
      if (pin.quote_id) quotes++;
      if (pin.current_status === 'sold') sales++;
      if (pin.visit_count > 0) totalVisited++;
      if (pin.last_activity_at) {
        const d = new Date(pin.last_activity_at);
        if (!latestActivity || d > latestActivity) latestActivity = d;
      }
    }

    const coverage = totalPins > 0 ? (totalVisited / totalPins) * 100 : 0;
    const closeRate = totalVisited > 0 ? (sales / totalVisited) * 100 : 0;
    const daysSinceActivity = latestActivity
      ? (now.getTime() - latestActivity.getTime()) / 86400000
      : 999;

    // Get nearby scheduled jobs
    const { count: nearbyJobs } = await admin
      .from('schedule_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('start_time', now.toISOString())
      .is('deleted_at', null);

    // Rep historical score
    const repScore = ter.assigned_user_id
      ? await getRepScore(admin, orgId, ter.assigned_user_id)
      : 50;

    const score = computeTerritoryScore({
      coverage_percent: coverage,
      recent_no_answers: recentNoAnswers,
      lead_density: leads,
      quote_density: quotes,
      close_rate: closeRate,
      days_since_last_activity: daysSinceActivity,
      nearby_scheduled_jobs: nearbyJobs ?? 0,
      rep_historical_score: repScore,
      total_pins: totalPins,
      active_leads: leads,
      profile: p,
    });

    // Territory fatigue
    const { count: recentKnocks } = await admin
      .from('field_house_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('house_id', pins!.map(pp => pp.id))
      .gte('created_at', sevenDaysAgo);

    const { count: monthKnocks } = await admin
      .from('field_house_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('house_id', pins!.map(pp => pp.id))
      .gte('created_at', thirtyDaysAgo);

    const fatigue = computeFatigueScore({
      knocks_last_7_days: recentKnocks ?? 0,
      knocks_last_30_days: monthKnocks ?? 0,
      conversion_trend: 0,
      unique_reps_visited: 1,
      total_visits: totalVisited,
    });

    await admin.from('field_territories').update({
      territory_score: score,
      fatigue_score: fatigue,
      coverage_percent: Math.round(coverage * 10) / 10,
      total_pins: totalPins,
      active_leads: leads,
      close_rate: Math.round(closeRate * 10) / 10,
      last_scored_at: now.toISOString(),
    }).eq('id', ter.id);
  }
}

// ---------------------------------------------------------------------------
// Batch score computation for pins
// ---------------------------------------------------------------------------

export async function scoreAllPins(
  admin: SupabaseClient,
  orgId: string,
  profile?: CompanyProfile
): Promise<void> {
  const p = profile ?? DEFAULT_PROFILE;

  const { data: pins } = await admin
    .from('field_house_profiles')
    .select('id, current_status, last_activity_at, visit_count, territory_id, lat, lng, quote_id, lead_id, job_id')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (!pins?.length) return;

  const now = new Date();

  // Get upcoming scheduled jobs for proximity calc
  const { data: upcomingJobs } = await admin
    .from('jobs')
    .select('id, property_address')
    .eq('org_id', orgId)
    .in('status', ['scheduled', 'in_progress'])
    .is('deleted_at', null)
    .limit(100);

  for (const pin of pins) {
    const daysSinceKnock = pin.last_activity_at
      ? (now.getTime() - new Date(pin.last_activity_at).getTime()) / 86400000
      : 999;

    // Skip pins that don't need reknocking
    if (['sold', 'cancelled', 'do_not_knock', 'not_interested'].includes(pin.current_status)) {
      await admin.from('field_house_profiles').update({
        reknock_priority_score: 0,
        ai_next_action: pin.current_status === 'sold' ? 'Completed' : 'No action needed',
        last_scored_at: now.toISOString(),
      }).eq('id', pin.id);
      continue;
    }

    // Count nearby opportunities (same territory)
    const nearbyOpportunities = pins.filter(
      pp => pp.id !== pin.id && pp.territory_id === pin.territory_id &&
        ['no_answer', 'callback', 'follow_up', 'lead'].includes(pp.current_status)
    ).length;

    const score = computeReknockScore({
      last_event_type: pin.current_status,
      days_since_last_knock: daysSinceKnock,
      nearby_job_count: upcomingJobs?.length ?? 0,
      nearby_opportunity_cluster: nearbyOpportunities,
      team_available: true,
      visit_count: pin.visit_count ?? 0,
      has_quote: !!pin.quote_id,
      has_lead: !!pin.lead_id,
      profile: p,
    });

    // Derive AI next action
    const NEXT_ACTIONS: Record<string, string> = {
      no_answer: 'Reknock — no one was home last time',
      callback: 'Call back as scheduled',
      follow_up: 'Follow up on previous interest',
      lead: 'Send proposal or schedule estimate',
      knocked: 'Revisit to build rapport',
      revisit: 'Revisit as planned',
      quote_sent: 'Follow up on sent quote',
      new: 'First visit — introduce services',
      unknown: 'Visit to assess opportunity',
    };

    await admin.from('field_house_profiles').update({
      reknock_priority_score: score,
      ai_next_action: NEXT_ACTIONS[pin.current_status] ?? 'Visit house',
      last_scored_at: now.toISOString(),
    }).eq('id', pin.id);
  }
}

// ---------------------------------------------------------------------------
// Helper: get rep performance score
// ---------------------------------------------------------------------------

async function getRepScore(
  admin: SupabaseClient,
  orgId: string,
  userId: string
): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const { data: stats } = await admin
    .from('field_daily_stats')
    .select('knocks, leads, sales')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgo);

  if (!stats?.length) return 50;

  const totals = stats.reduce(
    (acc, r) => ({
      knocks: acc.knocks + (r.knocks ?? 0),
      leads: acc.leads + (r.leads ?? 0),
      sales: acc.sales + (r.sales ?? 0),
    }),
    { knocks: 0, leads: 0, sales: 0 }
  );

  const closeRate = totals.knocks > 0 ? totals.sales / totals.knocks : 0;
  const activityScore = Math.min(totals.knocks / 100, 1) * 40;
  const conversionScore = closeRate * 60;

  return Math.round(Math.min(100, activityScore + conversionScore));
}

// ---------------------------------------------------------------------------
// Get company operating profile
// ---------------------------------------------------------------------------

export async function getCompanyProfile(
  admin: SupabaseClient,
  orgId: string
): Promise<CompanyProfile> {
  const { data } = await admin
    .from('company_operating_profile')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (!data) return DEFAULT_PROFILE;

  return {
    weight_proximity: data.weight_proximity ?? DEFAULT_PROFILE.weight_proximity,
    weight_team_availability: data.weight_team_availability ?? DEFAULT_PROFILE.weight_team_availability,
    weight_value: data.weight_value ?? DEFAULT_PROFILE.weight_value,
    weight_recency: data.weight_recency ?? DEFAULT_PROFILE.weight_recency,
    preferred_reknock_delay_days: data.preferred_reknock_delay_days ?? DEFAULT_PROFILE.preferred_reknock_delay_days,
    avg_jobs_per_day: data.avg_jobs_per_day ?? DEFAULT_PROFILE.avg_jobs_per_day,
    max_travel_radius_km: data.max_travel_radius_km ?? DEFAULT_PROFILE.max_travel_radius_km,
  };
}
