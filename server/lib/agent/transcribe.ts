/* ═══════════════════════════════════════════════════════════════
   Lume Agent — transcription vocale
   ─────────────────────────────────────────────────────────────
   Le navigateur enregistre l'audio (MediaRecorder) et l'envoie au
   serveur ; Gemini reçoit l'audio en ligne (inlineData) et renvoie la
   transcription. Aucune clé ne quitte le serveur, aucun fournisseur
   de plus que celui de l'agent.
   Docs : https://ai.google.dev/gemini-api/docs/audio
   ═══════════════════════════════════════════════════════════════ */

import { geminiApiKey } from '../config';

/* Pro transcrit juste les noms propres et les montants là où Flash se trompe
   (mesuré sur un échantillon québécois : « Côté », « Tremblay », « 8 h 30 »).
   Il prend ~5 s au lieu de ~2 s ; le texte est relu avant l'envoi, la
   justesse compte plus que la vitesse. Surcharge possible par variable d'env. */
const TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-pro';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Types audio que les navigateurs produisent avec MediaRecorder. */
export const TRANSCRIBE_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac'] as const;
export type TranscribeMimeType = (typeof TRANSCRIBE_MIME_TYPES)[number];

const PROMPT = {
  fr: `Tu transcris un enregistrement vocal. Contexte : la personne dirige une entreprise de services (lavage de vitres, toiture, paysagement, CVAC…) au Québec et parle à son logiciel de gestion. Elle parle en français québécois, parfois avec des mots anglais (job, cash, lead, booké…) : garde-les tels quels.
Vocabulaire fréquent : soumission, devis, facture, client, job, calendrier, horaire, rendez-vous, paie, feuille de temps, relance, rappel, texto, courriel, équipe, tournée, dispatch.
Règles : transcris mot pour mot ce qui est dit, avec la ponctuation, sans rien résumer ni corriger le sens. Écris les nombres en chiffres (« 3 factures », « 1 250 $ », « 8 h 30 »). Ne réponds pas à la personne, ne commente pas, ne traduis pas. Si tu hésites sur un mot, écris ce que tu entends. Si l'audio est vide ou inaudible, renvoie une chaîne vide.`,
  en: `You transcribe a voice recording. Context: the speaker runs a home-service business (window cleaning, roofing, landscaping, HVAC…) in Canada and is talking to their management software. Frequent words: quote, invoice, client, job, calendar, schedule, appointment, payroll, timesheet, follow-up, reminder, text, email, team, route, dispatch.
Rules: transcribe word for word what is said, with punctuation, without summarizing or correcting the meaning. Write numbers as digits ("3 invoices", "$1,250", "8:30"). Do not answer the speaker, do not comment, do not translate. If unsure about a word, write what you hear. If the audio is empty or inaudible, return an empty string.`,
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
      maxOutputTokens: 2048,
      // Pro exige un budget de réflexion > 0 ; on le garde petit. Flash n'en a
      // pas besoin pour transcrire.
      thinkingConfig: { thinkingBudget: /pro/i.test(TRANSCRIBE_MODEL) ? 512 : 0 },
    },
  };
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(TRANSCRIBE_MODEL)}:generateContent`;
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
    .filter((p) => !(p as { thought?: boolean }).thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return text;
}
