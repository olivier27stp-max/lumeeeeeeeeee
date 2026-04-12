/* State: understand — Intent detection with multi-intent + composite actions */

import type { AgentContext, AgentState, AgentIntent } from '../types';
import { geminiChat } from '../../gemini';
import { compressHistory, recordTokenUsage } from '../token-optimizer';

export async function understand(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  // If intent already detected locally, skip Gemini call entirely
  if (ctx.intent && ctx.intent.confidence >= 0.7) {
    console.log(`[agent/understand] Using local intent: ${ctx.intent.type}/${ctx.intent.domain} — skipped Gemini`);
    if (ctx.intent.type === 'chat') return { next: 'recommend', ctx };
    return { next: 'fetch_context', ctx };
  }
  const systemPrompt = `You are an intent classifier for a CRM assistant. Analyze the user's message precisely.

Respond ONLY with valid JSON:
{
  "type": "query" | "action" | "scenario_request" | "followup" | "chat" | "composite",
  "domain": "team_assignment" | "pricing" | "followup" | "scheduling" | "invoicing" | "convert_lead" | "update_job_status" | "update_lead_status" | "send_invoice" | "record_payment" | "general" | "reporting" | "client_info",
  "entities": { "client_name": "...", "job_id": "...", "quote_id": "...", "lead_id": "...", "invoice_id": "...", "team_id": "...", "amount": "...", "date": "...", "status": "..." },
  "confidence": 0.0 to 1.0,
  "sub_intents": [{"type": "...", "domain": "..."}]
}

Rules:
- "composite" = user wants MULTIPLE actions in one message (e.g. "create job AND send invoice")
  - Fill sub_intents with each individual action
  - Pick the primary domain for the main intent
- "action" = user wants to DO something
- "scenario_request" = user wants advice/comparison between options
- "query" = user wants information or data
- "reporting" = user asks about analytics, stats, trends, performance
- "client_info" = user asks about a specific client's history
- "followup" = continuing a previous topic
- "chat" = greeting, thanks, general conversation
- Extract ALL entity references: names, IDs, amounts, dates, statuses
- Be precise with domain mapping
- sub_intents is optional — only include if truly composite`;

  // Only send last 3 messages for context (token-efficient)
  const recentHistory = compressHistory(ctx.history, 300);
  const userPrompt = ctx.language === 'fr'
    ? `Message: "${ctx.userMessage}"\nContexte:\n${recentHistory.slice(-3).map(h => `${h.role}: ${h.content.slice(0, 100)}`).join('\n')}`
    : `Message: "${ctx.userMessage}"\nContext:\n${recentHistory.slice(-3).map(h => `${h.role}: ${h.content.slice(0, 100)}`).join('\n')}`;

  try {
    const response = await geminiChat({
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 256,
      orgId: ctx.orgId,
      purpose: 'intent-detection',
    });

    recordTokenUsage(ctx.orgId, response.inputTokens + response.outputTokens);

    const parsed = JSON.parse(response.content) as Partial<AgentIntent & { sub_intents?: any[] }>;

    ctx.intent = {
      type: parsed.type || 'chat',
      domain: parsed.domain || 'general',
      entities: parsed.entities || {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };

    // Store sub-intents for composite handling
    if (parsed.type === 'composite' && parsed.sub_intents?.length) {
      (ctx as any).subIntents = parsed.sub_intents;
    }
  } catch (err: any) {
    ctx.intent = { type: 'chat', domain: 'general', entities: {}, confidence: 0.3 };
    ctx.errors.push(`Intent detection failed: ${err?.message}`);
    console.warn('[agent/understand] Error:', err?.message);
  }

  // Fast-path: chat → straight to recommend (skip context/memory/decide)
  if (ctx.intent.type === 'chat') {
    return { next: 'recommend', ctx };
  }

  return { next: 'fetch_context', ctx };
}
