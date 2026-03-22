/* ═══════════════════════════════════════════════════════════════
   Gemini Client — Server-side utility for Google Gemini API
   Free tier: Gemini 2.0 Flash — fast, great at structured JSON
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

// ── Circuit Breaker ────────────────────────────────────────
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const MAX_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

function checkCircuit(): void {
  if (consecutiveFailures >= MAX_FAILURES && Date.now() < circuitOpenUntil) {
    throw new Error(`Gemini circuit breaker open — ${MAX_FAILURES} consecutive failures. Retry after ${Math.ceil((circuitOpenUntil - Date.now()) / 1000)}s`);
  }
}

function recordSuccess(): void { consecutiveFailures = 0; }

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_FAILURES) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(`[gemini] Circuit breaker OPEN after ${MAX_FAILURES} failures. Cooldown ${CIRCUIT_COOLDOWN_MS / 1000}s`);
  }
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
}

export interface GeminiChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

// ── Non-streaming call ─────────────────────────────────────

export async function geminiChat(opts: GeminiChatOptions): Promise<GeminiChatResponse> {
  checkCircuit();
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = opts.model || DEFAULT_MODEL;

    // Build contents array from messages
    const contents = opts.messages.map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }));

    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: opts.systemPrompt || undefined,
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxTokens ?? 2048,
        responseMimeType: opts.jsonMode ? 'application/json' : undefined,
      },
    });

    const content = response.text ?? '';
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

    recordSuccess();
    const durationMs = Date.now() - startTime;

    if (durationMs > 10_000) {
      console.warn(`[gemini] Slow call: ${model} took ${(durationMs / 1000).toFixed(1)}s`);
    }

    return { content, inputTokens, outputTokens, durationMs };
  } catch (err: any) {
    recordFailure();
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
  checkCircuit();
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
    for await (const chunk of response) {
      const text = chunk.text ?? '';
      if (text) {
        fullContent += text;
        onToken(text);
      }
    }

    recordSuccess();
    const durationMs = Date.now() - startTime;

    return {
      content: fullContent,
      inputTokens: 0, // Stream doesn't return usage metadata per chunk
      outputTokens: 0,
      durationMs,
    };
  } catch (err: any) {
    recordFailure();
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
    // Quick test — list models or do a tiny generation
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
