/* ═══════════════════════════════════════════════════════════════
   AI Training Engine — The learning loop for Mr Lume

   Handles:
   1. Outcome tracking (did recommendations work?)
   2. Confidence calibration (predicted vs actual)
   3. Few-shot evolution (weighted, domain-specific)
   4. Negative learning (anti-examples from thumbs-down)
   5. User personalization (learn decision style)
   6. Error corrections (user explains what was wrong)
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ─────────────────────────────────────────────────────

interface OutcomeInput {
  orgId: string;
  userId: string;
  decisionLogId?: string;
  sessionId?: string;
  messageId?: string;
  domain: string;
  actionType?: string;
  confidence: number;
  outcome: 'success' | 'partial' | 'failure' | 'rejected' | 'ignored';
  outcomeScore?: number;
  outcomeNote?: string;
  revenueImpactCents?: number;
  timeSavedMinutes?: number;
}

interface CorrectionInput {
  orgId: string;
  userId: string;
  sessionId?: string;
  messageId?: string;
  originalResponse: string;
  domain?: string;
  correctionType: 'wrong_answer' | 'wrong_tone' | 'missing_context' | 'hallucination' | 'outdated';
  correctionText: string;
  correctAnswer?: string;
}

interface FewShotExample {
  id: string;
  domain: string;
  user_message: string;
  agent_response: string;
  quality_score: number;
  feedback_type: 'positive' | 'negative';
  created_at: string;
  use_count: number;
}

export interface CalibrationData {
  domain: string;
  calibration_factor: number;
  total_predictions: number;
  correct_predictions: number;
  avg_predicted_conf: number;
  avg_actual_success: number;
}

export interface UserPrefs {
  preferred_detail_level: 'brief' | 'medium' | 'detailed';
  preferred_tone: 'casual' | 'professional' | 'direct';
  preferred_option_style: 'fastest' | 'cheapest' | 'balanced' | 'quality';
  approval_rate: number;
  domain_preferences: Record<string, { approval_rate: number; avg_confidence_needed: number }>;
}

// ─── 1. Outcome Tracking ──────────────────────────────────────

export async function recordOutcome(supabase: SupabaseClient, input: OutcomeInput): Promise<string> {
  const { data, error } = await supabase.from('decision_outcomes').insert({
    org_id: input.orgId,
    decision_log_id: input.decisionLogId || null,
    session_id: input.sessionId || null,
    message_id: input.messageId || null,
    domain: input.domain,
    action_type: input.actionType || null,
    confidence: input.confidence,
    outcome: input.outcome,
    outcome_score: input.outcomeScore ?? outcomeToScore(input.outcome),
    outcome_note: input.outcomeNote || null,
    revenue_impact_cents: input.revenueImpactCents || 0,
    time_saved_minutes: input.timeSavedMinutes || 0,
    user_id: input.userId,
    resolved_at: new Date().toISOString(),
  }).select('id').single();

  if (error) throw error;

  // Trigger async calibration recalc
  void recalibrateConfidence(supabase, input.orgId, input.domain).catch(() => {});

  // If positive outcome, promote the response to a few-shot example
  if (input.outcome === 'success' && input.messageId) {
    void promoteToFewShot(supabase, input.orgId, input.messageId, input.domain, 'positive').catch(() => {});
  }

  // If negative outcome, create anti-example
  if ((input.outcome === 'failure' || input.outcome === 'rejected') && input.messageId) {
    void promoteToFewShot(supabase, input.orgId, input.messageId, input.domain, 'negative').catch(() => {});
  }

  // Update user preferences
  void updateUserPrefs(supabase, input.orgId, input.userId, input.outcome, input.domain).catch(() => {});

  return data.id;
}

function outcomeToScore(outcome: string): number {
  switch (outcome) {
    case 'success': return 100;
    case 'partial': return 60;
    case 'failure': return 0;
    case 'rejected': return 10;
    case 'ignored': return 30;
    default: return 50;
  }
}

// Auto-record outcome when approval is approved/rejected
export async function recordApprovalOutcome(supabase: SupabaseClient, orgId: string, userId: string, approvalId: string, approved: boolean): Promise<void> {
  // Get the approval details
  const { data: approval } = await supabase.from('approvals')
    .select('action_type, decision_log_id, session_id')
    .eq('id', approvalId).single();
  if (!approval) return;

  // Get confidence from decision log
  let confidence = 70;
  if (approval.decision_log_id) {
    const { data: log } = await supabase.from('decision_logs')
      .select('confidence, domain').eq('id', approval.decision_log_id).single();
    if (log) confidence = log.confidence || 70;
  }

  await recordOutcome(supabase, {
    orgId,
    userId,
    decisionLogId: approval.decision_log_id,
    sessionId: approval.session_id,
    domain: approval.action_type?.split('_')[0] || 'general',
    actionType: approval.action_type,
    confidence,
    outcome: approved ? 'success' : 'rejected',
  });
}

// ─── 2. Confidence Calibration ────────────────────────────────

export async function recalibrateConfidence(supabase: SupabaseClient, orgId: string, domain: string): Promise<void> {
  const { error } = await supabase.rpc('recalculate_calibration', { p_org: orgId, p_domain: domain });
  if (error) console.error('[training] calibration error:', error.message);
}

export async function getCalibrationFactor(supabase: SupabaseClient, orgId: string, domain: string): Promise<number> {
  const { data } = await supabase.from('confidence_calibration')
    .select('calibration_factor, total_predictions')
    .eq('org_id', orgId).eq('domain', domain).single();

  // Need at least 10 predictions for calibration to be meaningful
  if (!data || data.total_predictions < 10) return 1.0;
  return data.calibration_factor;
}

export async function getAllCalibration(supabase: SupabaseClient, orgId: string): Promise<CalibrationData[]> {
  const { data } = await supabase.from('confidence_calibration')
    .select('*').eq('org_id', orgId).order('domain');
  return (data || []) as CalibrationData[];
}

// Apply calibration to a raw confidence score
export function calibrateConfidence(rawConfidence: number, factor: number): number {
  return Math.min(99, Math.max(1, Math.round(rawConfidence * factor)));
}

// ─── 3. Few-Shot Evolution ────────────────────────────────────

async function promoteToFewShot(
  supabase: SupabaseClient, orgId: string, messageId: string, domain: string, feedbackType: 'positive' | 'negative'
): Promise<void> {
  // Get the message and its parent (user message)
  const { data: msg } = await supabase.from('agent_messages')
    .select('id, session_id, role, content')
    .eq('id', messageId).single();
  if (!msg || msg.role !== 'assistant') return;

  // Find the user message that prompted this response
  const { data: userMsg } = await supabase.from('agent_messages')
    .select('content')
    .eq('session_id', msg.session_id)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1).single();
  if (!userMsg) return;

  // Check for duplicates (same user message in same domain)
  const { count } = await supabase.from('few_shot_examples')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('domain', domain)
    .eq('user_message', userMsg.content.slice(0, 200));
  if ((count || 0) > 0) return;

  // Quality score: positive=8, negative=3 (negative examples are less weighted)
  const baseScore = feedbackType === 'positive' ? 8.0 : 3.0;

  await supabase.from('few_shot_examples').insert({
    org_id: orgId,
    domain,
    user_message: userMsg.content.slice(0, 500),
    agent_response: msg.content.slice(0, 1000),
    source: feedbackType === 'positive' ? 'outcome' : 'negative_outcome',
    quality_score: baseScore,
    feedback_type: feedbackType,
    original_message_id: messageId,
    original_session_id: msg.session_id,
  });

  // Cap: max 20 examples per org+domain, remove lowest quality
  const { data: excess } = await supabase.from('few_shot_examples')
    .select('id, quality_score')
    .eq('org_id', orgId).eq('domain', domain).eq('is_active', true)
    .order('quality_score', { ascending: true });

  if (excess && excess.length > 20) {
    const toRemove = excess.slice(0, excess.length - 20).map((e: any) => e.id);
    await supabase.from('few_shot_examples')
      .update({ is_active: false })
      .in('id', toRemove);
  }
}

// Get weighted few-shot examples for prompt injection
export async function getWeightedFewShots(
  supabase: SupabaseClient, orgId: string, domain: string, limit: number = 3
): Promise<{ positive: FewShotExample[]; negative: FewShotExample[] }> {
  // Fetch active examples for this domain
  const { data } = await supabase.from('few_shot_examples')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .or(`domain.eq.${domain},domain.eq.general`)
    .order('quality_score', { ascending: false });

  if (!data?.length) return { positive: [], negative: [] };

  // Apply recency decay: reduce quality by 0.5 per week old
  const now = Date.now();
  const weighted = data.map((ex: any) => {
    const ageWeeks = (now - new Date(ex.created_at).getTime()) / (7 * 86400000);
    const decayedScore = Math.max(0, ex.quality_score - (ageWeeks * 0.5));
    // Boost domain-exact matches
    const domainBonus = ex.domain === domain ? 2.0 : 0;
    return { ...ex, effective_score: decayedScore + domainBonus };
  });

  // Sort by effective score
  weighted.sort((a: any, b: any) => b.effective_score - a.effective_score);

  const positive = weighted.filter((e: any) => e.feedback_type === 'positive').slice(0, limit);
  const negative = weighted.filter((e: any) => e.feedback_type === 'negative').slice(0, 2); // max 2 anti-examples

  // Track usage
  const usedIds = [...positive, ...negative].map((e: any) => e.id);
  if (usedIds.length > 0) {
    await supabase.from('few_shot_examples')
      .update({ last_used_at: new Date().toISOString(), use_count: supabase.rpc ? undefined : undefined })
      .in('id', usedIds).then(() => {
        // Increment use_count
        for (const id of usedIds) {
          supabase.rpc('increment_few_shot_usage', { p_id: id }).then(() => {}, () => {});
        }
      });
  }

  return { positive, negative };
}

// ─── 4. Negative Learning ─────────────────────────────────────

// Get anti-patterns for a domain (recent corrections + thumbs-down)
export async function getNegativePatterns(supabase: SupabaseClient, orgId: string, domain: string): Promise<string[]> {
  const patterns: string[] = [];

  // Get recent corrections for this domain
  const { data: corrections } = await supabase.from('agent_corrections')
    .select('correction_type, correction_text, correct_answer')
    .eq('org_id', orgId)
    .or(domain ? `domain.eq.${domain},domain.is.null` : 'domain.is.null')
    .order('created_at', { ascending: false })
    .limit(5);

  for (const c of corrections || []) {
    if (c.correction_type === 'wrong_answer') {
      patterns.push(`AVOID: ${c.correction_text}${c.correct_answer ? ` → INSTEAD: ${c.correct_answer}` : ''}`);
    } else if (c.correction_type === 'hallucination') {
      patterns.push(`NEVER fabricate: ${c.correction_text}`);
    } else if (c.correction_type === 'wrong_tone') {
      patterns.push(`Tone issue: ${c.correction_text}`);
    } else {
      patterns.push(`Correction: ${c.correction_text}`);
    }
  }

  // Get thumbs-down summaries from memory_events
  const { data: negFeedback } = await supabase.from('memory_events')
    .select('summary, metadata')
    .eq('org_id', orgId)
    .eq('event_type', 'feedback')
    .gte('importance', 7) // thumbs-down = importance 8
    .order('created_at', { ascending: false })
    .limit(3);

  for (const f of negFeedback || []) {
    if (f.summary?.includes('not helpful')) {
      const meta = f.metadata as any;
      if (meta?.agent_response) {
        patterns.push(`User disliked this response style: "${meta.agent_response.slice(0, 100)}..."`);
      }
    }
  }

  return patterns;
}

// ─── 5. User Personalization ──────────────────────────────────

async function updateUserPrefs(
  supabase: SupabaseClient, orgId: string, userId: string, outcome: string, domain: string
): Promise<void> {
  const isApproval = outcome === 'success' || outcome === 'partial';
  const isRejection = outcome === 'rejected' || outcome === 'failure';

  // Upsert preferences
  const { data: existing } = await supabase.from('user_agent_preferences')
    .select('*').eq('org_id', orgId).eq('user_id', userId).single();

  if (!existing) {
    await supabase.from('user_agent_preferences').insert({
      org_id: orgId,
      user_id: userId,
      total_interactions: 1,
      total_approvals: isApproval ? 1 : 0,
      total_rejections: isRejection ? 1 : 0,
      approval_rate: isApproval ? 100 : 0,
      domain_preferences: { [domain]: { approval_rate: isApproval ? 100 : 0, count: 1 } },
      last_interaction_at: new Date().toISOString(),
    });
    return;
  }

  const newTotal = (existing.total_interactions || 0) + 1;
  const newApprovals = (existing.total_approvals || 0) + (isApproval ? 1 : 0);
  const newRejections = (existing.total_rejections || 0) + (isRejection ? 1 : 0);
  const newRate = newTotal > 0 ? Math.round((newApprovals / newTotal) * 100) : 0;

  // Update domain-specific preferences
  const domainPrefs = (existing.domain_preferences || {}) as Record<string, any>;
  const dp = domainPrefs[domain] || { approval_rate: 0, count: 0 };
  dp.count = (dp.count || 0) + 1;
  dp.approval_rate = dp.count > 0 ? Math.round(((dp.approval_rate * (dp.count - 1) / 100 + (isApproval ? 1 : 0)) / dp.count) * 100) : 0;
  domainPrefs[domain] = dp;

  await supabase.from('user_agent_preferences')
    .update({
      total_interactions: newTotal,
      total_approvals: newApprovals,
      total_rejections: newRejections,
      approval_rate: newRate,
      domain_preferences: domainPrefs,
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
}

export async function getUserPrefs(supabase: SupabaseClient, orgId: string, userId: string): Promise<UserPrefs | null> {
  const { data } = await supabase.from('user_agent_preferences')
    .select('*').eq('org_id', orgId).eq('user_id', userId).single();
  if (!data) return null;
  return data as unknown as UserPrefs;
}

// Record thumbs up/down and update preferences
export async function recordFeedback(
  supabase: SupabaseClient, orgId: string, userId: string, messageId: string, isPositive: boolean, domain?: string
): Promise<void> {
  // Update user prefs
  const { data: existing } = await supabase.from('user_agent_preferences')
    .select('id, total_thumbs_up, total_thumbs_down')
    .eq('org_id', orgId).eq('user_id', userId).single();

  if (existing) {
    await supabase.from('user_agent_preferences')
      .update({
        total_thumbs_up: (existing.total_thumbs_up || 0) + (isPositive ? 1 : 0),
        total_thumbs_down: (existing.total_thumbs_down || 0) + (isPositive ? 0 : 1),
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
  } else {
    await supabase.from('user_agent_preferences').insert({
      org_id: orgId, user_id: userId,
      total_thumbs_up: isPositive ? 1 : 0,
      total_thumbs_down: isPositive ? 0 : 1,
    });
  }

  // Promote/demote to few-shot
  if (isPositive) {
    void promoteToFewShot(supabase, orgId, messageId, domain || 'general', 'positive').catch(() => {});
  } else {
    void promoteToFewShot(supabase, orgId, messageId, domain || 'general', 'negative').catch(() => {});
  }
}

// ─── 6. Error Corrections ─────────────────────────────────────

export async function recordCorrection(supabase: SupabaseClient, input: CorrectionInput): Promise<string> {
  const { data, error } = await supabase.from('agent_corrections').insert({
    org_id: input.orgId,
    user_id: input.userId,
    session_id: input.sessionId || null,
    message_id: input.messageId || null,
    original_response: input.originalResponse.slice(0, 2000),
    domain: input.domain || null,
    correction_type: input.correctionType,
    correction_text: input.correctionText.slice(0, 2000),
    correct_answer: input.correctAnswer?.slice(0, 2000) || null,
  }).select('id').single();

  if (error) throw error;

  // If user provided correct answer, create a positive few-shot from it
  if (input.correctAnswer && input.messageId) {
    const { data: msg } = await supabase.from('agent_messages')
      .select('session_id, created_at')
      .eq('id', input.messageId).single();

    if (msg) {
      // Find the user's question
      const { data: userMsg } = await supabase.from('agent_messages')
        .select('content')
        .eq('session_id', msg.session_id).eq('role', 'user')
        .lt('created_at', msg.created_at)
        .order('created_at', { ascending: false })
        .limit(1).single();

      if (userMsg) {
        await supabase.from('few_shot_examples').insert({
          org_id: input.orgId,
          domain: input.domain || 'general',
          user_message: userMsg.content.slice(0, 500),
          agent_response: input.correctAnswer.slice(0, 1000),
          source: 'correction',
          quality_score: 9.0, // Corrections are high-value training data
          feedback_type: 'positive',
          original_message_id: input.messageId,
          original_session_id: msg.session_id,
        });
      }
    }
  }

  return data.id;
}

// ─── 7. Training Context Builder ──────────────────────────────
// Builds the training context to inject into the system prompt

export async function buildTrainingContext(
  supabase: SupabaseClient, orgId: string, userId: string, domain: string
): Promise<string> {
  const parts: string[] = [];

  // 1. User preferences
  const prefs = await getUserPrefs(supabase, orgId, userId);
  if (prefs) {
    parts.push(`[User Profile] Detail: ${prefs.preferred_detail_level}, Tone: ${prefs.preferred_tone}, Style: ${prefs.preferred_option_style}. Approval rate: ${prefs.approval_rate}%.`);

    const dp = prefs.domain_preferences?.[domain];
    if (dp) {
      parts.push(`[Domain ${domain}] User approves ${dp.approval_rate}% of ${domain} recommendations.`);
    }
  }

  // 2. Calibration warning
  const factor = await getCalibrationFactor(supabase, orgId, domain);
  if (factor < 0.7) {
    parts.push(`[CALIBRATION WARNING] Your confidence predictions for ${domain} are significantly overestimated. Apply more caution. Calibration factor: ${factor.toFixed(2)}.`);
  } else if (factor > 1.3) {
    parts.push(`[CALIBRATION NOTE] You tend to underestimate confidence for ${domain}. You can be more confident. Factor: ${factor.toFixed(2)}.`);
  }

  // 3. Negative patterns / corrections
  const negatives = await getNegativePatterns(supabase, orgId, domain);
  if (negatives.length > 0) {
    parts.push(`[LEARNED CORRECTIONS]\n${negatives.map((n, i) => `${i + 1}. ${n}`).join('\n')}`);
  }

  // 4. Few-shot examples
  const { positive, negative } = await getWeightedFewShots(supabase, orgId, domain, 2);
  if (positive.length > 0) {
    parts.push(`[GOOD RESPONSE EXAMPLES — match this style]`);
    for (const ex of positive) {
      parts.push(`User: "${ex.user_message.slice(0, 150)}"\nAssistant: "${ex.agent_response.slice(0, 300)}"`);
    }
  }
  if (negative.length > 0) {
    parts.push(`[BAD RESPONSE EXAMPLES — AVOID this style]`);
    for (const ex of negative) {
      parts.push(`User: "${ex.user_message.slice(0, 150)}"\nDO NOT respond like: "${ex.agent_response.slice(0, 200)}"`);
    }
  }

  // 5. Recent outcome stats
  const { data: recentOutcomes } = await supabase.from('decision_outcomes')
    .select('outcome, confidence')
    .eq('org_id', orgId).eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(10);

  if (recentOutcomes && recentOutcomes.length >= 5) {
    const successRate = Math.round((recentOutcomes.filter((o: any) => o.outcome === 'success' || o.outcome === 'partial').length / recentOutcomes.length) * 100);
    parts.push(`[Recent Performance] Last ${recentOutcomes.length} ${domain} decisions: ${successRate}% success rate.`);
  }

  return parts.join('\n\n');
}

// ─── 8. Background Training Job ───────────────────────────────
// Runs periodically to maintain training data quality

export async function runTrainingMaintenance(supabase: SupabaseClient): Promise<void> {
  try {
    // 1. Decay old few-shot scores
    const { error: decayErr } = await supabase.rpc('decay_few_shot_scores');
    if (decayErr) {
      // Fallback: manual decay
      await supabase.from('few_shot_examples')
        .update({ quality_score: 0 })
        .lt('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
        .eq('is_active', true);
    }

    // 2. Auto-resolve stale pending outcomes (older than 7 days → "ignored")
    const staleDate = new Date(Date.now() - 7 * 86400000).toISOString();
    await supabase.from('decision_outcomes')
      .update({ outcome: 'ignored', resolved_at: new Date().toISOString() })
      .eq('outcome', 'pending')
      .lt('created_at', staleDate);

    // 3. Recalibrate all domains for all orgs
    const { data: orgs } = await supabase.from('orgs').select('id');
    const { data: domains } = await supabase.from('decision_outcomes')
      .select('org_id, domain')
      .not('domain', 'is', null);

    const seen = new Set<string>();
    for (const d of domains || []) {
      const key = `${d.org_id}:${d.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await recalibrateConfidence(supabase, d.org_id, d.domain);
    }

    console.log('[training] maintenance complete');
  } catch (err: any) {
    console.error('[training] maintenance error:', err?.message);
  }
}
