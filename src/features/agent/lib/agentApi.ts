/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Frontend API Client
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from '../../../lib/supabase';
import type { AgentSSEEvent, AgentSession, AgentMessage } from '../types';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

// ── Health Check (public — no auth needed) ─────────────────
export async function agentHealthCheck(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const res = await fetch('/api/ai/health', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, models: [] };
    return res.json();
  } catch {
    return { ok: false, models: [] };
  }
}

// ── Agent Chat (SSE stream) ────────────────────────────────
export async function agentChat(opts: {
  message: string;
  sessionId?: string | null;
  language: 'en' | 'fr';
  onEvent: (event: AgentSSEEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const headers = await getAuthHeaders();

  // Combine user signal with a 3-minute timeout for the whole SSE stream
  // Use AbortController fallback for browsers without AbortSignal.any/timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 180_000);

  let combinedSignal = timeoutController.signal;
  if (opts.signal) {
    // If browser supports AbortSignal.any, use it; otherwise just use user signal
    if (typeof AbortSignal.any === 'function') {
      combinedSignal = AbortSignal.any([opts.signal, timeoutController.signal]);
    } else {
      // Fallback: abort timeout controller when user signal fires
      opts.signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      combinedSignal = timeoutController.signal;
    }
  }

  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: opts.message,
      sessionId: opts.sessionId || undefined,
      language: opts.language,
    }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Agent request failed');
    opts.onEvent({ type: 'error', error: text });
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    opts.onEvent({ type: 'error', error: 'No response body' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const event = JSON.parse(json) as AgentSSEEvent;
        opts.onEvent(event);
      } catch {
        // Skip malformed events
      }
    }
  }

  // Flush final buffer — last event may not end with \n
  if (buffer.trim()) {
    const lastLine = buffer.trim();
    if (lastLine.startsWith('data: ')) {
      const json = lastLine.slice(6).trim();
      if (json) {
        try {
          const event = JSON.parse(json) as AgentSSEEvent;
          opts.onEvent(event);
        } catch { /* skip */ }
      }
    }
  }

  clearTimeout(timeoutId);
}

// ── Approve / Reject ───────────────────────────────────────
export async function agentApprove(opts: {
  approvalId: string;
  decision: 'approve' | 'reject';
}): Promise<{ ok: boolean; error?: string; status?: string; result?: { success: boolean; summary: string } }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/agent/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify(opts),
    });
    return res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Approval failed' };
  }
}

// ── Sessions ───────────────────────────────────────────────
export async function agentGetSessions(limit = 30): Promise<AgentSession[]> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/agent/sessions?limit=${limit}`, { headers });
    if (!res.ok) return [];
    const json = await res.json();
    return json.sessions || [];
  } catch {
    return [];
  }
}

export async function agentGetSessionMessages(sessionId: string): Promise<AgentMessage[]> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/agent/sessions/${sessionId}`, { headers });
    if (!res.ok) return [];
    const json = await res.json();
    return json.messages || [];
  } catch {
    return [];
  }
}

export async function agentDeleteSession(sessionId: string): Promise<boolean> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/agent/sessions/${sessionId}`, {
      method: 'DELETE',
      headers,
    });
    return res.ok;
  } catch {
    return false;
  }
}
