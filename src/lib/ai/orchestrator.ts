/* ═══════════════════════════════════════════════════════════════
   AI Orchestrator
   Main entry point for the AI system. Routes between CRM and Web
   modes, injects context, manages tool calls, and streams responses.
   ═══════════════════════════════════════════════════════════════ */

import type {
  OrchestratorRequest,
  OrchestratorResponse,
  StreamCallbacks,
  ToolCallRecord,
  ToolContext,
  AIChatMode,
} from './types';
import { buildSystemPrompt } from './system-prompt';
import { buildMessageArray } from './memory';
import { fetchDashboardContext } from './context-builder';
import { runTool } from './tool-runner';
import { toolRegistry } from './tool-registry';
import { registerAllTools } from './tools';
import {
  createConversation,
  addMessage,
  streamMessageToAI,
} from '../aiApi';

// ── Tool registration (idempotent) ───────────────────────────
let toolsRegistered = false;

function ensureToolsRegistered(): void {
  if (!toolsRegistered) {
    registerAllTools();
    toolsRegistered = true;
  }
}

/**
 * Main orchestrator: handles a user message through the full pipeline.
 *
 * Flow:
 * 1. Ensure tools are registered
 * 2. Fetch dashboard context (for CRM mode)
 * 3. Build system prompt with context + available tools
 * 4. Detect if user intent matches a tool call
 * 5. If tool needed → run tool → inject result into conversation
 * 6. Stream response from Ollama
 * 7. Return full response with tool call records
 */
export async function orchestrate(
  request: OrchestratorRequest,
  callbacks: StreamCallbacks,
  dbReady: boolean = true
): Promise<OrchestratorResponse> {
  ensureToolsRegistered();

  const { message, mode, crmContext, history, conversationId } = request;
  const toolCalls: ToolCallRecord[] = [];
  const sources: string[] = [];

  // 1. Fetch dashboard context for CRM mode
  const dashData = mode === 'crm' ? await fetchDashboardContext() : null;
  if (dashData) sources.push('dashboard');

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt(mode, crmContext, dashData);

  // 3. Detect tool intent and run tools (CRM mode only)
  let toolResultContext = '';
  if (mode === 'crm') {
    const detectedTools = detectToolIntent(message, crmContext.permissions);

    for (const detection of detectedTools) {
      callbacks.onToolCall?.(detection.toolId, 'start');

      const toolCtx: ToolContext = {
        orgId: crmContext.orgId,
        userId: crmContext.userId,
        permissions: crmContext.permissions,
        language: crmContext.language,
        conversationId,
      };

      const { result, record } = await runTool(detection.toolId, detection.params, toolCtx);
      toolCalls.push(record);
      sources.push(detection.toolId);

      callbacks.onToolCall?.(detection.toolId, 'done', result);

      if (result.success && result.data) {
        toolResultContext += `\n\n[Tool: ${detection.toolId}]\n${result.summary || ''}\nData: ${JSON.stringify(result.data, null, 2)}`;
      } else if (result.error) {
        toolResultContext += `\n\n[Tool: ${detection.toolId}] Error: ${result.error}`;
      }
    }
  }

  // 4. Build the final message with tool context injected
  const enrichedMessage = toolResultContext
    ? `${message}\n\n---\nTool Results (use this data to answer):\n${toolResultContext}`
    : message;

  // 5. Build message array with memory management
  const messageArray = buildMessageArray(systemPrompt, history, enrichedMessage);
  // Remove system message for Ollama (we pass it separately via the first message)
  const ollamaHistory = messageArray.slice(0, -1); // everything except the last user message

  // 6. Create conversation if needed
  let activeConvId = conversationId;
  if (!activeConvId && dbReady) {
    try {
      const conv = await createConversation({
        title: message.slice(0, 100),
        model: 'llama3.2',
        provider: 'ollama',
        metadata: { mode },
      });
      activeConvId = conv.id;
    } catch {
      // DB not ready, continue anyway
    }
  }

  // 7. Stream from Ollama
  const { fullContent } = await streamMessageToAI({
    conversationId: activeConvId,
    content: enrichedMessage,
    model: 'llama3.2',
    history: ollamaHistory,
    dbReady,
    onToken: callbacks.onToken,
  });

  return {
    content: fullContent,
    toolCalls,
    sources,
    mode,
  };
}

// ── Tool Intent Detection ─────────────────────────────────────
// Simple keyword-based detection. Will be replaced by LLM-driven
// tool selection in Phase 2 when we add function calling support.

interface ToolDetection {
  toolId: string;
  params: Record<string, unknown>;
}

