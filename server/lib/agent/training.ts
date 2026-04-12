/* ═══════════════════════════════════════════════════════════════
   Agent Training — Few-shot examples and RAG for Mr Lume

   Provides:
   - getFewShotExamples(supabase, orgId, domain?, limit?) — load examples from DB
   - formatFewShot(examples, language) — format examples for system prompt
   - findSimilarConversation(supabase, orgId, message) — find similar past response
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────

export interface FewShotExample {
  id: string;
  user_message: string;
  agent_response: string;
  domain?: string;
  quality_score: number;
}

// ── Get few-shot examples from database ──────────────────────

export async function getFewShotExamples(
  supabase: SupabaseClient,
  orgId: string,
  domain?: string,
  limit: number = 3
): Promise<FewShotExample[]> {
  try {
    let query = supabase
      .from('agent_few_shots')
      .select('id, user_message, agent_response, domain, quality_score')
      .eq('org_id', orgId)
      .eq('active', true)
      .order('quality_score', { ascending: false })
      .limit(limit);

    if (domain) {
      // Try domain-specific first, fallback handled by caller
      query = query.eq('domain', domain);
    }

    const { data } = await query;

    // If domain-specific returned nothing, try without domain filter
    if ((!data || data.length === 0) && domain) {
      const { data: fallback } = await supabase
        .from('agent_few_shots')
        .select('id, user_message, agent_response, domain, quality_score')
        .eq('org_id', orgId)
        .eq('active', true)
        .order('quality_score', { ascending: false })
        .limit(limit);

      return (fallback || []) as FewShotExample[];
    }

    return (data || []) as FewShotExample[];
  } catch {
    return [];
  }
}

// ── Format few-shot examples for the system prompt ───────────

export function formatFewShot(
  examples: FewShotExample[],
  language: 'en' | 'fr'
): string {
  if (!examples || examples.length === 0) return '';

  const fr = language === 'fr';
  const header = fr
    ? '## EXEMPLES DE BONNES REPONSES'
    : '## GOOD RESPONSE EXAMPLES';

  const formatted = examples.map((ex, i) => {
    const userLabel = fr ? 'Utilisateur' : 'User';
    const assistantLabel = fr ? 'Assistant' : 'Assistant';
    return `${i + 1}.\n${userLabel}: "${ex.user_message}"\n${assistantLabel}: "${ex.agent_response}"`;
  }).join('\n\n');

  return `\n${header}\n${formatted}\n`;
}

// ── Find similar past conversation (simple RAG) ──────────────

export async function findSimilarConversation(
  supabase: SupabaseClient,
  orgId: string,
  message: string
): Promise<string | null> {
  try {
    // Simple keyword-based similarity search
    // Extract meaningful words (3+ chars) from the message
    const keywords = message
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .slice(0, 5);

    if (keywords.length === 0) return null;

    // Search in past agent messages using text search
    const searchTerm = keywords.join(' & ');

    const { data } = await supabase
      .from('agent_messages')
      .select('response')
      .eq('org_id', orgId)
      .eq('feedback', 'positive')
      .textSearch('user_message', searchTerm, { type: 'websearch' })
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0 && data[0].response) {
      return data[0].response;
    }

    return null;
  } catch {
    return null;
  }
}
