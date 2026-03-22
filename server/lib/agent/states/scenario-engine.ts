/* State: scenario_engine — Generate and score 3-5 scenarios via Gemini */

import type { AgentContext, AgentState, ScenarioOption } from '../types';
import { geminiChat } from '../../gemini';
import { buildKnowledge } from '../knowledge';

export async function scenarioEngine(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const startTime = Date.now();
  const crmData = JSON.stringify(ctx.crmData || {}, null, 0).slice(0, 3000);
  const memoryCtx = ctx.memory?.entities?.length
    ? `Past context: ${ctx.memory.entities.slice(0, 5).map(e => `${e.key}: ${JSON.stringify(e.value)}`).join('; ')}`
    : '';

  const fr = ctx.language === 'fr';

  const knowledge = buildKnowledge(ctx.language);

  const systemPrompt = `${knowledge}

You are the scenario analysis engine of Mr Lume.
Generate exactly 3 to 5 scenarios for the given decision.
Use the CRM knowledge above to make realistic, grounded scenarios.

${fr ? 'Respond in French.' : 'Respond in English.'}

Respond ONLY with valid JSON:
{
  "scenarios": [
    {
      "label": "short title for this scenario",
      "score": 0-100,
      "benefits": ["benefit 1", "benefit 2"],
      "risks": ["risk 1", "risk 2"],
      "outcome": "what happens if this option is chosen",
      "confidence": 0.0 to 1.0
    }
  ]
}

Scoring criteria:
- For team_assignment: consider skills match, availability, past performance, workload
- For pricing: consider market rate, client history, profit margin, win probability
- For scheduling: consider team availability, client preference, efficiency

Score 0-100 where 100 is perfect. Be realistic — most scores should be 40-85.
Always include at least one risk per scenario.
Order scenarios by score (highest first).`;

  let scenarios: ScenarioOption[] = [];

  try {
    const response = await geminiChat({
      systemPrompt,
      messages: [{
        role: 'user',
        content: `Decision type: ${ctx.decision?.type || 'general'}
User request: "${ctx.userMessage}"

FULL CRM CONTEXT:
${ctx.brainSummary}

REQUEST-SPECIFIC DATA:
${crmData}
${memoryCtx}`,
      }],
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 2048,
    });

    const parsed = JSON.parse(response.content);

    if (Array.isArray(parsed.scenarios)) {
      scenarios = parsed.scenarios
        .slice(0, 5)
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
        .map((s: any, i: number) => ({
          label: String(s.label || `Option ${i + 1}`),
          score: Number(s.score) || 0,
          benefits: Array.isArray(s.benefits) ? s.benefits.map(String) : [],
          risks: Array.isArray(s.risks) ? s.risks.map(String) : [],
          outcome: String(s.outcome || ''),
          confidence: Number(s.confidence) || 0.5,
          isWinner: i === 0,
        }));
    }
  } catch (err: any) {
    ctx.errors.push(`Scenario generation failed: ${err?.message}`);
    console.error('[agent/scenario] Error:', err?.message);
  }

  // Fallback if generation failed
  if (scenarios.length === 0) {
    scenarios = [{
      label: fr ? 'Option par defaut' : 'Default option',
      score: 50,
      benefits: [fr ? 'Approche standard' : 'Standard approach'],
      risks: [fr ? 'Pas d\'analyse approfondie disponible' : 'No deep analysis available'],
      outcome: fr ? 'Resultat standard' : 'Standard outcome',
      confidence: 0.3,
      isWinner: true,
    }];
  }

  const durationMs = Date.now() - startTime;

  // Save to database
  try {
    const { data: run } = await ctx.supabase.from('scenario_runs').insert({
      org_id: ctx.orgId,
      session_id: ctx.sessionId,
      trigger_type: ctx.decision?.type || 'general',
      context_snapshot: { intent: ctx.intent, crmData: ctx.crmData },
      model_used: 'gemini-2.5-flash',
      duration_ms: durationMs,
    }).select('id').single();

    if (run?.id) {
      ctx.scenarioRunId = run.id;
      await ctx.supabase.from('scenario_options').insert(
        scenarios.map((s, i) => ({
          org_id: ctx.orgId,
          scenario_run_id: run.id,
          label: s.label,
          score: s.score,
          benefits: s.benefits,
          risks: s.risks,
          outcome: s.outcome,
          confidence: s.confidence,
          is_winner: s.isWinner || false,
          rank: i + 1,
        }))
      );
    }
  } catch (err: any) {
    ctx.errors.push(`Scenario DB save failed: ${err?.message}`);
  }

  ctx.scenarios = scenarios;
  ctx.responseType = 'scenario';
  ctx.structuredData = {
    runId: ctx.scenarioRunId || '',
    triggerType: ctx.decision?.type || 'general',
    options: scenarios,
    modelUsed: 'gemini-2.5-flash',
    durationMs,
  };

  return { next: 'recommend', ctx };
}
