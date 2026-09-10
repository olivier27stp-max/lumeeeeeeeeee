/* ═══════════════════════════════════════════════════════════════
   Lume Agent — transcription vocale
   ─────────────────────────────────────────────────────────────
   Le navigateur enregistre l'audio (MediaRecorder) et l'envoie au
   serveur ; Gemini reçoit l'audio en ligne (inlineData) et renvoie la
   transcription. Aucune clé ne quitte le serveur, aucun fournisseur
   de plus que celui de l'agent.
   Docs : https://ai.google.dev/gemini-api/docs/audio
   ═══════════════════════════════════════════════════════════════ */

import { geminiApiKey, geminiModel } from '../config';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Types audio que les navigateurs produisent avec MediaRecorder. */
export const TRANSCRIBE_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac'] as const;
export type TranscribeMimeType = (typeof TRANSCRIBE_MIME_TYPES)[number];

const PROMPT = {
  fr: "Transcris fidèlement ce que dit la personne, en français (Québec), avec la ponctuation. Ne réponds pas, ne commente pas, ne traduis pas : renvoie uniquement le texte dit. Si l'audio est vide ou inaudible, renvoie une chaîne vide.",
  en: 'Transcribe faithfully what the person says, in English, with punctuation. Do not answer, comment or translate: return only the spoken text. If the audio is empty or inaudible, return an empty string.',
} as const;

export async function transcribeAudio(opts: {
  /** Audio encodé en base64 (sans préfixe data:). */
  base64: string;
  mimeType: TranscribeMimeType;
  language: 'fr' | 'en';
}): Promise<string> {
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: opts.mimeType, data: opts.base64 } },
          { text: PROMPT[opts.language] },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      // Modèle « thinking » : inutile pour transcrire, et ça mangeait le budget.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(geminiModel)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let message = `Transcription failed (${res.status}).`;
    try { message = JSON.parse(errText)?.error?.message || message; } catch { /* garder le message par défaut */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return text;
}