function detectToolIntent(
  message: string,
  permissions: import('../permissions').PermissionsMap
): ToolDetection[] {
  const lower = message.toLowerCase();
  const detections: ToolDetection[] = [];

  // Dashboard / overview patterns
  if (matchesAny(lower, [
    'dashboard', 'overview', 'résumé', 'summary', 'today', "aujourd'hui",
    'performance', 'revenue', 'revenus', 'kpi', 'prépare-moi', 'prepare me',
    'brief', 'briefing', 'morning',
  ])) {
    if (toolRegistry.canUse('dashboard.overview', permissions)) {
      detections.push({ toolId: 'dashboard.overview', params: {} });
    }
  }

  // Client patterns
  if (matchesAny(lower, ['client', 'clients', 'customer', 'customers'])) {
    if (toolRegistry.canUse('clients.search', permissions)) {
      const query = extractEntityQuery(lower, ['client', 'clients', 'customer', 'customers']);
      detections.push({ toolId: 'clients.search', params: { query, pageSize: 10 } });
    }
  }

  // Job patterns
  if (matchesAny(lower, ['job', 'jobs', 'travaux', 'travail', 'chantier'])) {
    if (toolRegistry.canUse('jobs.search', permissions)) {
      const query = extractEntityQuery(lower, ['job', 'jobs', 'travaux', 'travail', 'chantier']);
      // Check for status filters
      const statusMatch = extractJobStatus(lower);
      detections.push({ toolId: 'jobs.search', params: { query, status: statusMatch, pageSize: 10 } });
    }
  }

  // Invoice patterns
  if (matchesAny(lower, ['invoice', 'invoices', 'facture', 'factures', 'billing', 'facturation'])) {
    if (toolRegistry.canUse('invoices.search', permissions)) {
      detections.push({ toolId: 'invoices.search', params: { pageSize: 10 } });
    }
    if (matchesAny(lower, ['kpi', 'stats', 'summary', 'résumé', 'overview', 'overdue', 'en retard'])) {
      if (toolRegistry.canUse('invoices.kpis', permissions)) {
        detections.push({ toolId: 'invoices.kpis', params: {} });
      }
    }
  }

  // Schedule patterns
  if (matchesAny(lower, ['schedule', 'calendar', 'rendez-vous', 'appointment', 'horaire', 'calendrier', 'agenda'])) {
    if (toolRegistry.canUse('schedule.list', permissions)) {
      detections.push({ toolId: 'schedule.list', params: {} });
    }
  }

  // Unscheduled jobs
  if (matchesAny(lower, ['unscheduled', 'non planifié', 'pas planifié', 'à planifier'])) {
    if (toolRegistry.canUse('schedule.unscheduled', permissions)) {
      detections.push({ toolId: 'schedule.unscheduled', params: {} });
    }
  }

  // Lead patterns
  if (matchesAny(lower, ['lead', 'leads', 'prospect', 'prospects', 'pipeline'])) {
    if (toolRegistry.canUse('leads.search', permissions)) {
      const statusMatch = extractLeadStatus(lower);
      detections.push({ toolId: 'leads.search', params: { status: statusMatch } });
    }
  }

  return detections;
}

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function extractEntityQuery(text: string, entityKeywords: string[]): string {
  // Try to extract a search term after common patterns like "find client X", "search for X"
  const patterns = [
    /(?:find|search|cherche|trouve|show|montre)\s+(?:me\s+)?(?:the\s+)?(?:client|clients|customer|job|jobs|lead|leads)\s+(.+)/i,
    /(?:client|customer|job|lead)\s+(?:named?|called?|nommé)\s+(.+)/i,
  ];
  for (const pat of patterns) {
    const match = text.match(pat);
    if (match) return match[1].trim();
  }
  // Remove entity keywords and common words to get a potential query
  let cleaned = text;
  for (const kw of [...entityKeywords, 'find', 'search', 'show', 'list', 'get', 'cherche', 'trouve', 'montre', 'my', 'mes', 'all', 'tous']) {
    cleaned = cleaned.replace(new RegExp(`\\b${kw}\\b`, 'gi'), '');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.length > 2 ? cleaned : '';
}

function extractJobStatus(text: string): string | undefined {
  const statusMap: Record<string, string> = {
    'late': 'Late',
    'en retard': 'Late',
    'overdue': 'Late',
    'unscheduled': 'Unscheduled',
    'non planifié': 'Unscheduled',
    'requires invoicing': 'Requires Invoicing',
    'à facturer': 'Requires Invoicing',
    'action required': 'Action Required',
    'action requise': 'Action Required',
    'scheduled': 'Scheduled',
    'planifié': 'Scheduled',
    'completed': 'Completed',
    'complété': 'Completed',
    'terminé': 'Completed',
  };
  for (const [keyword, status] of Object.entries(statusMap)) {
    if (text.includes(keyword)) return status;
  }
  return undefined;
}

function extractLeadStatus(text: string): string | undefined {
  const statusMap: Record<string, string> = {
    'new': 'New Prospect',
    'nouveau': 'New Prospect',
    'prospect': 'New Prospect',
    'no response': 'No Response',
    'sans réponse': 'No Response',
    'follow-up': 'No Response',
    'suivi': 'No Response',
    'quote sent': 'Quote Sent',
    'soumission': 'Quote Sent',
    'devis': 'Quote Sent',
    'closed won': 'Closed Won',
    'closed': 'Closed Won',
    'fermé': 'Closed Won',
    'gagné': 'Closed Won',
    'closed lost': 'Closed Lost',
    'lost': 'Closed Lost',
    'perdu': 'Closed Lost',
  };
  for (const [keyword, status] of Object.entries(statusMap)) {
    if (text.includes(keyword)) return status;
  }
  return undefined;
}
