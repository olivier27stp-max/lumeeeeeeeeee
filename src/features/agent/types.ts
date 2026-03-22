/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Frontend Types
   ═══════════════════════════════════════════════════════════════ */

// ── Agent Session ──────────────────────────────────────────
export interface AgentSession {
  id: string;
  org_id: string;
  created_by: string;
  title: string | null;
  status: 'active' | 'completed' | 'cancelled';
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

// ── Agent Message ──────────────────────────────────────────
export type AgentMessageType = 'text' | 'scenario' | 'approval_request' | 'approval_response' | 'tool_result';

export interface AgentMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  message_type: AgentMessageType;
  structured_data?: ScenarioResult | ApprovalRequest | null;
  model?: string;
  created_at: string;
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

export interface ScenarioResult {
  runId: string;
  triggerType: string;
  options: ScenarioOption[];
  modelUsed: string;
  durationMs: number;
}

// ── Approval ───────────────────────────────────────────────
export interface ApprovalRequest {
  approvalId: string;
  actionType: string;
  actionParams: Record<string, unknown>;
  description: string;
  expiresAt: string;
}

// ── SSE Events from /api/agent/chat ────────────────────────
export type AgentSSEEvent =
  | { type: 'state_change'; state: string; label: string }
  | { type: 'token'; content: string }
  | { type: 'scenario'; data: ScenarioResult }
  | { type: 'approval'; data: ApprovalRequest }
  | { type: 'done'; sessionId: string; messageId: string }
  | { type: 'error'; error: string };

// ── Agent State (mirrors server state machine) ─────────────
export type AgentStateLabel =
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

// ── UI Message (for rendering in the chat) ─────────────────
export interface UIAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  messageType: AgentMessageType;
  structuredData?: ScenarioResult | ApprovalRequest | null;
  isStreaming?: boolean;
  currentState?: AgentStateLabel;
}
