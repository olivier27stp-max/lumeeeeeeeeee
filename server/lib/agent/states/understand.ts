/* State: understand — Detect user intent via Gemini */

import type { AgentContext, AgentState, AgentIntent } from '../types';
import { geminiChat } from '../../gemini';

export async function understand(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const systemPrompt = `You are an intent classifier for a CRM assistant called Mr Lume.
Analyze the user's message and classify it.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "type": "query" | "action" | "scenario_request" | "followup" | "chat",
  "domain": "team_assignment" | "pricing" | "followup" | "scheduling" | "invoicing" | "convert_lead" | "update_job_status" | "update_lead_status" | "send_invoice" | "record_payment" | "general",
  "entities": { "client_name": "...", "job_id": "...", "quote_id": "...", "lead_id": "...", "invoice_id": "...", "team_id": "...", etc. },
  "confidence": 0.0 to 1.0
}

Rules:
- "action" = user wants to DO something (assign team, update status, send invoice, record payment, convert lead, schedule job)
- "scenario_request" = user wants advice/comparison (who should do this job, what price, which team)
- "query" = user wants information (show me, list, how many, status of, how is the business)
- "followup" = continuing a previous conversation topic
- "chat" = general conversation, greeting, thanks
- Extract entity names/IDs from the message when mentioned
- Domain mapping: "assign" = team_assignment, "price/quote" = pricing, "convert" = convert_lead, "send invoice" = send_invoice, "payment/paid" = record_payment, "schedule/plan" = scheduling, "mark as/change status" = update_job_status or update_lead_status
- Domain helps route to the right tools`;

  const userPrompt = ctx.language === 'fr'
    ? `Message de l'utilisateur: "${ctx.userMessage}"\n\nContexte conversation récente:\n${ctx.history.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n')}`
    : `User message: "${ctx.userMessage}"\n\nRecent conversation context:\n${ctx.history.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n')}`;

  try {
    const response = await geminiChat({
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 256,
    });

    const parsed = JSON.parse(response.content) as Partial<AgentIntent>;

    ctx.intent = {
      type: parsed.type || 'chat',
      domain: parsed.domain || 'general',
      entities: parsed.entities || {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch (err: any) {
    ctx.intent = { type: 'chat', domain: 'general', entities: {}, confidence: 0.3 };
    ctx.errors.push(`Intent detection failed: ${err?.message}`);
    console.warn('[agent/understand] Error:', err?.message);
  }

  if (ctx.intent.type === 'chat') {
    return { next: 'recommend', ctx };
  }

  return { next: 'fetch_context', ctx };
}
