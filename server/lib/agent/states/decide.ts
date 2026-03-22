/* State: decide — Determine if scenario engine is needed or direct recommendation */

import type { AgentContext, AgentState } from '../types';
import { geminiChat } from '../../gemini';

// These domains benefit from scenario analysis (comparing options)
const SCENARIO_DOMAINS = ['team_assignment', 'pricing', 'scheduling'];

// These domains are direct actions (no scenario needed)
const DIRECT_ACTION_DOMAINS = [
  'convert_lead', 'update_job_status', 'update_lead_status',
  'send_invoice', 'record_payment', 'followup',
];

export async function decide(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const intent = ctx.intent;

  // Fast path: simple queries or follow-ups don't need scenario engine
  if (!intent || intent.type === 'query' || intent.type === 'followup' || intent.type === 'chat') {
    ctx.decision = {
      type: 'direct',
      requiresScenario: false,
      reasoning: 'Simple query — direct response',
    };
    return { next: 'recommend', ctx };
  }

  const domainRequiresScenario = SCENARIO_DOMAINS.includes(intent.domain || '');
  const isScenarioRequest = intent.type === 'scenario_request';

  if (!domainRequiresScenario && !isScenarioRequest) {
    ctx.decision = {
      type: 'action',
      requiresScenario: false,
      reasoning: `Action in domain "${intent.domain}" — direct recommendation`,
    };
    return { next: 'recommend', ctx };
  }

  try {
    const crmSummary = JSON.stringify(ctx.crmData || {}, null, 0).slice(0, 2000);
    const memorySummary = ctx.memory?.entities?.length
      ? `Known context: ${ctx.memory.entities.map(e => `${e.key}: ${JSON.stringify(e.value)}`).join(', ')}`
      : 'No prior memory.';

    const response = await geminiChat({
      systemPrompt: `You are a decision router for a CRM agent. Determine if the user's request requires scenario analysis (comparing multiple options) or a direct answer.

Respond ONLY with valid JSON:
{
  "requiresScenario": true/false,
  "reasoning": "brief explanation",
  "scenarioType": "team_assignment" | "pricing" | "scheduling" | null
}

Use scenario analysis when:
- User asks "who should do this job?" (team assignment)
- User asks about pricing strategy for a quote
- User needs to compare scheduling options
- Decision has multiple valid outcomes

Skip scenario when:
- Question has one clear answer
- User just wants information
- Action is straightforward (create follow-up, etc.)`,
      messages: [{
        role: 'user',
        content: `User intent: ${JSON.stringify(intent)}
CRM data: ${crmSummary}
Memory: ${memorySummary}
User message: "${ctx.userMessage}"`,
      }],
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 256,
    });

    const parsed = JSON.parse(response.content);

    ctx.decision = {
      type: parsed.scenarioType || intent.domain || 'general',
      requiresScenario: Boolean(parsed.requiresScenario),
      reasoning: parsed.reasoning || 'LLM decision',
    };
  } catch (err: any) {
    ctx.decision = {
      type: intent.domain || 'general',
      requiresScenario: domainRequiresScenario || isScenarioRequest,
      reasoning: `Fallback heuristic (${err?.message})`,
    };
    console.warn('[agent/decide] Error:', err?.message);
  }

  return {
    next: ctx.decision.requiresScenario ? 'scenario_engine' : 'recommend',
    ctx,
  };
}
