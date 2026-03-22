/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Server-Side Types
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Agent State Machine ────────────────────────────────────
export type AgentState =
  | 'understand'
  | 'fetch_context'
  | 'check_memory'
  | 'decide'
  | 'scenario_engine'
  | 'recommend'
  | 'await_approval'
  | 'execute'
  | 'log'
  | 'done'
  | 'error';

// ── Agent Intent ───────────────────────────────────────────
export interface AgentIntent {
  type: 'query' | 'action' | 'scenario_request' | 'followup' | 'chat';
  domain?: string; // 'team_assignment' | 'pricing' | 'followup' | 'general'
  entities: Record<string, string>;
  confidence: number;
}

// ── Scenario ───────────────────────────────────────────────
export interface ScenarioOption {
  label: string;
  score: number;
  benefits: string[];
  risks: string[];
  outcome: string;
  confidence: number;
  isWinner?: boolean;
}

// ── Agent Context (passed through all states) ──────────────
export interface AgentContext {
  // Session info
  sessionId: string;
  orgId: string;
  userId: string;
  userMessage: string;
  language: 'en' | 'fr';
  history: { role: string; content: string }[];

  // Supabase client (service role for admin ops)
  supabase: SupabaseClient;

  // Model config
  models: {
    intent: string;    // e.g. 'llama3.2:3b' or 'llama3.2'
    reasoning: string; // e.g. 'qwen2.5:7b'
    scoring: string;   // e.g. 'deepseek-r1:8b'
  };

  // Full CRM brain (loaded once at start)
  brainSummary: string;

  // State data (built up as states execute)
  intent?: AgentIntent;
  crmData?: Record<string, unknown>;
  memory?: { entities: any[]; events: any[]; feedback?: any[]; pastDecisions?: any[] };
  decision?: {
    type: string;
    requiresScenario: boolean;
    reasoning: string;
  };
  scenarios?: ScenarioOption[];
  scenarioRunId?: string;
  recommendation?: {
    text: string;
    confidence: number;
    actionType?: string;
    actionParams?: Record<string, unknown>;
  };
  approval?: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
  };
  executionResult?: { success: boolean; summary: string };

  // Output
  response: string;
  responseType: 'text' | 'scenario' | 'approval_request';
  structuredData?: unknown;

  // Tracking
  errors: string[];
  stateHistory: AgentState[];
}

// ── State Handler ──────────────────────────────────────────
export type StateHandler = (
  ctx: AgentContext
) => Promise<{ next: AgentState; ctx: AgentContext }>;

// ── Agent Event (emitted via SSE) ──────────────────────────
export type AgentEvent =
  | { type: 'state_change'; state: AgentState; label: string }
  | { type: 'token'; content: string }
  | { type: 'scenario'; data: { runId: string; options: ScenarioOption[]; modelUsed: string; durationMs: number; triggerType: string } }
  | { type: 'approval'; data: { approvalId: string; actionType: string; actionParams: Record<string, unknown>; description: string; expiresAt: string } }
  | { type: 'done'; sessionId: string; messageId: string }
  | { type: 'error'; error: string };

// ── State Labels (for UI timeline) ─────────────────────────
export const STATE_LABELS: Record<AgentState, { en: string; fr: string }> = {
  understand: { en: 'Understanding request', fr: 'Analyse de la demande' },
  fetch_context: { en: 'Reading CRM data', fr: 'Lecture des données CRM' },
  check_memory: { en: 'Checking memory', fr: 'Consultation de la mémoire' },
  decide: { en: 'Making decision', fr: 'Prise de décision' },
  scenario_engine: { en: 'Building scenarios', fr: 'Création des scénarios' },
  recommend: { en: 'Preparing recommendation', fr: 'Préparation de la recommandation' },
  await_approval: { en: 'Waiting for approval', fr: 'En attente de validation' },
  execute: { en: 'Executing action', fr: 'Exécution de l\'action' },
  log: { en: 'Saving results', fr: 'Sauvegarde des résultats' },
  done: { en: 'Complete', fr: 'Terminé' },
  error: { en: 'Error', fr: 'Erreur' },
};

// ── Agent Request (from API) ───────────────────────────────
export interface AgentRequest {
  message: string;
  sessionId?: string;
  language: 'en' | 'fr';
  orgId: string;
  userId: string;
}
