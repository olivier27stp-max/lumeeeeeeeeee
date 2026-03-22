/* State: log — Save results to DB + update memory */

import type { AgentContext, AgentState } from '../types';

export async function log(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  try {
    const admin = ctx.supabase;

    // Save assistant message
    const { error: msgError } = await admin.from('agent_messages').insert({
      org_id: ctx.orgId,
      session_id: ctx.sessionId,
      role: 'assistant',
      content: ctx.response,
      message_type: ctx.responseType,
      structured_data: ctx.structuredData || null,
      model: ctx.models.reasoning,
    });

    if (msgError) {
      console.error('[agent/log] Failed to save assistant message:', msgError.message);
    }

    // Update session title on first meaningful exchange (message_count is auto-incremented by trigger)
    const { data: session } = await admin.from('agent_sessions')
      .select('title, message_count')
      .eq('id', ctx.sessionId)
      .single();

    if (session && (!session.title || session.title === 'New session') && session.message_count <= 4) {
      const title = ctx.userMessage.slice(0, 80) + (ctx.userMessage.length > 80 ? '...' : '');
      await admin.from('agent_sessions')
        .update({ title })
        .eq('id', ctx.sessionId);
    }

    // Always log the interaction type for learning
    await admin.from('memory_events').insert({
      org_id: ctx.orgId,
      event_type: 'interaction',
      entity_type: ctx.intent?.domain || 'general',
      summary: `User asked: "${ctx.userMessage.slice(0, 100)}" → ${ctx.responseType === 'scenario' ? 'scenario analysis' : 'direct response'}`,
      importance: 3,
    }).then(() => {}).catch(() => {});

    // Save memory event only if we executed a real action successfully
    if (ctx.intent?.type === 'action' && ctx.executionResult?.success) {
      const entityEntries = Object.entries(ctx.intent.entities);
      // Map key names like "client_id" → "client", "job_id" → "job"
      const rawKey = entityEntries[0]?.[0] || '';
      const entityType = rawKey.replace(/_id$/, '').replace(/_name$/, '') || null;
      const entityVal = entityEntries[0]?.[1] || '';

      const { error: memError } = await admin.from('memory_events').insert({
        org_id: ctx.orgId,
        event_type: ctx.intent.domain || 'action',
        entity_type: entityType,
        entity_id: typeof entityVal === 'string' && isUUID(entityVal) ? entityVal : null,
        summary: `Action "${ctx.recommendation?.actionType || ctx.intent.domain}": ${ctx.executionResult.summary}`,
        importance: 6,
      });

      if (memError) {
        console.warn('[agent/log] Memory event save failed:', memError.message);
      }
    }

    // Decision log for scenarios — ONLY if await-approval didn't already create one
    // (await-approval creates its own decision_log, so skip here if approval exists)
    if (ctx.scenarios?.length && !ctx.approval) {
      const { error: dlError } = await admin.from('decision_logs').insert({
        org_id: ctx.orgId,
        session_id: ctx.sessionId,
        decision_type: ctx.decision?.type || 'general',
        input_summary: ctx.userMessage,
        chosen_option: ctx.scenarios.find(s => s.isWinner)?.label || null,
        confidence: ctx.scenarios[0]?.confidence || 0.5,
        reasoning: ctx.decision?.reasoning || '',
      });
      if (dlError) console.warn('[agent/log] Decision log save failed:', dlError.message);
    }

  } catch (err: any) {
    ctx.errors.push(`Log save failed: ${err?.message}`);
    console.error('[agent/log] Unhandled error:', err?.message);
  }

  return { next: 'done', ctx };
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
