/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Main Entry Point
   Assembles the state machine and exports runAgent()
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

// V1: Gemini as primary provider (free, fast, great structured output)
const MODEL = 'gemini-2.5-flash';

/**
 * Build handler map for a specific request.
 * Each call gets its own handlers with its own token callback — no shared mutable state.
 */
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

/**
 * Run the Mr Lume agent for a given request.
 * Yields AgentEvent objects for SSE streaming.
 * Each invocation is fully isolated — no shared mutable state between requests.
 */
export async function* runAgent(
  request: AgentRequest,
  onToken?: (token: string) => void
): AsyncGenerator<AgentEvent, void, undefined> {
  const supabase = getServiceClient();

  // V1: Gemini for all tasks
  const models = { intent: MODEL, reasoning: MODEL, scoring: MODEL };

  // Per-request handler map with isolated token callback
  const handlers = buildHandlers(onToken);
  const machine = createAgentMachine(handlers);

  // Create or resume session — throw on failure, never use fake IDs
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

  // Save user message and capture its ID
  const { data: userMsg, error: msgError } = await supabase.from('agent_messages').insert({
    org_id: request.orgId,
    session_id: sessionId,
    role: 'user',
    content: request.message,
    message_type: 'text',
  }).select('id').single();

  if (msgError) {
    console.error('[agent] Failed to save user message:', msgError.message);
    // Non-fatal — continue without persisted message
  }

  // Load conversation history
  const { data: historyRows } = await supabase.from('agent_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(20);

  const history = (historyRows || []).map(r => ({ role: r.role, content: r.content }));

  // Fetch the complete CRM brain — everything Mr Lume needs
  let brainSummary = '';
  try {
    const brain = await fetchCRMBrain(supabase, request.orgId);
    brainSummary = formatBrainForPrompt(brain, request.language);
    console.log(`[agent] Brain loaded: ${brain.stats.totalClients} clients, ${brain.stats.totalJobs} jobs, ${brain.alerts.length} alerts`);

    // Learn org patterns in background (non-blocking) — only on new sessions
    if (!request.sessionId) {
      learnOrgPatterns(supabase, request.orgId).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[agent] Brain fetch failed:', err?.message);
  }

  // Determine fast-path: simple greetings skip intent detection but still get brain context
  // Briefing triggers: greetings or "prepare me" / "brief me" type messages
  const trimmedMsg = request.message.trim().toLowerCase();
  const isGreeting = trimmedMsg.length <= 20 && /^(hi|hello|hey|bonjour|salut|allo|merci|thanks|ok|oui|non|yes|no|bye|ciao)\s*[.!?]*$/i.test(trimmedMsg);
  const isBriefingRequest = /\b(prepare|brief|resume|briefing|journee|day|overview|morning)\b/i.test(trimmedMsg);
  const isSimpleChat = isGreeting && !isBriefingRequest;

  // Build initial context
  const initialContext: AgentContext = {
    sessionId,
    orgId: request.orgId,
    userId: request.userId,
    userMessage: request.message,
    language: request.language,
    history,
    supabase,
    models,
    brainSummary,
    response: '',
    responseType: 'text',
    errors: [],
    stateHistory: [],
  };

  // Run state machine — fast-path for simple chat goes straight to recommend
  const startState: AgentState = isSimpleChat ? 'recommend' : 'understand';
  const iterator = machine(startState, initialContext);

  let finalCtx: AgentContext | undefined;

  while (true) {
    const { value, done } = await iterator.next();
    if (done) {
      finalCtx = value as AgentContext | undefined;
      break;
    }
    yield value as AgentEvent;
  }

  // Emit scenario data if present
  if (finalCtx?.responseType === 'scenario' && finalCtx.structuredData) {
    yield { type: 'scenario', data: finalCtx.structuredData } as AgentEvent;
  }

  // Emit approval data if present
  if (finalCtx?.responseType === 'approval_request' && finalCtx.structuredData) {
    yield { type: 'approval', data: finalCtx.structuredData } as AgentEvent;
  }

  // Emit done with real message ID
  yield {
    type: 'done',
    sessionId,
    messageId: userMsg?.id || '',
  };

  // Log errors if any
  if (finalCtx?.errors.length) {
    console.warn('[agent] Completed with errors:', finalCtx.errors);
  }
}
