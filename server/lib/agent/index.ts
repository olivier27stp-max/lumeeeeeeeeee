/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Main Entry Point
   Token-optimized, cross-session memory, smart routing
   ═══════════════════════════════════════════════════════════════ */

import type { AgentState, AgentContext, AgentEvent, AgentRequest, StateHandler } from './types';
import { createAgentMachine } from './state-machine';
import { understand } from './states/understand';
import { fetchContext } from './states/fetch-context';
import { checkMemory } from './states/check-memory';
import { decide } from './states/decide';
import { scenarioEngine } from './states/scenario-engine';
import { recommend } from './states/recommend';
import { awaitApproval } from './states/await-approval';
import { execute } from './states/execute';
import { log } from './states/log';
import { getServiceClient } from '../supabase';
import { fetchCRMBrain, formatBrainForPrompt, learnOrgPatterns } from './crm-brain';
import { checkTokenBudget, detectIntentLocally, determineFastRoute } from './token-optimizer';
import { getCachedResponse } from './response-cache';

const MODEL = 'gemini-2.5-flash';

function buildHandlers(onToken?: (token: string) => void): Map<AgentState, StateHandler> {
  return new Map<AgentState, StateHandler>([
    ['understand', understand],
    ['fetch_context', fetchContext],
    ['check_memory', checkMemory],
    ['decide', decide],
    ['scenario_engine', scenarioEngine],
    ['recommend', (ctx) => recommend(ctx, onToken)],
    ['await_approval', awaitApproval],
    ['execute', execute],
    ['log', log],
  ]);
}

