/* ═══════════════════════════════════════════════════════════════
   Ollama Client — Server-side utility for calling Ollama API
   With timeouts, circuit breaker, and structured logging
   ═══════════════════════════════════════════════════════════════ */

import { redactPii } from './pii-redaction';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// Compliance: when Ollama points to a remote host, redact PII from prompts.
// Local (loopback) instances are treated as self-hosted and skipped.
const IS_REMOTE_OLLAMA = !/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(OLLAMA_URL);
const REDACT_PII = process.env.AI_REDACT_PII !== '0' && IS_REMOTE_OLLAMA;

// ── Timeouts ───────────────────────────────────────────────
const CHAT_TIMEOUT_MS = 90_000;   // 90s for non-streaming (model loading + inference)
const STREAM_TIMEOUT_MS = 120_000; // 120s for streaming (longer for scenario engine)
const HEALTH_TIMEOUT_MS = 8_000;   // 8s for health check

// ── Circuit Breaker ────────────────────────────────────────
// After 3 consecutive failures, stop trying for 30 seconds
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const MAX_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

function checkCircuit(): void {
  if (consecutiveFailures >= MAX_FAILURES && Date.now() < circuitOpenUntil) {
    throw new Error(`Ollama circuit breaker open — ${MAX_FAILURES} consecutive failures. Retry after ${Math.ceil((circuitOpenUntil - Date.now()) / 1000)}s`);
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_FAILURES) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(`[ollama] Circuit breaker OPEN after ${MAX_FAILURES} failures. Cooldown ${CIRCUIT_COOLDOWN_MS / 1000}s`);
  }
}

// ── Types ──────────────────────────────────────────────────

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  format?: 'json';
  options?: { temperature?: number; num_predict?: number; top_p?: number };
}

export interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

function redactMessages(messages: OllamaMessage[]): OllamaMessage[] {
  if (!REDACT_PII) return messages;
  const totalCounts: Record<string, number> = {};
  const out = messages.map(m => {
    const r = redactPii(m.content);
    for (const [k, v] of Object.entries(r.counts)) totalCounts[k] = (totalCounts[k] || 0) + v;
    return { ...m, content: r.text };
  });
  const total = Object.values(totalCounts).reduce((a, b) => a + b, 0);
  if (total > 0) console.log(`[ollama] redacted PII (remote): ${JSON.stringify(totalCounts)}`);
  return out;
}

// ── Non-streaming call ─────────────────────────────────────

export async function ollamaChat(opts: OllamaChatOptions): Promise<OllamaChatResponse> {
  checkCircuit();

  const startTime = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...opts, messages: redactMessages(opts.messages), stream: false }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const result = await res.json() as OllamaChatResponse;
    recordSuccess();

    const durationMs = Date.now() - startTime;
    if (durationMs > 10_000) {
      console.warn(`[ollama] Slow call: ${opts.model} took ${(durationMs / 1000).toFixed(1)}s`);
    }

    return result;
  } catch (err: any) {
    recordFailure();
    const durationMs = Date.now() - startTime;
    console.error(`[ollama] Chat failed (${opts.model}, ${durationMs}ms):`, err?.message);
    throw err;
  }
}

// ── Streaming call ─────────────────────────────────────────

export async function ollamaStream(
  opts: Omit<OllamaChatOptions, 'stream'>,
  onChunk: (chunk: OllamaChatResponse) => void,
  signal?: AbortSignal
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  checkCircuit();

  // Combine external signal with timeout
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), STREAM_TIMEOUT_MS);

  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  const startTime = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...opts, messages: redactMessages(opts.messages), stream: true }),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body from Ollama');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as OllamaChatResponse;
          if (chunk.message?.content) {
            fullContent += chunk.message.content;
          }
          if (chunk.done) {
            inputTokens = chunk.prompt_eval_count || 0;
            outputTokens = chunk.eval_count || 0;
          }
          onChunk(chunk);
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Flush remaining buffer
    const remaining = decoder.decode();
    if (remaining.trim()) {
      try {
        const chunk = JSON.parse(remaining) as OllamaChatResponse;
        if (chunk.message?.content) fullContent += chunk.message.content;
        onChunk(chunk);
      } catch { /* skip */ }
    }

    recordSuccess();
    return { content: fullContent, inputTokens, outputTokens };
  } catch (err: any) {
    recordFailure();
    const durationMs = Date.now() - startTime;
    console.error(`[ollama] Stream failed (${opts.model}, ${durationMs}ms):`, err?.message);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Health check ───────────────────────────────────────────

export async function ollamaHealthCheck(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    const models = (data?.models || []).map((m: any) => m.name as string);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}

export function getOllamaUrl(): string {
  return OLLAMA_URL;
}
