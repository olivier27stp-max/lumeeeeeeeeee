/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Google Gemini REST wrapper
   ─────────────────────────────────────────────────────────────
   Thin client around the Gemini generateContent endpoint with
   function-calling support. The API key NEVER leaves the server.
   Docs: https://ai.google.dev/gemini-api/docs/function-calling
   ═══════════════════════════════════════════════════════════════ */

import { geminiApiKey, geminiModel } from '../config';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ── Wire types (subset of the Gemini API) ──

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface GeminiFunctionCall {
  name: string;
  id?: string;
  args: Record<string, any>;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    name: string;
    id?: string;
    response: Record<string, any>;
  };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GenerateResult {
  parts: GeminiPart[];
  text: string;
  functionCalls: GeminiFunctionCall[];
  finishReason: string | null;
}

export function isGeminiConfigured(): boolean {
  return Boolean(geminiApiKey);
}

/**
 * Call Gemini once. Returns the model's reply parts split into text and
 * function calls for convenience.
 */
export async function generateContent(opts: {
  systemInstruction: string;
  contents: GeminiContent[];
  functionDeclarations?: FunctionDeclaration[];
  temperature?: number;
  maxOutputTokens?: number;
  disableThinking?: boolean;
}): Promise<GenerateResult> {
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Set it in .env.local to enable the Lume Agent.');
  }

  const generationConfig: Record<string, any> = { temperature: opts.temperature ?? 0.4 };
  // Plafond de tokens de sortie (borne le coût par réponse — utilisé par le
  // chat vendeur public où n'importe qui peut envoyer des messages).
  if (typeof opts.maxOutputTokens === 'number') {
    generationConfig.maxOutputTokens = opts.maxOutputTokens;
  }
  // Gemini 2.5 est un modèle « thinking » : il dépense des tokens à réfléchir
  // AVANT de répondre. Sur une réponse courte plafonnée, ce budget « pensée »
  // mangeait tout le maxOutputTokens et la vraie réponse était coupée
  // (finishReason MAX_TOKENS, texte tronqué). Pour un chat vendeur simple, on
  // coupe la réflexion : réponses complètes, plus rapides et moins chères.
  if (opts.disableThinking) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const body: Record<string, any> = {
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    contents: opts.contents,
    generationConfig,
  };

  if (opts.functionDeclarations && opts.functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations: opts.functionDeclarations }];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(geminiModel)}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': geminiApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let message = `Gemini request failed (${res.status}).`;
    try {
      const parsed = JSON.parse(errText);
      message = parsed?.error?.message || message;
    } catch { /* keep default */ }
    if (res.status === 429) {
      message = 'Lume Agent rate limit reached (Gemini free tier). Try again in a minute.';
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const json: any = await res.json();
  const candidate = json?.candidates?.[0];
  const parts: GeminiPart[] = candidate?.content?.parts || [];

  const text = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();

  const functionCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => p.functionCall as GeminiFunctionCall);

  return {
    parts,
    text,
    functionCalls,
    finishReason: candidate?.finishReason || null,
  };
}

export { geminiModel };