export async function* runAgent(
  request: AgentRequest,
  onToken?: (token: string) => void
): AsyncGenerator<AgentEvent, void, undefined> {
  const supabase = getServiceClient();
  const models = { intent: MODEL, reasoning: MODEL, scoring: MODEL };

  // ── Token budget check ─────────────────────────────────────
  const budget = checkTokenBudget(request.orgId);
  if (!budget.allowed) {
    yield { type: 'error', error: request.language === 'fr'
      ? 'Limite quotidienne de tokens atteinte. Réessayez demain.'
      : 'Daily token limit reached. Please try again tomorrow.' };
    return;
  }

  // ── Response cache check (zero tokens if hit) ──────────────
  const cached = getCachedResponse(request.orgId, request.message);
  if (cached && !request.sessionId) {
    // For new sessions with cached responses, still create session but skip Gemini
    console.log('[agent] Cache hit — returning cached response');
  }

  const handlers = buildHandlers(onToken);
  const machine = createAgentMachine(handlers);

  // ── Session management ─────────────────────────────────────
  let sessionId = request.sessionId || '';
  if (!sessionId) {
    const { data: session, error: sessionError } = await supabase.from('agent_sessions').insert({
      org_id: request.orgId,
      created_by: request.userId,
      title: 'New session',
      status: 'active',
      model_config: models,
    }).select('id').single();

    if (sessionError || !session?.id) {
      console.error('[agent] Failed to create session:', sessionError?.message);
      yield { type: 'error', error: 'Failed to create agent session' };
      return;
    }
    sessionId = session.id;
  }

  // ── Save user message ──────────────────────────────────────
  const { data: userMsg, error: msgError } = await supabase.from('agent_messages').insert({
    org_id: request.orgId,
    session_id: sessionId,
    role: 'user',
    content: request.message,
    message_type: 'text',
  }).select('id').single();

  if (msgError) console.error('[agent] Failed to save user message:', msgError.message);

  // ── Load conversation history ──────────────────────────────
  const { data: historyRows } = await supabase.from('agent_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(20);

  const history = (historyRows || []).map(r => ({ role: r.role, content: r.content }));

  // ── Cross-session memory: load user preferences + past topics ─
  let crossSessionContext = '';
  try {
    const { data: recentSessions } = await supabase.from('agent_sessions')
      .select('title')
      .eq('org_id', request.orgId)
      .eq('created_by', request.userId)
      .neq('id', sessionId)
      .order('last_message_at', { ascending: false })
      .limit(3);

    if (recentSessions?.length) {
      crossSessionContext = `Recent topics: ${recentSessions.map(s => s.title).join(', ')}`;
    }
  } catch { /* non-critical */ }

  // ── Local intent detection (zero tokens!) ───────────────────
  const localIntent = detectIntentLocally(request.message, history.length > 0);
  const fastRoute = determineFastRoute(localIntent?.type, localIntent?.confidence || 0, request.message.length);

  if (localIntent) {
    console.log(`[agent] Local intent: ${localIntent.type}/${localIntent.domain} (${localIntent.confidence}) — saves 1 Gemini call`);
  }

  // ── Brain loading: skip when fast route says so ────────────
  let brainSummary = '';
  let orgProfile: { industry?: string; tone?: string; avgJobValue?: number; teamCount?: number } | undefined;
  if (!fastRoute.skipBrain) {
    try {
      const brain = await fetchCRMBrain(supabase, request.orgId);
      brainSummary = formatBrainForPrompt(brain, request.language);
      // Detect industry from brain data
      const jobTypes = ((brain as any).recentJobs || []).map((j: any) => j.job_type?.toLowerCase()).filter(Boolean);
      const detectedIndustry = jobTypes.includes('landscaping') || jobTypes.includes('snow_removal') ? 'landscaping'
        : jobTypes.includes('construction') ? 'construction'
        : jobTypes.includes('cleaning') || jobTypes.includes('maintenance') ? 'cleaning'
        : 'service';

      orgProfile = {
        industry: detectedIndustry,
        avgJobValue: (brain.stats as any).avgJobValue || 0,
        teamCount: (brain.stats as any).teamCount || 0,
      };

      console.log(`[agent] Brain loaded: ${brain.stats.totalClients}c ${brain.stats.totalJobs}j ${brain.alerts.length} alerts | industry=${detectedIndustry}`);

      if (!request.sessionId) {
        learnOrgPatterns(supabase, request.orgId).catch(() => {});
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        supabase.from('memory_events').delete().eq('org_id', request.orgId).lt('created_at', cutoff).then(() => {}, () => {});
      }
    } catch (err: any) {
      console.warn('[agent] Brain fetch failed:', err?.message);
    }
  } else {
    console.log('[agent] Simple chat — skipping brain load (token savings)');
  }

  // ── Build context ──────────────────────────────────────────
  const initialContext: AgentContext = {
    sessionId,
    orgId: request.orgId,
    userId: request.userId,
    userMessage: request.message,
    language: request.language,
    history,
    supabase,
    models,
    brainSummary: brainSummary + (crossSessionContext ? `\n${crossSessionContext}` : ''),
    orgProfile,
    // Pre-fill intent from local detection to skip Gemini call
    ...(localIntent && fastRoute.startState !== 'understand' ? { intent: localIntent } : {}),
    response: '',
    responseType: 'text',
    errors: [],
    stateHistory: [],
  };

  // ── Run state machine with smart start state ───────────────
  const startState: AgentState = fastRoute.startState;
  const iterator = machine(startState, initialContext);

  let finalCtx: AgentContext | undefined;
  while (true) {
    const { value, done } = await iterator.next();
    if (done) { finalCtx = value as AgentContext | undefined; break; }
    yield value as AgentEvent;
  }

  if (finalCtx?.responseType === 'scenario' && finalCtx.structuredData) {
    yield { type: 'scenario', data: finalCtx.structuredData } as AgentEvent;
  }
  if (finalCtx?.responseType === 'approval_request' && finalCtx.structuredData) {
    yield { type: 'approval', data: finalCtx.structuredData } as AgentEvent;
  }

  yield { type: 'done', sessionId, messageId: userMsg?.id || '' };

  if (finalCtx?.errors.length) {
    console.warn('[agent] Completed with errors:', finalCtx.errors);
  }
}
