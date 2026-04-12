/**
 * Territory Assignment AI Engine
 *
 * Learns which reps perform best in which areas and:
 * - Recommends optimal rep-territory assignments
 * - Balances workload across team
 * - Optimizes for performance
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssignmentRecommendation {
  territory_id: string;
  territory_name: string;
  recommended_user_id: string;
  recommended_user_name: string;
  score: number;
  explanation: string;
  current_user_id: string | null;
  current_user_name: string | null;
}

interface RepPerformance {
  user_id: string;
  display_name: string;
  territory_id: string;
  knocks: number;
  leads: number;
  sales: number;
  close_rate: number;
  avg_daily_knocks: number;
}

// ---------------------------------------------------------------------------
// Main: get assignment recommendations
// ---------------------------------------------------------------------------

export async function getAssignmentRecommendations(
  admin: SupabaseClient,
  orgId: string
): Promise<AssignmentRecommendation[]> {
  // 1. Get all territories
  const { data: territories } = await admin
    .from('field_territories')
    .select('id, name, assigned_user_id, territory_score')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (!territories?.length) return [];

  // 2. Get all reps
  const { data: reps } = await admin
    .from('field_sales_reps')
    .select('id, user_id, display_name')
    .eq('org_id', orgId)
    .eq('is_active', true);

  if (!reps?.length) return [];

  // 3. Get performance data (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const { data: stats } = await admin
    .from('field_daily_stats')
    .select('user_id, knocks, leads, sales, date')
    .eq('org_id', orgId)
    .gte('date', thirtyDaysAgo);

  // 4. Get territory assignment history
  const { data: assignments } = await admin
    .from('field_territory_assignments')
    .select('territory_id, user_id, performance_score, knocks_during, leads_during, sales_during, close_rate')
    .eq('org_id', orgId);

  // Build rep performance map
  const repStats: Record<string, { knocks: number; leads: number; sales: number; days: Set<string> }> = {};
  for (const s of stats ?? []) {
    if (!repStats[s.user_id]) repStats[s.user_id] = { knocks: 0, leads: 0, sales: 0, days: new Set() };
    repStats[s.user_id].knocks += s.knocks ?? 0;
    repStats[s.user_id].leads += s.leads ?? 0;
    repStats[s.user_id].sales += s.sales ?? 0;
    repStats[s.user_id].days.add(s.date);
  }

  // Build territory-rep performance from history
  const terRepPerf: Record<string, Record<string, number>> = {};
  for (const a of assignments ?? []) {
    if (!terRepPerf[a.territory_id]) terRepPerf[a.territory_id] = {};
    terRepPerf[a.territory_id][a.user_id] = a.performance_score ?? 0;
  }

  // 5. For each territory, score each rep
  const recommendations: AssignmentRecommendation[] = [];
  const assignedCounts: Record<string, number> = {};

  // Count current assignments for workload balance
  for (const t of territories) {
    if (t.assigned_user_id) {
      assignedCounts[t.assigned_user_id] = (assignedCounts[t.assigned_user_id] ?? 0) + 1;
    }
  }

  for (const ter of territories) {
    let bestRep = { userId: '', name: '', score: 0, explanation: '' };

    for (const rep of reps) {
      let score = 50; // base
      const reasons: string[] = [];

      // Historical performance in this territory
      const histScore = terRepPerf[ter.id]?.[rep.user_id];
      if (histScore != null) {
        score += histScore * 0.3;
        if (histScore > 70) reasons.push('strong past performance here');
      }

      // Overall performance
      const rs = repStats[rep.user_id];
      if (rs) {
        const closeRate = rs.knocks > 0 ? (rs.sales / rs.knocks) * 100 : 0;
        const avgDaily = rs.days.size > 0 ? rs.knocks / rs.days.size : 0;

        if (closeRate > 15) { score += 15; reasons.push('high close rate'); }
        else if (closeRate > 8) { score += 8; reasons.push('good close rate'); }

        if (avgDaily > 20) { score += 10; reasons.push('high activity level'); }
      }

      // Workload balance: penalize over-assigned reps
      const currentLoad = assignedCounts[rep.user_id] ?? 0;
      if (currentLoad > 3) { score -= 20; reasons.push('already managing many territories'); }
      else if (currentLoad > 1) { score -= 5; }
      else if (currentLoad === 0) { score += 10; reasons.push('available capacity'); }

      score = Math.min(100, Math.max(0, Math.round(score)));

      if (score > bestRep.score) {
        bestRep = {
          userId: rep.user_id,
          name: rep.display_name,
          score,
          explanation: reasons.length > 0 ? reasons.join(', ') : 'balanced workload',
        };
      }
    }

    const currentRep = reps.find(r => r.user_id === ter.assigned_user_id);

    recommendations.push({
      territory_id: ter.id,
      territory_name: ter.name,
      recommended_user_id: bestRep.userId,
      recommended_user_name: bestRep.name,
      score: bestRep.score,
      explanation: bestRep.explanation,
      current_user_id: ter.assigned_user_id,
      current_user_name: currentRep?.display_name ?? null,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score);
}
