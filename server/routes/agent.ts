/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Chat route
   ─────────────────────────────────────────────────────────────
   POST /api/agent/chat — stateless turn. The client sends the running
   transcript; the server runs the Gemini tool-use loop scoped to the
   caller's org and returns the reply plus an optional proposedAction
   (which the client executes only after user confirmation).
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { validate, agentChatSchema } from '../lib/validation';
import { isGeminiConfigured } from '../lib/agent/gemini';
import { buildSystemPrompt } from '../lib/agent/systemPrompt';
import { runAgent } from '../lib/agent/orchestrator';
import type { GeminiContent } from '../lib/agent/gemini';

const router = Router();

// POST /api/agent/chat
router.post('/agent/chat', validate(agentChatSchema), async (req, res) => {
  try {
    if (!isGeminiConfigured()) {
      return res.status(503).json({
        error: 'Lume Agent is not configured. Set GEMINI_API_KEY on the server.',
        code: 'agent_not_configured',
      });
    }

    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { client, orgId, user } = authed;

    const { messages, language } = req.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      language?: 'fr' | 'en';
    };

    // Company name for grounding (best-effort).
    let companyName: string | null = null;
    try {
      const { data } = await client
        .from('company_settings')
        .select('company_name')
        .eq('org_id', orgId)
        .maybeSingle();
      companyName = data?.company_name || null;
    } catch { /* non-fatal */ }

    const userName =
      (user.user_metadata as any)?.full_name ||
      (user.user_metadata as any)?.name ||
      user.email ||
      null;

    const systemPrompt = buildSystemPrompt({
      companyName,
      userName,
      language: language === 'en' ? 'en' : 'fr',
      todayIso: new Date().toISOString().slice(0, 10),
    });

    // Convert transcript → Gemini contents (assistant → model).
    const history: GeminiContent[] = messages
      .filter((m) => m.content && m.content.trim())
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be from the user.' });
    }

    const result = await runAgent({
      ctx: { client, orgId, userId: user.id },
      systemPrompt,
      history,
    });

    return res.json(result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Lume Agent failed to respond.', '[agent/chat]');
  }
});

export default router;
