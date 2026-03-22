/* State: check_memory — Query long-term memory + feedback + past decisions */

import type { AgentContext, AgentState } from '../types';

const DOMAIN_TO_ENTITY_TYPE: Record<string, string> = {
  team_assignment: 'team',
  pricing: 'quote',
  followup: 'client',
  scheduling: 'job',
  invoicing: 'invoice',
};

export async function checkMemory(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const memory: { entities: any[]; events: any[]; feedback: any[]; pastDecisions: any[] } = {
    entities: [], events: [], feedback: [], pastDecisions: [],
  };

  try {
    const admin = ctx.supabase;
    const orgId = ctx.orgId;
    const entities = ctx.intent?.entities || {};

    // 1. Fetch relevant memory entities
    let entityQuery = admin.from('memory_entities')
      .select('entity_type, key, value, confidence, updated_at')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (entities.client_id) {
      entityQuery = entityQuery.eq('entity_id', entities.client_id);
    } else if (entities.job_id) {
      entityQuery = entityQuery.eq('entity_id', entities.job_id);
    } else if (ctx.intent?.domain) {
      const mappedType = DOMAIN_TO_ENTITY_TYPE[ctx.intent.domain];
      if (mappedType) {
        entityQuery = entityQuery.eq('entity_type', mappedType);
      }
    }

    const { data: memEntities } = await entityQuery;
    if (memEntities?.length) memory.entities = memEntities;

    // 2. Fetch recent important events
    const { data: memEvents } = await admin.from('memory_events')
      .select('event_type, entity_type, summary, importance, created_at')
      .eq('org_id', orgId)
      .gte('importance', 5)
      .order('created_at', { ascending: false })
      .limit(10);

    if (memEvents?.length) memory.events = memEvents;

    // 3. Fetch recent NEGATIVE feedback — so Mr Lume learns from mistakes
    const { data: negFeedback } = await admin.from('memory_events')
      .select('summary, created_at')
      .eq('org_id', orgId)
      .eq('event_type', 'feedback')
      .gte('importance', 7)
      .order('created_at', { ascending: false })
      .limit(5);

    if (negFeedback?.length) memory.feedback = negFeedback;

    // 4. Fetch past decisions for similar domain — learn from history
    if (ctx.intent?.domain && ctx.intent.domain !== 'general') {
      const { data: pastDecs } = await admin.from('decision_logs')
        .select('decision_type, input_summary, chosen_option, confidence, reasoning, approved_at, created_at')
        .eq('org_id', orgId)
        .eq('decision_type', ctx.intent.domain)
        .order('created_at', { ascending: false })
        .limit(5);

      if (pastDecs?.length) memory.pastDecisions = pastDecs;
    }

    // 5. Fetch org-level learned patterns (if any)
    const { data: orgPatterns } = await admin.from('memory_entities')
      .select('key, value')
      .eq('org_id', orgId)
      .eq('entity_type', 'org_pattern')
      .limit(5);

    if (orgPatterns?.length) {
      memory.entities.push(...orgPatterns.map(p => ({
        entity_type: 'org_pattern', key: p.key, value: p.value, confidence: 0.7,
      })));
    }

  } catch (err: any) {
    ctx.errors.push(`Memory check failed: ${err?.message}`);
    console.warn('[agent/check-memory] Error:', err?.message);
  }

  ctx.memory = memory;
  return { next: 'decide', ctx };
}
