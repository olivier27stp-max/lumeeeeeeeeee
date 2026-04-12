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

    // ── Extract business knowledge from user messages ────────
    // If the user shares facts about their business, save to org_knowledge
    try {
      await extractAndSaveKnowledge(admin, ctx.orgId, ctx.userMessage, ctx.language);
    } catch { /* optional — don't break the flow */ }

    // Always log the interaction type for learning
    await admin.from('memory_events').insert({
      org_id: ctx.orgId,
      event_type: 'interaction',
      entity_type: ctx.intent?.domain || 'general',
      summary: `User asked: "${ctx.userMessage.slice(0, 100)}" → ${ctx.responseType === 'scenario' ? 'scenario analysis' : 'direct response'}`,
      importance: 3,
    }).then(() => {}, () => {});

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

// ─── Knowledge Extraction ─────────────────────────────────────
// Detects business facts in user messages and saves them

import type { SupabaseClient } from '@supabase/supabase-js';

const KNOWLEDGE_PATTERNS: Array<{
  regex: RegExp;
  category: string;
  key: string;
  extract: (m: RegExpMatchArray) => string;
}> = [
  // Pricing
  { regex: /(?:taux|rate|tarif)\s*(?:horaire|\/h|par heure)?\s*(?:est|is|de|:)?\s*\$?\s*(\d+)/i, category: 'pricing', key: 'hourly_rate', extract: (m) => `$${m[1]}/h` },
  { regex: /(?:minimum|min)\s*(?:de facturation|charge)?\s*(?:est|is|de|:)?\s*\$?\s*(\d+)/i, category: 'pricing', key: 'minimum_charge', extract: (m) => `$${m[1]}` },
  { regex: /(?:dépôt|deposit)\s*(?:de|of|:)?\s*(\d+)\s*%/i, category: 'pricing', key: 'deposit_required', extract: (m) => `${m[1]}%` },

  // Business info
  { regex: /(?:on fait|we do|notre business|our business|on est dans)\s+(?:du|de la|le|l')?\s*(.{3,50})/i, category: 'business_info', key: 'business_type', extract: (m) => m[1].trim() },
  { regex: /(?:on est basé|we're based|on est à|located in|région|region)\s*(?:à|in|au|:)?\s*(.{3,40})/i, category: 'business_info', key: 'region', extract: (m) => m[1].trim() },

  // Seasonality
  { regex: /(?:saison|season|busy|peak)\s*(?:est|is|:)?\s*(?:de|from)?\s*([\w-]+)\s*(?:à|to|-)\s*([\w-]+)/i, category: 'seasonality', key: 'peak_season', extract: (m) => `${m[1]} to ${m[2]}` },

  // Payment
  { regex: /(?:net|paiement|payment)\s*(\d+)\s*(?:jours|days|j)/i, category: 'payment_terms', key: 'net_days', extract: (m) => `Net ${m[1]}` },

  // Service zones
  { regex: /(?:on dessert|we serve|zone de service|service area)\s*(?::)?\s*(.{3,60})/i, category: 'zones', key: 'service_area', extract: (m) => m[1].trim() },
];

async function extractAndSaveKnowledge(supabase: SupabaseClient, orgId: string, message: string, language: string): Promise<void> {
  if (message.length < 15) return; // Too short to contain facts

  const toSave: Array<{ category: string; key: string; value: string }> = [];

  for (const pattern of KNOWLEDGE_PATTERNS) {
    const match = message.match(pattern.regex);
    if (match) {
      toSave.push({
        category: pattern.category,
        key: pattern.key,
        value: pattern.extract(match),
      });
    }
  }

  if (toSave.length === 0) return;

  // Upsert each knowledge entry
  for (const entry of toSave) {
    await supabase.from('org_knowledge')
      .upsert({
        org_id: orgId,
        category: entry.category,
        key: entry.key,
        value: entry.value,
        importance: 7, // Chat-learned facts are high importance
      }, { onConflict: 'org_id,category,key' });
  }

  console.log(`[knowledge] Extracted ${toSave.length} fact(s) from chat: ${toSave.map(e => e.key).join(', ')}`);
}
