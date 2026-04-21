/* ═══════════════════════════════════════════════════════════════
   Gemini Client — Server-side utility for Google Gemini API
   Org-scoped circuit breaker + token cost tracking
   ═══════════════════════════════════════════════════════════════ */

import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_MODEL = 'gemini-2.5-flash';

let clientInstance: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!clientInstance) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
    clientInstance = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return clientInstance;
}

// ── Org-Scoped Circuit Breaker ─────────────────────────────
const MAX_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

interface CircuitState {
  failures: number;
  openUntil: number;
}

const circuits = new Map<string, CircuitState>();

// Cleanup stale circuits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of circuits) {
    if (state.failures === 0 && now > state.openUntil + 60_000) circuits.delete(key);
  }
}, 5 * 60_000);

function getCircuit(orgId: string): CircuitState {
  let state = circuits.get(orgId);
  if (!state) { state = { failures: 0, openUntil: 0 }; circuits.set(orgId, state); }
  return state;
}

function checkCircuit(orgId?: string): void {
  if (!orgId) return; // no org = no scoping (health check etc.)
  const state = getCircuit(orgId);
  if (state.failures >= MAX_FAILURES && Date.now() < state.openUntil) {
    throw new Error(`Gemini circuit breaker open for org — ${MAX_FAILURES} consecutive failures. Retry after ${Math.ceil((state.openUntil - Date.now()) / 1000)}s`);
  }
}

function recordSuccess(orgId?: string): void {
  if (!orgId) return;
  const state = getCircuit(orgId);
  state.failures = 0;
}

function recordFailure(orgId?: string): void {
  if (!orgId) return;
  const state = getCircuit(orgId);
  state.failures++;
  if (state.failures >= MAX_FAILURES) {
    state.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(`[gemini] Circuit breaker OPEN for org ${orgId.slice(0, 8)}… after ${MAX_FAILURES} failures. Cooldown ${CIRCUIT_COOLDOWN_MS / 1000}s`);
  }
}

// ── Token Cost Tracking ────────────────────────────────────
export interface GeminiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  orgId?: string;
  purpose?: string;
}

const usageLog: GeminiUsage[] = [];
const MAX_LOG = 1000;

export function trackUsage(usage: GeminiUsage): void {
  usageLog.push(usage);
  if (usageLog.length > MAX_LOG) usageLog.splice(0, usageLog.length - MAX_LOG);
  console.log(`[gemini] ${usage.purpose || 'call'} | ${usage.model} | in:${usage.inputTokens} out:${usage.outputTokens} | ${usage.durationMs}ms${usage.orgId ? ` | org:${usage.orgId.slice(0, 8)}` : ''}`);
}

export function getUsageStats(orgId?: string): { totalCalls: number; totalInputTokens: number; totalOutputTokens: number } {
  const filtered = orgId ? usageLog.filter(u => u.orgId === orgId) : usageLog;
  return {
    totalCalls: filtered.length,
    totalInputTokens: filtered.reduce((s, u) => s + u.inputTokens, 0),
    totalOutputTokens: filtered.reduce((s, u) => s + u.outputTokens, 0),
  };
}

// ── Types ──────────────────────────────────────────────────

export interface GeminiMessage {
  role: 'user' | 'model';
  content: string;
}

export interface GeminiChatOptions {
  model?: string;
  systemPrompt?: string;
  messages: GeminiMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  orgId?: string;
  purpose?: string;
}

export interface GeminiChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

// ── Non-streaming call ─────────────────────────────────────

export async function geminiChat(opts: GeminiChatOptions): Promise<GeminiChatResponse> {
  checkCircuit(opts.orgId);
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = opts.model || DEFAULT_MODEL;

    const contents = opts.messages.map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }));

    // 60s timeout — Gemini SDK has no signal support, use Promise.race
    const genPromise = client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: opts.systemPrompt || undefined,
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxTokens ?? 2048,
        responseMimeType: opts.jsonMode ? 'application/json' : undefined,
      },
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini request timed out after 60s')), 60_000)
    );
    const response = await Promise.race([genPromise, timeoutPromise]);

    const content = response.text ?? '';
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

    recordSuccess(opts.orgId);
    const durationMs = Date.now() - startTime;

    if (durationMs > 10_000) {
      console.warn(`[gemini] Slow call: ${model} took ${(durationMs / 1000).toFixed(1)}s`);
    }

    trackUsage({ model, inputTokens, outputTokens, durationMs, orgId: opts.orgId, purpose: opts.purpose });

    return { content, inputTokens, outputTokens, durationMs };
  } catch (err: any) {
    recordFailure(opts.orgId);
    const durationMs = Date.now() - startTime;
    console.error(`[gemini] Chat failed (${durationMs}ms):`, err?.message);
    throw err;
  }
}

// ── Streaming call ─────────────────────────────────────────

export async function geminiStream(
  opts: GeminiChatOptions,
  onToken: (token: string) => void,
): Promise<GeminiChatResponse> {
  checkCircuit(opts.orgId);
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = opts.model || DEFAULT_MODEL;

    const contents = opts.messages.map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }));

    const response = await client.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: opts.systemPrompt || undefined,
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 2048,
      },
    });

    let fullContent = '';
    let outputTokens = 0;
    for await (const chunk of response) {
      const text = chunk.text ?? '';
      if (text) {
        fullContent += text;
        onToken(text);
      }
      // Try to capture usage from last chunk
      if (chunk.usageMetadata?.candidatesTokenCount) {
        outputTokens = chunk.usageMetadata.candidatesTokenCount;
      }
    }

    recordSuccess(opts.orgId);
    const durationMs = Date.now() - startTime;

    trackUsage({ model, inputTokens: 0, outputTokens, durationMs, orgId: opts.orgId, purpose: opts.purpose || 'stream' });

    return { content: fullContent, inputTokens: 0, outputTokens, durationMs };
  } catch (err: any) {
    recordFailure(opts.orgId);
    const durationMs = Date.now() - startTime;
    console.error(`[gemini] Stream failed (${durationMs}ms):`, err?.message);
    throw err;
  }
}

// ── Health check ───────────────────────────────────────────

export async function geminiHealthCheck(): Promise<{ ok: boolean; model: string }> {
  try {
    if (!GEMINI_API_KEY) return { ok: false, model: '' };
    const client = getClient();
    const res = await client.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      config: { maxOutputTokens: 5 },
    });
    return { ok: Boolean(res.text), model: DEFAULT_MODEL };
  } catch (err: any) {
    console.warn('[gemini] Health check failed:', err?.message);
    return { ok: false, model: '' };
  }
}
