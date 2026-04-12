/* State: decide — Pure heuristic routing (zero Gemini tokens) */

import type { AgentContext, AgentState } from '../types';

const SCENARIO_DOMAINS = new Set(['team_assignment', 'pricing', 'scheduling']);
const SCENARIO_KEYWORDS = /\b(who should|qui devrait|compare|comparer|best option|meilleure option|which team|quelle equipe|how much should|combien devrait)\b/i;

export async function decide(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const intent = ctx.intent;

  // Fast path: non-actionable intents → direct recommend
  if (!intent || intent.type === 'query' || intent.type === 'followup' || intent.type === 'chat') {
    ctx.decision = { type: 'direct', requiresScenario: false, reasoning: 'Non-actionable intent' };
    return { next: 'recommend', ctx };
  }

  // Explicit scenario request
  if (intent.type === 'scenario_request') {
    ctx.decision = { type: intent.domain || 'general', requiresScenario: true, reasoning: 'User explicitly requested comparison' };
    return { next: 'scenario_engine', ctx };
  }

  // Domain-based heuristic + keyword detection
  const domainMatch = SCENARIO_DOMAINS.has(intent.domain || '');
  const keywordMatch = SCENARIO_KEYWORDS.test(ctx.userMessage);
  const hasMultipleOptions = (ctx.crmData as any)?.teams?.length > 1 || (ctx.crmData as any)?.quotes?.length > 1;

  if ((domainMatch && hasMultipleOptions) || keywordMatch) {
    ctx.decision = { type: intent.domain || 'general', requiresScenario: true, reasoning: `Heuristic: domain=${intent.domain}, keywords=${keywordMatch}, multipleOptions=${hasMultipleOptions}` };
    return { next: 'scenario_engine', ctx };
  }

  // Default: direct action/recommendation
  ctx.decision = { type: intent.domain || 'general', requiresScenario: false, reasoning: 'Direct action — no comparison needed' };
  return { next: 'recommend', ctx };
}
