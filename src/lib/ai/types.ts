/* ═══════════════════════════════════════════════════════════════
   AI Orchestration — Core Types
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionsMap } from '../permissions';

// ── Chat Mode ─────────────────────────────────────────────────
export type AIChatMode = 'crm' | 'web' | 'agent';

// ── Tool Definitions ──────────────────────────────────────────
export type ToolCategory = 'read' | 'write' | 'action';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  /** Unique tool identifier, e.g. "clients.search" */
  id: string;
  /** Human-readable label */
  label: string;
  /** What the tool does — fed into the system prompt */
  description: string;
  /** read = safe query, write = creates/updates data, action = side-effects */
  category: ToolCategory;
  /** CRM permission key(s) the user needs to call this tool */
  requiredPermissions: string[];
  /** Parameter schema for the tool */
  parameters: ToolParameter[];
  /** The function that executes the tool */
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ── Tool Execution Context ────────────────────────────────────
export interface ToolContext {
  orgId: string;
  userId: string;
  permissions: PermissionsMap;
  language: 'fr' | 'en';
  conversationId: string | null;
}

// ── Tool Result ───────────────────────────────────────────────
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Markdown summary for the LLM to include in its response */
  summary?: string;
}

// ── Tool Call (for logging / DB) ──────────────────────────────
export interface ToolCallRecord {
  id?: string;
  org_id: string;
  conversation_id: string | null;
  message_id: string | null;
  tool_id: string;
  tool_category: ToolCategory;
  parameters: Record<string, unknown>;
  result_success: boolean;
  result_data: unknown;
  result_error: string | null;
  duration_ms: number;
  created_by: string;
  created_at?: string;
}

// ── CRM Context (injected into orchestrator) ──────────────────
export interface CRMContext {
  /** Current org ID */
  orgId: string;
  /** Current user ID */
  userId: string;
  /** User display name */
  userName: string;
  /** Organization name */
  orgName: string;
  /** User's role */
  userRole: string;
  /** User permissions map */
  permissions: PermissionsMap;
  /** Language preference */
  language: 'fr' | 'en';
  /** Current page route, e.g. "/clients" or "/jobs/123" */
  currentRoute: string;
  /** Active entity context (if viewing a specific record) */
  activeEntity?: {
    type: 'client' | 'lead' | 'job' | 'invoice' | 'schedule_event';
    id: string;
    label?: string;
  };
}

// ── Orchestrator Request / Response ───────────────────────────
export interface OrchestratorRequest {
  /** User's message */
  message: string;
  /** Chat mode */
  mode: AIChatMode;
  /** CRM context */
  crmContext: CRMContext;
  /** Conversation history (last N messages for context window) */
  history: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }[];
  /** Active conversation ID (null for first message) */
  conversationId: string | null;
}

export interface OrchestratorResponse {
  /** Full assistant text */
  content: string;
  /** Tools that were called during this turn */
  toolCalls: ToolCallRecord[];
  /** Source transparency: what data sources were used */
  sources: string[];
  /** Mode that was used */
  mode: AIChatMode;
}

// ── Streaming callback ────────────────────────────────────────
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall?: (toolId: string, status: 'start' | 'done', result?: ToolResult) => void;
}

// ── System Prompt Sections ────────────────────────────────────
export interface SystemPromptParts {
  base: string;
  modeInstructions: string;
  responseFormatting: string;
  toolDescriptions: string;
  crmContext: string;
  constraints: string;
}
